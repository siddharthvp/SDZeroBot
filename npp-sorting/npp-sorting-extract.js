// process.chdir('./SDZeroBot/npp-sorting');
// crontab:
// 0 0 * * * jsub -N job-NPP -mem 2g ~/bin/node ~/SDZeroBot/npp-sorting/npp-sorting.js

const {log, argv, bot, sql, utils, assert} = require('../botbase');

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');

	await bot.loginGetToken();

	var revidsTitles, tableInfo;
	if (argv.nodb) {
		revidsTitles = require('./revidsTitles');
		tableInfo = require('./tableInfo');
	} else {
		const result = await sql.queryBot(`
			SELECT page_title, rev_timestamp, page_latest, page_len, actor_name, user_editcount
			FROM pagetriage_page
			JOIN page on page_id = ptrp_page_id
			JOIN revision ON page_id = rev_page AND rev_parent_id = 0
			JOIN actor ON rev_actor = actor_id
			LEFT JOIN user ON user_id = actor_user
			WHERE page_namespace = 0
			AND page_is_redirect = 0
			AND ptrp_reviewed = 0
		`);
		sql.end();
		log('[S] Got DB query result');

		var formatDateString = function(str) {
			return str.slice(0, 4) + '-' + str.slice(4, 6) + '-' + str.slice(6, 8);
		};

		var rfdRedirects = new Set(await new bot.category('All redirects for discussion').pages()
			.then(pages => pages.map(pg => pg.title)));

		revidsTitles = {};
		tableInfo = {};
		result.forEach(row => {
			var pagename = row.page_title.replace(/_/g, ' ');
			if (rfdRedirects.has(pagename)) { // exclude RfD'd redirects 
				return;
			}
			revidsTitles[row.page_latest] = pagename
			tableInfo[pagename] = {
				creation_date: formatDateString(row.rev_timestamp),
				bytecount: row.page_len,
				creator: row.actor_name,
				creatorEdits: row.user_editcount || '',
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

	/* GET SHORT DESCRIPTIONS */
	await bot.massQuery({
		action: 'query',
		titles: Object.values(revidsTitles),
		prop: 'description'
	}).then(jsons => {
		var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
		assert(pages.length === Object.values(revidsTitles).length);
		pages.forEach(page => {
			if (page.description) {
				tableInfo[page.title].shortdesc = page.description;
			}
		});
		log(`[S] Found ${pages.filter(page => page.description).length} pages with short descriptions`);
	});


	/* GET DATA ABOUT PRIOR AFD */
	var afds = {};

	// Get existing AfDs to filter them out
	var currentAfds = new Set(await new bot.category('AfD debates').pages().then(pages => {
		return pages.map(pg => pg.title); 
	}));

	await bot.massQuery({
		action: 'query',
		titles: Object.values(revidsTitles).map(e => 'Wikipedia:Articles for deletion/' + e)
	}).then(jsons => {
		var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
		pages.forEach(page => {
			if (!page.missing && !currentAfds.has(page)) {
				afds[page.title.slice('Wikipedia:Articles for deletion/'.length)] = 1;
			}
		});
		log(`[S] Fetched list of prior AfDs. Found ${Object.keys(afds).length} articles with AfDs`);
	});	



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
		if (ores.draftquality !== 'OK') { // OK / vandalism / spam / attack
			issues.push('Possible ' + ores.draftquality);
		}
		if (afds[title]) {
			issues.push(`[[Wikipedia:Articles for deletion/${title}|Past AfD]]`);
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


	await bot.massQuery({
		action: 'query',
		titles: sorter['Culture/Media/Media*'].map(e => e.title),
		prop: 'revisions',
		rvprop: 'content',
		rvsection: '0'
	}).then(jsons => {
		var pages = jsons.reduce((pages, json) => pages.concat(json.query.pages), []);
		pages.forEach(pg => {
			if (pg.missing) {
				return;
			}
			var text = pg.revisions[0].content;
			var extract = text
				.replace(/<!--.*?-->/sg, '')
				.replace(/<ref name=.*?\/>/g, '')
				.replace(/<ref.*?<\/ref>/sg, '')
				.replace(/\[\[File:.*\]\]/, '')
				.replace(/^\s*[{|}=*#:].*$/mg, '')
				.trimLeft()
				.replace(/\n\n.*/s, '')
				.replace(/'''(.*?)'''/g, '$1')
				.replace(/\(\{\{lang-.*?\}\}\)/, '')
				.trim();
			tableInfo[pg.title].extract = extract;
		});
	});


	/* FORMAT DATA TO BE SAVED ON THE WIKI */

	var isStarred = x => x.endsWith('*');
	var meta = x => x.split('/').slice(0, -1).join('/');

	var makeMainPage = function() {
		var count = Object.keys(revidsTitles).length;
		return bot.edit('User:SDZeroBot/NPP sorting', function(rev) {
			var text = rev.content.replace(/\{\{\/header.*\}\}/, 
				`{{/header|count=${count}|date=${accessdate}|ts=~~~~~}}`);
			return {
				text: text, 
				summary: 'Updating report'
			};
		});
	}
	// await makeMainPage();


	/* TOPICAL SUBPAGES */

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
		content += `{{User:SDZeroBot/NPP sorting/header|count=${sorter[topic].length}|date=${accessdate}|ts=~~~~~}}\n`;
		content += `
{| class="wikitable sortable"
|-
! scope="col" style="width: 5em;" | Created
! scope="col" style="width: 20em;" | Article
! scope="col" style="max-width: 28em;" | Extract 
! scope="col" style="width: 3em;" | Class
! scope="col" style="max-width: 14em;" | Creator (# edits)
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

			var articleString = `[[${page.title}]]`;
			if (tabledata.shortdesc) {
				articleString += ` <small>(${tabledata.shortdesc})</small>`;
			}

			content += `|-
| ${tabledata.creation_date}
| ${articleString}
| <small>${tabledata.extract || ''}</small>
| ${classString}
| ${editorString}
| ${page.issues}
`;
		});

		content += `|}\n<span style="font-style: italic; font-size: 85%;">Last updated by [[User:SDZeroBot|SDZeroBot]] <sup>''[[User:SD0001|operator]] / [[User talk:SD0001|talk]]''</sup> at ~~~~~</span>`;

		// strip any categories from page text extracts
		content = content.replace(/\[\[[cC]ategory:.*?\]\]/g, '');

		return bot.save('User:SDZeroBot/NPP sorting/' + pagetitle, content, 'Updating report (testing)');
	};

	bot.batchOperation(['Culture/Media/Media*'], createSubpage, 1).then(() => {
		log('[i] Finished');
	});

})();