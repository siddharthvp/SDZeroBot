import {bot, log} from "../botbase";
import {Template} from "../../mwn/build/wikitext";
import {SUBSCRIPTIONS_CATEGORY, fetchQueriesForPage, Query} from "./app";
import {MariadbMetadataStore} from "./MariadbMetadataStore";
import type {MetadataStore} from "./MetadataStore";

const metadataStore: MetadataStore = new MariadbMetadataStore();

// Copy of the function in eventstream-metadata-maintainer.ts
async function updateMetadata(page: string, recordIfNone = false) {
	log(`[+] Updating metadata for ${page}`);
	const queries = await fetchQueriesForPage(page);
	for (const q of queries) {
		await q.parseQuery();
	}
	let validQueries = queries.filter(q => q.isValid);
	if (validQueries.length === 0 && recordIfNone) {
		// This deals with pages that transclude pages with reports - they are in the category but have no template.
		// Add a dummy query to the database.
		validQueries = [ new Query(new Template('{{}}'), page, 0) ];
	}
	await metadataStore.updateMetadata(page, validQueries);
}

(async function() {
	await metadataStore.init();
	await bot.getSiteInfo();

	const pagesInCategory = (await new bot.Category(SUBSCRIPTIONS_CATEGORY).members()).map(e => e.title);
	await metadataStore.removeOthers(new Set(pagesInCategory));

	pagesInCategory.forEach(page => {
		updateMetadata(page, true);
	});
})();
