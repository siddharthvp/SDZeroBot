const {bot, sql, xdate, argv, log, emailOnError} = require('../botbase');
const OresUtils = require('../OresUtils');
// process.chdir(__dirname);

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');

	// using a union here, the [merged query](https://quarry.wmflabs.org/query/47717)
	// takes a lot more time
	const fiveMonthOldTs = new xdate().subtract(5, 'months').format('YYYYMMDDHHmmss');
	const result = await sql.queryBot(`
		SELECT DISTINCT page_namespace, page_title, rev_timestamp, page_latest
		FROM page
		JOIN revision ON rev_id = page_latest
		WHERE page_namespace = 118
		AND page_is_redirect = 0
		AND rev_timestamp < "${fiveMonthOldTs}"

		UNION
		
		SELECT DISTINCT page_namespace, page_title, rev_timestamp, page_latest
		FROM page
		JOIN revision ON rev_id = page_latest
		JOIN templatelinks ON tl_from = page_id 
		WHERE page_namespace = 2
		AND tl_title = "AFC_submission" 
		AND tl_namespace = 10
		AND page_is_redirect = 0
		AND rev_timestamp < "${fiveMonthOldTs}"
	`);
	sql.end();
	log('[S] Got DB query result');


	let revidsTitles = {};
	let tableInfo = {};
	result.forEach(row => {
		var pagename = 'Draft:' + row.page_title.replace(/_/g, ' ');
		revidsTitles[row.page_latest] = pagename
		tableInfo[pagename] = {};
	});


	/* GET DATA FROM ORES */

	var pagelist = Object.keys(revidsTitles);
	if (argv.size) {
		pagelist = pagelist.slice(0, argv.size);
	}

	let errors = [];
	let oresdata = await OresUtils.queryRevisions(['articlequality', 'draftquality', 'drafttopic'], pagelist, errors);

	await bot.getTokensAndSiteInfo();


	/* GET CONTENT (FOR TAG CHECK) AND DESCRIPTIONS */

	let coi = {}, undisclosedpaid = {};

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



	/* FORMAT DATA TO BE SAVED ON THE WIKI */

	var isStarred = x => x.endsWith('*');
	var meta = x => x.split('/').slice(0, -1).join('/');

	var makeSinglePageReport = function() {
		var count = Object.keys(revidsTitles).length;
		var pagetext = `{{/header|count=${count}|date=${new xdate().format('D MMMM YYYY')}|ts=~~~~~}}\n`;

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
		return bot.save('User:SDZeroBot/G13 soon sorting', pagetext, 'Updating report');
	};

	await makeSinglePageReport();

	log('[i] Finished');

})().catch(err => emailOnError(err, 'g13-soon-sorting'));