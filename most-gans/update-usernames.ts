import { getCurrentUsername, db, TABLE } from "./model";
import { bot, log } from "../botbase";

(async function () {
	bot.setOptions({ silent: true });
	const rows = await db.query(`SELECT * FROM ${TABLE}`);
	await bot.batchOperation(rows, async (row, idx) => {
		if (idx % 1000 === 0) log(`[i] Processing row #${idx + 1}`);
		const {article, nominator, date} = row;
		const newUsername = await getCurrentUsername(nominator as string, new bot.date(date).format('YYYY-MM-DD'));
		if (nominator !== newUsername) {
			log(`[i] UPDATE ${TABLE} SET nominator = "${newUsername}" WHERE article = "${article}"`);
			// log(`[i] ${nom} renamed to ${newUsername}`);
			// db.run(`UPDATE ${TABLE} SET nominator = ? WHERE article = ?`, [newUsername, article]).catch(err => {
			// 	log(`[E] DB write failure`);
			// 	log(err);
			// });
		}
	}, 50);
})();
