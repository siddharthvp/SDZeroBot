const {mwn, bot, log, argv, utils, emailOnError} = require('../botbase');
const OresUtils = require('../OresUtils');

process.chdir(__dirname);

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	await bot.getTokensAndSiteInfo();

	var revidsTitles, tableInfo;

	if (argv.noapiget) { // for debugging
		revidsTitles = require('./revidsTitles');
		tableInfo = require('./tableInfo');
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
			var months = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
			var pad = num => num < 10 ? '0' + num : num;
			pages.forEach(pg => {
				revidsTitles[pg.revisions[0].revid] = pg.title;
				var templates = new bot.wikitext(pg.revisions[0].content).parseTemplates();
				var afd_template, afd_date, afd_page;
				afd_template = templates.find(t => t.name === 'Article for deletion/dated' || t.name === 'AfDM');
				if (afd_template) {
					if (afd_template.getValue('year') && afd_template.getValue('month') && afd_template.getValue('day')) {
						afd_date = `${afd_template.getValue('year')}-${pad(months.indexOf(afd_template.getValue('month')))}-${pad(afd_template.getValue('day'))}`;
					}
					afd_page = afd_template.getValue('page');
				}
				tableInfo[pg.title] = {
					afd_date: afd_date,
					afd_page: afd_page,
					shortdesc: pg.description
				};
				// cut out noise
				if (pg.description === 'Wikimedia list article') {
					tableInfo[pg.title].shortdesc = '';
				} else if (pg.description === 'Disambiguation page providing links to topics that could be referred to by the same search term') {
					tableInfo[pg.title].shortdesc = 'Disambiguation page';
				}
			});

			log('[S] Got articles');

			utils.saveObject('revidsTitles', revidsTitles);
			utils.saveObject('tableInfo', tableInfo);
		});
	}

	var multiPageData = {};
	Object.entries(tableInfo).forEach(([title, {afd_page}]) => {
		if (multiPageData[afd_page]) {
			multiPageData[afd_page].push(title);
		} else {
			multiPageData[afd_page] = [ title ];
		}
	});
	utils.saveObject('multiPageData', multiPageData);

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
			afd_data[pg.title] = { concern, keeps, deletes };
		});
		log('[S] Got AfDs');
	});

	var accessdate = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });


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

	var article_entry = (title, shortdesc) => {
		return `[[${title}]] ${shortdesc ? `(<small>${shortdesc}</small>)` : ''}`;
	}

	var createSection = function(topic) {
		var pagetitle = topic;
		if (isStarred(topic)) {
			pagetitle = meta(topic);
		}
		var table = new mwn.table({ sortable: true, multiline: true });
		table.addHeaders([
			`scope="col" style="width: 5em;" | AfD date`,
			`scope="col" style="width: 19em;" | Article`,
			`AfD nomination`
		]);

		sorter[topic].forEach(function(page, idx, arr) {
			if (page.skip && page.skip.includes(topic)) {
				return;
			}
			var tabledata = tableInfo[page.title];
			var afd_cell, article_cell;
			if (tabledata.afd_page) {
				if (multiPageData[tabledata.afd_page].length > 1) {
					article_cell = "'''Multiple articles:'''\n";
					for (let pg of multiPageData[tabledata.afd_page]) {
						var pgObj = arr.find(p => p.title === pg);
						if (pgObj) {
							!pgObj.skip ? (pgObj.skip = [topic]) : pgObj.skip.push(topic);
							article_cell += '* ' + article_entry(pgObj.title, tableInfo[pgObj.title].shortdesc) + '\n';
						} else {
							log(`[E] ${pg} not found`);
						}
					}
				} else {
					article_cell = article_entry(page.title, tabledata.shortdesc);
				}
				var afd_title = `Wikipedia:Articles for deletion/${tabledata.afd_page
					// decode XML entities (Twinkle ugliness)
					.replace(/&#(\d+);/g, (_, numStr) => String.fromCharCode(parseInt(numStr, 10)))}`;

				afd_cell = `[[${afd_title}|AfD]]`;
				if (afd_data[afd_title]) {
					var {concern, keeps, deletes} = afd_data[afd_title];
					afd_cell += ` (${keeps} k, ${deletes} d) (<small>${concern}</small>)`;

					// parse the date if it hadn't been parsed from the template earlier
					if (!tabledata.afd_date) {
						var datematch = concern.match(/(\d{2}:\d{2}),( \d{1,2} \w+ \d{4} )\(UTC\)/);
						if (datematch) {
							var dateobj = new Date(datematch[1] + datematch[2] + 'UTC');
							if (!isNaN(dateobj.getTime())) {
								tabledata.afd_date = dateobj.toISOString().slice(0, 10);
							}
						}
					}
				}
			}

			table.addRow([
				tabledata.afd_date || '[Failed to parse]',
				article_cell,
				afd_cell || `[Couldn't find open AfD]`
			]);
		});

		return [pagetitle, table.getText()];
	};

	var makeMainPage = function() {
		var count = Object.keys(revidsTitles).length;

		var content = `{{/header|count=${count}|date=${accessdate}|ts=~~~~~}}\n`;
		Object.keys(sorter).sort(OresUtils.sortTopics).forEach(topic => {
			var [sectionTitle, sectionText] = createSection(topic);
			content += `\n==${sectionTitle}==\n`;
			content += sectionText + '\n';
		});
		content += '\n{{reflist-talk}}';

		if (!argv.dry) {
			return bot.save('User:SDZeroBot/AfD sorting/beta', content, 'Updating report');
		}

	}
	await makeMainPage();


})().catch(err => emailOnError(err, 'afd-sorting'));
