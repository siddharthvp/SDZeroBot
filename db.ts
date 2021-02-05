/**
 * Efficient interface to access ToolsDB.
 * Automatically handles transient connection errors.
 */

import {log, bot} from './botbase';
import * as mysql from 'mysql2/promise';
const auth = require('./.auth');

abstract class db {
	pool: mysql.Pool
	config: mysql.PoolOptions

	init() {
		this.pool = mysql.createPool({
			port: 3306,
			user: auth.db_user,
			password: auth.db_password,
			waitForConnections: true,
			connectionLimit: 5,
			//timezone: 'Z',
			...this.config
		});

		// Toolforge policy does not allow holding idle connections
		// Destroy connections on 5 seconds of inactivity. This avoids holding
		// idle connections and at the same time avoids the performance issue in
		// creating new connections for every query in a sequential set
		this.pool.on('release', (connection) => {
			connection.inactiveTimeout = setTimeout(() => {
				connection.destroy();
			}, 5000);
		});
		this.pool.on('acquire', function (connection) {
			clearTimeout(connection.inactiveTimeout);
		});

		return this;
	}

	async getConnection() {
		try {
			return await this.pool.getConnection();
		} catch (e) { // try again
			log(`[W] ${e.code}: retrying in 5 seconds...`);
			await bot.sleep(5000);
			return await this.pool.getConnection();
		}
	}

	async query(...args: any[]) {
		let conn = await this.getConnection();
		const result = await conn.query(...args).finally(() => {
			conn.release();
		});
		return result[0].map(row => {
			Object.keys(row).forEach(prop => {
				if (row[prop] instanceof Buffer) {
					row[prop] = row[prop].toString();
				}
			});
			return row;
		});
	}

	async run(...args: any[]) {
		// convert `undefined`s in bind parameters to null
		if (args[1] instanceof Array) {
			args[1] = args[1].map(item => item === undefined ? null : item);
		}
		let conn = await this.getConnection();
		return await conn.execute(...args).finally(() => {
			conn.release();
		});
	}

	// To be called when use of db is over
	async end() {
		await this.pool.end();
	}
}

class enwikidb extends db {
	replagHours: number
	constructor(customOptions = {}) {
		super();
		this.config = {
			host: 'enwiki.analytics.db.svc.eqiad.wmflabs',
			database: 'enwiki_p',
			...customOptions
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
	constructor(dbname, customOptions = {}) {
		super();
		this.config = {
			host: 'tools.db.svc.eqiad.wmflabs',
			database: 's54328__' + dbname,
			...customOptions
		};
	}
}

export {mysql, db, enwikidb, toolsdb};
