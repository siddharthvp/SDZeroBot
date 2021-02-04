import {bot, fs} from "../botbase";
import type {eventData} from "./main";
import {stringifyObject} from "./utils";

/**
 * REGISTER ROUTES
 *
 * A route should default export a class extending Route, which defines the
 * filter and worker methods. The worker should be idempotent, that is, it
 * must handle the scenario of the same event being passed to it multiple times,
 * which could occur due to reconnections.
 *
 * NOTE: Route files should NOT contain any process.chdir() statements!
 * Avoid executing code at the top level, put any required initializations
 * in the class init() method, which can be async.
 *
 */

export abstract class Route {
	name: string;
	log: ((msg: any) => void);

	init(): void | Promise<void> {
		this.log = this.createLogStream('./' + this.name + '.out');
	}

	filter(data: eventData): boolean {
		return true;
	}

	abstract worker(data: eventData);

	createLogStream(file: string) {
		let stream = fs.createWriteStream(file, {
			flags: 'a',
			encoding: 'utf8'
		});

		return function (msg) {
			let ts = new bot.date().format('YYYY-MM-DD HH:mm:ss');
			let stringified;
			if (typeof msg === 'string') {
				stream.write(`[${ts}] ${msg}\n`);
			} else if (stringified = stringifyObject(msg)) {
				stream.write(`[${ts}] ${stringified}\n`);
			} else {
				stream.write(`[${ts}] [Non-stringifiable object!]\n`);
			}
		};
	}
}