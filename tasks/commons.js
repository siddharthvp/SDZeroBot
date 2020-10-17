const {bot, mwn, log, emailOnError} = require('../botbase');
const OresUtils = require('../OresUtils');

async function getWikidataShortdescs(titles, tableInfo) {
	/* GET WIKIDATA SHORTDESCS */
	const wdbot = new mwn({
		...bot.options,
		apiUrl: 'https://www.wikidata.org/w/api.php',
		hasApiHighLimit: false
	});
	delete wdbot.options.defaultParams.assert;
	for await (let json of wdbot.massQueryGen({
		"action": "wbgetentities",
		"sites": "enwiki",
		"titles": titles,
		"props": "descriptions|labels",
		"languages": "en",
	})) {
		// eslint-disable-next-line no-unused-vars
		for (let [_id, {labels, descriptions}] of Object.entries(json.entities)) {
			let tableentry = tableInfo[labels?.en?.value];
			if (!tableentry || tableentry.shortdesc) {
				continue;
			}
			tableentry.shortdesc = descriptions?.en?.value;
		}
	}
}

function normaliseShortdesc(shortdesc) {
	if (!shortdesc || shortdesc === 'Wikimedia list article') {
		return '';
	} else if (shortdesc === 'Disambiguation page providing links to topics that could be referred to by the same search' +
		' term') {
		return 'Disambiguation page';
	} else {
		return shortdesc;
	}
}

async function populateOresQualityRatings(tableInfo) {
	let revidTitleMap = Object.entries(tableInfo).reduce((map, [title, data]) => {
		if (data.revid) {
			map[data.revid] = title;
		}
		return map;
	}, {});
	await OresUtils.queryRevisions(['articlequality', 'draftquality'], Object.keys(revidTitleMap))
		.then(data => {
			for (let [revid, {articlequality, draftquality}] of Object.entries(data)) {
				Object.assign(tableInfo[revidTitleMap[revid]], {
					oresRating: {
						'Stub': 1, 'Start': 2, 'C': 3, 'B': 4, 'GA': 5, 'FA': 6 // sort-friendly format
					}[articlequality],
					oresBad: draftquality !== 'OK' // Vandalism/spam/attack, many false positives
				});
			}
			log(`[S] Got ORES result`);
		}).catch(err => {
			log(`[E] ORES query failed: ${err}`);
			emailOnError(err, 'g13-* ores (non-fatal)');
		});
}

// Helper functions for sorting
function promote(param, data1, data2) {
	if (data1[param] && !data2[param]) return -1;
	else if (!data1[param] && data2[param]) return 1;
	else return 0;
}
function demote(param, data1, data2) {
	if (data1[param] && !data2[param]) return 1;
	else if (!data1[param] && data2[param]) return -1;
	else return 0;
}
function sortDesc(param, data1, data2) {
	if (data1[param] > data2[param]) return -1;
	else if (data1[param] < data2[param]) return 1;
	else return 0;
}
function sortAsc(param, data1, data2) {
	if (data1[param] > data2[param]) return 1;
	else if (data1[param] < data2[param]) return -1;
	else return 0;
}

// Get page size not counting AFC templates and comments
function AfcDraftSize(text) {
	text = text.replace(/<!--.*?-->/sg, ''); // remove comments
	let wkt = new bot.wikitext(text);
	wkt.parseTemplates({
		namePredicate: name => name.startsWith('AFC ') // AFC submission, AFC comment, etc
	});
	for (let template of wkt.templates) {
		wkt.removeEntity(template);
	}
	return wkt.getText().length;
}

function preprocessDraftForExtract(text) {
	let wkt = new bot.wikitext(text);
	wkt.parseTemplates({
		namePredicate: name => {
			return /infobox/i.test(name) || name === 'AFC submission';
		}
	});
	for (let template of wkt.templates) {
		wkt.removeEntity(template);
	}
	return wkt.getText();
}

async function saveWithBlacklistHandling(page, text) {
	await page.save(text, 'Updating G13 report').catch(async err => {
		if (err.code === 'spamblacklist') {
			for (let site of err.response.error.spamblacklist.matches) {
				text = text.replace(
					new RegExp('https?:\\/\\/' + site, 'g'),
					site
				);
			}
			await page.save(text, 'Updating G13 report');
		} else {
			return Promise.reject(err);
		}
	});
}

module.exports = {
	getWikidataShortdescs,
	normaliseShortdesc,
	populateOresQualityRatings,
	comparators: { promote, demote, sortAsc, sortDesc },
	AfcDraftSize,
	preprocessDraftForExtract,
	saveWithBlacklistHandling
};
