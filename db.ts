/**
 * Efficient interface to access ToolsDB.
 * Automatically handles transient connection errors.
 */

import { AuthManager, bot, log } from './botbase';
import * as mysql from 'mysql2/promise';
export { mysql };
import type { MwnDate } from "../mwn";
import { onToolforge } from "./utils";

export const ENWIKI_DB_HOST = 'enwiki.analytics.db.svc.eqiad.wmflabs';
export const TOOLS_DB_HOST = 'tools.db.svc.eqiad.wmflabs';

export abstract class db {
	pool: mysql.Pool;

	protected constructor(customOptions: mysql.PoolOptions = {}) {
		this.pool = mysql.createPool({
			port: 3306,
			...AuthManager.get('sdzerobot'),
			waitForConnections: true,
			connectionLimit: 5,
			//timezone: 'Z',
			typeCast: function (field, next) {
				if (field.type === 'BIT' && field.length === 1) {
					return field.buffer()[0] === 1;
				} else {
					return next();
				}
			},
			...customOptions
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

	/**
	 * @returns array of objects - each object represents a row
	 */
	async query(...args: any[]): Promise<Array<Record<string, string | number | null>>> {
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

	async timedQuery(...args: any[]): Promise<[number, Array<Record<string, string | number | null>>]> {
		let startTime = process.hrtime.bigint();
		let queryResult = await this.query(...args);
		let endTime = process.hrtime.bigint();
		let timeTaken = parseInt(String(endTime - startTime))/1e9;
		return [timeTaken, queryResult];
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

	/**
	 * To be called when use of db is over.
	 * All in-progress queries are executed before a quit packet is sent to mysql server.
 	 */
	async end() {
		await this.pool.end();
	}
}

export class enwikidb extends db {
	constructor(customOptions: mysql.PoolOptions = {}) {
		super({
			host: onToolforge() ? ENWIKI_DB_HOST : '127.0.0.1',
			port: onToolforge() ? 3306 : 4711,
			database: 'enwiki_p',
			...customOptions
		});
	}

	replagHours: number;
	replagHoursCalculatedTime: MwnDate;

	async getReplagHours() {
		log('[V] Querying database lag');
		const lastrev = await this.query(`SELECT MAX(rev_timestamp) AS ts FROM revision`);
		const lastrevtime = new bot.date(lastrev[0].ts);
		this.replagHours = Math.round((Date.now() - lastrevtime.getTime()) / 1000 / 60 / 60);
		this.replagHoursCalculatedTime = new bot.date();
		return this.replagHours;
	}
	/**
	 * Return replag hatnote wikitext. Remember getReplagHours() must have been called before.
	 * @param threshold - generate message only if replag hours is greater than this
	 * @returns
	 */
	makeReplagMessage(threshold: number): string {
		return this.replagHours > threshold ? `{{hatnote|Database replication lag is high. Changes newer than ${this.replagHours} hours may not be reflected.}}\n` : '';
	}
}

export class toolsdb extends db {
	/**
	 * @param dbname - DB name, `s54328__` will be prepended to this
	 * @param customOptions - extra mysql pool connection options
	 */
	constructor(dbname: string, customOptions: mysql.PoolOptions = {}) {
		super({
			host: onToolforge() ? TOOLS_DB_HOST : '127.0.0.1',
			port: onToolforge() ? 3306 : 4712,
			database: 's54328__' + dbname,
			...customOptions
		});
	}
}

export interface SQLError extends Error {
	code: string;
	errno: number;
	fatal: boolean;
	sql: string;
	sqlState: string;
	sqlMessage: string;
}
