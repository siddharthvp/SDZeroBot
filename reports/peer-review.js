const {bot, Mwn, log, emailOnError, TextExtractor} = require('../botbase');
const {populateWikidataShortdescs} = require('./commons');

(async function() {

await bot.getTokensAndSiteInfo();

const prcat = new bot.Category('Category:Requests for peer review');

const talkpages = (await prcat.pages({ cmnamespace: 1 })).map(pg => pg.title);
const articles = talkpages.map(t => new bot.Title(t).getSubjectPage().toText());

let data = {};

await bot.read(talkpages).then(json => {
	for (let pg of json) {
		let text = pg.revisions[0].content;
		let template = bot.Wikitext.parseTemplates(text, {
			namePredicate: name => name === 'Peer review',
			count: 1
		})[0];
		if (template) {
			let num = template.getValue('archive');
			let title = new bot.Title(pg.title).getSubjectPage().toText();
			let prpage = `Wikipedia:Peer review/${title}/archive${num}`;
			data[title] = {
				prpage
			};
		}
	}
});
log(`[S] got talk pages`);

await bot.read(articles, {
	prop: 'revisions|description',
	rvsection: '0'
}).then(json => {
	for (let pg of json) {
		if (!data[pg.title]) {
			log(`[E] data['${pg.title}'] is ${data[pg.title]}`);
			continue;
		}
		Object.assign(data[pg.title], {
			description: pg.description,
			excerpt: TextExtractor.getExtract(pg.revisions[0].content, 250, 500),
		});
	}
});
log(`[S] got articles`);

await populateWikidataShortdescs(data);
log(`[S] got wikidata shortdescs`);

await bot.batchOperation(articles, async article => {
	if (!data[article]) {
		return log(`[E] data['${article}'] is ${data[article]}`);
	}
	let prpage = data[article].prpage;
	return new bot.Page(prpage).history('timestamp|user', 'max').then(revs => {
		let firstrev = revs[revs.length - 1];

		let editors = revs.map(rev => rev.user).filter((u, i, arr) => arr.indexOf(u) === i).length;

		Object.assign(data[article], {
			requestor: firstrev.user,
			startdate: firstrev.timestamp,
			commenters: editors - 1,
		});
	}, err => {
		if (err.code === 'missingtitle') {
			Object.assign(data[article], {
				prmissing: true
			});
		} else {
			return Promise.reject(err);
		}
	});
}, 1, 2);
log(`[S] got histories`);


let table = new Mwn.Table();
table.addHeaders([
	{label: 'Date', class: 'date-header'},
	{label: 'Article', class: 'article-header'},
	{label: 'Excerpt', class: 'excerpt-header'},
	{label: 'Peer review', class: 'pr-header'}
]);

for (let [title, details] of Object.entries(data)) {

	const {startdate, description, excerpt, prpage, commenters, requestor, prmissing} = details;

	table.addRow([
		new bot.Date(startdate).format('YYYY-MM-DD HH:mm'),
		`[[${title}]] ${description ? `(<small>${description}</small>)` : ''}`,
		excerpt,
		prmissing ? `<span class=error>[No PR page was created]</span>` : `data-sort-value=${commenters} | [[${prpage}|PR]]<br>(${commenters} commenters)<br>Initiated by: [[User:${requestor}|${requestor}]]`
	]);

}

let wikitext =
`{{/header|count=${table.getNumRows()}|date=${new bot.Date().format('D MMMM YYYY')}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.Date().toISOString()}<section end=lastupdate /></includeonly>

${TextExtractor.finalSanitise(table.getText())}
`;

await bot.save('User:SDZeroBot/Peer reviews', wikitext, 'Updating');
log(`[i] Finished`);

})().catch(err => emailOnError(err, 'peer-review'));
