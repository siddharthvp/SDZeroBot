import { argv, bot, emailOnError, log } from "../botbase";
import { createLocalSSHTunnel, writeFile } from "../utils";
import { db, FAKE_OUTPUT_FILE, fetchQueries, processQueries } from "./app";
import { ENWIKI_DB_HOST } from "../db";

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
 *
 * Pending:
 * Support row_template and skip_table aka Listeriabot
 * Support frequency parameter - needs db support
 */

(async function () {

	log(`[i] Started`);

	process.chdir(__dirname);

	await Promise.all([
		bot.getTokensAndSiteInfo(),
		createLocalSSHTunnel(ENWIKI_DB_HOST)
	]);

	if (argv.fake) {
		writeFile(FAKE_OUTPUT_FILE, '');
	}

	const queries = await fetchQueries();
	log(`[S] Fetched queries`);

	await db.getReplagHours();
	await processQueries(queries);

	// createSSHTunnel creates a detached process that prevents natural exit
	process.exit();
})().catch(e => emailOnError(e, 'db-tabulator'));
