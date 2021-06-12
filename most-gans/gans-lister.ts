import { bot, log, mwn } from '../botbase';
import { TOOLS_DB_HOST, toolsdb } from '../db';
import { createLocalSSHTunnel } from "../utils";

(async function () {

	await createLocalSSHTunnel(TOOLS_DB_HOST);
	let db = new toolsdb('goodarticles_p');
	let result = await db.query(`
        select nominator, count(*) as count
        from nominators2
        group by nominator
        order by count desc, nominator asc
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
		'Wikipedia:List of Wikipedians by good article nominations',
		'{{/header}}\n\n' + wikitable.getText()
	);
	log(`[S] Saved`);

	process.exit();

})();
