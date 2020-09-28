const {bot, log, emailOnError, mwn} = require('../botbase');
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
		ts: new bot.date(ts)
	};
	if (template.getValue('nu')) {
		tableInfo[title].unsourced = 1;
	}
	if (template.getValue('nc')) {
		tableInfo[title].copyvio = 1;
	}
	if (template.getValue('nj')) {
		tableInfo[title].rejected = 1;
	}
});

log(`[i] Found ${Object.keys(tableInfo).length} pages declined yesterday`); 

for await (let json of bot.massQueryGen({
	"action": "query",
	"prop": "revisions|description",
	"titles": Object.keys(tableInfo),
	"rvprop": "content",
	"rvsection": "0",
	"rvslots": "main",
})) {

	for (let pg of json.query.pages) {
		Object.assign(tableInfo[pg.title], {
			extract: TextExtractor.getExtract(pg.revisions[0].slots.main.content, 250, 500),
			desc: pg.description
		});
	}

}


let coi = new Set((await bot.search(`incategory:"Declined AfC submissions" hastemplate:"COI"`, 'max', '', { srnamespace: '118' })).map(page => page.title));
log(`[i] Found ${coi.size} drafts with COI tag`);

let upe = new Set((await bot.search(`incategory:"Declined AfC submissions" hastemplate:"Undisclosed paid"`, 'max', '', { srnamespace: '118' })).map(page => page.title));
log(`[i] Found ${upe.size} drafts with undisclosed-paid tag`);


let table = new mwn.table();
table.addHeaders([
	{label: 'Time', style: 'width: 5em'},
	{label: 'Draft', style: 'width: 15em'},
	{label: 'Excerpt' },
	{label: 'Notes', style: 'width: 5em'}
]);

Object.entries(tableInfo).map(([title, {extract, desc, ts, unsourced, copyvio, rejected}]) => {
	let notes = [];
	if (coi.has(title)) {
		notes.push('COI');
	}
	if (upe.has(title)) {
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
		ts.format('YYYY-MM-DD HH:mm'),
		`[[${title}]] ${desc ? `(<small>${desc}</small>)` : ''}`,
		extract || '',
		notes.join('<br>')
	];
})
.sort((a, b) => a[0] - b[0]) // sort by date
.forEach(row => table.addRow(row));

let wikitext =
`{{/header|count=${Object.keys(tableInfo).length}|date=${yesterday.format('D MMMM YYYY')}|ts=~~~~~}}
${TextExtractor.finalSanitise(table.getText())}
`;

await bot.save('User:SDZeroBot/Declined AFCs', wikitext, 'Updating').catch(async err => {
	if (err.code === 'spamblacklist') {
		for (let site of err.response.error.spamblacklist.matches) {
			wikitext = wikitext.replace(
				new RegExp('https?:\\/\\/' + site, 'g'),
				site
			);
		}
		await bot.save('User:SDZeroBot/Declined AFCs', wikitext, 'Updating');
	} else {
		return Promise.reject(err);
	} 
});

log(`[i] Finished`);


})().catch(err => emailOnError(err, 'declined-afcs'));