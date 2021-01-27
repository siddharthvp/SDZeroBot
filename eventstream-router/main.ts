import {fs, bot, log, argv} from '../botbase';
import EventSource = require('./EventSource');

export function logError(err, task?) {
	let taskFmt = task ? `[${task}]` : '';
	let stringified;
	if (err.stack) {
		log(`${taskFmt} ${err.stack}`);
	} else if (stringified = stringifyObject(err)) {
		log(`${taskFmt} ${stringified}`);
	} else {
		log(`${taskFmt}`);
		console.log(err);
	}
}

// JSON.stringify throws on a cyclic object
export function stringifyObject(obj) {
	try {
		return JSON.stringify(obj, null, 2);
	} catch (e) {
		return null;
	}
}

export function debug(msg) {
	if (argv.debug) {
		log(msg);
	}
}

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

class RouteValidator {
	name: string;
	worker: ((data: eventData) => any)
	filter: ((data: eventData) => boolean)
	init: (() => any)
	isValid: boolean
	ready: Promise<void>

	validate(file) {
		this.name = file;
		let route;
		try {
			let routeCls = require('./' + file).default;
			route = new routeCls();
			route.name = file;
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
		return this;
	}
}

log(`[S] Started`);

process.chdir(__dirname);
// For development, specify a file as "-r filename" and only that route will be
// registered, otherwise all files in routes.json are registered.
let files: string[] = argv.r ? [argv.r] : require('./routes.json');
let routes: RouteValidator[] = files.map(file => new RouteValidator().validate(file)).filter(route => route.isValid);

// Number of milliseconds after which lastSeenTs is to be saved to file
const lastSeenUpdateInterval = 1000;

let lastSeenTs;
setInterval(function () {
	fs.writeFile('./last-seen.txt', String(lastSeenTs), err => err && console.log(err));
}, lastSeenUpdateInterval);

async function main() {
	log('[S] Restarted main');

	let lastTs;
	try {
		lastTs = (typeof lastSeenTs === 'number') ? lastSeenTs * 1000 :
			parseInt(fs.readFileSync('./last-seen.txt').toString()) * 1000;
	} catch (e) {}
	const ts = new bot.date(lastTs);
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

		// TODO: handle other errors, ensure auto-reconnection

		if (evt.status === 429) { // Too Many Requests, the underlying library doesn't reconnect by itself
			stream.close(); // just to be safe that there aren't two parallel connections
			bot.sleep(5000).then(() => {
				return start(); // restart
			});
		}
	}

	stream.onmessage = function (event) {
		let data = JSON.parse(event.data);
		lastSeenTs = data.timestamp;
		for (let route of routes) {
			// the filter method is only invoked after the init(), so that init()
			// can change the filter function
			route.ready.then(() => {
				try {
					if (route.filter(data)) {
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
