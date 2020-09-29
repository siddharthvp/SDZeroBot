const {bot, log, enwikidb, emailOnError, mwn, utils, argv} = require('../botbase');
const TextExtractor = require('../TextExtractor')(bot);

(async function() {

log(`[i] Started`);

let tableInfo = {};

const startTs = new bot.date().subtract(6, 'months').add(7, 'days').format('YYYYMMDDHHmmss');	
const endTs = new bot.date().subtract(6, 'months').add(6, 'days').format('YYYYMMDDHHmmss');

const db = await new enwikidb().connect();
const result = argv.nodb ? JSON.parse(fs.readFileSync('./g13-1week-db.json').toString()) : await db.query(`
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
utils.saveObject('g13-1week-db.json', result);
log('[S] Got DB query result');

await bot.getTokensAndSiteInfo();

result.forEach(row => {
	var pagename = new bot.title(row.page_title, row.page_namespace).toText();
	tableInfo[pagename] = {
		ts: row.rev_timestamp
	};
});

log(`[i] Found ${Object.keys(tableInfo).length} pages`); 

for await (let json of bot.massQueryGen({
	"action": "query",
	"prop": "revisions|description|templates",
	"titles": Object.keys(tableInfo),
	"rvprop": "content",
	"rvsection": "0",
	"rvslots": "main",
	"tltemplates": ["Template:COI", "Template:Undisclosed paid", "Template:Connected contributor"],
	"tllimit": "max",
})) {

	for (let pg of json.query.pages) {
		Object.assign(tableInfo[pg.title], {
			extract: TextExtractor.getExtract(pg.revisions?.[0].slots?.main?.content, 250, 500),
			desc: pg.description,
			coi: pg.templates && pg.templates.find(e => e.title === 'Template:COI' || e.title === 'Template:Connected contributor'),
			upe: pg.templates && pg.templates.find(e => e.title === 'Template:Undisclosed paid'),
		});
	}

}

/* GET DATA FOR NUMBER OF DECLINES */
const doSearch = async function(count) {
	var dec = '\\{\\{AFC submission\\|d\\|.*'.repeat(count).slice(0, -2);
	var searchQuery = `incategory:"Declined AfC submissions" insource:/${dec}/`;
	for await (let json of bot.continuedQueryGen({
		"action": "query",
		"list": "search",
		"srsearch": searchQuery,
		"srnamespace": "118",
		"srlimit": "max",
		"srinfo": "",
		"srprop": ""
	})) {
		let pages = json.query.pages;
		if (!pages) {
			continue;
		}
		pages.forEach(page => {
			if (tableInfo[page]) {
				tableInfo[page].declines = count;
			}
		});
		log(`[+][${count}/10] Fetched ${json.query.pages.length} drafts declined ${count} or more times`);
	}
}
for (let i = 1; i <= 10; i++) {
	await doSearch(i);
}


let table = new mwn.table();
table.addHeaders([
	{label: 'Time', style: 'width: 5em'},
	{label: 'Draft', style: 'width: 15em'},
	{label: 'Excerpt' },
	{label: '# declines', style: 'width: 4em'},
	{label: 'Notes', style: 'width: 5em'}
]);

Object.entries(tableInfo).map(([title, {extract, desc, ts, coi, upe, unsourced, copyvio, rejected, declines}]) => {
	let notes = [];
	if (coi) {
		notes.push('COI');
	}
	if (upe) {
		notes.push('Undisclosed-paid');
	}
	if (unsourced) {
		notes.push('unsourced');
	}
	if (copyvio) {
		notes.push('copyvio')
	}
	if (rejected) {
		notes.push('rejected');
	}

	return [
		new bot.date(ts).format('YYYY-MM-DD HH:mm'),
		`[[${title}]] ${desc ? `(<small>${desc}</small>)` : ''}`,
		extract || '',
		declines,
		notes.join('<br>')
	];
})
.sort((a, b) => a[0] < b[0] ? -1 : 1) // sort by date
.forEach(row => table.addRow(row));


let page = new bot.page('User:SDZeroBot/G13 soon'),
	oldlinks = '';

try {
	oldlinks = (await page.history('timestamp|ids', 3)).map(rev => {
		let date = new bot.date(rev.timestamp).subtract(24, 'hours');
		return `[[Special:Permalink/${rev.revid}|${date.format('D MMMM')}]]`;
	}).join(' - ') + ' - {{history|2=older}}';	
} catch (e) {}

let wikitext =
`{{/header|count=${Object.keys(tableInfo).length}|oldlinks=${oldlinks}|ts=~~~~~}}
${TextExtractor.finalSanitise(table.getText())}
`;

await page.save(wikitext, 'Updating').catch(async err => {
	if (err.code === 'spamblacklist') {
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