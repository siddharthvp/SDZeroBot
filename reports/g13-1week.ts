import { argv, bot, emailOnError, log, mwn, TextExtractor } from "../botbase";
import { ApiRevision, MwnDate} from "../../mwn";
import {
	AfcDraftSize,
	comparators,
	populateOresQualityRatings,
	populateWikidataShortdescs,
	preprocessDraftForExtract,
	saveWithBlacklistHandling
} from "./commons";
import { arrayChunk, createLocalSSHTunnel } from "../utils";
import { ENWIKI_DB_HOST, enwikidb } from "../db";

const REPORT_PAGE = 'User:SDZeroBot/G13 soon' + (argv.sandbox ? '/sandbox2' : '');

async function runForDate(date: MwnDate) {

	let tableInfo: Record<string, any> = {};

	// TODO: make date class objects immutable
	const startTs = new bot.date(date.getTime()).add(1, 'day').format('YYYYMMDDHHmmss');
	const endTs = date.format('YYYYMMDDHHmmss');

	const db = new enwikidb();
	const result = await db.query(`
		SELECT DISTINCT page_namespace, page_title, rev_timestamp
		FROM page
		JOIN revision ON rev_id = page_latest
		WHERE page_namespace = 118
		AND page_is_redirect = 0
		AND rev_timestamp < "${startTs}"
		AND rev_timestamp > "${endTs}"
	
		UNION
		
		SELECT DISTINCT page_namespace, page_title, rev_timestamp
		FROM page
		JOIN revision ON rev_id = page_latest
		JOIN templatelinks ON tl_from = page_id 
		WHERE page_namespace = 2
		AND tl_target_id = (SELECT lt_id FROM linktarget 
			WHERE lt_namespace = 10 AND lt_title = "AfC_submission")
		AND page_is_redirect = 0
		AND rev_timestamp < "${startTs}"
		AND rev_timestamp > "${endTs}"
	`);
	db.end();
	log('[S] Got DB query result');

	result.forEach(row => {
		let pagename = bot.title.makeTitle(row.page_namespace, row.page_title).toText();
		tableInfo[pagename] = {
			ts: row.rev_timestamp
		};
	});

	log(`[i] Found ${Object.keys(tableInfo).length} pages`);


	// In theory, we can request all the details of upto 500 pages in 1 API call, but
	// send in batches of 100 to avoid the slim possibility of hitting the max API response size limit
	await bot.seriesBatchOperation(arrayChunk(Object.keys(tableInfo), 100), async (pageSet) => {

		for await (let pg of bot.readGen(pageSet, {
			"prop": "revisions|info|description|templates|categories",
			"rvprop": "content|timestamp",
			"redirects": false,
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
		})) {
			let rev = pg.revisions?.[0];
			if (pg.missing || !rev || !validateTime(rev.timestamp)) {
				tableInfo[pg.title].skip = true;
				continue;
			}
			if (!tableInfo[pg.title]) {
				log(`[E] Page [[${pg.title}]] from API response was not there in db result (not in tableInfo)`);
				continue;
			}
			let text = rev.content;
			let excerpt = TextExtractor.getExtract(text, 250, 500, preprocessDraftForExtract);
			if (excerpt === '') { // empty extract is suspicious
				if (/^\s*#redirect/i.test(text)) { // check if it's a redirect
					// the db query should omit redirects, this happens only because of db lag
					// or if the page was converted to redirect after the db fetch
					tableInfo[page.title].skip = true; // skip it
					continue;
				}
			}
			let templates = pg.templates?.map(e => e.title.slice('Template:'.length)) || [];
			let categories = pg.categories?.map(e => e.title.slice('Category:'.length)) || [];
			Object.assign(tableInfo[pg.title], {
				extract: excerpt,
				revid: pg.lastrevid,
				lastedit: rev.timestamp,
				desc: pg.description,
				coi: templates.includes('COI') || templates.includes('Connected contributor'),
				upe: templates.includes('Undisclosed paid'),
				declines: text.match(/\{\{A[fF]C submission\|d/g)?.length || 0,
				rejected: categories.includes('Rejected AfC submissions'),
				draftified: templates.includes('Drafts moved from mainspace'),
				promising: categories.includes('Promising draft articles'),
				blank: /\{\{A[fF]C submission\|d\|blank/.test(text),
				test: /\{\{A[fF]C submission\|d\|test/.test(text),
				size: AfcDraftSize(text),
				unsourced: !/<ref/i.test(text) && !/\{\{([Ss]fn|[Hh]arv)/.test(text),
			});
		}

	}, 0, 1);

	// populate ORES quality ratings
	await populateOresQualityRatings(tableInfo);

	// Wikidata short descriptions
	await populateWikidataShortdescs(tableInfo);

	let table = new mwn.table({
		style: 'overflow-wrap: anywhere'
	});
	table.addHeaders([
		{label: 'Last edit (UTC)', style: 'width: 5em'},
		{label: 'Draft', style: 'width: 15em'},
		{label: 'Excerpt' },
		{label: '# declines', style: 'width: 5em'},
		{label: 'Size', style: 'width: 3em'},
		{label: 'Notes', style: 'width: 5em'}
	]);

	const {sortDesc, promote, demote} = comparators;

	Object.entries(tableInfo).filter(([_title, data]) => { // eslint-disable-line no-unused-vars
		return !data.skip;
	}).map(([title, data]) => {
		// Synthesise any new parameters from the data here
		data.short = data.size < 500; // thankfully undefined < 500 is false
		return [title, data];

	}).sort(([_title1, data1], [_title2, data2]) => { // eslint-disable-line no-unused-vars
		// Sorting: put promising drafts at the top, rejected or blank/test submissions at the bottom
		// then put the unsourced ones below the ones with sources
		// finally sort by ORES rating and then by size, both descending
		// Order of statements here matters!
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
	}).forEach(([title, data]) => {
		let notes = [];
		if (data.promising) notes.push('promising');
		if (data.coi) notes.push('COI');
		if (data.upe) notes.push('undisclosed-paid');
		if (data.unsourced) notes.push('unsourced');
		if (data.rejected) notes.push('rejected');
		if (data.blank) notes.push('blank');
		if (data.test) notes.push('test');
		if (data.draftified) notes.push('draftified');

		table.addRow([
			new bot.date(data.lastedit).format('YYYY-MM-DD HH:mm'),
			`[[${title}]] ${data.desc ? `(<small>${data.desc}</small>)` : ''}`,
			data.extract || '',
			data.declines ?? '',
			data.short ? `<span class=short>${data.size}</span>` : (data.size || ''),
			notes.join('<br>'),
		]);
	});


	let page = new bot.page(REPORT_PAGE);
	let oldlinks = await makeOldLinks();

	let wikitext =
		`{{/header|count=${table.getNumRows()}|oldlinks=${oldlinks}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.date().toISOString()}<section end=lastupdate /></includeonly>
${TextExtractor.finalSanitise(table.getText())}
''Rejected, unsourced, blank, very short or test submissions are at the bottom, more promising drafts are at the top.''
`;

	// Keep in sync with DATE_FROM_SUMMARY_REGEX
	await saveWithBlacklistHandling(page, wikitext, `G13 report: drafts with last edit on ${date.format('D MMMM YYYY')}`);
}

// Check that the last edit timestamp isn't recent, guards against database replag
function validateTime(ts) {
	let date = new bot.date(ts);
	return date.isBefore(new bot.date().subtract(2, 'months'));
}

const DATE_FROM_SUMMARY_REGEX = /last edit on (\d+.*)/;

function dateFromEditSummary(editSummary: string) {
	const rgxMatch = DATE_FROM_SUMMARY_REGEX.exec(editSummary);
	if (!rgxMatch) {
		return null;
	}
	return new bot.date(rgxMatch[1] + ' Z');
}

async function getRecentEdits(limit: number) {
	return new bot.page(REPORT_PAGE).history(['comment', 'ids'], limit, {
		rvuser: 'SDZeroBot'
	});
}

async function makeOldLinks() {
	try {
		// If same date has multiple reports (testing), show link to only the latest one
		let links: Record<string, string> = {};
		for (let rev of (await getRecentEdits(10))) {
			let date = dateFromEditSummary(rev.comment);
			if (date) {
				let dateStr = date.format('D MMMM');
				if (!links[dateStr]) {
					links[dateStr] = `[[Special:Permalink/${rev.revid}|Last edit ${dateStr}]]`;
					if (Object.keys(links).length >= 7) {
						break;
					}
				}
			}
		}
		return Object.values(links).join(' - ') + ' - {{history|2=older}}';
	} catch (e) {
		return '{{history}}';
	}
}

(async function() {

	log(`[i] Started`);
	await bot.getTokensAndSiteInfo();
	await createLocalSSHTunnel(ENWIKI_DB_HOST);
	process.chdir(__dirname);

	let lastRunDate;
	try {
		const lastEditSummary = (await getRecentEdits(1))[0].comment;
		lastRunDate = dateFromEditSummary(lastEditSummary);
	} catch (e) {} finally {
		if (!lastRunDate) {
			lastRunDate = new bot.date().subtract(1, 'day').subtract(6, 'months').add(6, 'days');
		}
	}

	let runTillDate = new bot.date().subtract(6, 'months').add(6, 'days');

	// zero out times for easy comparison
	// and for the SQL to work out right
	runTillDate.setUTCHours(0, 0, 0, 0);
	lastRunDate.setUTCHours(0, 0, 0, 0);

	// Most of the days, this would run once.
	// On beginning/end of certain months, this can run multiple times or not at all
	let date = lastRunDate.add(1, 'day');
	while (!date.isAfter(runTillDate)) {
		log(`[+] Running for drafts with last edit on ${date.format('D MMMM YYYY')}`);
		await runForDate(date);
		date = date.add(1, 'day');
	}
	// Note: remember that above all date methods modify the original object

	log(`[i] Finished`);

})().catch(err => emailOnError(err, 'g13-1week'));
