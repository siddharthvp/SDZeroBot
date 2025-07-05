import {argv, bot, emailOnError, log} from "../botbase";
import {writeFile} from "../utils";
import {checkShutoff, FAKE_OUTPUT_FILE, fetchQueries, processQueries, metadataStore} from "./app";

/**
 * Specs:
 *
 * Done:
 * Support linkification of items
 * Report back query errors to the user
 * Support multiple tables on a page
 * Support setting table attributes and widths for each column
 * Report the first results immediately on setup (Use EventStream)
 * Support article extracts
 * Setup webservice endpoint to generate reports on demand
 * Support linkification with ns numbers from another column
 * Support pagination
 * Create Module:Database report for syntax checking
 * Support frequency parameter
 * Support hiding namespace number
 * Support row_template and skip_table aka Listeriabot
 * Automatic query limiting: use LIMIT = pagination * max_pages
 * Disable auto-updates for query if it times out N number of consecutive times
 *
 */

(async function () {

	log(`[i] Started`);

	process.chdir(__dirname);

	await Promise.all([
		bot.getTokensAndSiteInfo(),
		metadataStore.init(),
	]);

	if (argv.fake) {
		writeFile(FAKE_OUTPUT_FILE, '');
	} else {
		const shutoffText = await checkShutoff();
		if (shutoffText) {
			log(`[E] Bot is shut off. Shutoff page content: ${shutoffText}`);
			process.exit();
		}
	}

	const queries = await fetchQueries();
	log(`[S] Fetched queries`);

	await processQueries(queries);

})().catch(e => emailOnError(e, 'db-tabulator'));
