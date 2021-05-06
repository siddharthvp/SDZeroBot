import { bot, fs } from "../botbase";

// XXX: consider using Redis rather than to NFS since this does a write every 1 second
export class LastSeen {
	ts: number;

	// Number of milliseconds after which lastSeenTs is to be saved to file
	updateInterval = 1000;

	file = './last-seen.txt';

	constructor() {
		setInterval(() => this.write(), this.updateInterval);
	}

	read() {
		try {
			return parseInt(fs.readFileSync(this.file).toString());
		} catch (e) {
			return NaN;
		}
	}

	write() {
		fs.writeFile(this.file, String(this.ts), err => err && console.log(err));
	}

	get() {
		return new bot.date(
			((typeof this.ts === 'number') ? this.ts : this.read())
			* 1000
		);
	}
}
