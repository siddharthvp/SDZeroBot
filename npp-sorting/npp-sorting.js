process.chdir('./SDZeroBot/npp-sorting');
// crontab:
// 0 0 * * * jsub -N job-NPP ~/bin/node ~/SDZeroBot/npp-sorting/npp-sorting.js

const fs = require('fs');
const util = require('util');

const mwn = require('mwn');
const mysql = require('mysql');

/** Parsed console arguments */
const argv = require('minimist')(process.argv.slice(2));

/** Colorised and dated console logging. Semlog is a dependency of mwn */
const log = require('semlog').log;

/** bot account and databse access credentials */
const auth = require('../.auth');

const bot = new mwn({
	apiUrl: 'https://en.wikipedia.org/w/api.php',
	username: auth.bot_username,
	password: auth.bot_password,
	hasApiHighLimit: true,
});
bot.setDefaultParams({ assert: 'bot' });
bot.setUserAgent('w:en:User:SDZeroBot');

const sql = mysql.createConnection({
	host: 'enwiki.analytics.db.svc.eqiad.wmflabs',
	port: 3306,
	user: auth.db_user,
	password: auth.db_password,
	database: 'enwiki_p'
});

/**
 * Wrapper around sql.query that returns a promise
 * and stringifies non-null items in output.
 */
sql.queryBot = function(query) {
	const promisifiedfn = util.promisify(sql.query).bind(sql);
	return promisifiedfn(query).then(results => {
		return results.map(row => {
			Object.keys(row).forEach(prop => {
				if (row[prop]) { // not null
					row[prop] = row[prop].toString();
				}
			});
			return row;
		});
	});
};

const utils = {
	saveObject: function(filename, obj) {
		fs.writeFileSync('./' + filename + '.json', JSON.stringify(obj, null, 2), console.log);
	},

	logObject: function(obj) {
		return console.log(JSON.stringify(obj, null, 2));
	},

	// copied from https://en.wikipedia.org/wiki/MediaWiki:Gadget-twinkleblock.js
	makeSentence: function(arr) {
		if (arr.length < 3) {
			return arr.join(' and ');
		}
		var last = arr.pop();
		return arr.join(', ') + ' and ' + last;
	},
	// copied from https://en.wikipedia.org/wiki/MediaWiki:Gadget-morebits.js
	arrayChunk: function(arr, size) {
		var result = [];
		var current;
		for (var i = 0; i < arr.length; ++i) {
			if (i % size === 0) { // when 'i' is 0, this is always true, so we start by creating one.
				current = [];
				result.push(current);
			}
			current.push(arr[i]);
		}
		return result;
	},
	// copied from https://doc.wikimedia.org/mediawiki-core/master/js/source/util.html#mw-util-method-escapeRegExp
	escapeRegExp: function(str) {
		// eslint-disable-next-line no-useless-escape
		return str.replace( /([\\{}()|.?*+\-^$\[\]])/g, '\\$1' );
	}
};



(async function() {

	/* GET DATA FROM DATABASE */

	log('[i] Started');
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
					models: 'articlequality|draftquality|articletopic',
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
						articletopic: data.articletopic.score.prediction,
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


	/* PROCESS ORES DATA, SORT PAGES INTO TOPICS */

	var sorter = {
		"Unsorted/Unsorted*": []
	};

	Object.entries(oresdata).forEach(function([revid, ores]) {

		var title = revidsTitles[revid];
		if (!title) {
			log(`[E] revid ${revid} couldn't be matched to title`);
		}

		var topics = ores.articletopic; // Array of topics
		var quality = ores.articlequality; // FA / GA / B / C / Start / Stub
		var issues = [];
		if (ores.draftquality !== 'OK') { // OK / vandalism / spam / attack
			issues.push('Possible ' + ores.draftquality);
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



	/* FORMAT DATA TO BE SAVED ON THE WIKI */

	var isStarred = x => x.endsWith('*');
	var meta = x => x.split('/').slice(0, -1).join('/');

	// copied from https://doc.wikimedia.org/mediawiki-core/REL1_29/js/source/mediawiki.util.html#mw-util-method-isIPv6Address
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
! scope="col" style="width: 14em;" | Article
! Class
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
| ${tabledata.creation_date}
| ${editorString}
| ${tabledata.bytecount}
| ${page.issues}
`;
		});

		content += `|}\n<span style="font-style: italic; font-size: 85%;">Last updated by [[User:SDZeroBot|SDZeroBot]] <sup>''[[User:SD0001|operator]] / [[User talk:SD0001|talk]]''</sup> at ~~~~~</span>`;

		return bot.save('User:SDZeroBot/NPP sorting/' + pagetitle, content, 'Updating report');
	};

	await bot.loginGetToken();
	bot.batchOperation(Object.keys(sorter), createSubpage, 1).then(() => {
		log('[i] Finished');
	});

})();