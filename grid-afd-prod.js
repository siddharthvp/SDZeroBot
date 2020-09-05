const {mwn, bot, emailOnError} = require('./botbase');
const TextExtractor = require('./TextExtractor')(bot);

var months = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function pad(num) {
	return num < 10 ? '0' + num : num;
}
function formatTimeStamp(ts) {
	return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}`;
}

function parseArticleForAfD(pagetext) {
	var templates = new bot.wikitext(pagetext).parseTemplates({
		namePredicate: name => name === 'AfDM' || name === 'Article for deletion/dated',
		count: 1
	});
	var afd_template = templates[0], afd_date, afd_page;
	if (afd_template) { 
		if (afd_template.getValue('year') && afd_template.getValue('month') && afd_template.getValue('day')) {
			afd_date = `${afd_template.getValue('year')}-${pad(months.indexOf(afd_template.getValue('month')))}-${pad(afd_template.getValue('day'))}`;
		}
		afd_page = afd_template.getValue('page');
	}
	return [afd_page, afd_date || '[Failed to parse]'];
}

function parseArticleForPROD(pagetext) {
	var templates = new bot.wikitext(pagetext).parseTemplates({
		namePredicate: name => name === 'Proposed deletion/dated' || name === 'Prod blp/dated',
		count: 1
	});
	var prod_template, prod_date;
	prod_template = templates[0];
	if (prod_template) {
		prod_date = formatTimeStamp(prod_template.getValue('timestamp') || '');
	}
	return prod_date || '[Failed to parse]';
}

(async function() {

	var afdtable = {}, prodtable = {};

	await bot.getTokensAndSiteInfo();
	
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
			var [afd_page, afd_date] = parseArticleForAfD(text)
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
		table.addHeaders([
			'scope="col" style="width: 5em" | Date', 
			'scope="col" style="width: 18em" | Article', 
			'Extract'
		]);
		Object.entries(afdtable).forEach(([title, data]) => {
			var datefield = data.afd_page ? 
				`[[Wikipedia:Articles for deletion/${data.afd_page}|${data.afd_date}]]` :
				data.afd_date;
			var articlefield = `[[${title}]]` + (data.shortdesc ? ` <small>(${data.shortdesc})</small>` : '');
			table.addRow([datefield, articlefield, data.extract ]);
		});
		return `<templatestyles src="User:SD0001/grid-styles.css" />\n` + 
			`:${Object.keys(afdtable).length} articles at AfD as of {{subst:#time:j F Y}} — [[User:SDZeroBot|SDZeroBot]]\n\n` + 
			TextExtractor.finalSanitise(table.getText());
	};
	var fnMakeTablePROD = function(prodtable) {
		var table = new mwn.table({ sortable: true });
		table.addHeaders([
			'scope="col" style="width: 5em" | Date', 
			'scope="col" style="width: 18em" | Article', 
			'Extract'
		]);
		Object.entries(prodtable).forEach(([title, data]) => {
			var articlefield = `[[${title}]]` + (data.shortdesc ? ` <small>(${data.shortdesc})</small>` : '');
			table.addRow([data.prod_date, articlefield, data.extract ]);
		});
		return `<templatestyles src="User:SD0001/grid-styles.css" />\n` + 
			`:${Object.keys(prodtable).length} articles proposed for deletion as of {{subst:#time:j F Y}} — [[User:SDZeroBot|SDZeroBot]]\n\n` + 
			TextExtractor.finalSanitise(table.getText());
	};

	await bot.save('User:SDZeroBot/AfD grid', fnMakeTableAfD(afdtable), 'Updating');
	await bot.save('User:SDZeroBot/PROD grid', fnMakeTablePROD(prodtable), 'Updating');

})().catch(err => emailOnError(err, 'grid-afd-prod'));