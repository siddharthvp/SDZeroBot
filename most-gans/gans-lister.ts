import { argv, bot, log, mwn } from '../botbase';
import { TOOLS_DB_HOST, toolsdb } from '../db';
import { createLocalSSHTunnel, withIndices } from "../utils";

(async function () {

	await createLocalSSHTunnel(TOOLS_DB_HOST);
	let db = new toolsdb('goodarticles_p');
	let result = await db.query(`
        SELECT nominator, COUNT(*) AS count
        FROM nominators2
        GROUP BY nominator
        ORDER BY count DESC, nominator ASC
        LIMIT 600
	`);
	db.end();
	log(`[S] Got query result`);

	let wikitable = new mwn.table();
	wikitable.addHeaders(['Rank', 'User', 'Count']);

	let rank500Count;
	for (let [idx, {nominator, count}] of withIndices(result)) {
		let rank = idx + 1;
		if (rank === 500) {
			rank500Count = count;
		} else if (rank > 500 && count < rank500Count) {
			break;
		}
		wikitable.addRow([
			String(rank),
			`[[User:${nominator}|${nominator}]]`,
			`[https://sdzerobot.toolforge.org/gans?user=${encodeURIComponent(nominator)} ${count}]`
		]);
	}

	await bot.getTokensAndSiteInfo();
	await bot.save(
		'Wikipedia:List of Wikipedians by good article nominations' + (argv.sandbox ? '/sandbox' : ''),
		'{{/header}}\n\n' + wikitable.getText()
	);
	log(`[S] Saved`);

	process.exit();

})();
