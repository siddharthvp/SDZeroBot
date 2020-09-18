const {bot, mwn, log} = require('../botbase');
const TextExtractor = require('../TextExtractor')(bot);
const OresUtils = require('../OresUtils');

(async function() {

let data = {};
let revidmap = {};

log(`[i] Started`);
await bot.getTokensAndSiteInfo();

const extlinkrgx = /\[(?:https?:)?\/\//;
const extlinksectionrgx = /==\s*External [Ll]inks\s*==/;

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
		let text = pg.revisions[0].content;
		data[pg.title] = {
			extract: TextExtractor.getExtract(text, 200, 400),
			desc: pg.description,
			revid: pg.revisions[0].revid
		}
		if (!extlinkrgx.test(text) && !extlinksectionrgx.test(text)) {
			data[pg.title].nolinks = true;
		}
		revidmap[pg.revisions[0].revid] = pg.title;
	}
}
log(`[S] got data from API`);




// {
// 	"action": "wbgetclaims",
// 	"format": "json",
// 	"entity": "Q1394070",
// 	"property": "P21",
// 	"props": "",
// 	"formatversion": "2"
// }


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
	{label: 'Article', style: 'width: 17em'},
	'Extract'
];

womennolinks.addHeaders(headers);
womenwithlinks.addHeaders(headers);
mennolinks.addHeaders(headers);
menwithlinks.addHeaders(headers);

let wcount = 0, mcount = 0;
for (let [title, {extract, woman, desc, nolinks}] of Object.entries(data)) {
	if (!woman) {
		mcount++;
		if (nolinks) {
			mennolinks.addRow([
				`[[${title}]] ${desc ? `(<small>${desc}</small>)` : ''}`,
				extract
			]);
		} else {
			menwithlinks.addRow([
				`[[${title}]] ${desc ? `(<small>${desc}</small>)` : ''}`,
				extract
			]);
		}
	} else {
		wcount++;
		if (nolinks) {
			womennolinks.addRow([
				`[[${title}]] ${desc ? `(<small>${desc}</small>)` : ''}`,
				extract
			]);
		} else {
			womenwithlinks.addRow([
				`[[${title}]] ${desc ? `(<small>${desc}</small>)` : ''}`,
				extract
			]);
		}
	}
}

let wikitext =
`${wcount} unreferenced woman BLPs -- SDZeroBOT (last updated ~~~~~)<includeonly><section begin=lastupdate />${new bot.date().format('D MMMM YYYY')}<section end=lastupdate /></includeonly>

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