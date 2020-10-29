const {fs, bot, log, TextExtractor, enwikidb, emailOnError, mwn, utils, argv} = require('../botbase');
const {AfcDraftSize, getWikidataShortdescs, populateOresQualityRatings, comparators, preprocessDraftForExtract, saveWithBlacklistHandling} = require('./commons');

(async function() {

log(`[i] Started`);

let tableInfo = {};

const startTs = new bot.date().subtract(6, 'months').setUTCHours(0,0,0,0).format('YYYYMMDDHHmmss');

const db = await new enwikidb().connect();
const result = argv.nodb ? JSON.parse(fs.readFileSync(__dirname + '/g13-eligible-db.json').toString()) :
	await db.query(`
	SELECT DISTINCT page_namespace, page_title, rev_timestamp
	FROM page
	JOIN revision ON rev_id = page_latest
	WHERE page_namespace = 118
	AND page_is_redirect = 0
	AND rev_timestamp < "${startTs}"

	UNION
	
	SELECT DISTINCT page_namespace, page_title, rev_timestamp
	FROM page
	JOIN revision ON rev_id = page_latest
	JOIN templatelinks ON tl_from = page_id 
	WHERE page_namespace = 2
	AND tl_title = "AFC_submission" 
	AND tl_namespace = 10
	AND page_is_redirect = 0
	AND rev_timestamp < "${startTs}"
`);
db.end();
process.chdir(__dirname);
utils.saveObject('g13-eligible-db', result);
log('[S] Got DB query result');

await bot.getTokensAndSiteInfo();

result.forEach(row => {
	let pagename = new bot.title(row.page_title, row.page_namespace).toText();
	tableInfo[pagename] = {
		ts: row.rev_timestamp
	};
});

log(`[i] Found ${Object.keys(tableInfo).length} pages`);

// Check that the last edit timestamp isn't recent, guards against database replag
function validateTime(ts) {
	let date = new bot.date(ts);
	if (date.isAfter(new bot.date().subtract(2, 'months'))) { // XXX
		return false;
	}
	return true;
}

// In theory, we can request all the details of upto 500 pages in 1 API call, but
// send in batches of 100 to avoid the slim possibility of hitting the max API response size limit
await bot.seriesBatchOperation(utils.arrayChunk(Object.keys(tableInfo), 100), async (pageSet) => {

	for await (let pg of bot.readGen(pageSet, {
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
	})) {
		let rev = pg.revisions?.[0];
		if (pg.missing || !rev || !validateTime(rev.timestamp)) {
			tableInfo[pg.title].skip = true;
			continue;
		}
		let text = rev.content;
		let templates = pg.templates?.map(e => e.title.slice('Template:'.length)) || [];
		let categories = pg.categories?.map(e => e.title.slice('Category:'.length)) || [];
		Object.assign(tableInfo[pg.title], {
			extract: TextExtractor.getExtract(text, 250, 500, preprocessDraftForExtract),
			revid: pg.lastrevid,
			desc: pg.description,
			coi: templates.includes('COI') || templates.includes('Connected contributor'),
			upe: templates.includes('Undisclosed paid'),
			declines: text.match(/\{\{AFC submission\|d/g)?.length || 0,
			rejected: categories.includes('Rejected AfC submissions'),
			draftified: templates.includes('Drafts moved from mainspace'),
			promising: categories.includes('Promising draft articles'),
			blank: /\{\{AFC submission\|d\|blank/.test(text),
			test: /\{\{AFC submission\|d\|test/.test(text),
			size: AfcDraftSize(text),
			unsourced: !/<ref/i.test(text) && !/\{\{([Ss]fn|[Hh]arv)/.test(text),
		});
	}

}, 0, 1);

// ORES
await populateOresQualityRatings(tableInfo);

// Wikidata short descriptions
await getWikidataShortdescs(Object.keys(tableInfo), tableInfo);

let table = new mwn.table({
	style: 'overflow-wrap: anywhere'
});
table.addHeaders([
	{label: 'Draft', style: 'width: 15em'},
	{label: 'Excerpt' },
	{label: '# declines', style: 'width: 4em'},
	{label: 'Size', style: 'width: 2em'},
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
		`[[${title}]] ${data.desc ? `(<small>${data.desc}</small>)` : ''}`,
		data.extract || '',
		data.declines ?? '',
		data.short ? `<span class=short>${data.size}</span>` : (data.size || ''),
		notes.join('<br>'),
	]);
});


let page = new bot.page('User:SDZeroBot/G13 eligible' + (argv.sandbox ? '/sandbox' : ''));

let wikitext =
	`{{/header|count=${Object.keys(tableInfo).length}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.date().toISOString()}<section end=lastupdate /></includeonly>
${TextExtractor.finalSanitise(table.getText())}
`;

await saveWithBlacklistHandling(page, wikitext);

log(`[i] Finished`);


})().catch(err => emailOnError(err, 'g13-eligible'));
