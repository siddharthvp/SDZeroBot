import {enwikidb} from "../db";
import {arrayChunk} from "../utils";
import {bot, log} from "../botbase";

(async function () {

    log(`[S] Started`)
    const db = new enwikidb();
    const [timeTaken, result] = await db.timedQuery(`
        SELECT page_id FROM page
        JOIN templatelinks ON tl_from = page_id
            AND tl_target_id = (SELECT lt_id FROM linktarget WHERE lt_namespace = 10 AND lt_title = "AfC_submission")
        JOIN revision ON rev_id = page_latest
        WHERE page_namespace IN (2, 118)
        AND rev_timestamp < DATE_FORMAT(UTC_DATE() - INTERVAL 5 MONTH, '%Y%m%d%H%i%S')
        AND page_id NOT IN (SELECT cl_from FROM categorylinks WHERE cl_to = "AfC_G13_eligible_soon_submissions")
    `);
    log(`[S] Got query result in ${timeTaken.toFixed(2)} seconds: found ${result.length} pages to be purged`);
    const batches = arrayChunk(result.map(row => row.page_id as number), 100);
    await bot.seriesBatchOperation(batches, batch => bot.purge(batch), 10000, 2);

})();
