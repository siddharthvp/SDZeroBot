const {fs, mwn, bot, sql, utils, argv, log, emailOnError} = require('../botbase');
const OresUtils = require('../OresUtils');
// process.chdir(__dirname);

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	var revidsTitles, tableInfo;
	if (argv.nodb) {
		revidsTitles = require('./revidsTitles');
		tableInfo = require('./tableInfo');
	} else {
		const result = await sql.queryBot(`
			SELECT page_title, page_latest
			FROM categorylinks
			JOIN page ON page_id = cl_from
			WHERE cl_to = 'AfC_G13_eligible_soon_submissions'
			AND page_namespace = 118;
		`);
		sql.end();
		log('[S] Got DB query result');


		revidsTitles = {};
		tableInfo = {};
		result.forEach(row => {
			var pagename = 'Draft:' + row.page_title.replace(/_/g, ' ');
			revidsTitles[row.page_latest] = pagename
			tableInfo[pagename] = {};
		});
		utils.saveObject('revidsTitles', revidsTitles);
		utils.saveObject('tableInfo', tableInfo);
	}

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
		var errors = [];
		oresdata = await OresUtils.queryRevisions(['articlequality', 'draftquality', 'drafttopic'], pagelist, errors);

		utils.saveObject('oresdata', oresdata);
		utils.saveObject('errors', errors);
	}

	await bot.getTokensAndSiteInfo();


	/* GET CONTENT (FOR TAG CHECK) AND DESCRIPTIONS */

	var coi = {}, undisclosedpaid = {};

	for await (let data of bot.massQueryGen({
		"action": "query",
		"prop": "revisions|description",
		"titles": Object.keys(tableInfo),
		"rvprop": "content"
	})) {

		data.query.pages.forEach(pg => {
			tableInfo[pg.title].description = pg.description;
			if (pg.missing) {
				return;
			}
			var text = pg.revisions[0].content;
			new bot.wikitext(text).parseTemplates({
				limit: 2,
				namePredicate: name => {
					if (name === 'COI') {
						coi[pg.title] = 1;
						return true;
					} else if (name === 'Undisclosed paid') {
						undisclosedpaid[pg.title] = 1;
						return true;
					}
				}
			});
		});

	}
	log(`[i] Found ${Object.keys(coi).length} drafts with COI tag`);
	log(`[i] Found ${Object.keys(undisclosedpaid).length} drafts with undisclosed-paid tag`);
	log(`[i] Found ${Object.values(tableInfo).filter(val => val.description).length} drafts with descriptions`);



	/* GET DATA FOR NUMBER OF DECLINES */

	var numDeclines = {};

	var doSearch = async function(count) {
		var dec = '\\{\\{AFC submission\\|d\\|.*'.repeat(count).slice(0, -2);
		var searchQuery = `incategory:"Declined AfC submissions" insource:/${dec}/`;
		await bot.continuedQuery({
			"action": "query",
			"list": "search",
			"srsearch": searchQuery,
			"srnamespace": "118",
			"srlimit": "max",
			"srinfo": "",
			"srprop": ""
		}).then(function(jsons) {
			var pages = jsons.reduce((pages, json) => pages.concat(json.query.search.map(e => e.title)), []);
			pages.forEach(page => {
				numDeclines[page] = count;
			});
			log(`[+][${count}/10] Fetched drafts declined ${count} or more times`);
		});
	}
	for (let i = 1; i <= 10; i++) {
		await doSearch(i);
	}
	utils.saveObject('numDeclines', numDeclines);



	/* PROCESS ORES DATA, SORT PAGES INTO TOPICS */

	/**
	 * sorter: Object with topic names as keys,
	 * array of page objects as values, each page object being
	 * {
	 * 	title: 'title of the page ,
	 *	revid: '972384329',
	 *	quality: 'C',
	 *	issues: 'Possible vandalism<br>Past AfD',
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
		var quality = ores.articlequality; // FA / GA / B / C / Start / Stub
		var issues = [];
		if (numDeclines[title]) {
			issues.push(`${numDeclines[title]} past decline${numDeclines[title] > 1 ? 's' : ''}`);
		}
		if (coi[title]) {
			issues.push(`COI`);
		}
		if (undisclosedpaid[title]) {
			issues.push(`Undisclosed-paid`);
		}
		if (ores.draftquality !== 'OK') { // OK / vandalism / spam / attack
			issues.push('Possible ' + ores.draftquality);
		}
		issues = issues.join('<br>');

		var toInsert = { title, revid, quality, issues };

		OresUtils.processTopicsForPage(topics, sorter, toInsert);
	});

	// sorter: object mapping topic names to array of objects with page name and other ORES data
	utils.saveObject('sorter', sorter);




	/* FORMAT DATA TO BE SAVED ON THE WIKI */

	var isStarred = x => x.endsWith('*');
	var meta = x => x.split('/').slice(0, -1).join('/');

	/* MAIN-PAGE REPORT */

	var makeSinglePageReport = function() {
		var count = Object.keys(revidsTitles).length;
		var pagetext = `{{/header|count=${count}|date=${accessdate}|ts=~~~~~}}\n`;

		Object.keys(sorter).sort(OresUtils.sortTopics).forEach(function(topic) {

			var rawtopic = topic;
			if (isStarred(topic)) {
				topic = meta(topic) + '/*';
			}
			var size = `<small>(${sorter[rawtopic].length})</small>`;

			pagetext += `\n== ${topic} ${size} {{anchor|${topic}}} ==\n` +
				`{{div col|colwidth=20em}}\n`;
			sorter[rawtopic].forEach(function(page) {
				pagetext += '* [[' + page.title + ']]: <small>' + page.quality + '-class' +
				(!page.issues ? '' : ', ' + page.issues.replace(/<br>/g, ', ')) + '</small>\n';
			});
			pagetext += '{{div col end}}\n';
		});
		return bot.save('User:SDZeroBot/G13 soon sorting', pagetext, 'Updating report (testing)');
	};

	await makeSinglePageReport();

	log('[i] Finished');

})().catch(err => emailOnError(err, 'g13-soon-sorting'));