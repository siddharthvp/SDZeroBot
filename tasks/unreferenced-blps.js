const { processNamespaceData } = require('../../mwn/src/title');
const {bot, mwn, log, fs} = require('../botbase');
const TextExtractor = require('../TextExtractor')(bot);

const wd = new mwn({
	...bot.options,
	apiUrl: 'https://www.wikidata.org/w/api.php',
	hasApiHighLimit: false
});
wd.initOAuth();
wd.options.defaultParams.assert = 'user';

// maxlag is not a problem when merely reading data
delete bot.options.defaultParams.maxlag;
delete wd.options.defaultParams.maxlag;

function getGender(title) {
	return wd.request({
		"action": "wbgetentities",
		"format": "json",
		"sites": "enwiki",
		"titles": title,
		"props": "",
		"languages": "en",
		"formatversion": "2"
	}).then(data => {
		let id = Object.keys(data.entities)[0];
		return wd.request({
			"action": "wbgetclaims",
			"format": "json",
			"entity": id,
			"property": "P21",
			"props": "",
			"formatversion": "2"
		});
	}).then(data => {
		let gender = data.claims.P21[0].mainsnak.datavalue.value.id;
		if (gender === 'Q6581097') {
			return 'male';
		} else if (gender === 'Q6581072') {
			return 'female';
		} else {
			return null;
		}
	});
}

(async function() {

let data = {};

log(`[i] Started`);
await bot.getTokensAndSiteInfo();

process.chdir(__dirname);

for await (let json of bot.continuedQueryGen({
	"action": "query",
	"prop": "revisions|description|extlinks",
	"rvprop": "content",
	"rvslots": "main",
	"ellimit": "max",
	"generator": "categorymembers",
	"gcmtitle": "Category:All unreferenced BLPs",
	"gcmnamespace": "0",
	"gcmtype": "page",
	"gcmlimit": "50"
})) {
	await bot.batchOperation(json.query.pages, function(pg) {
		log(`[+] Processing ${pg.title}`)
		let text = pg.revisions[0].slots.main.content;
		data[pg.title] = {
			extract: TextExtractor.getExtract(text, 200, 500),
			desc: pg.description,
			sourced: /<ref/i.test(text) || /\{\{([Ss]fn|[Hh]arv)\}\}/.test(text),
			hasextlinks: pg.extlinks && pg.extlinks.map(e => e.url).filter(link => {
				return !link.includes('google.com') && !link.includes('jstor.org/action/doBasicSearch');
			}).length
		}
		return getGender(pg.title).then(gender => {
			data[pg.title].gender = gender
		});
	}, 50, 1).then(err => {
		fs.appendFile('./errlog.txt', JSON.stringify(err, null, 4), console.log);
	});
}
log(`[S] got data from the APIs`);

let tables = {
	men: new mwn.table(),
	women: new mwn.table(),
	unknown: new mwn.table()
};
let headers = [
	{label: 'Article', style: 'width: 17em'},
	'Extract',
	{label: 'Notes', style: 'width: 5em'}
];

tables.men.addHeaders(headers);
tables.women.addHeaders(headers);

let wcount = 0, mcount = 0;
for (let [title, {extract, gender, desc, sourced, hasextlinks}] of Object.entries(data)) {
	let table;
	if (gender === 'male') {
		mcount++;
		table = tables.men;
	} else if (gender === 'female') {
		wcount++;
		table = tables.women;
	} else {
		table = tables.unknown;
	}
	let notes = [];
	if (sourced) notes.push('has sources');
	if (hasextlinks) notes.push('has extlinks');
	table.addRow([
		`[[${title}]] ${desc ? `(<small>${desc}</small>)` : ''}`,
		extract,
		notes.join('<br>')
	]);
}

// enable maxlag for writes
bot.options.defaultParams.maxlag = 5;

let wikitext =
`${wcount} unreferenced woman BLPs — SDZeroBOT (last updated ~~~~~)<includeonly><section begin=lastupdate />${new bot.date().format('D MMMM YYYY')}<section end=lastupdate /></includeonly>

${TextExtractor.finalSanitise(tables.women.getText())}
`;
await bot.save('User:SDZeroBot/Unreferenced BLPs/Women', wikitext, 'Updating');

wikitext =
`${mcount} unreferenced BLPs of men — SDZeroBOT (last updated ~~~~~)

${TextExtractor.finalSanitise(tables.men.getText())}
`;
await bot.save('User:SDZeroBot/Unreferenced BLPs/Men', wikitext, 'Updating');

wikitext =
`Unreferenced BLPs (unknown gender) — SDZeroBOT (last updated ~~~~~)

(Please check if the wikidata item has the gender property present.)

${TextExtractor.finalSanitise(tables.unknown.getText())}
`;
await bot.save('User:SDZeroBot/Unreferenced BLPs/Unknown gender', wikitext, 'Updating');


log(`[i] Finished`);

})();
