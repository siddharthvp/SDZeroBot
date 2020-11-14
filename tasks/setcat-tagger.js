const {argv, bot, log} = require('../botbase');

(async function () {

	await bot.getTokensAndSiteInfo();

	let cat = new bot.category('Television series by creator');

	let subcats = (await cat.subcats()).map(e => e.title);

	for (let cat of subcats) {
		let count = (await new bot.category(cat).subcats()).length;
		if (count > 0) {
			log(`[i] Skip ${cat} as it has subcats`);
			continue;
		}
		await bot.edit(cat, rev => {
			if (rev.content.match(/\{\{[Ss]et category/)) {
				return;
			}
			log(`[S] Would edit ${cat}`);
			if (argv.dry) {
				return;
			}
			return {
				prependtext: '{{Set category}}\n',
				summary: `Adding {{set category}} ([[WP:Bots/Requests for approval/SDZeroBot 8|BRFA]])`,
				minor: true
			}
		})
	}


})();
