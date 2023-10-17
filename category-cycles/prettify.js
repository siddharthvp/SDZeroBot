/**
 * Reads in cycles.json (output of the C++ program),
 * translates the page IDs to titles using the API,
 * and writes the output to the wiki as bot user subpages.
 */

const {bot, log} = require('../botbase');

const PAGE_SIZE_MAX_LIMIT = 60000;
const MAX_PAGES = 100;
const PAGE_LEAD = `{{User:SDZeroBot/Category cycles/header}}\n`;

process.chdir(__dirname);

// sort cycles by length as we're more interested in the smaller cycles
let cycles = require('./cycles.json').sort((a, b) => a.length - b.length);

(async function () {

	await bot.getTokensAndSiteInfo();

	let map = {};

	for (let cycle of cycles) {
		cycle.reverse(); // while we're iterating, reverse the cycle in-place to get a more logical order
		for (let pgid of cycle) {
			map[pgid] = '';
		}
	}

	log(`[+] Detected ${cycles.length} category cycles involving a total of ${Object.keys(map).length}`);

	// Resolve titles from page IDs, 500 at a time
	for await (let json of bot.massQueryGen({
		action: 'query',
		pageids: Object.keys(map)
	}, 'pageids')) {

		for (let pg of json.query.pages) {
			map[pg.pageid] = pg.title.slice('Category:'.length);
		}

	}

	const wiki_page_name = num => `User:SDZeroBot/Category cycles/${num}`

	let page_number = 1;
	let page = PAGE_LEAD;

	for (let cycle of cycles) {
		page += '*' + cycle.map(e => `[[:Category:${map[e]}|${map[e]}]]`).join(' → ') + '\n';
		if (page.length > PAGE_SIZE_MAX_LIMIT) {
			await bot.save(wiki_page_name(page_number), page, 'Updating category cycles')
				.then(() => log(`[+] Saved ${wiki_page_name(page_number)}`));
			page_number++;
			page = PAGE_LEAD;
			if (page_number > MAX_PAGES) {
				break;
			}
		}
	}
	log(`[i] Finished`);

})();
