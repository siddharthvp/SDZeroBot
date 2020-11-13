import {argv, bot, emailOnError} from "../botbase";
import {debug, Monitor, RawRule} from "./bot-monitor";

// Only a small amount of data is stored. Probably not worth using ToolsDB.
import * as sqlite from "sqlite";
import * as sqlite3 from "sqlite3";

import hash = require('object-hash');

export class ChecksDb {
	static db: sqlite.Database

	static async connect() {
		this.db = await sqlite.open({
			filename: './last_checks.db',
			driver: sqlite3.Database
		});
		await this.db.run(`CREATE TABLE IF NOT EXISTS last_good(
            name varbinary(255) PRIMARY KEY,
            rulehash varbinary(60), 
            ts varbinary(25) NOT NULL
        )`);
		await this.db.run(`CREATE TABLE IF NOT EXISTS last_seen(	
			name varbinary(255) PRIMARY KEY,
			rulehash varbinary(60),
			checkts varbinary(25),
			lastseents varbinary(25),
			notseen integer
		)`);
		debug(`[S] Opened database connection`);
	}

	// Robustify this? This value still stands the risk of being the same for two tasks.
	// Should we use the SHA1 hash as the primary key?
	static getDbKey(rule: RawRule) {
		return `${rule.bot}: ${rule.task}`.slice(0, 250);
	}

	static handleError(err: Error) {
		emailOnError(err, 'bot-monitor checksDb (non-fatal)');
	}

	static async update(rule: RawRule, ts: string) {
		await this.db.run(`INSERT OR REPLACE INTO last_good VALUES(?, ?, ?)`, [
			this.getDbKey(rule),
			hash.sha1(rule),
			ts // ISO timestamp
		]).catch(this.handleError);
	}

	/**
	 * The timestamp stored as last_good from a previous run is the one starting from which if
	 * we look at the actions, we can say the bot task is on track. If this time happens to be later
	 * than the time since which we are to begin checking for actions, we can pre-emptively say
	 * the task is on track without any API calls, saving a lot of time.
	 * @param rule
	 */
	static async checkCached(rule: RawRule) {
		if (argv.noignore) {
			return false;
		}
		const last = await this.db.get(`SELECT * FROM last_good WHERE name = ?`, [
			this.getDbKey(rule),
		]).catch(this.handleError); // on error, last remains undefined
		return last &&
			last.rulehash === hash.sha1(rule) && // check that the rule itself hasn't changed
			new bot.date(last.ts).isAfter(Monitor.getFromDate(rule.duration));
	}


	static async getLastSeen(rule: RawRule) {
		let lastSeen = await this.db.get(`SELECT * FROM last_seen WHERE name = ?`, [
			this.getDbKey(rule),
		]).catch(this.handleError); // on error, lastSeen remains undefined
		// If the rule was changed, discard it (namespace/pages/summary config could have changed)
		if (lastSeen && lastSeen.rulehash === hash.sha1(rule)) {
			return lastSeen;
		} // else returns undefined
	}

	static async updateLastSeen(rule: RawRule, ts: string, notSeen?: boolean) {
		await this.db.run(`INSERT OR REPLACE INTO last_seen VALUES(?, ?, ?, ?, ?)`, [
			this.getDbKey(rule),
			hash.sha1(rule),
			new bot.date().toISOString(),
			ts,
			notSeen ? 1 : 0
		]).catch(this.handleError);
	}
}
