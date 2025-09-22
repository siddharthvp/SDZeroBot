import {bot, log} from "../botbase";
import {SUBSCRIPTIONS_CATEGORY, updateMetadata, metadataStore} from "./app";

(async function() {
	await metadataStore.init();
	await bot.getSiteInfo();

	const pagesInCategory = (await new bot.Category(SUBSCRIPTIONS_CATEGORY).members()).map(e => e.title);
	await metadataStore.removeOthers(new Set(pagesInCategory));

	pagesInCategory.forEach(page => {
		log(`[+] Updating metadata for ${page}`);
		updateMetadata(page, true);
	});
})();
