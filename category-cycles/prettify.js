const {bot, log} = require('../botbase');
const cycles = require('./cycles.json');

(async function() {

await bot.getTokensAndSiteInfo();

let map = {};

for (let cycle of cycles) {
	for (let pgid of cycle) {
		map[pgid] = '';
	}
}

log(`[+] Detected ${cycles.length} category cycles involving a total of ${Object.keys(map).length} unique categories. Showing first 5000 lines of output...`);

// Resolve titles from page IDs, 500 at a time
for await (let json of bot.massQueryGen({
	action: 'query',
	pageids: Object.keys(map)
}, 'pageids')) {

	for (let pg of json.query.pages) {
		map[pg.pageid] = pg.title.slice('Category:'.length);
	}

}

for (let cycle of cycles) {
	console.log(cycle.map(e => map[e]).join(' <- ') + '\n\n');
}

})();