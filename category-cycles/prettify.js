/**
 * Reads in cycles.json (output of the C++ program),
 * translates the page IDs to titles using the API,
 * and writes the output to the wiki as bot user subpages.
 */

const {bot, log} = require('../botbase');

const PAGE_SIZE_MAX_LIMIT = 60000;
const MAX_PAGES = 100;
const ROOT_PAGE = process.env.ROOT_PAGE || 'User:SDZeroBot/Category cycles';
const PAGE_LEAD = `{{${ROOT_PAGE}/header}}\n`;

process.chdir(__dirname);

// Allow running for other wikis as well
if (process.env.API_URL) {
	bot.setOptions({
		apiUrl: process.env.API_URL,
		OAuth2AccessToken: process.env.OAUTH2_ACCESS_TOKEN,
		defaultParams: {
			assert: 'user'
		}
	});
}

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

	log(`[+] Detected ${cycles.length} category cycles involving a total of ${Object.keys(map).length} pages`);

	// Resolve titles from page IDs, 50/500 at a time
	const batchSize = bot.hasApiHighLimit ? 500 : 50;
	const numBatches = Math.ceil(Object.keys(map).length / batchSize);
	let batchId = 1;
	for await (let json of bot.massQueryGen({
		action: 'query',
		pageids: Object.keys(map)
	}, 'pageids')) {
		log(`[+] Matching ids to titles... [${batchId++}/${numBatches}]`);
		for (let pg of json.query.pages) {
			map[pg.pageid] = pg.title.slice('Category:'.length);
		}
	}

	const wiki_page_name = num => `${ROOT_PAGE}/${num}`

	let pageNumber = 1;
	let page = PAGE_LEAD;

	for (let cycle of cycles) {
		page += '*' + cycle.map(e => `[[:Category:${map[e]}|${map[e]}]]`).join(' → ') + '\n';
		if (page.length > PAGE_SIZE_MAX_LIMIT) {
			await bot.save(wiki_page_name(pageNumber), page, 'Updating category cycles');
			log(`[+] Saved ${wiki_page_name(pageNumber)}`);
			pageNumber++;
			page = PAGE_LEAD;
			if (pageNumber > MAX_PAGES) {
				break;
			}
		}
	}
	log(`[i] Finished`);

})();
