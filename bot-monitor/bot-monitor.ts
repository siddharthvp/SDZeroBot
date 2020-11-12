import {argv, bot, emailOnError, log, mwn, fs, path} from '../botbase';
import {MwnDate} from "../../mwn/src/bot";
import {ApiQueryLogEventsParams, ApiQueryUserContribsParams} from "../../mwn/src/api_params";
import {LogEvent, UserContribution} from "../../mwn/src/user";

import {Tabulator} from "./Tabulator";
import {ChecksDb} from "./ChecksDb";

export interface RawRule {
	bot: string
	task: string
	action: string
	namespace: number | number[]
	pages: string
	summary: string
	minEdits: number
	duration: string
	alertMode: 'email' | 'talkpage' | 'ping'
	alertpage: string
	emailuser: string
	header: string
	pingUser: string
}
export interface Rule {
	bot: string
	task: string
	action: string
	namespace: number | number[]
	titleRegex?: RegExp
	summaryRegex?: RegExp
	minEdits: number
	duration: string
	fromDate: MwnDate
	alertMode: 'email' | 'talkpage' | 'ping'
	alertPage: string
	emailUser: string
	header: string
	pingUser: string
}

class RuleError extends Error {
	constructor(msg) {
		super(msg);
	}
}

export function debug(str) {
	if (argv.verbose) {
		log(str);
	}
}


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


	static pingpage = 'Wikipedia:Bot activity monitor/Pings'
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
			this.rule = await this.parseRule(rule);
			await this.checkActions();
		} catch (err) {
			return this.handleError(err);
		}
	}

	static getFromDate(duration = '1 day', times = 1): MwnDate {
		try {
			let durationParts = duration.split(' ');
			let num = parseInt(durationParts[0]);
			let unit = durationParts[1];
			// @ts-ignore
			return new bot.date().subtract(num * times, unit);
		} catch(err) {
			throw new RuleError(`Invalid duration: ${duration}: ${err.message}`);
		}
	}

	async parseRule(rule: RawRule): Promise<Rule> {
		let fromDate = Monitor.getFromDate(rule.duration);

		if (typeof rule.namespace === 'string') {
			throw new RuleError(`Invalid namespace: ${rule.namespace}`);
		}
		if (!rule.bot) {
			throw new RuleError(`No bot account specified!`);
		}
		if (rule.alertpage) {
			let title = bot.title.newFromText(rule.alertpage);
			if (!title) {
				throw new RuleError(`Invalid alert page: ${rule.alertpage}`);
			} else if (title.namespace === 0) {
				throw new RuleError(`Invalid alert page: ${rule.alertpage}`);
			}
		}
		if (rule.minEdits && typeof rule.minEdits !== 'number') {
			throw new RuleError(`Invalid minEdits: ${rule.minEdits}: must be a numbeer`);
		}

		return {
			bot: rule.bot,
			task: rule.task || '',
			action: rule.action || 'edit',
			namespace: rule.namespace,
			duration: rule.duration || '1 day',
			fromDate,
			titleRegex: rule.pages && (rule.pages.startsWith('#') ?
				new RegExp('^' + rule.pages.slice(1) + '$') :
				new RegExp('^' + mwn.util.escapeRegExp(rule.pages) + '$')
			),
			summaryRegex: rule.summary && (rule.summary.startsWith('#') ?
				new RegExp('^' + rule.summary.slice(1) + '$') :
				new RegExp('^' + mwn.util.escapeRegExp(rule.summary) + '$')
			),
			alertMode: rule.alertMode || 'talkpage',
			alertPage: rule.alertpage || 'User talk:' + rule.bot,
			emailUser: rule.emailuser || rule.bot,
			pingUser: rule.pingUser,
			header: rule.header,
			minEdits: rule.minEdits || 1
		};
	}

	async checkActions() {
		this.lastSeenDb = await ChecksDb.getLastSeen(this.rawRule);
		let check = this.rule.action === 'edit' ? await this.checkContribs() : await this.checkLogs();
		Tabulator.add(this, check);
		if (!check) { // Not OK
			await this.alert();
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
				end: Monitor.getFromDate(this.rule.duration, 4)
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


	async alert() {
		log(`Failing: ${this.name}: only ${this.actions} actions, expected at least ${this.rule.minEdits}`);
		if (argv.dry) {
			return;
		}

		if (this.rule.alertMode === 'talkpage') {
			await this.alertTalkPage();
		} else if (this.rule.alertMode === 'email') {
			await this.alertEmail();
		} else if (this.rule.alertMode === 'ping') {
			await this.alertPing();
		} else if (!this.rule.alertMode) {
			throw new RuleError(`Invalid alert mode: ${this.rule.alertMode}: must be "talkpage", "email" or "ping"`);
		}
	}

	async alertTalkPage() {
		await new bot.page(this.rule.alertPage).newSection(
			this.getHeader(),
			this.getMessage() + ' ~~~~',
			{redirect: true, nocreate: true}
		).catch(err => {
			if (err.code === 'missingtitle') {
				throw new RuleError(`Missing alert page: ${this.rule.alertPage}`);
			} else if (err.code === 'protectedpage') {
				throw new RuleError(`Alert page is protected: ${this.rule.alertPage}`);
			} else throw err;
		});
	}

	async alertEmail() {
		await new bot.user(this.rule.emailUser).email(
			this.getHeader(),
			this.getMessage(),
			{ccme: true}
		).catch(err => {
			if (err.code === 'notarget') {
				throw new RuleError(`Invalid username for email: ${this.rule.emailUser}`);
			} else if (err.code === 'nowikiemail') {
				throw new RuleError(`Email is disabled for ${this.rule.emailUser}`);
			} else throw err;
		});
	}

	async alertPing() {
		let pingUser = this.rule.pingUser || await getBotOperator(this.rule.bot) || this.rule.bot;
		await new bot.page(Monitor.pingpage).edit((rev) => {
			return {
				appendtext: `{{re|${pingUser}}} ${this.rule.bot}'s task ${this.rule.task} failed: found ${this.actions} ${this.rule.action === 'edit' ? 'edits' : 'log actions'} against ${this.rule.minEdits} expected.`,
				summary: `Reporting [[:User:${this.rule.bot}|${this.rule.bot}]]: ${this.rule.task}`
			}
		})
	}

	getHeader() {
		if (typeof this.rule.header === 'string') {
			return this.rule.header
				.replace('$TASK', this.rule.task.replace(/\$/g, '$$$$'))
				.replace('$BOT', this.rule.bot.replace(/\$/g, '$$$$'));
		}
		return `${this.rule.task} failure`; // default
	}

	getMessage() {
		return `The bot task ${this.name} failed to run per the requirements specified at [[${Monitor.configpage}]]. Found only ${this.actions} ${this.rule.action === 'edit' ? 'edits' : 'log actions'}, expected ${this.rule.minEdits}.`;
	}


	handleError(err) {
		if (err instanceof RuleError) {
			// It's the user's fault
			// TODO: notify on-wiki
			log(`[W] Invalid rule for ${this.name}: ${err.message}`);
			Tabulator.invalidRules.push({task: this.name, reason: err.message})
		} else {
			emailOnError(err, 'bot-monitor (non-fatal)');
		}
	}

}

export async function getBotOperator(botName: string) {
	try {
		const userpage = await new bot.user(botName).userpage.text();
		const rgx = /\{\{[bB]ot\s*\|\s*([^|}]*)/;
		const match = rgx.exec(userpage);
		if (!match) {
			return null;
		}
		return match[1];
	} catch (e) {
		if (e.code !== 'missingtitle') {
			log(`[E] Unexpected error getting operator name: ${e}`);
		}
		return null;
	}
}

export async function fetchRules(): Promise<RawRule[]> {
	return !argv.fake ?
		await bot.parseJsonPage(Monitor.configpage) :
		JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-config.json')).toString())
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
