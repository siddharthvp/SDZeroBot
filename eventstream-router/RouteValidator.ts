import { log } from "../botbase";
import { debug, logError } from "./utils";
import { RecentChangeStreamEvent } from "./RecentChangeStreamEvent";

export class RouteValidator {
	name: string;
	worker: ((data: RecentChangeStreamEvent) => any)
	filter: ((data: RecentChangeStreamEvent) => boolean)
	init: (() => any)
	isValid: boolean
	ready: Promise<void>

	constructor(name) {
		this.name = name;
	}

	validate(file) {
		let route;
		try {
			let routeCls = require(file).default;
			route = new routeCls();
			route.name = this.name;
		} catch (e) {
			log(`Invalid route "${file}": require failed`);
			log(e);
			this.isValid = false;
			return;
		}
		this.worker = route.worker.bind(route);
		this.filter = route.filter.bind(route);
		this.init = route.init.bind(route);

		if (typeof this.filter !== 'function' || typeof this.worker !== 'function') {
			log(`Invalid route ${route.name}: filter or worker is not a function`);
			this.isValid = false;
			return;
		}
		this.ready = new Promise((resolve, reject) => {
			if (typeof this.init !== 'function') {
				resolve();
				debug(`[i] Initialized ${route.name} with no initializer`);
			} else {
				Promise.resolve(this.init()).then(() => {
					resolve();
					debug(`[S] Initialized ${route.name}`);
				}, (err) => {
					reject();
					logError(err, route.name);
				});
			}
		});
		this.isValid = true;
		return this;
	}
}
