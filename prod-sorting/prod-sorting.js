process.chdir('./SDZeroBot/prod-sorting');
// crontab:
// 0 16 * * * jsub -N job-NPP ~/bin/node ~/SDZeroBot/prod-sorting/prod-sorting.js

const {bot, log, argv, utils} = require('../botbase');

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
				var templates = new bot.wikitext(pg.revisions[0].content).parseTemplates();
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
					prod_concern = prod_blp ? '[BLP]' : prod_template.getValue('concern') ;
					prod_date = formatTimeStamp(prod_template.getValue('timestamp') || '');
				}
				tableInfo[pg.title] = {
					concern: prod_concern || '[Failed to parse]',
					prod_date: prod_date || '[Failed to parse]',
					description: pg.description 
				};
			});
		});
		log('[S] Got API result');

		utils.saveObject('revidsTitles', revidsTitles);
		utils.saveObject('tableInfo', tableInfo);
	}

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
! scope="col" style="width: 7em;" | PROD date
! scope="col" style="width: 17em;" | Article
! Concern
`;

		sorter[topic].forEach(function(page) {
			var tabledata = tableInfo[page.title];

			content += `|-
| ${tabledata.prod_date}
| [[${page.title}]] ${tabledata.shortdesc ? `(<small>${tabledata.shortdesc}</small>)` : ''}
| ${tabledata.concern}
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

		return bot.save('User:SDZeroBot/PROD sorting', content, 'Updating report');

	}
	await makeMainPage();


})();