import {bot, fs} from '../botbase';

export function createLogStream(file: string) {
	let stream = fs.createWriteStream(file, {
		flags: 'a',
		encoding: 'utf8'
	});

	return function(msg) {
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

// JSON.stringify throws on a cyclic object
export function stringifyObject(obj) {
	try {
		return JSON.stringify(obj, null, 2);
	} catch (e) {
		return null;
	}
}
