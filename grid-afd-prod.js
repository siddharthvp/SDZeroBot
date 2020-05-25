const {mwn, bot} = require('./botbase');
const TextExtractor = require('./TextExtractor')(bot);

process.chdir(__dirname);

var months = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function pad(num) {
	return num < 10 ? '0' + num : num;
}
function formatTimeStamp(ts) {
	return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;
}

function parseArticleForAfD(pagetext) {
	var templates = new bot.wikitext(pagetext).parseTemplates();
	var afd_template = templates.find(t => t.name === 'AfDM' || t.name === 'Article for deletion/dated'),
		afd_date, afd_page;
	if (afd_template) { 
		if (afd_template.getValue('year') && afd_template.getValue('month') && afd_template.getValue('day')) {
			afd_date = `${afd_template.getValue('year')}-${pad(months.indexOf(afd_template.getValue('month')))}-${pad(afd_template.getValue('day'))}`;
		}
		afd_page = afd_template.getValue('page');
	}
	return [afd_page, afd_date];
}

function parseArticleForPROD(pagetext) {
	var templates = new bot.wikitext(pagetext).parseTemplates();
	var prod_template, prod_date;
	prod_template = templates.find(t => t.name === 'Proposed deletion/dated' || t.name === 'Prod blp/dated');
	if (prod_template) {
		prod_date = formatTimeStamp(prod_template.getValue('timestamp') || '');
	}
	return prod_date || '[Failed to parse]';
}

(async function() {

	var afdtable = {}, prodtable = {};

	await bot.loginGetToken();
	
	await bot.continuedQuery({
		"action": "query",
		"prop": "revisions|description",
		"generator": "categorymembers",
		"rvprop": "content",
		"gcmtitle": "Category:Articles for deletion",
		"gcmnamespace": "0",
		"gcmtype": "page",
		"gcmlimit": "500"
	}).then(jsons => {
		var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
		pages.forEach(pg => {
			var text = pg.revisions[0].content;
			var [afd_date, afd_page] = parseArticleForAfD(text)
			afdtable[pg.title] = {
				afd_date,
				afd_page, 
				shortdesc: pg.description,
				extract: TextExtractor.getExtract(text)
			};
		});
	});

	await bot.continuedQuery({
		"action": "query",
		"prop": "revisions|description",
		"generator": "categorymembers",
		"rvprop": "content",
		"gcmtitle": "Category:All_articles_proposed_for_deletion",
		"gcmnamespace": "0",
		"gcmtype": "page",
		"gcmlimit": "500"
	}).then(jsons => {
		var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
		pages.forEach(pg => {
			var text = pg.revisions[0].content;
			prodtable[pg.title] = {
				shortdesc: pg.description,
				extract: TextExtractor.getExtract(text),
				prod_date: parseArticleForPROD(text)
			};
		});
	});

	var fnMakeTableAfD = function(afdtable) {
		var table = new mwn.table({ sortable: true });
		table.addHeaders(['Date', 'Article', 'Extract']);
		Object.entries(afdtable).forEach(([title, data]) => {
			var datefield = `[[Wikipedia:Articles for deletion/${data.afd_page}|${data.afd_date}]]`;
			var articlefield = title + (data.shortdesc ? ` (${data.shortdesc})` : '');
			table.addRow([datefield, articlefield, data.extract ]);
		});
		return table.getText();
	};
	var fnMakeTablePROD = function(prodtable) {
		var table = new mwn.table({ sortable: true });
		table.addHeaders(['Date', 'Article', 'Extract']);
		Object.entries(prodtable).forEach(([title, data]) => {
			var articlefield = title + (data.shortdesc ? ` (${data.shortdesc})` : '');
			table.addRow([data.afd_date, articlefield, data.extract ]);
		});
		return table.getText();
	};

	await bot.save('User:SDZeroBot/AfD log', fnMakeTableAfD(afdtable), 'Updating');
	await bot.save('User:SDZeroBot/PROD log', fnMakeTablePROD(prodtable), 'Updating');

})();