import { argv, bot, emailOnError, log } from "../botbase";
import { fetchQueries } from "./input";
import { writeFile } from "../filesystem";
import { FAKE_OUTPUT_FILE } from "./consts";

/**
 * Specs:
 *
 * MVP:
 * Support linkification of items --done
 * Report back query errors to the user
 * Support multiple tables on a page
 *
 * Improvements:
 * Support setting table attributes and widths for each column
 * Support article extracts
 * Report the first results immediately on setup (Use EventStream)
 *
 */

(async function () {

	log(`[i] Started`);
	process.chdir(__dirname);

	await bot.getTokensAndSiteInfo();

	const queries = await fetchQueries();
	log(`[S] Fetched queries`);

	if (argv.fake) {
		writeFile(FAKE_OUTPUT_FILE, '');
	}

	await bot.batchOperation(queries, async (query) => {
		log(`[i] Processing page ${query.page}`);
		await query.process();
	}, 10);

})();
