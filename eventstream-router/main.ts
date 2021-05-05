import {argv, bot, fs, log} from '../botbase';
import {createLogStream, debug, logError} from "./utils";
import * as EventSource from './EventSource';

// TODO: improve logging

export interface eventData {
	$schema: string
	meta: {
		uri: string
		request_id: string
		id: string
		dt: string
		domain: string
		stream: string
		topic: string
		partition: number
		offset: number
	}

	type: 'edit' | 'log' | 'categorize' | 'new'

	namespace: number
	title: string
	comment: string
	parsedcomment: string
	timestamp: number
	user: string
	bot: boolean
	wiki: string
	server_url: string
	server_name: string
	server_script_path: string

	// present for type=edit, categorize, new
	id: number

	// present type=edit, new
	minor: boolean
	patrolled: boolean
	length: {
		old: number // not present for type=new
		new: number
	}
	revision: {
		old: number // not present for type=new
		new: number
	}

	// present for type=log
	log_id: number
	log_type: string
	log_action: string
	log_params: any
	log_action_comment: string
}

class RouteValidator {
	name: string;
	worker: ((data: eventData) => any)
	filter: ((data: eventData) => boolean)
	init: (() => any)
	isValid: boolean
	ready: Promise<void>

	validate(file) {
		this.name = file.replace(/\.js$/, '');
		let route;
		try {
			let routeCls = require('./routes/' + file).default;
			route = new routeCls();
			route.name = this.name;
		} catch (e) {
			log(`Invalid route ${file}: require failed`);
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

log(`[S] Started`);

process.chdir(__dirname);
// For development, specify a file as "-r filename" and only that route will be
// registered, otherwise all files in routes.json are registered.
let files: string[] = argv.r ? [argv.r] : require('./routes.json');
let routes: RouteValidator[] = files.map(file => {
	return new RouteValidator().validate(file);
}).filter(route => {
	return route.isValid;
});

// XXX: consider saving to Redis rather than to NFS every 1 second?
class LastSeen {
	ts: number;

	// Number of milliseconds after which lastSeenTs is to be saved to file
	updateInterval = 1000;

	file = './last-seen.txt';

	constructor() {
		setInterval(() => {
			fs.writeFile(this.file, String(this.ts), err => err && console.log(err));
		}, this.updateInterval);
	}
	read() {
		try {
			return parseInt(fs.readFileSync(this.file).toString());
		} catch (e) {
			return NaN;
		}
	}
	get() {
		return new bot.date(
			((typeof this.ts === 'number') ? this.ts : lastSeen.read())
			* 1000
		);
	}
}
const lastSeen = new LastSeen();

let routerLog = createLogStream('./routerlog.out');

async function main() {
	log('[S] Restarted main');

	const ts = lastSeen.get();
	const tsUsable = ts.isValid() && new bot.date().subtract(7, 'days').isBefore(ts);
	log(`[i] lastSeenTs: ${ts}: ${tsUsable}`);

	let since = !argv.fromNow && tsUsable ? ts : new bot.date();
	let stream = new EventSource(
		`https://stream.wikimedia.org/v2/stream/recentchange?since=${since.toISOString()}`, {
			headers: {
				'User-Agent': bot.options.userAgent
			}
		});

	stream.onopen = function () {
		// EventStreams API drops connection every 15 minutes ([[phab:T242767]])
		// So this will be invoked every time that happens.
		log(`[i] Reconnected`);
	}

	stream.onerror = function (evt) {
		if (evt.type === 'error' && evt.message === undefined) {
			// The every 15 minute connection drop?
			return; // EventSource automatically reconnects. No unnecessary logging.
		}
		log(`[W] Event source encountered error:`);
		logError(evt);

		if (evt.status === 429) { // Too Many Requests, the underlying library doesn't reconnect by itself
			stream.close(); // just to be safe that there aren't two parallel connections
			bot.sleep(5000).then(() => {
				return start(); // restart
			});
		}
		// TODO: handle other errors, ensure auto-reconnection
	}

	stream.onmessage = function (event) {
		let data: eventData = JSON.parse(event.data);
		lastSeen.ts = data.timestamp;
		for (let route of routes) {
			// the filter method is only invoked after the init(), so that init()
			// can change the filter function
			route.ready.then(() => {
				try {
					if (route.filter(data)) {
						routerLog(`Routing to ${route.name}: ${data.title}@${data.wiki}`);
						route.worker(data);
					}
				} catch (e) {
					logError(e, route.name);
				}
			});
		}
	}
}

async function start() {
	await main().catch(err => {
		logError(err);
		start();
	});
}

start();
