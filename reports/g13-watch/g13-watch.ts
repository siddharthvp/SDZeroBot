import {argv, bot, emailOnError, enwikidb, log, mwn} from "../../botbase";
import {toolsdb, TOOLS_DB_HOST, ENWIKI_DB_HOST} from "../../db";
import {arrayChunk, createLocalSSHTunnel, closeTunnels} from "../../utils";
import TextExtractor from "../../TextExtractor";
import {preprocessDraftForExtract, saveWithBlacklistHandling} from '../commons';

/**
 * Query pages becoming eligible for G13 within the next 24 hours, along with currently eligible pages if any.
 * Store data along with excerpt in g13 db.
 * The next day, find pages that were deleted per G13 (log entry regex).
 * Lookup those pages in g13 db. Output details and excerpt on-wiki.
 * If not found in g13 db, it means the page hadn't been eligible, output a warning.
 */

(async function() {

    await Promise.all([
        bot.getTokensAndSiteInfo(),
        createLocalSSHTunnel(ENWIKI_DB_HOST),
        createLocalSSHTunnel(TOOLS_DB_HOST)
    ]);

    const g13db = new toolsdb('g13watch_p');
    log('[S] Connected to the g13 database');

    const wikidb = new enwikidb();
    log('[S] Connected to enwiki database');

    // First, accumulate data to be used for the next day's report:
    // Get all pages becoming G13 eligible within a day
    const result = await wikidb.query(`
        WITH bots AS (
            SELECT user_id
            FROM user
            JOIN user_groups ON user_id = ug_user
            WHERE ug_group = 'bot'
        )

        SELECT page_namespace, page_title
        FROM page
                 LEFT JOIN revision ON rev_page = page_id
                 LEFT JOIN actor_revision ON actor_id = rev_actor
        WHERE page_namespace = 118
          AND page_is_redirect = 0
          AND (actor_user IS NULL OR actor_user NOT IN (SELECT * FROM bots))
        GROUP BY page_id
        HAVING MAX(rev_timestamp) < DATE_FORMAT(UTC_DATE() - INTERVAL 6 MONTH + INTERVAL 1 DAY, '%Y%m%d%H%i%S')

        UNION

        SELECT page_namespace, page_title
        FROM page
                 LEFT JOIN revision ON rev_page = page_id
                 LEFT JOIN actor_revision ON actor_id = rev_actor
                 JOIN templatelinks ON tl_from = page_id AND tl_namespace = 10 AND tl_title = 'AfC_submission'
        WHERE page_namespace = 2
          AND page_is_redirect = 0
          AND (actor_user IS NULL OR actor_user NOT IN (SELECT * FROM bots))
        GROUP BY page_id
        HAVING MAX(rev_timestamp) < DATE_FORMAT(UTC_DATE() - INTERVAL 6 MONTH + INTERVAL 1 DAY, '%Y%m%d%H%i%S')

        UNION 
        
        -- currently eligible pages that have already been G13-tagged won't show up in the above 
        -- timestamp based lookup
        SELECT page_namespace, page_title
        FROM page
        JOIN categorylinks ON cl_from = page_id
        WHERE cl_to = 'Candidates_for_speedy_deletion_as_abandoned_drafts_or_AfC_submissions'
    `) as Array<{page_title: string, page_namespace: number, rev_timestamp: string}>;

    wikidb.end();
    log(`[S] Got DB query result: ${result.length} entries`);

    // for each page, fetch text, generate excerpt, save to g13db
    for (const pages of arrayChunk(result, 100)) {
       let pagedata = await bot.read(pages.map(pg => new bot.title(pg.page_title, pg.page_namespace)), {
           prop: 'revisions|description',
           rvprop: 'content|size|timestamp'
       });
       await Promise.all(pagedata.map(pg => {
           let excerpt = TextExtractor.getExtract(pg.revisions[0].content, 300, 500, preprocessDraftForExtract);
           let lastEdited = new bot.date(pg.revisions[0].timestamp);
           let size = pg.revisions[0].size;
           let title = pg.title;
           let desc = pg.description;
           if (desc && desc.size > 255) {
               desc = desc.slice(0, 250) + ' ...';
           }
           return g13db.run(`
               INSERT INTO g13 VALUES(?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE excerpt=VALUES(excerpt), description=VALUES(description), ts=VALUES(ts), size=VALUES(size)
           `, [title, desc, excerpt, size, lastEdited]).catch(e => {
               log(`[E] Error inserting ${pg} into g13 db`);
               log(e);
           });
       }));
    }

    // Delete data older than 1 week in g13 db
    await g13db.run(`DELETE FROM g13 WHERE ts < FROM_UNIXTIME(?)`, [
        Math.round(new bot.date().subtract(6, 'months').subtract(7 * 24, 'hours').getTime() / 1000)
    ]);
    log(`[i] Deleted g13 db data more than 1 week old`);

    // For today's report:
    // Query G13 deletions in last 24 hours

    const g13Regex = /G13/i;

    const lestart = (function () {
        let d = new bot.date().subtract(24, 'hours');
        d.setUTCHours(0,0,0,0);
        return d;
    })();
    const leend = (function () {
        let d = new bot.date();
        d.setUTCHours(0,0,0,0);
        return d;
    })();

    let data = {} as Map<string, {excerpt?: string, description: string, ts: string, size: number, error?: string}>;

    for await (const json of bot.continuedQueryGen({
        "action": "query",
        "list": "logevents",
        "leprop": "title|timestamp|comment",
        "letype": "delete",
        "leaction": "delete/delete",
        "lestart": lestart.toISOString(),
        "leend": leend.toISOString(),
        "ledir": "newer",
        "lelimit": "max"
    })) {
        const g13Deletions = json.query.logevents
            .filter(log => g13Regex.test(log.comment));
        log(`[+] Got a page of the deletion log entries, with ${g13Deletions.length} G13 deletions (out of ${json.query.logevents.length})`);

        await Promise.all(g13Deletions.map(entry => {
            if (entry.ns !== 118 && entry.ns !== 2) {
                data[entry.title] = {
                    error: 'Invalid G13: page not in draft/user space'
                };
                return;
            }
            return g13db.query(`SELECT * FROM g13 WHERE name = ?`, [entry.title]).then(result => {
                if (result.length) {
                    data[entry.title] = result[0];
                } else {
                    log(`[E] Invalid G13 (not found in g13 db): ${entry.title}`);
                    data[entry.title] = {
                        // TODO: fetch last edit time
                        error: 'Possibly invalid G13: could not find excerpt'
                    };
                }
            }, e => {
                log(`[E] Error querying g13 db for ${entry.title}`);
                data[entry.title] = {
                    error: 'Failed to fetch'
                };
                log(e);
            })
        }));
    }
    g13db.end();

    let table = new mwn.table();
    table.addHeaders([
        {label: 'Date', style: 'width: 5em'},
        {label: 'Draft', style: 'width: 18em'},
        {label: 'Excerpt'},
        {label: 'Size', style: 'width: 4em'}
    ]);
    for (const [title, details] of Object.entries(data)) {
        let page = `[[${title}]]`;
        if (details.description) {
            page += ` (<small>${details.description}</small>)`
        }
        table.addRow([
            details.ts ? new bot.date(details.ts).format('YYYY-MM-DD HH:mm') : '',
            page,
            details.excerpt ? details.excerpt :
                (details.error ? `<span class="error">[${details.error}]</span>` : ''),
            String(details.size || '')
        ]);
    }
    const wikitable = table.getText();

    let yesterday = new bot.date().subtract(1, 'day');

    let page = new bot.page('User:SDZeroBot/G13 Watch' + (argv.sandbox ? '/sandbox' : ''));

    let oldlinks = '';
    try {
        oldlinks = (await page.history(['timestamp', 'ids'], 3)).map(rev => {
            let date = new bot.date(rev.timestamp).subtract(24, 'hours');
            return `[[Special:Permalink/${rev.revid}|${date.format('D MMMM')}]]`;
        }).join(' - ') + ' - {{history|2=older}}';
    } catch (e) {}

    let text = `{{/header/v4|count=${result.length}|date=${yesterday.format('D MMMM YYYY')}|ts=~~~~~|oldlinks=${oldlinks}}}<includeonly><section begin=lastupdate />${new bot.date().toISOString()}<section end=lastupdate /></includeonly>`
        + `\n\n${wikitable}`;

    await saveWithBlacklistHandling(page, text, 'Updating G13 report');

    log(`[i] Finished`);
    closeTunnels();

})().catch(err => emailOnError(err, 'g13-watch'));
