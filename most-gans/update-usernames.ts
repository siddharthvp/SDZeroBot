import { getCurrentUsername, db, TABLE } from "./model";
import { argv, bot, log } from "../botbase";
import { createLocalSSHTunnel, createLogStream } from "../utils";
import { TOOLS_DB_HOST } from "../db";

(async function () {
	bot.setOptions({ silent: true });
	await createLocalSSHTunnel(TOOLS_DB_HOST);

	process.chdir(__dirname);
	const updatesLog = createLogStream('./updates-log.txt');
	const errorLog = createLogStream('./error-log.txt');

	const rows = await db.query(`SELECT * FROM ${TABLE}`);
	await bot.batchOperation(rows, async (row, idx) => {
		if (idx % 1000 === 0) log(`[i] Processing row #${idx + 1}`);
		const {article, nominator, date, usernameUpdateDate} = row;
		const newUsername = await getCurrentUsername(nominator as string, new bot.date(usernameUpdateDate || date).format('YYYY-MM-DD'));
		if (nominator !== newUsername) {
			updatesLog(`Article [[${article}]], "${nominator}" –> "${newUsername}"`);
			if (!argv.dry) {
				db.run(`UPDATE ${TABLE} SET nominator = ?, username_updated = UTC_DATE() WHERE article = ?`,
					[newUsername, article]).then(() => {
					log(`[i] Article [[${article}]], "${nominator}" –> "${newUsername}"`);
				}, err => {
					errorLog(`Failed updating nominator for [[${article}]] from "${nominator}" to "${newUsername}"`);
					log(`[E] Failed updating nominator for [[${article}]] from "${nominator}" to "${newUsername}"`);
					log(err);
				});
			}
		}
	}, 10);
})();
