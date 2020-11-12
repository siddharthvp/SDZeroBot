import {argv, bot} from "../botbase";
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
		await this.db.run(`CREATE TABLE IF NOT EXISTS checks(
            name varbinary(255) PRIMARY KEY,
            rulehash varbinary(60), 
            ts varbinary(25) NOT NULL
        )`);
		debug(`[S] Opened database connection`);
	}

	static async update(rule: RawRule, ts: string) {
		await this.db.run(`INSERT OR REPLACE INTO checks VALUES(?, ?, ?)`, [
			`${rule.bot}: ${rule.task}`,
			hash.sha1(rule),
			ts // ISO timestamp
		]);
	}

	static async checkCached(rule: RawRule) {
		if (argv.noignore) {
			return false;
		}
		const last = await this.db.get(`SELECT * FROM checks WHERE name = ?`, [
			`${rule.bot}: ${rule.task}`
		]);
		return last &&
			last.rulehash === hash.sha1(rule) && // check that the rule itself hasn't changed
			new bot.date(last.ts).isAfter(Monitor.getFromDate(rule.duration));
	}
}
