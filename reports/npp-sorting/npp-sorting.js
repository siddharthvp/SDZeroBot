const {log, argv, TextExtractor, Mwn, bot, enwikidb, utils, emailOnError} = require('../../botbase');
const OresUtils = require('../OresUtils');
const {populateWikidataShortdescs, normaliseShortdesc} = require('../commons');
const {createLocalSSHTunnel, closeTunnels} = require("../../utils");
const {ENWIKI_DB_HOST} = require("../../db");

process.chdir(__dirname);

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');

	await Promise.all([
		bot.getTokensAndSiteInfo(),
		createLocalSSHTunnel(ENWIKI_DB_HOST)
	]);

	let sql;

	var revidsTitles, tableInfo;
	if (argv.nodb) {
		revidsTitles = require('./revidsTitles');
		tableInfo = require('./tableInfo');
	} else {
		sql = new enwikidb();
		await sql.getReplagHours();
		const result = await sql.query(`
			SELECT page_title, rev_timestamp, page_latest, page_len, actor_name, user_editcount,
				(
					SELECT COUNT(*) FROM page
					WHERE page_namespace = 4
					AND page_title = CONCAT('Articles_for_deletion/', p.page_title)
					 -- exclude current AfDs
					AND page_id NOT IN (SELECT cl_from FROM categorylinks WHERE cl_to = 'AfD_debates')
			   ) AS afd
			FROM pagetriage_page
			 JOIN page p on page_id = ptrp_page_id
			 JOIN revision ON page_id = rev_page AND rev_parent_id = 0
			 JOIN actor ON rev_actor = actor_id
			 LEFT JOIN user ON user_id = actor_user
			WHERE page_namespace = 0
			  AND page_is_redirect = 0
			  AND ptrp_reviewed = 0
			  AND page_id NOT IN (SELECT cl_from FROM categorylinks WHERE cl_to = 'All_redirects_for_discussion')
		`);
		sql.end();
		log('[S] Got DB query result');

		var formatDateString = function(str) {
			return str.slice(0, 4) + '-' + str.slice(4, 6) + '-' + str.slice(6, 8);
		};
		revidsTitles = {};
		tableInfo = {};
		result.forEach(row => {
			var pagename = row.page_title.replace(/_/g, ' ');
			revidsTitles[row.page_latest] = pagename
			tableInfo[pagename] = {
				creation_date: formatDateString(row.rev_timestamp),
				bytecount: row.page_len,
				creator: row.actor_name,
				creatorEdits: row.user_editcount || '',
				afd: row.afd > 0
			};
		});
		utils.saveObject('revidsTitles', revidsTitles);
		utils.saveObject('tableInfo', tableInfo);
	}

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
		var errors = [];
		oresdata = await OresUtils.queryRevisions(['articlequality', 'draftquality', 'drafttopic'], pagelist, errors);

		utils.saveObject('oresdata', oresdata);
		utils.saveObject('errors', errors);
	}
	log(`[S] Finished fetching ORES data`);

	/* GET SHORT DESCRIPTIONS AND PAGE CONTENT */
	let pagesWithShortDescs = 0;

	let pagesRead = 0;
	for await (let page of bot.readGen(Object.values(revidsTitles), {
		prop: 'revisions|description',
	}, 200)) {
		if (++pagesRead % 1000 === 0) {
			log(`[+] Reading contents and descriptions: ${pagesRead} pages read`);
		}
		if (page.missing) {
			tableInfo[page.title].skip = true; // skip it
			continue;
		}
		var text = page.revisions[0].content;
		if (!tableInfo[page.title]) {
			log(`[E] tableInfo[${page.title}] undefined`);
			continue;
		}
		tableInfo[page.title].extract = TextExtractor.getExtract(text, 250, 500);
		// NOTE: additional processing of extracts at the end of createSubpage() function
		if (tableInfo[page.title].extract === '') { // empty extract is suspicious
			if (/^\s*#redirect/i.test(text)) { // check if it's a redirect
				// the db query should omit redirects, this happens only because of db lag
				// or if the page was converted to redirect after the db fetch
				tableInfo[page.title].skip = true; // skip it
			}
		}
		if (page.description) {
			pagesWithShortDescs++;
			tableInfo[page.title].shortdesc = normaliseShortdesc(page.description);
		}
	}
	log(`[S] Fetched page contents and short descriptions`);
	log(`[S] Found ${pagesWithShortDescs} pages with short descriptions`);

	// populate wikidata shortdescs into tableInfo
	await populateWikidataShortdescs(tableInfo);


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
		var quality = ores.articlequality ?? ''; // FA / GA / B / C / Start / Stub
		var issues = [];
		if (ores.draftquality && ores.draftquality !== 'OK') { // OK / vandalism / spam / attack
			issues.push('Possible ' + ores.draftquality);
		}
		if (tableInfo[title].afd) {
			issues.push(`[[Wikipedia:Articles for deletion/${title}|Past AfD]]`);
		}
		issues = issues.join('<br>');

		var toInsert = { title, revid, quality, issues };

		if (topics && topics.length) {

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

	var makeMainPage = function() {
		var count = Object.keys(revidsTitles).length;
		return bot.edit('User:SDZeroBot/NPP sorting', function(rev) {
			var text = rev.content;
			text = text.replace(/\{\{\/header.*\}\}.*?<\/includeonly>/,
				`{{/header|count=${count}|date=${accessdate}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.Date().toISOString()}<section end=lastupdate /></includeonly>`);

			var sorterKeys = Object.keys(sorter);

			// update category counts
			text.split('\n').forEach(line => {
				var match = line.match(/\[\[\/(.*?)\|.*?\]\]/);
				if (!match || !match[1]) {
					return;
				}
				var topic = match[1];
				var sorterKey = sorterKeys.find(e => e === topic || (isStarred(e) && meta(e) === topic));
				var items = sorter[sorterKey];
				if (!items) {
					log(`[E] sorter[${sorterKey}] is undefined`);
					return;
				}
				var count = items.length;
				text = text.replace(line, line.replace(/\(\d+\)/, `(${count})`));
			});

			return {
				text: text,
				summary: 'Updating report'
			};
		}).then(result => {
			if (result.nochange) {
				log(`[W] No change made for User:SDZeroBot/NPP sorting`);
			}
		}).catch(err => {
			log(`[E] Failed to save main page: ${err}`);
			emailOnError(err, 'npp-sorting (main page)');
		});
	};
	await makeMainPage();


	/* TOPICAL SUBPAGES */

	let replagMessage = sql ? sql.makeReplagMessage(12) : '';

	var createSubpage = function(topic) {
		var pagetitle = topic;
		var content = '';
		if (isStarred(topic)) {
			pagetitle = meta(topic);
			if (pagetitle !== 'Unsorted') {
				content += `<div style="font-size:18px">See also the subpages:</div>\n` +
				`{{Special:PrefixIndex/User:SDZeroBot/NPP sorting/${pagetitle}/|stripprefix=1}}\n\n`;
			}
		}
		content += `{{User:SDZeroBot/NPP sorting/header|count=${sorter[topic].length}|date=${accessdate}|ts=~~~~~}}
${replagMessage}
{| class="wikitable sortable"
|-
! scope="col" style="width: 5em;" | Created
! scope="col" style="width: 15em;" | Article
! Extract
! scope="col" style="width: 3em;" | Class
! scope="col" style="width: 10em;" | Creator (# edits)
! scope="col" style="width: 4em;" | Notes
`;

		sorter[topic].forEach(function(page) {
			var tabledata = tableInfo[page.title];
			if (tabledata.skip) {
				return;
			}

			var editorString;
			if (tabledata.creatorEdits) {
				editorString = `data-sort-value=${tabledata.creatorEdits} | [[Special:Contribs/${tabledata.creator}|${tabledata.creator}]] (${tabledata.creatorEdits})`;
			} else {
				// lowercase IPv6 address and split to 2 lines to reduce column width
				if (Mwn.util.isIPv6Address(tabledata.creator)) {
					var ip = tabledata.creator.toLowerCase();
					var idx = Math.round(ip.length / 2);
					ip = ip.slice(0, idx) + '<br>' + ip.slice(idx);
					editorString = `data-sort-value=0 | [[Special:Contribs/${tabledata.creator}|${ip}]]`;
				} else {
					editorString = `data-sort-value=0 | [[Special:Contribs/${tabledata.creator}|${tabledata.creator}]]`;
				}
			}

			var classString = page.quality;
			// fix sort values: put FA, GA at the top in sorted order
			if (classString === 'FA') {
				classString = `data-sort-value="A0"|FA`;
			} else if (classString === 'GA') {
				classString = `data-sort-value="A1"|GA`;
			}

			var articleString = `[[${page.title}]]`;
			if (tabledata.shortdesc) {
				articleString += ` <small>(${tabledata.shortdesc})</small>`;
			}

			content += `|-
| ${tabledata.creation_date}
| ${articleString}
| ${tabledata.extract || ''}
| ${classString}
| ${editorString}
| ${page.issues}
`;
		});

		content += `|}\n<span style="font-style: italic; font-size: 85%;">Last updated by [[User:SDZeroBot|SDZeroBot]] <sup>''[[User:SD0001|operator]] / [[User talk:SD0001|talk]]''</sup> at ~~~~~</span>`;

		content = TextExtractor.finalSanitise(content);

		return bot.save('User:SDZeroBot/NPP sorting/' + pagetitle, content, 'Updating report');
	};

	const result = await bot.batchOperation(Object.keys(sorter), createSubpage, 1);
	if (Object.keys(result.failures).length) {
		for (const [topic, err] of Object.entries(result.failures)) {
			log(`[E] Failed to create subpage for ${topic}`);
			emailOnError(err, 'npp-sorting (non-fatal)', false);
		}
	}

	log(`[i] Finished`);
	closeTunnels();

})().catch(err => emailOnError(err, 'npp-sorting'));
