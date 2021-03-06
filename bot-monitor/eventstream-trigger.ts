import { exec } from 'child_process';
import { Route } from "../eventstream-router/app";

export default class botActivityMonitor extends Route {
	name = "bot-activity-monitor";

	async init() {
		super.init();
		this.log('[S] Started');
	}

	filter(data): boolean {
		return data.wiki === 'enwiki' &&
			data.title === 'Wikipedia:Bot activity monitor/Configurations';
	}

	async worker(data) {
		// run crontab command for bot-activity monitor
		this.log(`[+] Triggering BAM run following config edit by ${data.user} at ${data.timestamp}`);
		exec('jsub -quiet -N bot-monitor -mem 2g ~/bin/node ~/SDZeroBot/bot-monitor/main.js');
	}
}
