import {bot} from '../botbase';

// Should be bound to a writable stream with options { flags: 'a', encoding: 'utf8' }
// before use
export function streamLog(msg) {
	let ts = new bot.date().format('YYYY-MM-DD HH:mm:ss');
	let stringified;
	if (typeof msg === 'string') {
		this.write(`[${ts}] ${msg}\n`);
	} else if (stringified = stringifyObject(msg)) {
		this.write(`[${ts}] ${stringified}\n`);
	} else {
		this.write(`[${ts}] [Non-stringifiable object!]\n`);
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
