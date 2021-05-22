import { bot, log, mwn } from '../botbase';
import { TOOLS_DB_HOST, toolsdb } from '../db';
import { createLocalSSHTunnel } from "../utils";

(async function () {

	await createLocalSSHTunnel(TOOLS_DB_HOST);
	let db = new toolsdb('goodarticles_p').init();
	let result = await db.query(`
        select nominator, count(*) as count
        from nominators
        group by nominator
        order by count desc
        limit 500
	`);
	log(`[S] Got query result`);

	let wikitable = new mwn.table({ classes: ['plainlinks'] });
	wikitable.addHeaders(['Rank', 'User', 'Count']);

	result.forEach(({nominator, count}, idx) => {
		wikitable.addRow([
			String(idx + 1),
			`[[User:${nominator}|${nominator}]]`,
			`[https://sdzerobot.toolforge.org/gans?user=${encodeURIComponent(nominator)} ${count}]`
		]);
	});

	await bot.getTokensAndSiteInfo();
	await bot.save(
		'User:SDZeroBot/Wikipedians by most GANs',
		'{{/header}}\n\n' + wikitable.getText()
	);
	log(`[S] Saved`);

	process.exit();

})();