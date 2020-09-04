const {mwn, bot, xdate, log, emailOnError} = require('../botbase');
const TextExtractor = require('../TextExtractor')(bot);

(async function() {
	
await bot.getTokensAndSiteInfo();

log(`[i] Started`);

let json = await bot.request({
	"action": "query",
	"list": "recentchanges",
	"rcstart": new xdate().toISOString(),
	"rcend": new xdate().subtract(1, 'day').toISOString(),
	"rcnamespace": "0",
	"rctag": "mw-new-redirect",
	"rcprop": "title|timestamp|user|comment",
	"rclimit": "max",
	"rctype": "edit"
});

const actions = json.query.recentchanges;
log(`[S] Fetched data from the API - ${actions.length} pages`);

let table = new mwn.table();
table.addHeaders([
	{label: 'Time', style: 'width: 5em'},
	{label: 'Article', style: 'width: 17em;'},
	{label: 'User & summary', style: 'width: 17em;'},
	{label: 'Excerpt of former content'}
]);

const isRedirect = function(text) {
	return /^#redirect\s*\[\[/i.test(text);	
};

const formatSummary = function(text) {
	return text
		.replace(/\{\{.*?\}\}/g, '<nowiki>$&</nowiki>')
		.replace(/\[\[((?:Category|File|Image):.*?)\]\]/gi, '[[:$1]]');
}

let count = 0;

for (let edit of actions) {

	log(`[+] Doing ${edit.title}`);

	// skip redirectifications as a result of AfD or RfD
	if (/^\[\[:?Wikipedia:(Redirects|Articles) for d.*?\]\]/.test(edit.comment)) {
		continue;
	}
	count++;

	let page = new bot.page(edit.title)
	let revs = await page.history('content', 10, {
		rvsection: '0'
	});
	for (let rev of revs) {
		if (!rev.content) {
			continue;
		}
		if (!isRedirect(rev.content)) {
			edit.excerpt = TextExtractor.getExtract(rev.content, 250, 500);
			break;
		}
	}

	let shortdesc = await page.getDescription();

	table.addRow([
		new xdate(edit.timestamp).format('YYYY-MM-DD HH:mm'),
		`[[${edit.title}]] ${shortdesc ? `(<small>${shortdesc}</small>)` : ''}`,
		`[[User:${edit.user}|${edit.user}]]: <small>${formatSummary(edit.comment)}</small>`,
		edit.excerpt || ''
	]);

}

let report = new bot.page('User:SDZeroBot/Redirectify Watch');
let revs = await report.history('timestamp|ids', 3);

let oldlinks = revs.map(rev => {
	return `[[Special:Permalink/${rev.revid}|${new xdate(rev.timestamp).subtract(1, 'day').format('D MMMM')}]]`;
}).join(' - ') + ' - {{history|2=older}}';

let wikitext = 
`{{/header|count=${count}|date=${new xdate().subtract(1, 'day').format('D MMMM YYYY')}|oldlinks=${oldlinks}|ts=~~~~~}}

${table.getText()}
`;

await report.save(TextExtractor.finalSanitise(wikitext), 'Updating report');

log(`[i] Finished`);

})().catch(err => emailOnError(err, 'redirectify-watch'));