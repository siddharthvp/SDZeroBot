import { Route } from "../eventstream-router/app";
import { invokeCronJob } from "../k8s";

export default class BotActivityMonitor extends Route {
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
		this.log(`[+] Triggering BAM run following config edit by ${data.user} at ${data.timestamp}`);
		invokeCronJob('bot-monitor');
	}
}
