const {bot, mwn, log} = require('./botbase');
const TextExtractor = require('./TextExtractor')(bot);

(async function() {

await bot.getTokensAndSiteInfo();

const prcat = new bot.category('Category:Requests for peer review');

const talkpages = (await prcat.pages()).map(pg => pg.title);
const articles = talkpages.map(t => new bot.title(t).getSubjectPage().toText());

let data = {};

await bot.read(talkpages).then(json => {
	for (let pg of json) {
		let text = pg.revisions[0].content;
		let template = bot.wikitext.parseTemplates(text, {
			namePredicate: name => name === 'Peer review',
			count: 1
		})[0];
		if (template) {
			let num = template.getValue('archive');
			let title = new bot.title(pg.title).getSubjectPage().toText();
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
		Object.assign(data[pg.title], {
			description: pg.description,
			excerpt: TextExtractor.getExtract(pg.revisions[0].content, 250, 500),
		});
	}
});
log(`[S] got articles`);

let prpages = Object.values(data).map(e => e.prpage);

await bot.batchOperation(prpages, prpage => {
	return new bot.page(prpage).history('timestamp|user', 'max').then(revs => {
		let firstrev = revs[revs.length - 1];
		let article = prpage.match(/^Wikipedia:Peer review\/(.*?)\/archive/)[1];

		let editors = revs.map(rev => rev.user).filter((u, i, arr) => arr.indexOf(u) === i).length;

		Object.assign(data[article], {
			requestor: firstrev.user,
			startdate: firstrev.timestamp,
			commentors: editors - 1,
		});
	});
}, 1, 2);
log(`[S] got histories`);


let table = new mwn.table();
table.addHeaders([
	{label: 'Date'},
	{label: 'Article'},
	{label: 'Excerpt'},
	{label: 'Peer review'}
]);

for (let [title, details] of Object.entries(data)) {

	const {startdate, description, prpage, commentors, excerpt, requestor} = details;

	table.addRow([
		new bot.date(startdate).format('YYYY-MM-DD HH:mm'),
		`[[${title}]] ${description ? `(<small>${description}</small>)` : ''}`,
		excerpt,
		`data-sort-value=${commentors} | [[${prpage}|PR]]<br>(${commentors} commentors)<br>Initiated by: [[User:${requestor}|${requestor}]]`
	]);

}

let wikitext =
`{{/header|count=${articles.length}|date=${new bot.date().format('D MMMM YYYY')}|ts=~~~~~}}

${table.getText()}
`;

await bot.save('User:SDZeroBot/Peer reviews', wikitext, 'Updating');
log(`[i] Finished`);

})();