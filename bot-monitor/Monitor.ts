import {bot, emailOnError, log} from '../botbase';
import {MwnDate} from "../../mwn/src/bot";
import {ApiQueryLogEventsParams, ApiQueryUserContribsParams} from "../../mwn/src/api_params";
import {LogEvent, UserContribution} from "../../mwn/src/user";

import {Alert, ChecksDb, debug, getFromDate, parseRule, RawRule, Rule, RuleError, Tabulator} from './internal'

export class Monitor {
	name: string
	rule: Rule
	rawRule: RawRule

	actions = 0;
	// last checked edit that was matching
	lastSeen: MwnDate;
	// last checked edit where no edit was matching
	lastSeenNot: MwnDate;
	// SQLite DB row
	lastSeenDb: { name: string, rulehash: string, checkts: string, lastseents: string, notseen: number } | undefined;

	static configpage = 'Wikipedia:Bot activity monitor/config.json'

	async monitor(rule: RawRule) {
		this.name = (rule.bot || '[UNNAMED BOT]') + (rule.task ? ': ' + rule.task : '');
		debug(`[i] Checking ${this.name}`);
		this.rawRule = rule;
		try {
			if (await ChecksDb.checkCached(rule)) {
				Tabulator.add(this, true);
				log(`[i] Skipped check for ${rule.task}`);
				return;
			}
			this.rule = parseRule(rule);
			await this.checkActions();
		} catch (err) {
			return this.handleError(err);
		}
	}

	async checkActions() {
		this.lastSeenDb = await ChecksDb.getLastSeen(this.rawRule);
		let check = this.rule.action === 'edit' ? await this.checkContribs() : await this.checkLogs();
		Tabulator.add(this, check);
		if (!check) { // Not OK
			// await this.alert();
			await new Alert(this).alert();
		} else { // OK
			log(`[S] ${this.rule.task} on track`);
		}
	}

	async checkContribs() {
		debug(`[i] Checking edits of ${this.rule.bot}`);
		var ucParams: ApiQueryUserContribsParams = {
			ucnamespace: this.rule.namespace,
			ucend: moreRecent(new bot.date(this.lastSeenDb?.checkts), this.rule.fromDate),
			ucprop: ['title', 'comment', 'timestamp'],
			uclimit: 100 // items retrieved in one API call
		};
		for await (let edit of new bot.user(this.rule.bot).contribsGen(ucParams)) {
			if (this.checkEdit(edit)) {
				if (++this.actions >= this.rule.minEdits) {
					await ChecksDb.update(this.rawRule, edit.timestamp);
					return true;
				}
			}
		}
		// If we reach here, something's off with the task, find the last matching action
		await this.getLastSeen(ucParams, false);
		return false;
	}

	async checkLogs() {
		debug(`[i] Checking logs of ${this.rule.bot}`);
		let apiParams: ApiQueryLogEventsParams = {
			leprop: ['title', 'comment', 'timestamp'],
			leend: moreRecent(new bot.date(this.lastSeenDb?.checkts), this.rule.fromDate),
			lelimit: 100 // items retrieved in one API call
		};
		// if multiple namespaces are given, can't filter them via the API
		// call itself.
		if (typeof this.rule.namespace === 'number') {
			apiParams.lenamespace = this.rule.namespace;
		}
		if (this.rule.action.includes('/')) {
			// @ts-ignore
			apiParams.leaction = this.rule.action;
		} else {
			// @ts-ignore
			apiParams.letype = this.rule.action;
		}
		try {
			for await (let action of new bot.user(this.rule.bot).logsGen(apiParams)) {
				if (this.checkLogEvent(action)) {
					if (++this.actions >= this.rule.minEdits) {
						await ChecksDb.update(this.rawRule, action.timestamp);
						return true;
					}
				}
			}
			await this.getLastSeen(apiParams, true);
			return false;
		} catch (e) {
			// badvalue: for unrecognized letype
			// unknown_leaction: for unrecognized leaction
			if (e.code === 'badvalue' || e.code === 'unknown_leaction') {
				throw new RuleError(`Invalid action type: ${this.rule.action} (${e.info})`);
			} else throw e;
		}
	}

	async getLastSeen(apiParams: ApiQueryLogEventsParams | ApiQueryUserContribsParams, forLogs: boolean) {
		debug(`[i] Getting last seen of ${this.name}`);
		function listParams(params) {
			let prefix = forLogs ? 'le' : 'uc';
			let fixedParams = {};
			for (let [key, val] of Object.entries(params)) {
				fixedParams[prefix + key] = val;
			}
			return fixedParams;
		}

		let json = await bot.request({
			action: 'query',
			list: forLogs ? 'logevents' : 'usercontribs',
			...apiParams,
			...listParams({
				user: this.rule.bot,
				limit: 'max',
				start: this.rule.fromDate,
				end: this.lastSeenDb?.checkts // could be undefined, which fits
			})
		});
		let actions = json.query.usercontribs || json.query.logevents;
		let checkAction = forLogs ? this.checkLogEvent.bind(this) : this.checkEdit.bind(this);
		for (let action of actions) {
			if (checkAction(action)) {
				this.lastSeen = new bot.date(action.timestamp);
				await ChecksDb.updateLastSeen(this.rawRule, action.timestamp);
				return;
			}
		}
		if (this.lastSeenDb) {
			debug(`[i] Filling in last seen from db`);
			if (this.lastSeenDb.notseen) {
				this.lastSeenNot = new bot.date(this.lastSeenDb.lastseents);
			} else {
				this.lastSeen = new bot.date(this.lastSeenDb.lastseents);
			}
			return;
		}

		// We reach here only if lastSeen was not stored in db,
		// which means we queried with end=undefined above
		let lastAction = actions[actions.length - 1];
		if (!lastAction) {
			// There are no edits at all! A "never seen" situation.
			// Likely a mis-configured rule. Don't set any lastSeen
			// related prop. Tabulator shows no edits since beginning of time
			return;
		}
		debug(`[i] Still getting last seen of ${this.name}: Try with time`);
		let lastSeenNot = lastAction.timestamp;
		for await (let action of new bot.user(this.rule.bot)[forLogs ? 'logsGen' : 'contribsGen']({
			...apiParams,
			...listParams({
				start: lastAction.timestamp,
				end: getFromDate(this.rule.duration, 4)
			})
		})) {
			if (checkAction(action)) {
				this.lastSeen = new bot.date(action.timestamp);
				await ChecksDb.updateLastSeen(this.rawRule, action.timestamp);
				return;
			} else {
				lastSeenNot = action.timestamp;
			}
		}
		this.lastSeenNot = new bot.date(lastSeenNot);
		await ChecksDb.updateLastSeen(this.rawRule, lastSeenNot, true);
	}


	checkEdit(edit: UserContribution) {
		return (
			(!this.rule.titleRegex || this.rule.titleRegex.test(edit.title)) &&
			(!this.rule.summaryRegex || this.rule.summaryRegex.test(edit.comment))
		);
	}

	checkLogEvent(event: LogEvent) {
		return (
			(!this.rule.titleRegex || this.rule.titleRegex.test(event.title)) &&
			(!this.rule.summaryRegex || this.rule.summaryRegex.test(event.comment)) &&
			(!Array.isArray(this.rule.namespace) || this.rule.namespace.includes(event.ns))
		);
	}

	handleError(err) {
		if (err instanceof RuleError) {
			// It's the user's fault
			log(`[W] Invalid rule for ${this.name}: ${err.message}`);
			Tabulator.invalidRules.push({task: this.name, reason: err.message})
		} else {
			emailOnError(err, 'bot-monitor (non-fatal)');
		}
	}

}


function moreRecent(date1, date2) {
	// relies on the fact that new Date(undefined) is an invalid date
	if (!date1.isValid()) {
		return date2;
	} else if (!date2.isValid()) {
		return date1;
	}
	return date1.isAfter(date2) ? date1: date2;
}
