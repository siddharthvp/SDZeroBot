const {bot, mwn, log} = require('../botbase');
const TextExtractor = require('../TextExtractor');
const OresUtils = require('../OresUtils');

(async function() {

let data = {};
let revidmap = {};

log(`[i] Started`);
for await (let json of bot.continuedQueryGen({
	"action": "query",
	"prop": "revisions|description",
	"generator": "categorymembers",
	"rvprop": "ids|content",
	"rvsection": "0",
	"gcmtitle": "Category:All unreferenced BLPs",
	"gcmnamespace": "0",
	"gcmtype": "page",
	"gcmlimit": "500"
})) {
	for (let pg of json.query.pages) {
		data[pg.title] = {
			extract: TextExtractor.getExtract(pg.revisions[0].content, 200, 400),
			desc: pg.description,
			revid: pg.revisions[0].revid
		}
		revidmap[pg.revisions[0].revid] = pg.title;
	}
}
log(`[S] got data from API`);


for (let title of Object.keys(data)) {
	let links = await new bot.page(title).externallinks();
	if (links.length === 0) {
		data[title].nolinks = true;
	}
}
log(`[S] got extlinks data from API`);

const oresdata = await OresUtils.queryRevisions(['drafttopic'], Object.values(data).map(e => e.revid));

log(`[S] got data from ORES`);

for (let [revid, {drafttopic}] of Object.entries(oresdata)) {
	if (drafttopic.includes("Culture.Biography.Women")) {
		data[revidmap[revid]].woman = true;
	}
}

let tablenolinks = new mwn.table();
let tablewithlinks = new mwn.table();
tablenolinks.addHeaders([
	'Article',
	'Extract'
]);
tablewithlinks.addHeaders([
	'Article',
	'Extract'
]);

let count = 0;
for (let [title, {extract, woman, desc, nolinks}] of Object.entries(data)) {
	if (!woman) {
		continue;
	}
	count++;
	if (nolinks) {
		tablenolinks.addRow([
			`[[${title}]] ${desc ? `<small>${desc}</small>` : ''}`,
			extract
		]);
	} else {
		tablewithlinks.addRow([
			`[[${title}]] ${desc ? `<small>${desc}</small>` : ''}`,
			extract
		]);
	}	
}

let wikitext = 
`${count} unreferenced woman BLPs -- SDZeroBOT (last updated ~~~~~)

=== No external links ===
${TextExtractor.finalSanitise(tablenolinks.getText())}

=== Have external links ===
${TextExtractor.finalSanitise(tablewithlinks.getText())}
`;

await bot.save('User:SDZeroBot/Unreferenced woman BLPs', wikitext, 'Updating');

log(`[i] Finished`);

})();