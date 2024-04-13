import {argv, bot, emailOnError} from "../botbase";
import {metadataStore, fetchQueriesForPage, processQueriesForPage} from "./app";

/**
 * Entry point invoked in a child Node.js process for queries
 * with custom JS preprocessing enabled.
 */
(async function () {

    process.chdir(__dirname);

    await Promise.all([
        bot.getTokensAndSiteInfo(),
        metadataStore.init()
    ]);

    const queries = await fetchQueriesForPage(argv.page);
    await processQueriesForPage(queries);

    if (queries.filter(q => q.needsForceKill).length > 0) {
        process.send({ code: 'catastrophic-error' });
    }

})().catch(e => emailOnError(e, 'db-tabulator-child'));
