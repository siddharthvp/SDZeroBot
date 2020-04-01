process.chdir('./SDZeroBot/most-imported-scripts');
// crontabs:
// 0 12 1 * * jsub -N job-MIS ~/bin/node ~/SDZeroBot/most-imported-scripts/most-imported-scripts.js
// 0 12 15 * * jsub -N job-MIS ~/bin/node ~/SDZeroBot/most-imported-scripts/most-imported-scripts.js

const {fs, bot, libApi, utils, log, argv} = require('../botbase');

/** globals */
var table, activeusers, scriptList, tableList, tableSorted, wikitable, failures;

bot.loginBot().then(() => {

	if (argv.tabulate) return;
	if (argv.noactiveusers) {
		activeusers = require('./active-users');
		return;
	}

	/** Get list of all active users */
	return libApi.ApiQueryContinuous(bot, {
		"action": "query",
		"assert": "bot",
		"list": "allusers",
		"auactiveusers": 1,
		"aulimit": "max"
	}, 50).then(function(jsons) {

		activeusers = jsons.reduce(function(activeusers, json) {
			json.query.allusers.forEach(e => {
				activeusers[e.name] = e.recentactions;

			});
			return activeusers;
		}, {});

		utils.saveObject('active-users', activeusers);
		log('[S] Got list of active users');
	});

}).then(function() {
	if (argv.tabulate) return;

	/** Get the first 3000 JS pages sorted by number of backlinks
	 * Should cover every script that has at least 2 backlinks, and many others. */
	return bot.request({
		"action": "query",
		"list": "search",
		"srsearch": "contentmodel:javascript",
		"srnamespace": "2",
		"srlimit": "3000",
		"srprop": "",
		"srsort": "incoming_links_desc"
	}).then(json => {
		log('[S] Got basic script list');
		scriptList = json.query.search.map(e => e.title);
		utils.saveObject('scriptList', scriptList);
	});

}).then(function() {
	if (argv.tabulate) return;

	table = {};
	failures = [];
	return libApi.ApiBatchOperation(scriptList, function(title, idx) {
		log(`[i][${idx}/${scriptList.length}] Processing ${title}`);
		var subpagename = title.slice(title.indexOf('/') + 1);

		// ignore these, skipping the api calls
		if (['common.js', 'vector.js', 'monobook.js', 'timeless.js', 'modern.js',
		'cologneblue.js', 'twinkleoptions.js'].includes(subpagename)) {
			table[title] = {
				total: -1,
				active: -1
			};
			return Promise.resolve();
		}

		return libApi.ApiQueryContinuous(bot, {  // only 1 or 2
			"action": "query",
			"format": "json",
			"list": "search",
			"srsearch": '"' + title + '" intitle:/(common|vector|monobook|modern|timeless|cologneblue)\\.js/',
			"srnamespace": "2",
			"srlimit": "max",
			"srinfo": "totalhits",
			"srprop": ""

		}, 10, true).then(function(jsons) {

			var installCount = jsons[0].query.searchinfo.totalhits;
			table[title] = {
				total: installCount
			};
			if (installCount === 0) {
				table[title].active = 0;
				table[title].activeusers = [];
				return; // code below won't work
			}

			var scriptActiveUsers = jsons.reduce(function(users, json) {
				return users.concat(json.query.search.map(e => e.title.split('/')[0].slice('User:'.length)).filter(e => activeusers[e]));
			}, []);

			table[title].active = scriptActiveUsers.length;
			table[title].activeusers = scriptActiveUsers; // debugging

		}).catch(function() {
			failures.push(title);
			return Promise.reject();
		});

	}, 1);

}).then(function() {
	if (argv.tabulate) return;
	if (failures.length) {
		log(`[E] Fetched search results with ${failures.length} errors`);
	}
	// Read old JSON file and compute deltas

	// var oldcounts = require('./importCounts');
	// Object.keys(oldcounts).forEach(page => {
	// 	if (!table[page]) {
	// 		log(`[E] Couldn't find ${page} in table. It was there last time`);
	// 		return;
	// 	}
	// 	table[page].deltaTotal = table[page].total - oldjson[page].total;
	// 	table[page].deltaActive = table[page].active - oldjson[page].active;
	// });

}).then(function() {

	if (!argv.tabulate) {
		utils.saveObject('table', table);
	} else {
		table = require('./table');
	}

	// Sort the table by total:
	tableList = [];
	Object.entries(table).forEach(([title, data]) => {
		tableList.push([title, data.total, data.active]);
	});
	tableSorted = {};
	tableList.sort((a, b) => {
		if (b[1] - a[1] !== 0) {
			return b[1] - a[1];
		}
		return b[2] - a[2];
	}).forEach(function(e) {
		tableSorted[e[0]] = table[e[0]];
	});
	utils.saveObject('importCounts', tableSorted);
	fs.writeFileSync('importCounts-time.txt', new Date().toString(), console.log);

	// Create wikitable:
	var dateString = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

	wikitable =
`The number of installations of a script is taken as the number of userspace common.js or skin js pages that contain the script's name ([https://en.wikipedia.org/w/index.php?search=%22User%3ALupin%2Fpopups.js%22+intitle%3A%2F%28common%7Cvector%7Cmonobook%7Cmodern%7Ctimeless%7Ccologneblue%29%5C.js%2F&title=Special%3ASearch&ns2=1 example search query]). Commented-out installations also get counted, but the over-counting because of this should be negligible.

Note that a few scripts may have redirects, which indicates that they are also getting loaded for users who have installed the redirect version instead.

:''Last updated on ${dateString} by [[User:SDZeroBot|SDZeroBot]]
{| class="wikitable sortable"  style="text-align: center"
! Position !! Script !! Total users !! Active users
`;

// 	wikitable =
// 	`:''Last updated on ${dateString} by [[User:SDZeroBot|SDZeroBot]]
// {| class="wikitable sortable"  style="text-align: center"
// ! Position !! Script !! Total users !! data-sort-type=number | Change !! Active users !! data-sort-type=number | Change
// `;

	var pos = 1;
	Object.entries(tableSorted).forEach(function([name, count]) {
		// count.deltaTotal = count.deltaTotal || count.total;
		// count.deltaActive = count.deltaActive || count.active;

		// var deltaTotal = count.deltaTotal + ' &nbsp; ' + (count.deltaTotal >= 0 ? '{{up}}' : '{{down}}');
		// var deltaActive = count.deltaActive + ' &nbsp; ' + (count.deltaActive >= 0 ? '{{up}}' : '{{down}}');

		if (count.total <= 0) {
			return;
		}
		wikitable +=
		'|-\n' +
		`| ${(pos++).toString()} || style="text-align:left;" | [[${name}]] || ${count.total} || ${count.active}\n`;

	});

	wikitable += '|}';

	fs.writeFileSync('./wikitable.txt', wikitable, console.log);
	return bot.edit('Wikipedia:User scripts/Most imported scripts', wikitable, 'Updating');

}).catch(console.log);