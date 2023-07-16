import {argv, bot, emailOnError, log} from "../botbase";
import {RawRule, subtractFromNow} from './index'

// Only a small amount of data is stored. Probably not worth using ToolsDB.
import * as sqlite from "sqlite";
import * as sqlite3 from "sqlite3";
import * as hash from 'object-hash';
import {getRedisInstance} from "../redis";

class SqliteDb {
	db: sqlite.Database;
	async connect(filename) {
		this.db = await sqlite.open({
			filename: filename,
			driver: sqlite3.Database
		});
	}
	async run(sql: sqlite.ISqlite.SqlType, ...params: any[]): Promise<void | sqlite.ISqlite.RunResult> {
		return this.db.run(sql, ...params).catch(this.handleError);
	}
	handleError(err: Error) {
		emailOnError(err, 'bot-monitor checksDb (non-fatal)', false);
	}
}

interface ChecksDb {
	connect();
	update(rule: RawRule, ts: string);
	checkCached(rule: RawRule);
	getLastSeen(rule: RawRule);
	updateLastSeen(rule: RawRule, ts: string, notSeen?: boolean);
}

/**
 *
 * THIS REDIS IMPLEMENTATION IS UNTESTED
 *
 */
class RedisChecksDb implements ChecksDb {
	redis = getRedisInstance();

	async connect() {
		await this.redis.ping();
	}

	getKey(rule: RawRule) {
		return `botmonitor-${rule.bot}: ${rule.task}`;
	}

	async update(rule: RawRule, ts: string) {
		await this.redis.hset(this.getKey(rule) + '-cached',
			'rulehash', hash.sha1(rule),
			'ts', ts);
	}

	async checkCached(rule: RawRule) {
		if (argv.nocache) {
			return false;
		}
		let cached = await this.redis.hgetall(this.getKey(rule) + '-cached');
		return cached.rulehash === hash.sha1(rule) &&
			new bot.date(cached.ts).isAfter(subtractFromNow(rule.duration));
	}

	async getLastSeen(rule: RawRule) {
		if (argv.nocache) {
			return;
		}
		let lastseen = await this.redis.hgetall(this.getKey(rule) + '-seen');
		if (lastseen && lastseen.rulehash === hash.sha1(rule)) {
			return lastseen;
		} // else return undefined
	}

	async updateLastSeen(rule: RawRule, ts: string, notSeen?: boolean) {
		let props: Record<string, string> = {
			rulehash: hash.sha1(rule),
			ts: ts,
		};
		if (notSeen) {
			props.notseen = '1';
		}
		await this.redis.hset(this.getKey(rule) + '-seen', ...Object.entries(props).flat());
	}

}

class SqliteChecksDb extends SqliteDb implements ChecksDb {

	async connect() {
		await super.connect('./last_checks.db');
		await this.run(`CREATE TABLE IF NOT EXISTS last_good(
            name varbinary(255) PRIMARY KEY,
            rulehash varbinary(60), 
            ts varbinary(25) NOT NULL
        )`);
		await this.run(`CREATE TABLE IF NOT EXISTS last_seen(	
			name varbinary(255) PRIMARY KEY,
			rulehash varbinary(60),
			checkts varbinary(25),
			lastseents varbinary(25),
			notseen integer
		)`);
		log(`[V] Opened database connection`);
	}

	// Robustify this? This value still stands the risk of being the same for two tasks.
	// Should we use the SHA1 hash as the primary key?
	getKey(rule: RawRule) {
		return `${rule.bot}: ${rule.task}`.slice(0, 250);
	}

	async update(rule: RawRule, ts: string) {
		await this.run(`INSERT OR REPLACE INTO last_good VALUES(?, ?, ?)`, [
			this.getKey(rule),
			hash.sha1(rule),
			ts // ISO timestamp
		]);
	}

	/**
	 * The timestamp stored as last_good from a previous run is the one starting from which if
	 * we look at the actions, we can say the bot task is on track. If this time happens to be later
	 * than the time since which we are to begin checking for actions, we can pre-emptively say
	 * the task is on track without any API calls, saving a lot of time.
	 * @param rule
	 */
	async checkCached(rule: RawRule) {
		if (argv.nocache) {
			return false;
		}
		const last = await this.db.get(`SELECT * FROM last_good WHERE name = ?`, [
			this.getKey(rule),
		]); // on error, last remains undefined
		return last &&
			last.rulehash === hash.sha1(rule) && // check that the rule itself hasn't changed
			new bot.date(last.ts).isAfter(subtractFromNow(rule.duration));
	}


	async getLastSeen(rule: RawRule) {
		if (argv.nocache) {
			return;
		}
		let lastSeen = await this.db.get(`SELECT * FROM last_seen WHERE name = ?`, [
			this.getKey(rule),
		]); // on error, lastSeen remains undefined
		// If the rule was changed, discard it (namespace/pages/summary config could have changed)
		if (lastSeen && lastSeen.rulehash === hash.sha1(rule)) {
			return lastSeen;
		} // else returns undefined
	}

	async updateLastSeen(rule: RawRule, ts: string, notSeen?: boolean) {
		await this.run(`INSERT OR REPLACE INTO last_seen VALUES(?, ?, ?, ?, ?)`, [
			this.getKey(rule),
			hash.sha1(rule),
			new bot.date().toISOString(),
			ts,
			notSeen ? 1 : 0
		]);
	}
}

export const checksDb: ChecksDb = new SqliteChecksDb();
