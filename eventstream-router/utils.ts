import {bot} from '../botbase';

// Should be bound to a writable stream with options { flags: 'a', encoding: 'utf8' }
// before use
export function streamLog(msg) {
	let ts = new bot.date().format('YYYY-MM-DD HH:mm:ss');
	if (typeof msg === 'string') {
		this.write(`[${ts}] ${msg}\n`);
	} else {
		this.write(`[${ts}] ${JSON.stringify(msg)}\n`);
	}
}
