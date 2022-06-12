import {argv, bot, emailOnError, enwikidb, log, mwn} from "../../botbase";
import {toolsdb, TOOLS_DB_HOST, ENWIKI_DB_HOST} from "../../db";
import {arrayChunk, createLocalSSHTunnel, closeTunnels} from "../../utils";
import TextExtractor from "../../TextExtractor";
import {preprocessDraftForExtract, saveWithBlacklistHandling, comparators, AfcDraftSize} from '../commons';
import * as OresUtils from '../OresUtils';

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
           "prop": "revisions|info|description|templates|categories",
           "rvprop": "content|timestamp",
           "tltemplates": [
               "Template:COI",
               "Template:Undisclosed paid",
               "Template:Connected contributor",
               "Template:Drafts moved from mainspace"
           ],
           "clcategories": [
               "Category:Rejected AfC submissions",
               "Category:Promising draft articles"
           ],
           "tllimit": "max",
           "cllimit": "max"
       });
       pagedata = Array.isArray(pagedata) ? pagedata : [ pagedata ]; // in case this chunk has a single page

       // fetch ORES ratings as well
       let revIdTitleMap = Object.fromEntries(pagedata.filter(pg => !pg.missing).map(pg => [pg.lastrevid, pg.title]));
       let rawOresData = {};
       try {
           rawOresData = await OresUtils.queryRevisions(
               ['articlequality', 'draftquality'],
               Object.keys(revIdTitleMap),
               []
           );
       } catch (e) {
           log(`[E] Failed to fetch ORES data`);
       }
       let oresData = {};
       for (let [revid, {articlequality, draftquality}] of Object.entries(rawOresData)) {
           oresData[revIdTitleMap[revid]] = {
               oresRating: {
                   'Stub': 1, 'Start': 2, 'C': 3, 'B': 4, 'GA': 5, 'FA': 6 // sort-friendly format
               }[articlequality],
               oresBad: draftquality !== 'OK' // Vandalism/spam/attack, many false positives
           };
       }

       await Promise.all(pagedata.map(pg => {
           let rev = pg.revisions?.[0];
           if (!rev) {
               log(`[E] ${pg.title} no longer exists`);
               return;
           }
           let text = rev.content;
           let templates = pg.templates?.map(e => e.title.slice('Template:'.length)) || [];
           let categories = pg.categories?.map(e => e.title.slice('Category:'.length)) || [];

           let excerpt = TextExtractor.getExtract(text, 300, 500, preprocessDraftForExtract);
           let lastEdited = new bot.date(pg.revisions[0].timestamp);
           let size = AfcDraftSize(text);
           let title = pg.title;
           let desc = pg.description;
           if (desc && desc.size > 255) {
               desc = desc.slice(0, 250) + ' ...';
           }
           let declines = text.match(/\{\{A[fF]C submission\|d/g)?.length || 0;
           let upe = templates.includes('Undisclosed paid');
           let coi = templates.includes('COI') || templates.includes('Connected contributor');
           let unsourced = !/<ref/i.test(text) && !/\{\{([Ss]fn|[Hh]arv)/.test(text);
           let promising = categories.includes('Promising draft articles');
           let blank = /\{\{A[fF]C submission\|d\|blank/.test(text);
           let test = /\{\{A[fF]C submission\|d\|test/.test(text);
           let draftified = templates.includes('Drafts moved from mainspace');
           let rejected = categories.includes('Rejected AfC submissions');
           let oresBad = oresData?.[pg.title]?.oresBad ?? false;
           let oresRating = oresData?.[pg.title]?.oresRating ?? 2;
           return g13db.run(`
               REPLACE INTO g13(name, description, excerpt, size, ts, declines, upe, coi, unsourced, 
                                promising, blank, test, draftified, rejected, oresBad, oresRating)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           `, [
               title, desc, excerpt, size, lastEdited, declines, upe, coi, unsourced,
               promising, blank, test, draftified, rejected, oresBad, oresRating
           ]).catch(e => {
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

    let numDeletions = 0;
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
        numDeletions += g13Deletions.length;
        log(`[+] Got a page of the deletion log entries, with ${g13Deletions.length} G13 deletions (out of ${json.query.logevents.length})`);

        await Promise.all(g13Deletions.map(entry => {
            if (entry.ns !== 118 && entry.ns !== 2) {
                data[entry.title] = {
                    error: 'Invalid G13: page not in draft/user space'
                };
                return;
            }
            return g13db.query(`SELECT * FROM g13 WHERE name = ?`, [entry.title]).then(async result => {
                if (result.length) {
                    data[entry.title] = result[0];
                } else {
                    log(`[E] Invalid G13 (not found in g13 db): ${entry.title}`);
                    const lastEditTime = (await bot.query({
                        "prop": "deletedrevisions",
                        "titles": entry.title,
                        "drvprop": "timestamp",
                        "drvlimit": "1"
                    }))?.query?.pages?.[0]?.deletedrevisions?.[0]?.timestamp;

                    data[entry.title] = {
                        error: 'Possibly invalid G13: could not find excerpt. ' +
                            (lastEditTime ? `Last deleted edit was at ${lastEditTime}`: '')
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
    log(`[i] ${numDeletions} G13 deletions overall`);

    let table = new mwn.table();
    table.addHeaders([
        {label: 'Draft', style: 'width: 15em'},
        {label: 'Excerpt' },
        {label: '# declines', style: 'width: 5em'},
        {label: 'Size', style: 'width: 3em'},
        {label: 'Notes', style: 'width: 5em'}
    ]);

    const {sortDesc, promote, demote} = comparators;
    Object.entries(data).map(([title, details]) => {
        // Synthesise any new parameters from the details here
        details.short = details.size < 500; // thankfully undefined < 500 is false
        return [title, details];

    }).sort(([_title1, data1], [_title2, data2]) => {
        return (
            promote('promising', data1, data2) ||
            demote('blank', data1, data2) ||
            demote('test', data1, data2) ||
            demote('short', data1, data2) ||
            demote('rejected', data1, data2) ||
            demote('unsourced', data1, data2) ||
            demote('oresBad', data1, data2) || // many false positives
            sortDesc('oresRating', data1, data2) ||
            sortDesc('size', data1, data2)
        );
    }).forEach(([title, details]) => {
        let page = `[[${title}]]`;
        if (details.description) {
            page += ` (<small>${details.description}</small>)`
        }
        let notes = [];
        if (details.promising) notes.push('promising');
        if (details.coi) notes.push('COI');
        if (details.upe) notes.push('undisclosed-paid');
        if (details.unsourced) notes.push('unsourced');
        if (details.rejected) notes.push('rejected');
        if (details.blank) notes.push('blank');
        if (details.test) notes.push('test');
        if (details.draftified) notes.push('draftified');

        table.addRow([
            // details.ts ? new bot.date(details.ts).format('YYYY-MM-DD HH:mm') : '',
            page,
            details.excerpt ? details.excerpt :
                (details.error ? `<span class="error">[${details.error}]</span>` : ''),
            String(details.declines ?? ''),
            details.short ? `<span class=short>${details.size || ''}</span>` : (details.size || ''),
            notes.join('<br>')
        ]);
    });
    const wikitable = TextExtractor.finalSanitise(table.getText());

    let yesterday = new bot.date().subtract(1, 'day').format('D MMMM YYYY');

    let page = new bot.page('User:SDZeroBot/G13 Watch' + (argv.sandbox ? '/sandbox' : ''));

    let oldlinks = '';
    try {
        oldlinks = (await page.history(['timestamp', 'ids'], 3)).map(rev => {
            let date = new bot.date(rev.timestamp).subtract(24, 'hours');
            return `[[Special:Permalink/${rev.revid}|${date.format('D MMMM')}]]`;
        }).join(' - ') + ' - {{history|2=older}}';
    } catch (e) {}

    let text = `{{/header/v4|count=${numDeletions}|date=${yesterday}|ts=~~~~~|oldlinks=${oldlinks}}}<includeonly><section begin=lastupdate />${new bot.date().toISOString()}<section end=lastupdate /></includeonly>`
        + `\n\n${wikitable}`
        + `\n''Rejected, unsourced, blank, very short or test submissions are at the bottom, more promising drafts are at the top.''`;

    await saveWithBlacklistHandling(page, text, `Updating report: ${numDeletions} G13 deletions on ${yesterday}`);

    log(`[i] Finished`);
    closeTunnels();

})().catch(err => emailOnError(err, 'g13-watch'));
