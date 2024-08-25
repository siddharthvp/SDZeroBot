import {argv, bot, emailOnError} from "../botbase";
import {metadataStore, fetchQueriesForPage, processQueriesForPage} from "./app";

/**
 * Entry point invoked in a child Node.js process for queries
 * with custom JS postprocessing enabled.
 */
(async function () {

    process.chdir(__dirname);

    await Promise.all([
        bot.getTokensAndSiteInfo(),
        metadataStore.init()
    ]);

    const queries = await fetchQueriesForPage(argv.page);

    // Send progress events to parent process for display in web UI
    for (let query of queries) {
        query.on('message', (...args) => {
            process.send({
                code: args[0],
                args: args.slice(1)
            });
        });
    }

    await processQueriesForPage(queries);

    if (queries.filter(q => q.needsForceKill).length > 0) {
        process.send({ code: 'catastrophic-error', args: [] });
    }

})().catch(e => emailOnError(e, 'db-tabulator-child'));
