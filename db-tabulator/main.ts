import { argv, bot, log } from "../botbase";
import { fetchQueries, processQueries } from "./io";
import { FAKE_OUTPUT_FILE } from "./consts";
import { writeFile } from "../utils";

/**
 * Specs:
 *
 * Done:
 * Support linkification of items
 * Report back query errors to the user
 * Support multiple tables on a page
 * Support setting table attributes and widths for each column
 * Report the first results immediately on setup (Use EventStream)
 *
 * Pending:
 * Support article extracts
 * Setup web endpoint to generate reports on demand
 *
 */

(async function () {

	log(`[i] Started`);

	process.chdir(__dirname);

	await bot.getTokensAndSiteInfo();

	if (argv.fake) {
		writeFile(FAKE_OUTPUT_FILE, '');
	}

	const queries = await fetchQueries();
	log(`[S] Fetched queries`);

	await processQueries(queries);

})();
