const {bot, log, emailOnError, mwn} = require('../botbase');
const TextExtractor = require('../TextExtractor')(bot);

(async function() {

log(`[i] Started`);
await bot.getTokensAndSiteInfo();

let tableInfo = {};

for await (let json of bot.continuedQueryGen({
	"action": "query",
	"prop": "revisions|description",
	"generator": "categorymembers",
	"rvprop": "content",
	"rvsection": "0",
	"gcmtitle": "Category:Declined_AfC_submissions",
	"gcmlimit": "500",
	"gcmnamespace": "118",
	"gcmsort": "timestamp",
	"gcmdir": "ascending",
	"gcmstart": new bot.date().subtract(24, 'hours').toISOString()
})) {

	for (let pg of json.query.pages) {
		tableInfo[pg.title] = {
			extract: TextExtractor.getExtract(pg.revisions[0].content, 250, 500),
			desc: pg.description
		}
	}

}


let coi = new Set((await bot.search(`incategory:"Declined AfC submissions" hastemplate:"COI"`, 'max', '', { srnamespace: '118' })).map(page => page.title));
log(`[i] Found ${coi.size} drafts with COI tag`);

let upe = new Set((await bot.search(`incategory:"Declined AfC submissions" hastemplate:"Undisclosed paid"`, 'max', '', { srnamespace: '118' })).map(page => page.title));
log(`[i] Found ${upe.size} drafts with undisclosed-paid tag`);


let table = new mwn.table();
table.addHeaders([
	{label: 'Draft', style: 'width: 17em'},
	{label: 'Excerpt' },
	{label: 'Notes', style: 'width: 8em'}
]);

for (let [title, {extract, desc}] of Object.entries(tableInfo)) {
	let notes = [];
	if (coi.has(title)) {
		notes.push('COI');
	}
	if (upe.has(title)) {
		notes.push('Undisclosed-paid');
	}

	table.addRow([
		`[[${title}]] ${desc ? `(<small>${desc}</small>)` : ''}`,
		extract || '',
		notes.join('<br>')
	]);
}

let wikitext =
`{{/header|count=${Object.keys(tableInfo).length}|date=${new bot.date().format('D MMMM YYYY')}|ts=~~~~~}}
${TextExtractor.finalSanitise(table.getText())}
`;

await bot.save('User:SDZeroBot/Declined AFCs', wikitext, 'Updating');
log(`[i] Finished`);


})().catch(err => emailOnError(err, 'declined-afcs'));