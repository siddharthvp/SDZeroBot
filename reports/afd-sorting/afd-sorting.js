const {Mwn, bot, log, argv, utils, emailOnError} = require('../../botbase');
const OresUtils = require('../OresUtils');
const {normaliseShortdesc, populateWikidataShortdescs, escapeForTableCell, saveWithBlacklistHandling } = require('../commons');

process.chdir(__dirname);

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	await bot.getTokensAndSiteInfo();

	var revidsTitles, tableInfo;

	if (argv.noapiget) { // for debugging
		revidsTitles = require('revidsTitles');
		tableInfo = utils.saveObject('tableInfo');
	} else {
		await bot.continuedQuery({
			"action": "query",
			"prop": "revisions|description",
			"generator": "categorymembers",
			"rvprop": "ids|content",
			"gcmtitle": "Category:Articles for deletion",
			"gcmnamespace": "0",
			"gcmtype": "page",
			"gcmlimit": "500"
		}).then(jsons => {
			revidsTitles = {};
			tableInfo = {};
			var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
			pages.forEach(pg => {
				revidsTitles[pg.revisions[0].revid] = pg.title;
				var afd_template = new bot.Wikitext(pg.revisions[0].content).parseTemplates({
					count: 1,
					namePredicate: name => name === 'Article for deletion/dated' || name === 'AfDM'
				})[0];
				var afd_date, afd_page;
				if (afd_template) {
					if (afd_template.getValue('timestamp')) {
						afd_date = new bot.Date(afd_template.getValue('timestamp')).format('YYYY-MM-DD');
					} else if (afd_template.getValue('year') && afd_template.getValue('month') && afd_template.getValue('day')) {
						afd_date = new bot.Date(
							afd_template.getValue('year'),
							bot.Date.localeData.months.indexOf(afd_template.getValue('month')),
							afd_template.getValue('day')
						).format('YYYY-MM-DD');
					}
					afd_page = afd_template.getValue('page');
				}
				tableInfo[pg.title] = {
					afd_date: afd_date,
					afd_page: afd_page,
					shortdesc: normaliseShortdesc(pg.description)
				};
			});

			log('[S] Got articles');

			utils.saveObject('revidsTitles', revidsTitles);
			utils.saveObject('tableInfo', tableInfo);
		});
	}

	await populateWikidataShortdescs(tableInfo);

	var afd_data = {};

	await bot.continuedQuery({
		action: 'query',
		generator: 'categorymembers',
		gcmtitle: 'Category:AfD debates',
		gcmlimit: '500',
		gcmtype: 'page',
		prop: 'revisions',
		rvprop: 'content'
	}).then(jsons => {
		var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
		pages.forEach(pg => {
			if (pg.missing) return; // should never happen
			var text = pg.revisions[0].content;
			var concern = text.replace(/^\s*[:*#{}|!=<].*$/mg, '').replace(/^\s*$/mg, '').trim();

			// cut at the first newline coming after the first timestamp
			concern = concern.replace(/(\d{2}:\d{2}, \d{1,2} \w+ \d{4} \(UTC\)[^\n]*).*/s, '$1');

			var keeps = 0, deletes = 0;
			var boldedTexts = (text.match(/'''.*?'''/g) || []).map(e => e.slice(3, -3));
			boldedTexts.forEach(text => {
				if (/^(strong |weak )?keep$/i.test(text)) {
					keeps++;
				} else if (/^(strong |weak )?delete$/i.test(text)) {
					deletes++;
				}
			});

			// find number of relists and last relist date
			var rgx = /div class="xfd_relist".*?(\d{2}:\d{2}, \d{1,2} \w+ \d{4} \(UTC\))/sg;
			var match, relists = 0, relist_date;
			while (match = rgx.exec(text)) { // eslint-disable-line no-cond-assign
				relists++;
				relist_date = match[1];
			}

			afd_data[pg.title] = { concern, keeps, deletes, relists, relist_date };
		});
		log('[S] Got AfDs');
	});

	// Temp hack as this single mass AFD is breaking the page
	delete afd_data['Wikipedia:Articles for deletion/List of Air Nippon destinations'];

	var accessdate = new bot.Date().format('D MMMM YYYY');


	/* GET DATA FROM ORES */

	var pagelist = Object.keys(revidsTitles);
	if (argv.size) {
		pagelist = pagelist.slice(0, argv.size);
	}
	var oresdata = {};

	if (argv.noores) {
		oresdata = require('./oresdata');
	} else {
		oresdata = await OresUtils.queryRevisions(['drafttopic'], pagelist);
		utils.saveObject('oresdata', oresdata);
	}

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

	var createSection = function(topic) {
		var pagetitle = topic;
		if (isStarred(topic)) {
			pagetitle = meta(topic);
		}
		var table = new Mwn.Table({
			style: 'overflow-wrap: anywhere'
		});
		table.addHeaders([
			`scope="col" style="width: 5em;" | AfD date`,
			`scope="col" style="width: 19em;" | Article`,
			`AfD nomination`
		]);

		sorter[topic].map(function(page) {
			var tabledata = tableInfo[page.title];
			var afd_cell;
			if (tabledata.afd_page) {
				var afd_title = `Wikipedia:Articles for deletion/${tabledata.afd_page
					// decode XML entities (Twinkle ugliness)
					.replace(/&#(\d+);/g, (_, numStr) => String.fromCharCode(parseInt(numStr, 10)))}`;

				afd_cell = `[[${afd_title}|AfD]]`;
				if (afd_data[afd_title]) {
					var {concern, keeps, deletes, relists, relist_date} = afd_data[afd_title];
					afd_cell += ` (${keeps} k, ${deletes} d)`;
					if (relists) { // skip if no relists
						afd_cell += ` (${relists} relist${relists > 1 ? 's' : ''})`;
					}
					afd_cell += ` (<small>${escapeForTableCell(concern)}</small>)`;

					// over-write date with date of last relist
					if (relists && relist_date) {
						tabledata.afd_date = new bot.Date(relist_date).format('YYYY-MM-DD');
					}

					// parse the date from concern it hadn't been parsed from the template earlier
					// or from relisting
					if (!tabledata.afd_date) {
						var datematch = concern.match(/\d{2}:\d{2} \d{1,2} \w+ \d{4} \(UTC\)/);
						if (datematch) {
							tabledata.afd_date = new bot.Date(datematch[0]).format('YYYY-MM-DD');
						}
					}
				}
			}

			return [
				tabledata.afd_date || '[Failed to parse]',
				`[[${page.title}]] ${tabledata.shortdesc ? `(<small>${tabledata.shortdesc}</small>)` : ''}`,
				afd_cell || `[Couldn't find open AfD]`
			]

		// sort rows by AfD date
		}).sort((row1, row2) => row1[0] < row2[0] ? -1 : 1)
		.forEach(row => table.addRow(row));

		return [pagetitle, table.getText()];
	};

	var makeMainPage = function() {
		var count = Object.keys(revidsTitles).length;

		var content = `{{/header|count=${count}|date=${accessdate}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.Date().toISOString()}<section end=lastupdate /></includeonly>\n`;
		Object.keys(sorter).sort(OresUtils.sortTopics).forEach(topic => {
			var [sectionTitle, sectionText] = createSection(topic);
			content += `\n==${sectionTitle}==\n`;
			content += sectionText + '\n';
		});
		content += '\n{{reflist-talk}}';

		if (!argv.dry) {
			return saveWithBlacklistHandling(new bot.Page('User:SDZeroBot/AfD sorting'), content, 'Updating report');
		}

	}
	await makeMainPage();

	log('[i] Finished');

})().catch(err => emailOnError(err, 'afd-sorting'));
