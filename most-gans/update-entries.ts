import {getCurrentUsername, db, TABLE, getCurrentTitle} from "./model";
import {argv, bot, emailOnError, log} from "../botbase";
import {closeTunnels, createLocalSSHTunnel, createLogStream} from "../utils";
import {TOOLS_DB_HOST} from "../db";

// TODO: rewrite this as part of eventstream listener, making this real-time

(async function () {
	bot.setOptions({ silent: true });
	await createLocalSSHTunnel(TOOLS_DB_HOST);

	process.chdir(__dirname);
	const updatesLog = createLogStream('./updates-log.txt');
	const errorLog = createLogStream('./error-log.txt');

	const rows = await db.query(`SELECT * FROM ${TABLE}`);
	await bot.batchOperation(rows, async (row, idx) => {
		if (idx % 1000 === 0) log(`[i] Processing row #${idx + 1}`);
		const {article, nominator, date, lastUpdate} = row;
		const lastUpdated = new bot.date(lastUpdate || date).format('YYYY-MM-DD');
		const newUsername = await getCurrentUsername(nominator as string, lastUpdated);
		const newTitle = await getCurrentTitle(article as string, lastUpdated);
		if (article !== newTitle) {
			updatesLog(`Article [[${article}]] renamed to [[${newTitle}]]`);
			try {
				await db.run(`UPDATE ${TABLE} SET article = ?, lastUpdate = UTC_DATE() WHERE article = ?`, [newTitle, article]);
			} catch (err) {
				errorLog(`Failed renaming article [[${article}]] to [[${newTitle}]]`);
				log(`[E] Failed renaming article [[${article}]] to [[${newTitle}]]`);
				log(err);
			}
		}
		if (nominator !== newUsername) {
			updatesLog(`Article [[${article}]], nominator renamed "${nominator}" –> "${newUsername}"`);
			if (!argv.dry) {
				db.run(`UPDATE ${TABLE} SET nominator = ?, lastUpdate = UTC_DATE() WHERE article = ?`,
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

	log(`[+] Finished`);
	closeTunnels();

})().catch(e => emailOnError(e, 'gans-update-entries'));
