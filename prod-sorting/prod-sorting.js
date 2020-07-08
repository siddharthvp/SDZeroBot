const {bot, mwn, log, argv, utils, emailOnError} = require('../botbase');
const OresUtils = require('../OresUtils');
const TextExtractor = require('../TextExtractor')(bot);

process.chdir(__dirname);

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	await bot.loginGetToken();

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
			var formatTimeStamp = function(ts) {
				return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;
			};
			pages.forEach(pg => {
				revidsTitles[pg.revisions[0].revid] = pg.title;
				var templates = new bot.wikitext(pg.revisions[0].content).parseTemplates(); // KLUDGE
				var prod_template, prod_blp, prod_date, prod_concern;
				prod_template = templates.find(t => {
					if (t.name === 'Proposed deletion/dated') {
						return true;
					} else if (t.name === 'Prod blp/dated') {
						prod_blp = true;
						return true;
					}
				});
				if (prod_template) {
					prod_concern = prod_blp ? '[BLP]' : prod_template.getValue('concern');
					if (prod_concern === '') {
						prod_concern = '<span class=error>[No reason given]</span>';
					}
					var prod_nom = prod_template.getValue('nom');
					if (prod_nom) {
						prod_concern += ` ({{u|${prod_nom}}})`;
					}
					prod_date = formatTimeStamp(prod_template.getValue('timestamp') || '');
				}
				tableInfo[pg.title] = {
					concern: prod_concern || '[Failed to parse]',
					prod_date: prod_date || '[Failed to parse]',
					extract: TextExtractor.getExtract(pg.revisions[0].content, 250, 500),
					shortdesc: pg.description
				};
				// cut out noise
				if (pg.description === 'Wikimedia list article') {
					tableInfo[pg.title].shortdesc = '';
				} else if (pg.description === 'Disambiguation page providing links to topics that could be referred to by the same search term') {
					tableInfo[pg.title].shortdesc = 'Disambiguation page';
				}
			});
		});
		log('[S] Got API result');

		utils.saveObject('revidsTitles', revidsTitles);
		utils.saveObject('tableInfo', tableInfo);
	}


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
		var table = new mwn.table({ sortable: true, multiline: true });

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

		var content = `{{User:SDZeroBot/PROD sorting/header|count=${count}|date={{subst:#time:j F Y}}|ts=~~~~~}}\n`;
		Object.keys(sorter).sort(OresUtils.sortTopics).forEach(topic => {
			var [sectionTitle, sectionText] = createSection(topic, lite);
			content += `\n==${sectionTitle}==\n`;
			content += sectionText + '\n';
		});

		return bot.save('User:SDZeroBot/PROD sorting' + (lite ? '/lite' : ''), content, 'Updating report');

	}
	await makeMainPage(); // User:SDZeroBot/PROD sorting
	await makeMainPage(true); // User:SDZeroBot/PROD sorting/lite

})().catch(err => emailOnError(err, 'prod-sorting'));