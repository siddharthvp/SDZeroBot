import {log, bot} from './botbase';
import * as mysql from 'mysql2/promise';
const auth = require('./.auth');

abstract class db {
	conn: mysql.Connection
	config: mysql.ConnectionOptions
	connected = false

	async connect(isRetry = false) {
		try {
			this.conn = await mysql.createConnection(this.config);
		} catch(e) {
			if (!isRetry) { // retry, but only once
				log(`[W] ${e.code}, retrying in 5 seconds...`);
				await bot.sleep(5000);
				return this.connect(true);
			} else throw e;
		}
		this.connected = true;
		return this;
	}
	async query(...args: any[]) {
		if (!this.connected) {
			await this.connect();
		}
		const result = await this.conn.query(...args).catch(err => {
			console.log(`err.code:`, err.code);
			return Promise.reject(err);
		});
		return result[0].map(row => {
			Object.keys(row).forEach(prop => {
				if (row[prop]) {
					row[prop] = row[prop].toString();
				}
			});
			return row;
		});
	}
	async run(...args: any[]) {
		if (!this.connected) {
			await this.connect();
		}
		// convert `undefined`s in bind parameters to null
		if (args[1] instanceof Array) {
			args[1] = args[1].map(item => item === undefined ? null : item);
		}
		const result = await this.conn.execute(...args);
		return result;
	}
	// Always call end() when no more database operations are immediately required
	async end() {
		await this.conn.end();
		this.connected = false;
	}
}

class enwikidb extends db {
	replagHours: number
	constructor() {
		super();
		this.config = {
			host: 'enwiki.analytics.db.svc.eqiad.wmflabs',
			port: 3306,
			user: auth.db_user,
			password: auth.db_password,
			database: 'enwiki_p',
			//timezone: 'Z',
			//stringifyObjects: true
		};
	}

	async getReplagHours() {
		const lastrev = await this.query(`SELECT MAX(rev_timestamp) AS ts FROM revision`);
		const lastrevtime = new bot.date(lastrev[0].ts);
		this.replagHours = Math.round((Date.now() - lastrevtime.getTime()) / 1000 / 60 / 60);
		return this.replagHours;
	}
	/**
	 * Return replag hatnote wikitext. Remember getReplagHours() must have been called before.
	 * @param {number} threshold - generate message only if replag hours is greater than this
	 * @returns {string}
	 */
	makeReplagMessage(threshold) {
		return this.replagHours > threshold ? `{{hatnote|Replica database lag is high. Changes newer than ${this.replagHours} hours may not be reflected.}}\n` : '';
	}
}

class toolsdb extends db {
	constructor(dbname) {
		super();
		this.config = {
			host: 'tools.db.svc.eqiad.wmflabs',
			port: 3306,
			user: auth.db_user,
			password: auth.db_password,
			database: 's54328__' + dbname
		}
	}
}
export {mysql, db, enwikidb, toolsdb};
