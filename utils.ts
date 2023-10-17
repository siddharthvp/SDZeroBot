import { bot, fs, log } from "./botbase";
import { spawn } from "child_process";
import { ENWIKI_DB_HOST, TOOLS_DB_HOST, enwikidb, toolsdb } from "./db";
import { getRedisInstance, REDIS_HOST } from "./redis";

export function readFile(file) {
	try {
		return fs.readFileSync(file).toString();
	} catch (e) {
		return null;
	}
}

export function writeFile(file, text) {
	return fs.writeFileSync(file, text);
}

export function createLogStream(file: string) {
	let stream = fs.createWriteStream(file, {
		flags: 'a',
		encoding: 'utf8'
	});

	var logger = function (msg) {
		let ts = new bot.date().format('YYYY-MM-DD HH:mm:ss');
		let stringified;
		if (typeof msg === 'string') {
			stream.write(`[${ts}] ${msg}\n`);
		} else if (stringified = stringifyObject(msg)) {
			stream.write(`[${ts}] ${stringified}\n`);
		} else {
			stream.write(`[${ts}] [Non-stringifiable object!]\n`);
		}
	}

	return function (...args) {
		args.forEach(arg => logger(arg));
	};
}

let runningInToolforge;
export function onToolforge(): boolean {
	if (runningInToolforge !== undefined) {
		return runningInToolforge;
	}
	// See https://phabricator.wikimedia.org/T192244
	return runningInToolforge = fs.existsSync('/etc/wmcs-project');
}

/**
 * Expand ~ to /data/project/sdzerobot
 * or if running locally to current directory.
 * This is asymmetric!
 * @param path
 */
export function mapPath(path: string): string {
	if (onToolforge()) {
		return path.replace(/^~/, '/data/project/sdzerobot');
	} else {
		return path.replace(/^~/, __dirname);
	}
}

const runningTunnels = [];

export async function createLocalSSHTunnel(host: string, localPort?: number, remotePort?: number) {
	if (!onToolforge()) {
		log(`[i] Spawning local SSH tunnel for ${host} ...`);
		localPort = localPort || (
			host === ENWIKI_DB_HOST ? 4711 :
			host === TOOLS_DB_HOST ? 4712 :
			host === REDIS_HOST ? 4713 :
			null
		);
		remotePort = remotePort || (
			host === ENWIKI_DB_HOST ? 3306 :
			host === TOOLS_DB_HOST ? 3306 :
			host === REDIS_HOST ? 6379 :
			null
		);
		// relies on "ssh toolforge" command connecting successfully
		runningTunnels.push(
			spawn('ssh', ['-L', `${localPort}:${host}:${remotePort}`, 'toolforge'], {
				detached: true
			})
		);

		let maxTries = 15;
		let db = host === ENWIKI_DB_HOST ? new enwikidb() : host === TOOLS_DB_HOST ? new toolsdb('g13watch_p') : null;
		if (db) {
			while (maxTries--) {
				try {
					await db.pool.getConnection();
					log(`[S] Db tunnel ping successful in ${15-maxTries} tries`);
					break;
				} catch (_) {}
				await bot.sleep(500);
			}
		} else if (host === REDIS_HOST) {
			while (maxTries--) {
				try {
					await getRedisInstance().ping();
					log(`[S] Redis tunnel ping successful in ${15-maxTries} tries`);
					break;
				} catch (_) {}
				await bot.sleep(500);
			}
		} else {
			await bot.sleep(5000);
		}
	}
}

export function closeTunnels() {
	runningTunnels.forEach(tunnel => tunnel.kill());
}

export function saveObject(filename, obj) {
	fs.writeFileSync('./' + filename + '.json', JSON.stringify(obj, null, 2));
}

export function logObject(obj) {
	return console.log(JSON.stringify(obj, null, 2));
}

// JSON.stringify throws on a cyclic object
export function stringifyObject(obj) {
	try {
		return JSON.stringify(obj, null, 2);
	} catch (e) {
		return null;
	}
}

export function makeSentence(list: string[]) {
	var text = '';
	for (let i = 0; i < list.length; i++) {
		text += list[i];
		if (list.length - 2 === i) {
			text += " and ";
		} else if (list.length - 1 !== i) {
			text += ", ";
		}
	}
	return text;
}

export function arrayChunk(arr, size) {
	var numChunks = Math.ceil(arr.length / size);
	var result = new Array(numChunks);
	for(var i = 0; i < numChunks; i++) {
		result[i] = arr.slice(i * size, (i + 1) * size);
	}
	return result;
}

export function withIndices<T>(arr: Array<T>): Array<[number, T]> {
	return arr.map((item, idx) => [idx, item]);
}

export function len(obj: Record<any, any> | Array<any>) {
	if (Array.isArray(obj)) {
		return obj.length;
	} else {
		return Object.keys(obj).length;
	}
}

export function lowerFirst(str: string) {
	return str[0].toLowerCase() + str.slice(1);
}

export function upperFirst(str: string) {
	return str[0].toLowerCase() + str.slice(1);
}

export function setIntersection<T>(a: Set<T>, b: Set<T>): Set<T> {
	return new Set([...a].filter(x => b.has(x)));
}

export function setUnion<T>(a: Set<T>, b: Set<T>): Set<T> {
	return new Set([...a, ...b]);
}

export function setDifference<T>(a: Set<T>, b: Set<T>): Set<T> {
	return new Set([...a].filter(x => !b.has(x)));
}
