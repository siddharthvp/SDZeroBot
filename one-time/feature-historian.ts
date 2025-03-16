import {bot, fs, log, Mwn} from '../botbase.js';

(async function () {

await bot.getTokensAndSiteInfo();
log (`[S] started`);

//let talkpages = JSON.parse(fs.readFileSync('./cache').toString());
let pages = [];
let contQuery = bot.continuedQueryGen({
	"action": "query",
	"list": "categorymembers",
	"cmtitle": "Category:Featured articles",
	"cmlimit": "max",
});
for await (let json of contQuery) {
	pages = pages.concat(json.query.categorymembers.map(e => e.title));
}
log(`[S] Got ${pages.length} featured articles`);

let talkpages = pages.map(pg => new bot.Page(pg).getTalkPage().toText());
fs.writeFileSync('./cache', JSON.stringify(talkpages));
//talkpages = talkpages.slice(0, 500);

const reader = bot.readGen(talkpages, {
	rvsection: 0
});

let noAH = [];
let noTalk = [];
let noFaXParams = [];

let table = [];

for await (let pg of reader) {
	log(`[i] Processing ${pg.title}`);
	if (pg.missing) {
		noTalk.push(pg.title);
		log(`[E] ${pg.title} missing`);
		continue;
	}
	let text = pg.revisions[0].content;
	let template = bot.Wikitext.parseTemplates(text, {recursive: true}).filter(t => {
		return /(T:AH|Article ?([Hh]istory|milestones))/.test(t.name as string)
	})[0];
	if (!template) {
		noAH.push(pg.title.slice('Talk:'.length));
		continue;
	}

	let faXActionParams = template.parameters.filter(p => /^fa[cr]/i.test(p.value.trim()));
	let nums = faXActionParams.map(p => {
		let numMatch = String(p.name).match(/\d+$/);
		return numMatch && parseInt(numMatch[0]);
	}).filter(e => e).sort((a, b) => a < b ? -1 : 1);

	if (nums.length === 0) {
		noFaXParams.push(pg.title.slice('Talk:'.length));
		continue;
	}
	let biggestNum = nums[nums.length - 1];

	let date;
	let dateValue = template.getValue(`action${biggestNum}date`);
	if (dateValue) {
		let parsedDate = new bot.Date(dateValue);
		if (parsedDate.isValid()) {
			date = parsedDate.format('YYYY-MM-DD');
		}
	}
	let faXlink = template.getValue(`action${biggestNum}link`);

	let maindate;
	let maindateValue = template.getValue('maindate');
	if (maindateValue) {
		let maindateParsed = new bot.Date(maindateValue);
		if (maindateParsed.isValid()) {
			maindate = maindateParsed.format('YYYY-MM-DD');
		}
	}

	let data = {
		date,
		maindate,
		article: pg.title.slice('Talk:'.length),
		faX: faXlink
	};

	table.push(data);

}

let mwntable = new Mwn.Table({
	style: 'overflow-wrap: anywhere;'
});
mwntable.addHeaders([
	{label: 'Date last FAC or FAR', style: 'width: 6em'},
	{label: 'TFA date', style: 'width: 6em'},
	{label: 'Article', style: 'width: 17em'},
	{label: 'Most recent FAC or FAR'},
	{label: 'Notes', style: 'width: 7em'}
]);
table = table.sort((a,b) => a.date < b.date ? -1: 1);
for (let item of table) {
	mwntable.addRow([
		item.date || '',
		item.maindate || '',
		`[[${item.article}]]`,
		item.faX ? `[[${item.faX}]]` : '',
		''
	]);
}

let text = mwntable.getText().replace(/\[\[Wikipedia:/g, '[[Wp:');

text += `

===No article history template===
*${noAH.map(e => '[[' + e + ']]').join('\n*')}

===No actionN=FAC or actionN=FAR in article history template===
*${noFaXParams.map(e => '[[' + e + ']]').join('\n*')} 
`
await bot.save('User:SDZeroBot/Featured articles', text);

})();
