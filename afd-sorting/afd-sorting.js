process.chdir('./SDZeroBot/afd-sorting');

const {bot, log, argv, utils} = require('../botbase');

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	await bot.loginGetToken();

	var revidsTitles, tableInfo;

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
				afd_date = `${afd_template.getValue('year')}-${pad(months.indexOf(afd_template.getValue('month')))}-${pad(afd_template.getValue('day'))}`;
				afd_page = afd_template.getValue('page')
			}
			tableInfo[pg.title] = {
				afd_date: afd_date || '[Failed to parse]',
				afd_page: afd_page || '[Failed to parse]',
				shortdesc: pg.description 
			};
		});
	
		log('[S] Got API result');

		utils.saveObject('revidsTitles', revidsTitles);
		utils.saveObject('tableInfo', tableInfo);
	});

	var afd_data = {};
	await bot.massQuery({
		action: 'query',
		titles: Object.values(tableInfo).map(e => {
			if (e.afd_page !== '[Failed to parse]') {
				return 'Wikipedia:Articles for deletion/' + e.afd_page;
			}
		}).filter(e => e), // filter out undefineds
		prop: 'revisions', 
		rvprop: 'content'
	}).then(jsons => {
		var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
		pages.forEach(pg => {
			if (pg.missing) {
				return;
			}
			var text = pg.revisions[0].content;
			var concern = text.replace(/^[:*#'{}|=<].*$/mg, '').replace(/^\s*$/mg, '').trim();
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
	});

	var accessdate = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });


	/* GET DATA FROM ORES */

	var pagelist = Object.keys(revidsTitles);
	if (argv.size) {
		pagelist = pagelist.slice(0, argv.size);
	}
	var chunks = utils.arrayChunk(pagelist, 50);
	var oresdata = {};

	if (argv.noores) {
		oresdata = require('./oresdata');
	} else {
		var queryOres = function(revids, i) {

			return bot.rawRequest({
				method: 'get',
				url: 'https://ores.wikimedia.org/v3/scores/enwiki/',
				params: {
					models: 'drafttopic',
					revids: revids.join('|')
				},
				responseType: 'json'
			}).then(function(json) {
				log(`[+][${i}/${chunks.length}] Ores API call ${i} succeeded.`);
				Object.entries(json.enwiki.scores).forEach(([revid, data]) => {
					oresdata[revid] = {
						drafttopic: data.drafttopic.score.prediction,
					}
				});
			});

		};

		for (var i = 0; i < chunks.length; i++) {
			await queryOres(chunks[i], i+1); // sequential calls
		}

		utils.saveObject('oresdata', oresdata);
	}

	/* PROCESS ORES DATA, SORT PAGES INTO TOPICS */

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

		if (topics.length) {

			topics = topics.map(t => t.replace(/\./g, '/'));

			topics.forEach(function(topic) {

				// Remove Asia.Asia* if Asia.South-Asia is present (example)
				if (topic.endsWith('*')) {
					var metatopic = topic.split('/').slice(0, -1).join('/');
					for (var i = 0; i < topics.length; i++) {
						if (topics[i] !== topic && topics[i].startsWith(metatopic)) {
							return;
						}
					}
				}

				if (sorter[topic]) {
					sorter[topic].push(toInsert);
				} else {
					sorter[topic] = [ toInsert ];
				}

			});
		} else {
			sorter["Unsorted/Unsorted*"].push(toInsert);
		}
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
		var content = `
{| class="wikitable sortable"
|-
! scope="col" style="width: 5em;" | AfD date
! scope="col" style="width: 19em;" | Article
! AfD nomination
`;

		sorter[topic].forEach(function(page) {
			var tabledata = tableInfo[page.title];
			var afd_title = `Wikipedia:Articles for deletion/${tabledata.afd_page}`;
			var afd_line = '';
			if (afd_data[afd_title]) {
				var {concern, keeps, deletes} = afd_data[afd_title];
				afd_line = `(${keeps} k, ${deletes} d) (<small>${concern}</small>)`;
			}

			content += `|-
| ${tabledata.afd_date}
| [[${page.title}]] ${tabledata.shortdesc ? `(<small>${tabledata.shortdesc}</small>)` : ''}
| [[${afd_title}|AfD]] ${afd_line}
`;
		});

		content += `|}`;

		return [pagetitle, content];
	};

	var makeMainPage = function() {
		var count = Object.keys(revidsTitles).length;

		var content = `{{/header|count=${count}|date=${accessdate}|ts=~~~~~}}\n`;
		Object.keys(sorter).sort(function(a, b) {
			if (isStarred(a) && isStarred(b)) {
				return a > b ? 1 : -1;
			} else if (isStarred(a) && meta(a) === meta(b)) {
				return -1;
			} else if (isStarred(b) && meta(a) === meta(b)) {
				return 1;
			} else {
				// don't put the big biography section at the top
				if (a.startsWith('Culture/Biography') &&
					(b.startsWith('Culture/F') || b.startsWith('Culture/I') || b.startsWith('Culture/L'))) {
					return 1;
				} else if (b.startsWith('Culture/Biography') &&
					(a.startsWith('Culture/F') || a.startsWith('Culture/I') || a.startsWith('Culture/L'))) {
					return -1;
				}
				return a > b ? 1 : -1;
			}
		}).forEach(topic => {
			var [sectionTitle, sectionText] = createSection(topic);
			content += `\n==${sectionTitle}==\n`;
			content += sectionText + '\n';
		});

		if (!argv.dry) {
			return bot.save('User:SDZeroBot/AfD sorting', content, 'Updating report');
		}

	}
	await makeMainPage();


})();