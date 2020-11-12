import {bot, mwn, log, argv} from "../botbase";
import {Monitor} from "./bot-monitor";
import moment = require("moment");

export class Tabulator {
	static rootpage = 'user:SD0001/Bot activity monitor';

	static table: InstanceType<typeof mwn.table>;
	static invalidRules: { task: string, reason: string }[] = []

	static init() {
		this.table = new mwn.table();
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
			rule.bot,
			rule.task,
			success ? '{{tick}}' : `{{cross}} ${msg}`
		]);
	}

	static async whineAboutRuleErrors() {
		let msg;
		if (this.invalidRules.length) {
			let table = new mwn.table();
			table.addHeaders([
				'Bot and task',
				'Configuration error'
			]);
			this.invalidRules.forEach(({task, reason}) => table.addRow([task, reason]));
			let msg = `The following entries at [[${Monitor.configpage}]] are malformed. Please fix:\n`;
			msg += table.getText();
		} else {
			msg = '{{tick}} No configuration errors';
		}
		await new bot.page(this.rootpage + '/Errors').save(msg, `Updating ${argv.fake ? '(testing)': ''}`);
	}

	static async postResults() {
		let text = Tabulator.table.getText();
		await new bot.page(this.rootpage + '/Report').save(text, `Updating ${argv.fake ? '(testing)': ''}`);
		await Tabulator.whineAboutRuleErrors();
	}
}

// plural s or not
export function s(num: number) {
	return num === 1 ? '' : 's';
}
