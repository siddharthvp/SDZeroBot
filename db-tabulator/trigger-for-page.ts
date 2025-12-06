import {EventEmitter} from "events";
import {argv, log, bot} from "../botbase";
import {fetchQueriesForPage, checkShutoff, metadataStore, processQueries} from "./app";

/**
 * Script to trigger a one-off update to a page from local code.
 * Useful for testing.
 */

(async () => {
	const page = argv.page;

	let [shutoffText, queries] = await Promise.all([
		checkShutoff(),
		fetchQueriesForPage(page),
		metadataStore.init(),
		bot.getTokensAndSiteInfo(),
	]);

	if (shutoffText) {
		log(`[E] Bot is shut off. Shutoff page content: ${shutoffText}`);
		return;
	}

	if (!queries.length) {
		log(`[E] No queries found for ${page}`);
		return;
	}

	let handleMessage = (...args) => {
		console.log(args[0], {args: args.slice(1)})
	};

	const notifier = new EventEmitter();
	notifier.on('message', handleMessage); // If custom JS is enabled
	queries.forEach(q => q.on('message', handleMessage)); // If custom JS is not enabled

	log(`Started processing ${page}`);
	await processQueries({[page]: queries}, notifier);
	log(`Finished processing ${page}`);

})();
