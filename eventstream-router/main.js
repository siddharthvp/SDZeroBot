const {fs, bot, log, argv} = require('../botbase');
const EventSource = require('./EventSource');

function logError(err, task) {
	let taskFmt = task ? `[${task}]` : '';
	let stringified;
	if (err.stack) {
		log(`${taskFmt} ${err.stack}`);
	} else if (stringified = stringifyObject(err)) {
		log(`${taskFmt} ${stringified}`);
	} else {
		log(`${taskFmt}`);
		log(err);
	}
}
// JSON.stringify throws on a cyclic object
function stringifyObject(obj) {
	try {
		return JSON.stringify(obj, null, 2);
	} catch (e) {
		return null;
	}
}

function debug(msg) {
	if (argv.debug) {
		log(msg);
	}
}

/**
 * REGISTER ROUTES
 *
 * A route is a JS file that exports a filter function and a worker function.
 * The worker should be equipped to handle duplicated events caused due to
 * reconnections.
 *
 * NOTE: Route files should NOT contain any process.chdir() statements!
 * Avoid executing code at the top level, put any required initializations
 * in an exported init() method, which can be async.
 *
 */

class Route {
	// name: string
	// worker: ((data: any) => any)
	// filter: ((data: any) => boolean)
	// init: Function
	// isValid: boolean
	// ready: Promise<void>

	constructor(file) {
		this.name = file;
		let exported;
		try {
			exported = require('./' + file);
		} catch (e) {
			log(`Invalid route ${this.name}: require() failed`);
			log(e);
			this.isValid = false;
			return;
		}
		this.worker = exported.worker;
		this.filter = exported.filter;
		this.init = exported.init;

		this.isValid = typeof this.filter === 'function' && typeof this.worker === 'function';
		if (!this.isValid) {
			log(`Ignoring ${this.name}: filter or worker is not a function`);
			return;
		}
		this.ready = new Promise((resolve, reject) => {
			if (typeof this.init !== 'function') {
				resolve();
				debug(`[i] Initialized ${this.name} with no initializer`);
			} else {
				Promise.resolve(this.init()).then(() => {
					resolve();
					debug(`[S] Initialized ${this.name}`);
				}, (err) => {
					reject();
					logError(err, this.name);
				});
			}
		});
	}
}

log(`[S] Started`);

process.chdir(__dirname);
// For development, specify a file as "-r filename" and only that route will be
// registered, otherwise all files in the directory are registered.
let files = argv.r ? [argv.r] : fs.readdirSync('.').filter(file => {
	return file.endsWith('.js') && file !== 'main.js';
});
let routes = files.map(file => new Route(file)).filter(route => route.isValid);

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
		console.log(evt);
		logError(evt);

		// TODO: handle other errors, ensure auto-reconnection

		if (evt.status === 429) { // Too Many Requests, the underlying library doesn't reconnect by itself
			stream.close(); // just to be safe that there aren't two parallel connections
			bot.sleep(5000).then(() => {
				return go(); // restart
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

async function go() {
	await main().catch(err => {
		logError(err);
		go();
	});
}

go();
