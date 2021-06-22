import * as fs from 'fs';
import { Route } from "../app";

export default class Task extends Route {
	async init() {
		super.init();
		this.log('[S] Started');

		setInterval(() => {
			fs.writeFile('./bots.out', JSON.stringify(this.bots, null, 4), err => err && console.log(err));
		}, 5000);
	}

	filter(data): boolean {
		return data.wiki === 'enwiki' &&
			data.bot === true &&
			(data.type === "edit" || data.type === "log");
	}

	bots = {};

	async worker(data) {
		let sanitisedCmt = (data.comment || data.log_action_comment)
			.replace(/\[\[:?(?:[^\|\]]+?\|)?([^\]\|]+?)\]\]/g, "$1")
			.replace(/[^\w\s]/g, '')
			.replace(/\d/g, '')
			.trim();

		this.log(sanitisedCmt);

		let words = sanitisedCmt.split(/\s/g);

		words = words.filter(word => {
			return !/bots?/i.test(word) && !/task/i.test(word);
		});

		let start = words.slice(0, 3).join(' ');

		if (!this.bots[data.user]) {
			this.bots[data.user] = {
				[start]: true
			}
		} else {
			this.bots[data.user][start] = true;
		}

		this.log(`${data.user}: ${start} [on ${data.title}]\n`);
	}
}
