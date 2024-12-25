// DEPRECATED: reports are no longer updated on first save

import { checkShutoff, fetchQueriesForPage, processQueriesForPage, SUBSCRIPTIONS_CATEGORY } from "./app";
import { pageFromCategoryEvent, Route } from "../eventstream-router/app";
import { log } from "../botbase";

export default class dbTabulator extends Route {
	name = "db-tabulator";

	async init() {
		super.init();
		this.log('[S] Started');
	}

	filter(data): boolean {
		return data.wiki === 'commonswiki' &&
			data.type === 'categorize' &&
			data.title === 'Category:' + SUBSCRIPTIONS_CATEGORY;
	}

	async worker(data) {
		let page = pageFromCategoryEvent(data);
		if (!page.added) return;

		const shutoffText = await checkShutoff();
		if (shutoffText) {
			log(`[E] ${page.title} added to category at ${data.timestamp}. Not triggering since the bot is shut off. Shutoff page content: ${shutoffText}`);
			return;
		}

		this.log(`[+] Triggering db-lister for ${page.title} due to addition to category at ${data.timestamp}`);
		const queries = await fetchQueriesForPage(page.title);
		await processQueriesForPage(queries);
	}
}
