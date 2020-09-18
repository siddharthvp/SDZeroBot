const {fs, mwn, bot, utils, log, argv, emailOnError} = require('../botbase');

process.chdir(__dirname);

(async function() {

	await bot.getTokensAndSiteInfo();

	/** Get list of all active users */
	var activeusers;
	if (argv.noactiveusers) {
		activeusers = require('./active-users');
	} else {
		await bot.continuedQuery({
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
	}


	/** Get the first 5000 JS pages sorted by number of backlinks
	 * Should cover every script that has at least 2 backlinks, and many others. */
	var scriptList = await bot.request({
		"action": "query",
		"list": "search",
		"srsearch": "contentmodel:javascript",
		"srnamespace": "2",
		"srlimit": "5000",
		"srprop": "",
		"srsort": "incoming_links_desc"
	}).then(json => {
		log('[S] Got basic script list');
		scriptList = json.query.search.map(e => e.title);
		utils.saveObject('scriptList', scriptList);
		return scriptList;
	});

	var table = {};

	await bot.batchOperation(scriptList, function(title, idx) {
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

		return bot.continuedQuery({  // only 1 or 2
			"action": "query",
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

			table[title].active = jsons.reduce(function(users, json) {
				return users.concat(json.query.search.map(e => e.title.split('/')[0].slice('User:'.length)).filter(e => activeusers[e]));
			}, []).length;

		});

	}, /* batchSize */ 1, /* retries */ 10).then(failures => {
		utils.saveObject('failures', failures.failures);
	});

	// Read old JSON file and compute deltas

	// var oldcounts = require('./importCounts');
	// Object.keys(oldcounts).forEach(page => {
	// 	if (!table[page]) {
	// 		log(`[E] Couldn't find ${page} in table. It was there last time`);
	// 		return;
	// 	}
	// 	table[page].deltaTotal = table[page].total - oldjson[page].total;
	// });

	if (argv.tabulate) { // for debugging
		table = require('./table');
	} else {
		utils.saveObject('table', table);
	}

	// Sort the table by total:
	var tableList = [];
	Object.entries(table).forEach(([title, data]) => {
		tableList.push([title, data.total, data.active]);
	});
	var tableSorted = {};
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

	var wikitable = new mwn.table({ sortable: true, style: 'text-align: center' });
	wikitable.addHeaders([
		'Position',
		'Script',
		'Total users',
		'Active users'
	]);

	var wikitext = `{{Wikipedia:User scripts/Most imported scripts/header}}\n\n` +
		`:''Last updated on {{subst:#time:j F Y}} by [[User:SDZeroBot|SDZeroBot]]<includeonly><section begin=lastupdate />${new bot.date().format('D MMMM YYYY')}<section end=lastupdate /></includeonly>\n`;

// 	wikitable =
// 	`:''Last updated on {{subst:#time:j F Y}} by [[User:SDZeroBot|SDZeroBot]]
// {| class="wikitable sortable"  style="text-align: center"
// ! Position !! Script !! Total users !! data-sort-type=number | Change !! Active users !! data-sort-type=number | Change
// `;

	let idx = 1, prevtotal;
	for (let [name, count] of Object.entries(tableSorted)) {
		// count.deltaTotal = count.deltaTotal || count.total;
		// var deltaTotal = count.deltaTotal + ' &nbsp; ' + (count.deltaTotal >= 0 ? '{{up}}' : '{{down}}');

		if (idx >= 1000 && count.total !== prevtotal) {
			break;
		}
		wikitable.addRow([ idx++, `[[${name}]]`, count.total, count.active ]);
		prevtotal = count.total;

	}

	wikitext += wikitable.getText();

	if (!argv.dry) {
		await bot.save('Wikipedia:User scripts/Most imported scripts', wikitext, 'Updating');
	}

	log('[i] Finished');

})().catch(err => emailOnError(err, 'most-imported-scripts'));
