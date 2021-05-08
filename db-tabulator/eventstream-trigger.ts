import { Route } from "../eventstream-router/Route";
import { pageFromCategoryEvent } from "../eventstream-router/utils";
import { fetchQueriesForPage, processQueries, SUBSCRIPTIONS_CATEGORY } from "./app";

export default class Task extends Route {
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
		await processQueries(queries);
	}
}
