import { argv, bot, log } from "../botbase";
import { writeFile } from "../utils";
import { FAKE_OUTPUT_FILE, fetchQueries, processQueries } from "./app";
import { createLocalSSHTunnel, ENWIKI_DB_HOST } from "../db";

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
 *
 * Pending:
 * Support linkification with ns numbers from another column
 *
 */

(async function () {

	log(`[i] Started`);

	process.chdir(__dirname);

	await Promise.all([
		bot.getTokensAndSiteInfo(),
		process.env.LOCAL && createLocalSSHTunnel(ENWIKI_DB_HOST)
	]);

	if (argv.fake) {
		writeFile(FAKE_OUTPUT_FILE, '');
	}

	const queries = await fetchQueries();
	log(`[S] Fetched queries`);

	await processQueries(queries);

	// createSSHTunnel creates a detached process that prevents natural exit
	if (process.env.LOCAL) {
		process.exit();
	}
})();
