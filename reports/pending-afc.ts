import { argv, bot, emailOnError, enwikidb, log, Mwn, TextExtractor } from "../botbase";
import {
	AfcDraftSize,
	comparators,
	populateOresQualityRatings,
	populateWikidataShortdescs,
	preprocessDraftForExtract, saveWithBlacklistHandling
} from "./commons";
import { createLocalSSHTunnel, arrayChunk, len } from "../utils";
import { ENWIKI_DB_HOST } from "../db";
import { NS_DRAFT } from "../namespaces";

(async function() {

	log(`[i] Started`);

	let tableInfo = {};

	const db = new enwikidb();
	await createLocalSSHTunnel(ENWIKI_DB_HOST);
	const result = await db.query(`
        SELECT page_title, page_latest, cl_sortkey_prefix, actor_name, rev_timestamp, user_editcount,
               (SELECT afds.page_title from page afds
                WHERE page_namespace = 4
                  AND afds.page_title = CONCAT('Articles_for_deletion/', p.page_title)
                  AND afds.page_id NOT IN  (
                    SELECT cl_from FROM categorylinks
                    WHERE cl_to = 'AfD_debates'
                )
               ) AS prior_afd
        FROM page p
		JOIN categorylinks ON page_id = cl_from
		JOIN revision ON page_id = rev_page AND rev_parent_id = 0
		JOIN actor_revision ON rev_actor = actor_id
		LEFT JOIN user ON user_id = actor_user
        WHERE cl_to = 'Pending_AfC_submissions'
        AND page_namespace = 118;
	`) as Array<{page_title: string, page_latest: number, cl_sortkey_prefix: string,
		actor_name: string, rev_timestamp: string, user_editcount: number, prior_afd: string}>;

	db.end();
	process.chdir(__dirname);
	log('[S] Got DB query result');

	await bot.getTokensAndSiteInfo();

	result.forEach(row => {
		let pagename = bot.title.makeTitle(NS_DRAFT, row.page_title).toText();
		tableInfo[pagename] = {
			revid: row.page_latest,
			creationDate: formatDateString(row.rev_timestamp),
			submissionDate: formatDateString(row.cl_sortkey_prefix.slice(1)),
			creator: row.actor_name,
			creatorEdits: row.user_editcount || '',
			priorAfD: row.prior_afd
		};
	});

	log(`[i] Found ${Object.keys(tableInfo).length} pages`);

	// In theory, we can request all the details of upto 500 pages in 1 API call, but
	// send in batches of 100 to avoid the slim possibility of hitting the max API response size limit
	for (let [idx, pageSet] of Object.entries(arrayChunk(Object.keys(tableInfo), 100))) {

		log(`[+] Running API call ${Number(idx)+1}/${Math.ceil(len(tableInfo)/100)}`);
		for await (let pg of bot.readGen(pageSet, {
			"prop": "revisions|description|templates|categories",
			"rvprop": "content",
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
			if (pg.missing || !rev) {
				tableInfo[pg.title].skip = true;
				continue;
			}
			let text = rev.content;
			let excerpt = TextExtractor.getExtract(text, 250, 500, preprocessDraftForExtract);
			if (excerpt === '') { // empty extract is suspicious
				if (/^\s*#redirect/i.test(text)) { // check if it's a redirect
					// the db query should omit redirects, this happens only because of db lag
					// or if the page was converted to redirect after the db fetch
					tableInfo[pg.title].skip = true; // skip it
					continue;
				}
			}
			let templates = pg.templates?.map(e => e.title.slice('Template:'.length)) || [];
			let categories = pg.categories?.map(e => e.title.slice('Category:'.length)) || [];
			if (!tableInfo[pg.title]) {
				log(`[E] Page [[${pg.title}]] from API response was not there in db result (not in tableInfo)`);
				continue;
			}
			Object.assign(tableInfo[pg.title], {
				extract: excerpt,
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

	}

	// ORES
	await populateOresQualityRatings(tableInfo);

	// Wikidata short descriptions
	await populateWikidataShortdescs(tableInfo);

	let table = new Mwn.table({
		style: 'overflow-wrap: anywhere'
	});
	table.addHeaders([
		{label: 'Submission date', style: 'width: 5em'},
		{label: 'Draft', style: 'width: 15em'},
		{label: 'Excerpt' },
		{label: 'Previous declines', style: 'width: 5em'},
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
			// demote('blank', data1, data2) ||
			// demote('test', data1, data2) ||
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
		if (data.upe) notes.push('UPE');
		if (data.unsourced) notes.push('unsourced');
		if (data.rejected) notes.push('rejected');
		if (data.blank) notes.push('blank');
		if (data.test) notes.push('test');
		if (data.draftified) notes.push('draftified');
		if (data.priorAfD) notes.push(`[[WP:${data.priorAfD}|Prior AfD]]`)

		table.addRow([
			data.submissionDate,
			`[[${title}]] ${data.desc ? `(<small>${data.desc}</small>)` : ''}`,
			data.extract || '',
			data.declines ?? '',
			data.short ? `<span class=short>${data.size}</span>` : (data.size || ''),
			notes.join('<br>'),
		]);
	});


	let page = new bot.page('User:SDZeroBot/Pending AfC submissions' + (argv.sandbox ? '/sandbox' : ''));

	let wikitext =
		`{{/header|count=${table.getNumRows()}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.date().toISOString()}<section end=lastupdate /></includeonly>
${TextExtractor.finalSanitise(table.getText())}
`;

	await saveWithBlacklistHandling(page, wikitext, 'Updating AfC report');

	log(`[i] Finished`);


})().catch(err => emailOnError(err, 'pending-afc'));

function formatDateString(str) {
	return str.slice(0, 4) + '-' + str.slice(4, 6) + '-' + str.slice(6, 8);
}
