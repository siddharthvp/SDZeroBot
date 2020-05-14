process.chdir('./SDZeroBot/afc-report');
// crontab:
// 0 0 * * * jsub -N job-AFC -mem 900m ~/bin/node ~/SDZeroBot/afc-report/afc-sorting-bot.js

const {fs, bot, sql, utils, argv, log} = require('../botbase');

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	var revidsTitles, tableInfo;
	if (argv.nodb) {
		revidsTitles = require('./revidsTitles');
		tableInfo = require('./tableInfo');
	} else {
		const result = await sql.queryBot(`
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
				creatorEdits: row.user_editcount || '',
				//creatorRegn: row.user_registration ? new Date(formatDateString(row.user_registration) + ' UTC').toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''
			};
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
	var chunks = utils.arrayChunk(pagelist, 50);
	var oresdata = {};

	if (argv.noores) {
		oresdata = require('./oresdata');
	} else {
		var errors = [];
		var queryOres = function(revids, i) {

			return bot.rawRequest({
				method: 'get',
				url: 'https://ores.wikimedia.org/v3/scores/enwiki/',
				params: {
					models: 'articlequality|draftquality|drafttopic',
					revids: revids.join('|')
				},
				responseType: 'json'
			}).then(function(json) {
				log(`[+][${i}/${chunks.length}] Ores API call ${i} succeeded.`);
				Object.entries(json.enwiki.scores).forEach(([revid, data]) => {
					if (data.articlequality.error) {
						errors.push(revid);
						return;
					}
					oresdata[revid] = {
						articlequality: data.articlequality.score.prediction,
						draftquality: data.draftquality.score.prediction,
						drafttopic: data.drafttopic.score.prediction,
					}
				});
			});

		};

		for (var i = 0; i < chunks.length; i++) {
			await queryOres(chunks[i], i+1); // sequential calls
		}

		utils.saveObject('oresdata', oresdata);
		utils.saveObject('errors', errors);
	}




	/* GET COPYVIOS REPORT */

	await bot.loginGetToken();

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
		var re = new RegExp(`${bot.util.escapeRegExp(title).replace(/ /g, '_')}(?:\\s|\\S)*?tools\\.wmflabs\\.org\\/copyvios\\/.*? (.*?)\\]%`).exec(UserSQLReport);
		if (!re || !re[1]) {
			return null;
		}
		entriesFound++;
		return parseFloat(re[1]);
	};



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
		if (ores.draftquality !== 'OK') { // OK / vandalism / spam / attack
			issues.push('Possible ' + ores.draftquality);
		}
		if (UserSQLReport && getCopyioPercent(title) > 50) {
			issues.push('Possible copyvio');
		}
		issues = issues.join('<br>');

		var toInsert = { title, revid, quality, issues };

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
			diff = `{{DecreasePositive}} ${-diff} from yesterday`;
		} else if (diff > 0) {
			diff = `{{IncreaseNegative}} ${diff} from yesterday`;
		} else {
			diff = `{{Steady}} no change from yesterday`;
		}
		var pagetext = `{{Wikipedia:AfC sorting/header|count=${count} (${diff})|date=${accessdate}|ts=~~~~~}}\n`;

		fs.writeFileSync('./previousRunCount.txt', count);

		Object.keys(sorter).sort(function(a, b) {
			if (isStarred(a) && isStarred(b)) {
				return a > b ? 1 : -1;
			} else if (isStarred(a) && meta(a) === meta(b)) {
				return -1;
			} else if (isStarred(b) && meta(a) === meta(b)) {
				return 1;
			} else {
				// don't put the BIG biography section at the top
				if (a.startsWith('Culture/Biography') &&
					(b.startsWith('Culture/F') || b.startsWith('Culture/I') || b.startsWith('Culture/L'))) {
					return 1;
				} else if (b.startsWith('Culture/Biography') &&
					(a.startsWith('Culture/F') || a.startsWith('Culture/I') || a.startsWith('Culture/L'))) {
					return -1;
				}
				return a > b ? 1 : -1;
			}
		}).forEach(function(topic) {

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
		content += `{{Wikipedia:AfC sorting/header|count=${sorter[topic].length}|date=${accessdate}|ts=~~~~~}}\n`;
		content += `
{| class="wikitable sortable"
|-
! scope="col" style="width: 14em;" | Page
! Class
! scope="col" style="width: 5em;" | Submitted
! scope="col" style="width: 5em;" | Created
! scope="col" style="max-width: 14em;" | Creator (# edits)
! Length
! Notes
`;

		sorter[topic].forEach(function(page) {
			var tabledata = tableInfo[page.title];

			var editorString;
			if (tabledata.creatorEdits) {
				editorString = `[[Special:Contribs/${tabledata.creator}|${tabledata.creator}]] (${tabledata.creatorEdits})`;
			} else {
				// lowercase IPv6 address and split to 2 lines to reduce column width
				if (bot.util.isIPv6Address(tabledata.creator)) {
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

			content += `|-
| [[${page.title}]]
| ${classString}
| ${tabledata.submit_date}
| ${tabledata.creation_date}
| ${editorString}
| ${tabledata.bytecount}
| ${page.issues}
`;
		});

		content += `|}\n<span style="font-style: italic; font-size: 85%;">Last updated by [[User:SDZeroBot|SDZeroBot]] <sup>''[[User:SD0001|operator]] / [[User talk:SD0001|talk]]''</sup> at ~~~~~</span>`;

		return bot.save('Wikipedia:AfC sorting/' + pagetitle, content, 'Updating report');
	};

	bot.batchOperation(Object.keys(sorter), createSubpage, 1, 2).then(() => {
		log('[i] Finished');
	});

})();