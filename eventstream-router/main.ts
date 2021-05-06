import { argv, bot, log, path } from '../botbase';
import * as EventSource from './EventSource';
import { RouteValidator } from "./RouteValidator";
import { RecentChangeStreamEvent } from "./RecentChangeStreamEvent";
import { LastSeen } from "./LastSeen";
import { createLogStream, logError, pageFromCategoryEvent } from "./utils";

// TODO: improve logging

log(`[S] Started`);

process.chdir(__dirname);

// For development, specify a file as "-r filename" and only that route will be
// registered, otherwise all files in routes.json are registered.
let files: Record<string, string> = argv.r ? { [path.basename(argv.r)]: argv.r } : require('./routes.json');
let routes: RouteValidator[] = Object.entries(files).map(([name, file]) => {
	return new RouteValidator(name).validate(file);
}).filter(route => {
	return route.isValid;
});

const lastSeen = new LastSeen();

const routerLog = createLogStream('./routerlog.out');
function addToRouterLog(routeName: string, data: RecentChangeStreamEvent) {
	let catNote = '';
	if (data.type === 'categorize') {
		let page = pageFromCategoryEvent(data);
		if (page) {
			catNote = (page.added ? '+' : '–') + page.title + '@';
		}
	}
	routerLog(`Routing to ${routeName}: ${catNote}${data.title}@${data.wiki}`);
}

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
		let data: RecentChangeStreamEvent = JSON.parse(event.data);
		lastSeen.ts = data.timestamp;
		for (let route of routes) {
			// the filter method is only invoked after the init(), so that init()
			// can change the filter function
			route.ready.then(() => {
				try {
					if (route.filter(data)) {
						addToRouterLog(route.name, data);
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
