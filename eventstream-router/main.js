"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const botbase_1 = require("../botbase");
const EventSource = require("./EventSource");
function logError(err, task) {
    let taskFmt = task ? `[${task}]` : '';
    let stringified;
    if (err.stack) {
        botbase_1.log(`${taskFmt} ${err.stack}`);
    }
    else if (stringified = stringifyObject(err)) {
        botbase_1.log(`${taskFmt} ${stringified}`);
    }
    else {
        botbase_1.log(`${taskFmt}`);
        console.log(err);
    }
}
// JSON.stringify throws on a cyclic object
function stringifyObject(obj) {
    try {
        return JSON.stringify(obj, null, 2);
    }
    catch (e) {
        return null;
    }
}
function debug(msg) {
    if (botbase_1.argv.debug) {
        botbase_1.log(msg);
    }
}
/**
 * REGISTER ROUTES
 *
 * A route is a JS file that exports a filter function and a worker function.
 * The worker should be idempotent, that is, it must handle the scenario of the
 * same event being passed to it multiple times, which could occur due to
 * reconnections.
 *
 * NOTE: Route files should NOT contain any process.chdir() statements!
 * Avoid executing code at the top level, put any required initializations
 * in an exported init() method, which can be async.
 *
 */
class Route {
    constructor(file) {
        this.name = file;
        let exported;
        try {
            exported = require('./' + file);
        }
        catch (e) {
            botbase_1.log(`Invalid route ${this.name}: require() failed`);
            botbase_1.log(e);
            this.isValid = false;
            return;
        }
        this.worker = exported.worker;
        this.filter = exported.filter;
        this.init = exported.init;
        this.isValid = typeof this.filter === 'function' && typeof this.worker === 'function';
        if (!this.isValid) {
            botbase_1.log(`Ignoring ${this.name}: filter or worker is not a function`);
            return;
        }
        this.ready = new Promise((resolve, reject) => {
            if (typeof this.init !== 'function') {
                resolve();
                debug(`[i] Initialized ${this.name} with no initializer`);
            }
            else {
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
botbase_1.log(`[S] Started`);
process.chdir(__dirname);
// For development, specify a file as "-r filename" and only that route will be
// registered, otherwise all files in the directory are registered.
let files = botbase_1.argv.r ? [botbase_1.argv.r] : botbase_1.fs.readdirSync('.').filter(file => {
    return file.endsWith('.js') && file !== 'main.js';
});
let routes = files.map(file => new Route(file)).filter(route => route.isValid);
// Number of milliseconds after which lastSeenTs is to be saved to file
const lastSeenUpdateInterval = 1000;
let lastSeenTs;
setInterval(function () {
    botbase_1.fs.writeFile('./last-seen.txt', String(lastSeenTs), err => err && console.log(err));
}, lastSeenUpdateInterval);
async function main() {
    botbase_1.log('[S] Restarted main');
    let lastTs;
    try {
        lastTs = (typeof lastSeenTs === 'number') ? lastSeenTs * 1000 :
            parseInt(botbase_1.fs.readFileSync('./last-seen.txt').toString()) * 1000;
    }
    catch (e) { }
    const ts = new botbase_1.bot.date(lastTs);
    const tsUsable = ts.isValid() && new botbase_1.bot.date().subtract(7, 'days').isBefore(ts);
    botbase_1.log(`[i] lastSeenTs: ${ts}: ${tsUsable}`);
    let since = !botbase_1.argv.fromNow && tsUsable ? ts : new botbase_1.bot.date();
    let stream = new EventSource(`https://stream.wikimedia.org/v2/stream/recentchange?since=${since.toISOString()}`, {
        headers: {
            'User-Agent': botbase_1.bot.options.userAgent
        }
    });
    stream.onopen = function () {
        // EventStreams API drops connection every 15 minutes ([[phab:T242767]])
        // So this will be invoked every time that happens.
        botbase_1.log(`[i] Reconnected`);
    };
    stream.onerror = function (evt) {
        if (evt.type === 'error' && evt.message === undefined) {
            // The every 15 minute connection drop?
            return; // EventSource automatically reconnects. No unnecessary logging.
        }
        botbase_1.log(`[W] Event source encountered error:`);
        logError(evt);
        // TODO: handle other errors, ensure auto-reconnection
        if (evt.status === 429) { // Too Many Requests, the underlying library doesn't reconnect by itself
            stream.close(); // just to be safe that there aren't two parallel connections
            botbase_1.bot.sleep(5000).then(() => {
                return start(); // restart
            });
        }
    };
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
                }
                catch (e) {
                    logError(e, route.name);
                }
            });
        }
    };
}
async function start() {
    await main().catch(err => {
        logError(err);
        start();
    });
}
start();
//# sourceMappingURL=main.js.map