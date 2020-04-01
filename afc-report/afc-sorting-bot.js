process.chdir('./SDZeroBot/afc-report');
// crontabs:
// 0 0 * * * jsub -N job-MIS ~/bin/node ~/SDZeroBot/afc-report/afc-sorting-bot.js

const {bot, sql, utils, libApi, argv, log} = require('../botbase');

(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
	var revidsTitles, tableInfo;
	if (argv.nodb) {
		revidsTitles = require('./revidsTitles');
		tableInfo = require('./tableInfo');
	} else {
		const result = await sql.queryBot(`
			select page_title, page_latest, cl_sortkey_prefix, page_len, actor_name, rev_timestamp, user_editcount, user_registration
			from categorylinks
			join page on page_id = cl_from
			join revision on page_id = rev_page and rev_parent_id = 0
			join actor on rev_actor = actor_id
			left join user on user_id = actor_user
			where cl_to = 'Pending_AfC_submissions'
			and page_namespace = 118;
		`);
		sql.end();
		log('[S] Got DB query result');

		var formatDateString = function(str) {
			return str.slice(0, 4) + '-' + str.slice(4, 6) + '-' + str.slice(6, 8) +
				' ' + str.slice(8, 10) + ':' + str.slice(10, 12);
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
				creatorRegn: row.user_registration ? new Date(formatDateString(row.user_registration) + ' UTC').toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''
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
		var apicallcount = 1;
		var errors = [];
		var queryOres = function(revids) {

			return bot.rawRequest({
				method: 'GET',
				uri: 'https://ores.wikimedia.org/v3/scores/enwiki/',
				qs: {
					models: 'articlequality|draftquality|drafttopic',
					revids: revids.join('|')
				},
				json: true
			}).then(function(json) {
				log(`[+][${apicallcount}/${chunks.length}] Ores API call ${apicallcount++} succeeded.`);
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
			await queryOres(chunks[i]); // sequential calls
		}

		utils.saveObject('oresdata', oresdata);
		utils.saveObject('errors', errors);
	}




	/* GET COPYVIOS REPORT */

	await bot.loginBot();
	var UserSQLReport = await bot.request({
		"action": "query",
		"prop": "revisions",
		"titles": "User:SQL/AFC-Ores",
		"rvprop": "content"
	}).then(function(json) {
		log('[S] Got User:SQL/AFC-Ores');
		return json.query.pages[0].revisions[0].content;
	}).catch(function() {
		log('[E] Failed to get User:SQL/AFC-Ores');
		console.log(arguments);
	});
	utils.saveObject('UserSQLReport', UserSQLReport);

	var entriesFound = 0;
	var getCopyioPercent = function(title) {
		var re = new RegExp(`${utils.escapeRegExp(title).replace(/ /g, '_')}(?:\\s|\\S)*?tools\\.wmflabs\\.org\\/copyvios\\/.*? (.*?)\\]%`).exec(UserSQLReport);
		if (!re || !re[1]) {
			return null;
		}
		entriesFound++;
		return parseFloat(re[1]);
	};



	/* PROCESS ORES DATA, SORT PAGES INTO TOPICS */

	var sorter = {
		"Unsorted/Unsorted*": []
	};

	Object.entries(oresdata).forEach(function([revid, data]) {

		var topics = data.drafttopic; // Array of topics
		var quality = data.articlequality; // FA / GA / B / C / Start / Stub
		var issues = data.draftquality; // OK / vandalism / spam / attack
		if (issues !== 'OK') {
			issues = 'Possible ' + issues;
		} else {
			issues = '';
		}
		if (UserSQLReport && getCopyioPercent(revidsTitles[revid]) > 50) {
			issues += (issues ? '<br>' : '') + 'Possible copyvio';
		}

		if (!revidsTitles[revid]) {
			log(`[E] revid ${revid} couldn't be matched to title`);
		}
		var toInsert = {
			title: revidsTitles[revid],
			revid: revid,
			quality: quality,
			issues: issues
		};

		if (topics.length) {

			topics.forEach(function(topic) {
				topic = topic.replace(/\./g, '/');
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

	// copied form mw.util.isIPv6Address
	var isIPv6Address = function(address) {
		var RE_IPV6_ADD = '(?:' + ':(?::|(?::' + '[0-9A-Fa-f]{1,4}' + '){1,7})' + '|' + '[0-9A-Fa-f]{1,4}' + '(?::' + '[0-9A-Fa-f]{1,4}' + '){0,6}::' + '|' + '[0-9A-Fa-f]{1,4}' + '(?::' + '[0-9A-Fa-f]{1,4}' + '){7}' + ')';
		if (new RegExp('^' + RE_IPV6_ADD + '$').test(address)) {
			return true;
		}
		RE_IPV6_ADD = '[0-9A-Fa-f]{1,4}' + '(?:::?' + '[0-9A-Fa-f]{1,4}' + '){1,6}';
		return (new RegExp('^' + RE_IPV6_ADD + '$').test(address) && /::/.test(address) && !/::.*::/.test(address));
	};



	/* TOPICAL SUBPAGES */
	var createSubpage = function(topic) {
		var pagetitle = topic;
		var content = `<templatestyles src="User:SD0001/AfC sorting/styles.css"/>\n`;
		if (isStarred(topic)) {
			pagetitle = meta(topic);
			if (pagetitle !== 'Unsorted') {
				content += `<div style="font-size:18px">See also the subpages:</div>\n` +
				`{{Special:PrefixIndex/User:SDZeroBot/AfC sorting/${pagetitle}/|stripprefix=1}}\n\n`;
			}
		}
		content += `<div style="font-size:18px">${sorter[topic].length} pending AfC submission${sorter[topic].length > 1 ? 's' : ''} as of ${accessdate}</div>
{| class="wikitable sortable"
|-
! Page
! Class
! Submission date
! Creation date
! Creator (# edits)
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
				if (isIPv6Address(tabledata.creator)) {
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

		content += '|}';

		return bot.edit('User:SDZeroBot/AfC sorting/' + pagetitle, content, 'Updating report');
	};



	/* MAIN-PAGE REPORT */
	var makeSinglePageReport = function() {
		var pagetext = `<templatestyles src="User:SD0001/AfC sorting/styles.css"/>
{{TOC right}}
<div style="font-size:24px">Pending AfC submissions as of ${accessdate}</div>
{{hatnote|A single page may appear in multiple sections. Pages now in mainspace appear in green. Count of entries in each section is indicated in the section header.}}
`;

		Object.keys(sorter).sort(function(a, b) {
			if (isStarred(a) && isStarred(b)) {
				return a > b ? 1 : -1;
			} else if (isStarred(a) && meta(a) === meta(b)) {
				return -1;
			} else if (isStarred(b) && meta(a) === meta(b)) {
				return 1;
			} else {
				return a > b ? 1 : -1;
			}
		}).forEach(function(topic) {

			var rawtopic = topic;
			if (isStarred(topic)) {
				topic = meta(topic) + '/*';
			}
			var size = ` <small>(${sorter[rawtopic].length})</small>`;

			pagetext += `\n== ${topic} ${size} ==\n` +
				`{{main page|User:SDZeroBot/AfC sorting/${isStarred(topic) ? meta(topic) : topic}}}\n{{div col|colwidth=20em}}\n`;
			sorter[rawtopic].forEach(function(page) {
				pagetext += '* [[' + page.title + ']]: <small>' + page.quality + '-class' +
				(!page.issues ? '' : ', ' + page.issues) + '</small>\n';
			});
			pagetext += '{{div col end}}\n';
		});
		return bot.edit('User:SDZeroBot/AfC sorting', pagetext, 'Updating report');
	};

	makeSinglePageReport();
	libApi.ApiBatchOperation(Object.keys(sorter), createSubpage, 10);

})();



// TemplateStyles:
// mw.util.addCSS(`
// .mw-redirect { color: green }
// .wikitable tbody tr td:nth-child(2),
// .wikitable tbody tr td:nth-child(3) {
//     font-size: 13px;
// }
// `);
