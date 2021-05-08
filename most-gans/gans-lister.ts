import { bot, log, mwn } from '../botbase';
import { createLocalSSHTunnel, toolsdb } from '../db';

(async function () {

	await createLocalSSHTunnel('tools.db.svc.eqiad.wmflabs');
	let db = new toolsdb('goodarticles_p').init();
	let result = await db.query(`
        select nominator, count(*) as count
        from nominators
        group by nominator
        order by count desc
        limit 500
	`);
	log(`[S] Got query result`);

	let wikitable = new mwn.table();
	wikitable.addHeaders(['Rank', 'User', 'Count']);

	result.forEach(({nominator, count}, idx) => {
		wikitable.addRow([
			String(idx + 1),
			`[[User:${nominator}|${nominator}]]`,
			String(count)
		]);
	});

	await bot.getTokensAndSiteInfo();
	await bot.save(
		'User:SDZeroBot/Wikipedians by most GANs',
		'{{Hatnote|Last updated at {{subst:#time:H:m, j F Y}} (UTC) by [[User:SDZeroBot|SDZeroBot]]}}.\n\n' +
			wikitable.getText()
	);
	log(`[S] Saved`);

	process.exit();

})();
