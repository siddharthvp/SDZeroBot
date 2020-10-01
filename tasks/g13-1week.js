const {fs, bot, log, TextExtractor, enwikidb, emailOnError, mwn, utils, argv} = require('../botbase');
const OresUtils = require('../OresUtils');

(async function() {

log(`[i] Started`);

let tableInfo = {};

const startTs = new bot.date().subtract(6, 'months').add(7, 'days').format('YYYYMMDDHHmmss');	
const endTs = new bot.date().subtract(6, 'months').add(6, 'days').format('YYYYMMDDHHmmss');

const db = await new enwikidb().connect();
const result = argv.nodb ? JSON.parse(fs.readFileSync(__dirname + '/g13-1week-db.json').toString()) : 
await db.query(`
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
	AND tl_title = "AFC_submission" 
	AND tl_namespace = 10
	AND page_is_redirect = 0
	AND rev_timestamp < "${startTs}"
	AND rev_timestamp > "${endTs}"
`);
db.end();
process.chdir(__dirname);
utils.saveObject('g13-1week-db', result);
log('[S] Got DB query result');

await bot.getTokensAndSiteInfo();

result.forEach(row => {
	let pagename = new bot.title(row.page_title, row.page_namespace).toText();
	tableInfo[pagename] = {
		ts: row.rev_timestamp
	};
});

log(`[i] Found ${Object.keys(tableInfo).length} pages`); 

// Get page size not counting AFC templates and comments
function size(text) {
	text = text.replace(/<!--.*?-->/sg, ''); // remove comments
	let wkt = new bot.wikitext(text);
	wkt.parseTemplates({
		namePredicate: name => name.startsWith('AFC ') // AFC submission, AFC comment, etc
	});
	for (let template of wkt.templates) {
		wkt.removeEntity(template);
	}
	return wkt.getText().length;
}

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
		let categories = pg.categories?.map(e => e.title.slice('Category'.length)) || [];
		Object.assign(tableInfo[pg.title], {
			extract: TextExtractor.getExtract(text, 250, 500),
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
			size: size(text),
			unsourced: !/<ref/i.test(text) && !/\{\{([Ss]fn|[Hh]arv)/.test(text),
		});
	}

}, 0, 1);

// ORES
let revidTitleMap = Object.entries(tableInfo).reduce((map, [title, data]) => {
	if (data.revid) {
		map[data.revid] = title;
	}
	return map;
}, {});
await OresUtils.queryRevisions(['articlequality'], Object.keys(revidTitleMap)).then(data => {
	for (let [revid, {articlequality}] of Object.entries(data)) {
		tableInfo[revidTitleMap[revid]].oresRating = {
			'Stub': 1, 'Start': 2, 'C': 3, 'B': 4, 'GA': 5, 'FA': 6 // sort-friendly format
		}[articlequality];
	}
}).catch(err => {
	log(`[E] ORES query failed: ${err}`);
	emailOnError(err, 'g13-1week ores (non-fatal)');
});

let table = new mwn.table();
table.addHeaders([
	{label: 'Last edit', style: 'width: 5em'},
	{label: 'Draft', style: 'width: 15em'},
	{label: 'Excerpt' },
	{label: '# declines', style: 'width: 4em'},
	{label: 'Notes', style: 'width: 5em'},
	'ORES',
	'Size'
]);

// Helper functions for sorting
function promote(param, data1, data2) {
	if (data1[param] && !data2[param]) return -1;
	else if (!data1[param] && data2[param]) return 1;
	else return 0;
}
function demote(param, data1, data2) {
	if (data1[param] && !data2[param]) return 1;
	else if (!data1[param] && data2[param]) return -1;
	else return 0;
}
function sortDesc(param, data1, data2) { 
	if (data1[param] > data2[param]) return -1;
	else if (data1[param] < data2[param]) return 1;
	else return 0;
}
function sortAsc(param, data1, data2) { // eslint-disable-line no-unused-vars
	if (data1[param] > data2[param]) return 1;
	else if (data1[param] < data2[param]) return -1;
	else return 0;
}

Object.entries(tableInfo).filter(([_title, data]) => { // eslint-disable-line no-unused-vars
	return !data.skip;
}).map(([title, data]) => {
	// Synthesise any new parameters from the data here
	data.short = data.size < 500;
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
	if (data.blank) notes.push('blank')
	if (data.test) notes.push('test')
	if (data.short) notes.push('short');
	if (data.draftified) notes.push('draftified');

	table.addRow([
		new bot.date(data.ts).format('YYYY-MM-DD HH:mm'),
		`[[${title}]] ${data.desc ? `(<small>${data.desc}</small>)` : ''}`,
		data.extract || '',
		data.declines ?? '',
		notes.join('<br>'),
		data.oresRating || '',
		data.size
	]);
});


let page = new bot.page('User:SDZeroBot/G13 soon'),
	oldlinks = '';

try {
	oldlinks = (await page.history('timestamp|ids', 3)).map(rev => {
		let date = new bot.date(rev.timestamp).subtract(24, 'hours');
		return `[[Special:Permalink/${rev.revid}|${date.format('D MMMM')}]]`;
	}).join(' - ') + ' - {{history|2=older}}';	
} catch (e) {} // eslint-disable-line no-empty

let wikitext =
`{{/header|count=${Object.keys(tableInfo).length}|oldlinks=${oldlinks}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.date().format('D MMMM YYYY')}<section end=lastupdate /></includeonly>
${TextExtractor.finalSanitise(table.getText())}
`;

await page.save(wikitext, 'Updating').catch(async err => {
	if (err.code === 'spamblacklist') {
		// Cut out the protocol of links that hit the blacklist
		for (let site of err.response.error.spamblacklist.matches) {
			wikitext = wikitext.replace(
				new RegExp('https?:\\/\\/' + site, 'g'),
				site
			);
		}
		await page.save(wikitext, 'Updating');
	} else {
		return Promise.reject(err);
	} 
});

log(`[i] Finished`);


})().catch(err => emailOnError(err, 'g13-1week'));