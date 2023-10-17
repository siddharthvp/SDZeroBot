import { bot } from "../../botbase";
import { Route } from "../app";
import { createLocalSSHTunnel } from "../../utils";
import { ENWIKI_DB_HOST, enwikidb } from "../../db";

export default class DykCountsTask extends Route {
    name = 'dyk-counts';

	db: enwikidb;

	counts: Record<string, number> = {};
	unflushedChanges: Record<string, string[]> = {};
	lastFlushTime: number = 0;
	isFlushScheduled = false;

	readonly page = 'User:SDZeroBot/DYK_nomination_counts.json';
	readonly minCountToSave = 5;
	readonly minFlushInterval = 5000;
	readonly dbRefreshInterval = 86400000;

	async init() {
		super.init();
		this.log('[S] Started');

		await createLocalSSHTunnel(ENWIKI_DB_HOST);
		this.db = new enwikidb();

		bot.setOptions({ maxRetries: 0, defaultParams: { maxlag: undefined } });
		await bot.getTokensAndSiteInfo();

		await this.refreshCountsFromDb();
		// TODO: skip periodic refresh if db is lagged by more than 15 minutes
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

	filter(data): boolean {
		return data.wiki === 'enwiki' &&
			data.type === 'new' &&
			data.title.startsWith('Template:Did you know nominations/');
	}

	async worker(data) {
		let {user, title} = data;
		this.counts[user] = (this.counts[user] || 0) + 1;
		this.unflushedChanges[user] = (this.unflushedChanges[user] || []).concat(title);
		this.log(`[i] Crediting "${user}" for [[${data.title}]]`);

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
}
