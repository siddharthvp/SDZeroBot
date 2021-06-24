import { fetchQueriesForPage, processQueriesForPage, SUBSCRIPTIONS_CATEGORY } from "./app";
import { pageFromCategoryEvent, Route } from "../eventstream-router/app";

export default class dbTabulator extends Route {
	name = "db-tabulator";

	async init() {
		super.init();
		this.log('[S] Started');
	}

	filter(data): boolean {
		return data.wiki === 'enwiki' &&
			data.type === 'categorize' &&
			data.title === 'Category:' + SUBSCRIPTIONS_CATEGORY;
	}

	async worker(data) {
		let page = pageFromCategoryEvent(data);
		if (!page.added) return;

		this.log(`[+] Triggering db-lister for ${page.title} due to addition to category at ${data.timestamp}`);
		const queries = await fetchQueriesForPage(page.title);
		await processQueriesForPage(queries);
	}
}
