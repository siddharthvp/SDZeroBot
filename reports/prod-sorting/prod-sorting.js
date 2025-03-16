const {bot, TextExtractor, Mwn, log, argv, utils, emailOnError} = require('../../botbase');
const OresUtils = require('../OresUtils');
const {populateWikidataShortdescs, normaliseShortdesc, saveWithBlacklistHandling} = require('../commons');

process.chdir(__dirname);

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	await bot.getTokensAndSiteInfo();

	var revidsTitles, tableInfo;
	if (argv.nodb) {
		revidsTitles = require('./revidsTitles');
		tableInfo = require('./tableInfo');
	} else {
		await bot.continuedQuery({
			"action": "query",
			"prop": "revisions|description",
			"generator": "categorymembers",
			"rvprop": "ids|content",
			"gcmtitle": "Category:All_articles_proposed_for_deletion",
			"gcmtype": "page",
			"gcmlimit": "500"
		}).then(jsons => {
			revidsTitles = {};
			tableInfo = {};
			var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
			pages.forEach(pg => {
				revidsTitles[pg.revisions[0].revid] = pg.title;
				var prod_template, prod_blp, prod_date, prod_concern;
				var templates = new bot.Wikitext(pg.revisions[0].content).parseTemplates({
					count: 1,
					namePredicate: name => {
						if (name === 'Proposed deletion/dated') {
							return true;
						} else if (name === 'Prod blp/dated') {
							prod_blp = true;
							return true;
						}
					}
				});
				prod_template = templates[0];
				if (prod_template) {
					prod_concern = prod_blp ? '[BLP]' : prod_template.getValue('concern');
					if (prod_concern === '') {
						prod_concern = '<span class=error>[No reason given]</span>';
					}
					var prod_nom = prod_template.getValue('nom');
					if (prod_nom) {
						prod_concern += ` ({{u|${prod_nom}}})`;
					}
					prod_date = new bot.Date(prod_template.getValue('timestamp')).format('YYYY-MM-DD HH:mm');
				}
				tableInfo[pg.title] = {
					concern: prod_concern || '[Failed to parse]',
					prod_date: prod_date || '[Failed to parse]',
					extract: TextExtractor.getExtract(pg.revisions[0].content, 250, 500),
					shortdesc: normaliseShortdesc(pg.description)
				};
			});
		});
		log('[S] Got API result');

		utils.saveObject('revidsTitles', revidsTitles);
		utils.saveObject('tableInfo', tableInfo);
	}

	await populateWikidataShortdescs(tableInfo);


	/* GET DATA FROM ORES */

	var pagelist = Object.keys(revidsTitles);
	var oresdata = await OresUtils.queryRevisions(['drafttopic'], pagelist);
	utils.saveObject('oresdata', oresdata);

	/* PROCESS ORES DATA, SORT PAGES INTO TOPICS */

	/**
	 * sorter: Object with topic names as keys,
	 * array of page objects as values, each page object being
	 * {
	 * 	title: 'title of the page ,
	 *	revid: '972384329',
	 * }
	 * Populated through OresUtils.processTopicsForPage
	 */
	var sorter = {
		"Unsorted/Unsorted*": []
	};

	Object.entries(oresdata).forEach(function([revid, ores]) {

		var title = revidsTitles[revid];
		if (!title) {
			log(`[E] revid ${revid} couldn't be matched to title`);
		}

		var topics = ores.drafttopic; // Array of topics
		var toInsert = { title, revid };

		OresUtils.processTopicsForPage(topics, sorter, toInsert);

	});

	// sorter: object mapping topic names to array of objects with page name and other ORES data
	utils.saveObject('sorter', sorter);


	/* FORMAT DATA TO BE SAVED ON THE WIKI */

	var isStarred = x => x.endsWith('*');
	var meta = x => x.split('/').slice(0, -1).join('/');

	/** @param {string} topic, @param {boolean} lite - for lite mode */
	var createSection = function(topic, lite) {
		var pagetitle = topic;
		if (isStarred(topic)) {
			pagetitle = meta(topic);
		}
		var table = new Mwn.Table({ style: 'overflow-wrap: anywhere' });

		table.addHeaders(lite ? [ // exlcude excerpt in lite mode
			`scope="col" style="width: 7em;" | PROD date`,
			`scope="col" style="width: 21em;" | Article`,
			`Concern`
		] : [
			`scope="col" style="width: 5em;" | PROD date`,
			`scope="col" style="width: 15em;" | Article`,
			`scope="col" style="width: 22em"; | Excerpt`,
			`Concern`
		]);

		sorter[topic].forEach(function(page) {
			var tabledata = tableInfo[page.title];

			table.addRow(lite ? [
				tabledata.prod_date,
				`[[${page.title}]] ${tabledata.shortdesc ? `(<small>${tabledata.shortdesc}</small>)` : ''}`,
				tabledata.concern
			] : [
				tabledata.prod_date,
				`[[${page.title}]] ${tabledata.shortdesc ? `(<small>${tabledata.shortdesc}</small>)` : ''}`,
				tabledata.extract,
				tabledata.concern
			]);

		});

		return [pagetitle, table.getText()];
	};

	/** @param {boolean} lite */
	var makeMainPage = function(lite) {
		var count = Object.keys(revidsTitles).length;

		var content = `{{User:SDZeroBot/PROD sorting/header|count=${count}|date={{subst:#time:j F Y}}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.Date().toISOString()}<section end=lastupdate /></includeonly>\n`;
		Object.keys(sorter).sort(OresUtils.sortTopics).forEach(topic => {
			var [sectionTitle, sectionText] = createSection(topic, lite);
			content += `\n==${sectionTitle}==\n`;
			content += sectionText + '\n';
		});
		content = TextExtractor.finalSanitise(content);

		return saveWithBlacklistHandling(new bot.Page('User:SDZeroBot/PROD sorting' + (lite ? '/lite' : '')), content, 'Updating report');

	}
	await makeMainPage(); // User:SDZeroBot/PROD sorting
	await makeMainPage(true); // User:SDZeroBot/PROD sorting/lite

	log('[i] Finished');

})().catch(err => emailOnError(err, 'prod-sorting'));
