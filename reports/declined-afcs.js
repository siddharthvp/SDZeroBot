const {argv, bot, log, TextExtractor, emailOnError, Mwn, utils} = require('../botbase');
const {AfcDraftSize, populateWikidataShortdescs, populateOresQualityRatings, comparators,
	preprocessDraftForExtract, saveWithBlacklistHandling} = require('./commons');
const {enwikidb} = require("../db");

(async function() {

log(`[i] Started`);
await bot.getTokensAndSiteInfo();

let earwigReport = new bot.page('Template:AfC statistics/declined');
let yesterday = new bot.date().subtract(1, 'day');
let tableInfo = {};

bot.wikitext.parseTemplates(await earwigReport.text(), {
	name: name => name === '#invoke:AfC'
}).forEach(template => {
	let title = template.getValue('t');
	let ts = template.getValue('sd');
	if (!title || new bot.date(ts).getDate() !== yesterday.getDate()) {
		return;
	}
	tableInfo[title] = {
		ts: new bot.date(ts),
		copyvio: !!template.getValue('nc')
	};
});

log(`[i] Found ${Object.keys(tableInfo).length} pages declined yesterday`);
let db = new enwikidb();
let replag = await db.getReplagHours();
let replagNote = '';
if (replag > 0) {
	log(`[W] DB replag: ${replag} hours`);
	replagNote = db.makeReplagMessage(0);
}
db.end();

// In theory, we can request all the details of upto 500 pages in 1 API call, but
// send in batches of 100 to avoid the slim possibility of hitting the max API response size limit
await bot.seriesBatchOperation(utils.arrayChunk(Object.keys(tableInfo), 100), async (pageSet) => {

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
		if (pg.missing || !rev) {
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
				tableInfo[pg.title].skip = true; // skip it
				continue;
			}
		}
		let templates = pg.templates?.map(e => e.title.slice('Template:'.length)) || [];
		let categories = pg.categories?.map(e => e.title.slice('Category:'.length)) || [];
		Object.assign(tableInfo[pg.title], {
			extract: excerpt,
			revid: pg.lastrevid,
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

// ORES
await populateOresQualityRatings(tableInfo);

// Wikidata short descriptions
await populateWikidataShortdescs(tableInfo);

let table = new Mwn.table({
	style: 'overflow-wrap: anywhere'
});
table.addHeaders([
	{label: 'Draft', style: 'width: 15em'},
	{label: 'Excerpt'},
	{label: '# declines', style: 'width: 5em'},
	{label: 'Size', style: 'width: 3em'},
	{label: 'Notes', style: 'width: 5em'},
]);

// Helper functions for sorting
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
})
.forEach(([title, data]) => {
	let notes = [];
	if (data.promising) notes.push('promising');
	if (data.coi) notes.push('COI');
	if (data.upe) notes.push('undisclosed-paid');
	if (data.unsourced) notes.push('unsourced');
	if (data.rejected) notes.push('rejected');
	if (data.blank) notes.push('blank');
	if (data.test) notes.push('test');
	if (data.draftified) notes.push('draftified');
	if (data.copyvio) notes.push('copyvio');

	table.addRow([
		`[[${title}]] ${data.desc ? `(<small>${data.desc}</small>)` : ''}`,
		data.extract || '',
		data.declines ?? '',
		data.short ? `<span class=short>${data.size}</span>` : (data.size || ''),
		notes.join('<br>'),
	]);
});

let page = new bot.page('User:SDZeroBot/Recent AfC declines' + (argv.sandbox ? '/sandbox' : ''));

let oldlinks = (await page.history('timestamp|ids', 3)).map(rev => {
	let date = new bot.date(rev.timestamp).subtract(24, 'hours');
	return `[[Special:Permalink/${rev.revid}|${date.format('D MMMM')}]]`;
}).join(' - ') + ' - {{history|2=older}}';

let wikitext =
`{{/header|count=${table.getNumRows()}|date=${yesterday.format('D MMMM YYYY')}|oldlinks=${oldlinks}|ts=~~~~~}}${replagNote}<includeonly><section begin=lastupdate />${new bot.date().toISOString()}<section end=lastupdate /></includeonly>
${TextExtractor.finalSanitise(table.getText())}
''Rejected, unsourced, blank, very short or test submissions are at the bottom, more promising drafts are at the top.''
`;

await saveWithBlacklistHandling(page, wikitext, 'Updating');

log(`[i] Finished`);


})().catch(err => emailOnError(err, 'declined-afcs'));
