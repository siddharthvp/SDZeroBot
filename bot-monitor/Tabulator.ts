import {bot, Mwn, log, argv, enwikidb} from "../botbase";
import {Monitor} from './index';

import * as moment from "moment";

export class Tabulator {
	static rootpage = 'Wikipedia:Bot activity monitor' + (argv.fake ? '/sandbox' : '');

	static table: InstanceType<typeof Mwn.table>;
	static invalidRules: { task: string, reason: string }[] = []

	static init() {
		this.table = new Mwn.table();
		this.table.addHeaders([
			{label: 'Bot'},
			{label: 'Task'},
			{label: 'Status'}
		]);
	}

	static add(monitor: Monitor, success: boolean) {
		let rule = monitor.rule || monitor.rawRule,
			actions = monitor.actions,
			msg;
		if (!success) {
			msg = `${actions} action${s(actions)} in last ${rule.duration}, expected at least ${rule.minEdits}. `;
			if (monitor.lastSeen) {
				msg += `Last seen ${monitor.lastSeen.format('D MMMM YYYY')}`;
			} else if (monitor.lastSeenNot) {
				msg += `Not seen in more than ${moment(monitor.lastSeenNot).fromNow().replace(/ ago$/, '')}.`;
			} else {
				msg += `No matching actions found since the beginning of time.`;
			}
			log(`[W] ${rule.bot}: ${rule.task}: ${msg}`);
		}
		this.table.addRow([
			`[[User:${rule.bot}|${rule.bot}]]`,
			rule.task,
			success ? '{{tick}}' : `{{cross}} ${msg}`
		]);
	}

	static addError(monitor: Monitor, err: Error) {
		let rule = monitor.rule || monitor.rawRule;
		this.table.addRow([
			`[[User:${rule.bot}|${rule.bot}]]`,
			rule.task,
			`{{hmmm}} Error while checking: ${err?.code || ''}`
		]);
	}

	static async whineAboutRuleErrors() {
		let msg;
		if (this.invalidRules.length) {
			let table = new Mwn.table();
			table.addHeaders([
				'Bot and task',
				'Configuration error'
			]);
			this.invalidRules.forEach(({task, reason}) => table.addRow([task, reason]));
			msg = `The following entries at [[${Monitor.configpage}]] are malformed. Please fix:\n`;
			msg += table.getText();
		} else {
			msg = '{{tick}} No configuration errors';
		}
		await new bot.page(this.rootpage + '/Errors').save(msg, `Updating ${argv.fake ? '(testing)': ''}`);
		log(`[V] Saved error report on-wiki`);
	}

	static async postResults() {
		let replagHours;
		try {
			replagHours = await new enwikidb().getReplagHours();
		} catch (e) {}
		let text = '== Current status report ==\n' +
			(replagHours > 6 ? `{{hatnote|1=Database replication lag is ${replagHours} hours; as a result some bots may not be working}}\n` : '') +
			'<noinclude>' + Mwn.template('/header', {
				errcount: this.invalidRules.length ? String(this.invalidRules.length) : null
			}) + '</noinclude>\n' +
			Tabulator.table.getText();
		if (argv.dry) {
			return console.log(text);
		}
		await new bot.page(this.rootpage + '/Report').save(text, `Updating ${argv.fake ? '(testing)': ''}`);
		log(`[V] Saved report on-wiki`);
		await Tabulator.whineAboutRuleErrors();
	}
}

// plural s or not
function s(num: number) {
	return num === 1 ? '' : 's';
}
