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

let womennolinks = new mwn.table();
let womenwithlinks = new mwn.table();
let mennolinks = new mwn.table();
let menwithlinks = new mwn.table();
let headers = [
	'Article',
	'Extract'
];

womennolinks.addHeaders(headers);
womenwithlinks.addHeaders(headers);
mennolinks.addHeaders(headers);
menwithlinks.addHeaders(headers);

let wcount = 0, mcount = 0;
for (let [title, {extract, woman, desc, nolinks}] of Object.entries(data)) {
	if (!woman) {
		if (nolinks) {
			mcount++;
			mennolinks.addRow([
				`[[${title}]] ${desc ? `<small>${desc}</small>` : ''}`,
				extract
			]);
		} else {
			menwithlinks.addRow([
				`[[${title}]] ${desc ? `<small>${desc}</small>` : ''}`,
				extract
			]);
		}	
	} else {
		wcount++;
		if (nolinks) {
			womennolinks.addRow([
				`[[${title}]] ${desc ? `<small>${desc}</small>` : ''}`,
				extract
			]);
		} else {
			womenwithlinks.addRow([
				`[[${title}]] ${desc ? `<small>${desc}</small>` : ''}`,
				extract
			]);
		}
	}	
}

let wikitext = 
`${wcount} unreferenced woman BLPs -- SDZeroBOT (last updated ~~~~~)

=== No external links ===
${TextExtractor.finalSanitise(womennolinks.getText())}

=== Have external links ===
${TextExtractor.finalSanitise(womenwithlinks.getText())}
`;

await bot.save('User:SDZeroBot/Unreferenced BLPs/Women', wikitext, 'Updating');

wikitext = 
`${mcount} unreferenced BLPs of men -- SDZeroBOT (last updated ~~~~~)

=== No external links ===
${TextExtractor.finalSanitise(mennolinks.getText())}

=== Have external links ===
${TextExtractor.finalSanitise(menwithlinks.getText())}
`;

await bot.save('User:SDZeroBot/Unreferenced BLPs/Men', wikitext, 'Updating');

log(`[i] Finished`);

})();