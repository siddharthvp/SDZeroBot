const {bot, log, emailOnError, mwn, utils} = require('../botbase');
const TextExtractor = require('../TextExtractor')(bot);

(async function() {

log(`[i] Started`);
await bot.getTokensAndSiteInfo();

let earwigReport = new bot.page('Template:AFC statistics/declined');
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

// In theory, we can request all the details of upto 500 pages in 1 API call, but 
// send in batches of 100 to avoid the slim possibility of hitting the max API response size limit
await bot.seriesBatchOperation(utils.arrayChunk(Object.keys(tableInfo), 100), async (pageSet) => {

	for await (let pg of bot.readGen(pageSet, {
		"prop": "revisions|description|templates|categories",
		"tltemplates": ["Template:COI", "Template:Undisclosed paid", "Template:Connected contributor"],
		"clcategories": ["Category:Rejected AfC submissions", "Category:Promising draft articles"],
		"tllimit": "max",
		"cllimit": "max"
	})) {
		if (pg.missing) {
			continue;
		}
		let text = pg.revisions[0].content;
		Object.assign(tableInfo[pg.title], {
			extract: TextExtractor.getExtract(text, 250, 500),
			desc: pg.description,
			coi: pg.templates && pg.templates.find(e => e.title === 'Template:COI' || e.title === 'Template:Connected contributor'),
			upe: pg.templates && pg.templates.find(e => e.title === 'Template:Undisclosed paid'),
			declines: text.match(/\{\{AFC submission\|d/g)?.length || 0,
			rejected: pg.categories && pg.categories.find(e => e.title === 'Category:Rejected AfC submissions'),
			promising: pg.categories && pg.categories.find(e => e.title === 'Category:Promising draft articles'),
			blank: /\{\{AFC submission\|d\|blank/.test(text),
			test: /\{\{AFC submission\|d\|test/.test(text),
			unsourced: !/<ref/i.test(text) && !/\{\{([Ss]fn|[Hh]arv)/.test(text),
		});
	}

}, 0, 1);


let table = new mwn.table();
table.addHeaders([
	{label: 'Time', style: 'width: 5em'},
	{label: 'Draft', style: 'width: 15em'},
	{label: 'Excerpt' },
	{label: '# declines', style: 'width: 4em'},
	{label: 'Notes', style: 'width: 5em'}
]);

Object.entries(tableInfo).sort(([_title1, data1], [_title2, data2]) => { // eslint-disable-line no-unused-vars
	// Sorting: put promising drafts at the top, rejected or blank/test submissions at the bottom
	// then put the unsourced ones below the ones with sources
	// finally sort by time
	if (data1.promising && !data2.promising) return -1;
	if (!data1.promising && data2.promising) return 1;
	if (data1.blank && !data2.blank) return 1;
	if (!data1.blank && data2.blank) return -1;
	if (data1.test && !data2.test) return 1;
	if (!data1.test && data2.test) return -1;
	if (data1.rejected && !data2.rejected) return 1;
	if (!data1.rejected && data2.rejected) return -1;
	if (data1.unsourced && !data2.unsourced) return 1;
	if (!data1.unsourced && data2.unsourced) return -1;
	return data1.ts < data2.ts ? -1 : 1;
})
.forEach(([title, data]) => {
	let notes = [];
	if (data.promising) {
		notes.push('promising');
	}
	if (data.coi) {
		notes.push('COI');
	}
	if (data.upe) {
		notes.push('Undisclosed-paid');
	}
	if (data.unsourced) {
		notes.push('unsourced');
	}
	if (data.rejected) {
		notes.push('rejected');
	}
	if (data.copyvio) {
		notes.push('copyvio')
	}
	if (data.blank) {
		notes.push('blank')
	}
	if (data.test) {
		notes.push('test')
	}

	table.addRow([
		data.ts.format('YYYY-MM-DD HH:mm'),
		`[[${title}]] ${data.desc ? `(<small>${data.desc}</small>)` : ''}`,
		data.extract || '',
		data.declines ?? '',
		notes.join('<br>')
	]);
});

let page = new bot.page('User:SDZeroBot/Declined AFCs');

let oldlinks = (await page.history('timestamp|ids', 3)).map(rev => {
	let date = new bot.date(rev.timestamp).subtract(24, 'hours');
	return `[[Special:Permalink/${rev.revid}|${date.format('D MMMM')}]]`;
}).join(' - ') + ' - {{history|2=older}}';

let wikitext =
`{{/header|count=${Object.keys(tableInfo).length}|date=${yesterday.format('D MMMM YYYY')}|oldlinks=${oldlinks}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.date().format('D MMMM YYYY')}<section end=lastupdate /></includeonly>
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


})().catch(err => emailOnError(err, 'declined-afcs'));