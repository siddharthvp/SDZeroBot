const {fs, xdate, mwn, bot, db, utils, argv, log, emailOnError} = require('../botbase');
const OresUtils = require('../OresUtils');
process.chdir(__dirname);

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	let revidsTitles, tableInfo, sql;

	if (argv.nodb) {
		revidsTitles = require('./revidsTitles');
		tableInfo = require('./tableInfo');
	} else {
		sql = await new db().connect();
		await sql.getReplagHours();
		const result = await sql.query(`
			SELECT page_title, page_latest, cl_sortkey_prefix, page_len, actor_name, rev_timestamp, user_editcount
			FROM categorylinks
			JOIN page ON page_id = cl_from
			JOIN revision ON page_id = rev_page AND rev_parent_id = 0
			JOIN actor ON rev_actor = actor_id
			LEFT JOIN user ON user_id = actor_user
			WHERE cl_to = 'Pending_AfC_submissions'
			AND page_namespace = 118;
		`);
		sql.end();
		log('[S] Got DB query result');

		var formatDateString = function(str) {
			return str.slice(0, 4) + '-' + str.slice(4, 6) + '-' + str.slice(6, 8);
		};

		revidsTitles = {};
		tableInfo = {};
		result.forEach(row => {
			var pagename = 'Draft:' + row.page_title.replace(/_/g, ' ');
			revidsTitles[row.page_latest] = pagename
			tableInfo[pagename] = {
				submit_date: formatDateString(row.cl_sortkey_prefix.slice(1)),
				creation_date: formatDateString(row.rev_timestamp),
				bytecount: row.page_len,
				creator: row.actor_name,
				creatorEdits: row.user_editcount || ''			
			};
		});
		utils.saveObject('revidsTitles', revidsTitles);
		utils.saveObject('tableInfo', tableInfo);
	}

	var accessdate = new xdate().format('D MMMM YYYY');



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




	/* GET COPYVIOS REPORT */

	await bot.getTokensAndSiteInfo();

	var UserSQLReport = await bot.request({
		"action": "query",
		"prop": "revisions",
		"titles": "User:SQL/AFC-Ores",
		"rvprop": "content"
	}).then(function(json) {
		log('[S] Got User:SQL/AFC-Ores');
		return json.query.pages[0].revisions[0].content;
	}).catch(console.log);
	fs.writeFileSync('./UserSQLReport.txt', UserSQLReport, console.log);

	var entriesFound = 0;
	var getCopyioPercent = function(title) {
		var re = new RegExp(`${mwn.util.escapeRegExp(title).replace(/ /g, '_')}(?:\\s|\\S)*?tools\\.wmflabs\\.org\\/copyvios\\/.*? (.*?)\\]%`).exec(UserSQLReport);
		if (!re || !re[1]) {
			return null;
		}
		entriesFound++;
		return parseFloat(re[1]);
	};


	/* GET DESCRIPTIONS */

	for await (let data of bot.massQueryGen({
		"action": "query",
		"prop": "description",
		"titles": Object.keys(tableInfo),
		"rvprop": "content"
	})) {

		data.query.pages.forEach(pg => {
			tableInfo[pg.title].description = pg.description;
		});

	}
	log(`[i] Found ${Object.values(tableInfo).filter(val => val.description).length} drafts with descriptions`);



	/* GET DATA FOR COI/UPE TAGS */

	var coi = {}, undisclosedpaid = {};

	// using search instead of parsing page content means we get it
	// even if a redirect to the template was used

	const coi_result = await bot.search(`incategory:"Pending AfC submissions" hastemplate:"COI"`, 'max', '', { srnamespace: '118' });
	coi_result.forEach(page => {
		coi[page.title] = 1;
	});
	log(`[i] Found ${Object.keys(coi).length} drafts with COI tag`);

	const upe_result = await bot.search(`incategory:"Pending AfC submissions" hastemplate:"Undisclosed paid"`, 'max', '', { srnamespace: '118' });
	upe_result.forEach(page => {
		coi[page.title] = 1;
	});

	log(`[i] Found ${Object.keys(undisclosedpaid).length} drafts with undisclosed-paid tag`);
	


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
		if (UserSQLReport && getCopyioPercent(title) > 50) {
			issues.push('Possible copyvio');
		}
		issues = issues.join('<br>');

		var toInsert = { title, revid, quality, issues };

		OresUtils.processTopicsForPage(topics, sorter, toInsert);
	});

	// sorter: object mapping topic names to array of objects with page name and other ORES data
	utils.saveObject('sorter', sorter);
	log(`[i] ${entriesFound} entries in User:SQL/AFC-Ores, out of ${Object.keys(revidsTitles).length} total`);




	/* FORMAT DATA TO BE SAVED ON THE WIKI */

	var isStarred = x => x.endsWith('*');
	var meta = x => x.split('/').slice(0, -1).join('/');

	/* MAIN-PAGE REPORT */

	var makeSinglePageReport = function() {
		var count = Object.keys(revidsTitles).length;
		var prevCount = parseInt(fs.readFileSync('./previousRunCount.txt').toString());
		var diff = count - prevCount;
		if (diff < 0) {
			diff = `{{DecreasePositive}} ${-diff} from last update`;
		} else if (diff > 0) {
			diff = `{{IncreaseNegative}} ${diff} from last update`;
		} else {
			diff = `{{Steady}} no change from last update`;
		}
		var pagetext = `{{Wikipedia:AfC sorting/header|count=${count} (${diff})|date=${accessdate}|ts=~~~~~}}\n`;

		fs.writeFileSync('./previousRunCount.txt', count);

		Object.keys(sorter).sort(OresUtils.sortTopics).forEach(function(topic) {

			var rawtopic = topic;
			if (isStarred(topic)) {
				topic = meta(topic) + '/*';
			}
			var size = ` <small>(${sorter[rawtopic].length})</small>`;

			pagetext += `\n== ${topic} ${size} ==\n` +
				`{{main page|Wikipedia:AfC sorting/${isStarred(topic) ? meta(topic) : topic}}}\n{{div col|colwidth=20em}}\n`;
			sorter[rawtopic].forEach(function(page) {
				pagetext += '* [[' + page.title + ']]: <small>' + page.quality + '-class' +
				(!page.issues ? '' : ', ' + page.issues.replace(/<br>/g, ', ')) + '</small>\n';
			});
			pagetext += '{{div col end}}\n';
		});
		return bot.save('Wikipedia:AfC sorting', pagetext, 'Updating report');
	};

	await makeSinglePageReport();



	/* TOPICAL SUBPAGES */
	let replagMessage = sql ? sql.makeReplagMessage(12) : '';

	var createSubpage = function(topic) {
		var pagetitle = topic;
		var content = '';
		if (isStarred(topic)) {
			pagetitle = meta(topic);
			if (pagetitle !== 'Unsorted') {
				content += `<div style="font-size:18px">See also the subpages:</div>\n` +
				`{{Special:PrefixIndex/Wikipedia:AfC sorting/${pagetitle}/|stripprefix=1}}\n\n`;
			}
		}
		content += `{{Wikipedia:AfC sorting/header|count=${sorter[topic].length}|date=${accessdate}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.date().format('D MMMM YYYY')}<section end=lastupdate /></includeonly>\n${replagMessage}`;

		var table = new mwn.table();
		table.addHeaders([
			`scope="col" style="width: 17em;" | Page`,
			`Class`,
			`scope="col" style="width: 5em;" | Submitted`,
			`scope="col" style="width: 5em;" | Created`,
			`scope="col" style="max-width: 14em;" | Creator (# edits)`,
			`Length`,
			`Notes`
		]);

		sorter[topic].sort((a, b) => {
			// sort by submitted date
			return tableInfo[a.title].submit_date > tableInfo[b.title].submit_date ? 1 : -1;
		}).forEach(function(page) {
			var tabledata = tableInfo[page.title];

			var nameString = `[[${page.title}]]`;
			if (tabledata.description) {
				nameString += ` <small>(${tabledata.description})</small>`;
			}

			var editorString;
			if (tabledata.creatorEdits) {
				editorString = `[[Special:Contribs/${tabledata.creator}|${tabledata.creator}]] (${tabledata.creatorEdits})`;
			} else {
				// lowercase IPv6 address and split to 2 lines to reduce column width
				if (mwn.util.isIPv6Address(tabledata.creator)) {
					var ip = tabledata.creator.toLowerCase();
					var idx = Math.round(ip.length / 2);
					ip = ip.slice(0, idx) + '<br>' + ip.slice(idx);
					editorString = `[[Special:Contribs/${tabledata.creator}|${ip}]]`;
				} else {
					editorString = `[[Special:Contribs/${tabledata.creator}|${tabledata.creator}]]`;
				}
			}

			var classString = page.quality;
			// fix sort values: put FA, GA at the top in sorted order
			if (classString === 'FA') {
				classString = `data-sort-value="A0"|FA`;
			} else if (classString === 'GA') {
				classString = `data-sort-value="A1"|GA`;
			}

			table.addRow([
				nameString,
				classString,
				tabledata.submit_date,
				tabledata.creation_date,
				editorString,
				tabledata.bytecount,
				page.issues
			]);
		});

		content += table.getText() + `\n<span style="font-style: italic; font-size: 85%;">Last updated by [[User:SDZeroBot|SDZeroBot]] <sup>''[[User:SD0001|operator]] / [[User talk:SD0001|talk]]''</sup> at ~~~~~</span>`;

		return bot.save('Wikipedia:AfC sorting/' + pagetitle, content, 'Updating report');
	};

	bot.batchOperation(Object.keys(sorter), createSubpage, 1, 2).then(() => {
		log('[i] Finished');
	});

})().catch(err => emailOnError(err, 'afc-sorting'));