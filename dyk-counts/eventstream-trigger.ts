import {bot} from "../botbase";
import {Route} from "../eventstream-router/app";
import {enwikidb} from "../db";
import {RecentChangeStreamEvent} from "../eventstream-router/RecentChangeStreamEvent";
import {Cache, CacheClass} from "memory-cache";
import {ReplyError} from 'redis';
import {DAY, SECOND} from "../millis";
import {redis} from "../redis-io";

export default class DykCounts extends Route {
    name = 'dyk-counts';

	db: enwikidb;

	counts: Record<string, number> = {};
	unflushedChanges: Record<string, string[]> = {};
	dupeCache: CacheClass<string, boolean> = new Cache();
	lastFlushTime: number = 0;
	isFlushScheduled = false;

	readonly page = 'User:SDZeroBot/DYK_nomination_counts.json';
	readonly minCountToSave = 5;
	readonly minFlushInterval = 5 * SECOND;
	readonly dbRefreshInterval = DAY;

	async init() {
		super.init();
		this.log('[S] Started');

		this.db = new enwikidb();

		await this.refreshCountsFromDb();
		setInterval(() => this.refreshCountsFromDb(), this.dbRefreshInterval);
	}

	// Necessary to be run periodically as otherwise we aren't accounting for DYK noms being deleted/redirected
	// Also the worker() isn't idempotent!
	async refreshCountsFromDb() {
		this.log(`[i] Refreshing counts from db`);
		try {
			const queryResult = await this.db.query(`
                SELECT actor_name AS username, COUNT(*) AS noms
				FROM revision_userindex
				JOIN page ON rev_page = page_id
				JOIN actor_revision ON rev_actor = actor_id
				WHERE page_namespace = 10
				AND page_title LIKE 'Did_you_know_nominations/%'
				AND page_is_redirect = 0
				AND rev_parent_id = 0
				GROUP BY username
			`);
			this.counts = Object.fromEntries(queryResult.map(e => [e.username, parseInt(e.noms as string)]));
			await this.saveCounts('Refreshing counts from database');

			const keyValues = queryResult.flatMap(e => [e.username, e.noms]) as string[];
			await redis.del('dyk-counts').catch(e => this.redisError(e));
			const redisArgs = ['dyk-counts'].concat(keyValues) as [string, ...string[]]; // TS: array with at least one element
			await redis.hmset(...redisArgs).catch(e => this.redisError(e));
		} catch (e) {
			this.log(`[E] Error while running db refresh`, e);
		}
	}

	async flushCounts() {
		this.lastFlushTime = Date.now();
		this.isFlushScheduled = false;

		let changesToFlush = Object.entries(this.unflushedChanges)
			.filter(([user, entries]) => this.counts[user] >= 5)
			.map(([user, entries]) => {
				let articles = entries.map(e => `[[${e}|${e.slice('Template:Did you know nominations/'.length)}]]`).join(', ');
				return `${user} +${entries.length} (${articles})`;
			});
		if (changesToFlush.length) {
			let editSummary = 'Updating: ' + changesToFlush.join(', ');
			await this.saveCounts(editSummary);
		}
	}

	async saveCounts(editSummary: string) {
		let counts = Object.fromEntries(Object.entries(this.counts).filter(e => e[1] >= this.minCountToSave));
		try {
			await bot.save(this.page, JSON.stringify(counts), editSummary);
			this.unflushedChanges = {};
		} catch (e) {
			this.log(`[E] Failed to save to onwiki page`, e);
		}
	}

	filter(data: RecentChangeStreamEvent): boolean {
		return data.wiki === 'enwiki' &&
			data.type === 'new' &&
			data.title.startsWith('Template:Did you know nominations/');
	}

	async worker(data: RecentChangeStreamEvent) {
		let {user, title} = data;

		// Check that we are not getting the same event a second time, which happens occasionally
		if (this.dupeCache.get(title)) {
			this.log(`[E] Ignoring [[${title}]] present in dupe cache`);
			return;
		}
		this.dupeCache.put(title, true, 300); // 5 min timeout

		this.counts[user] = (this.counts[user] || 0) + 1;
		redis.hincrby('dyk-counts', user, 1).catch(e => this.redisError(e));
		this.unflushedChanges[user] = (this.unflushedChanges[user] || []).concat(title);
		this.log(`[i] Crediting "${user}" for [[${title}]]`);

		if (Date.now() - this.lastFlushTime > this.minFlushInterval) {
			this.flushCounts();
		} else {
			if (!this.isFlushScheduled) {
				this.isFlushScheduled = true;
				this.log(`[D] Scheduling flush for ${this.minFlushInterval/1e3} seconds from now`);
				setTimeout(() => this.flushCounts(), this.minFlushInterval);
			}
		}
	}

	redisError(err: ReplyError) {
		if (err.command === 'HMSET') {
			err.args = [err.args[0], '<snipped>']; // too big to log!
		}
		this.log(`[E] dyk-counts redis error: `, err)
	}
}
