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

log(`[+] ${Object.keys(map).length} page IDs`);

for await (let json of bot.massQueryGen({
	action: 'query',
	pageids: Object.keys(map),
	limit: 'max'
}, 'pageids')) {

	log(`[+] Got titles for 5000 pages`);
	for (let pg of json.query.pages) {
		map[pg.pageid] = pg.title;
	}

}

for (let cycle of cycles) {
	console.log(cycle.map(e => map[e]).join(' <- ') + '\n\n');
}

})();