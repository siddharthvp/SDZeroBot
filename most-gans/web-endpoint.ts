import * as express from "express";
import { toolsdb } from '../db';
import { AuthManager, bot } from "../botbase";

const router = express.Router();

// readonly db instance
const db = new toolsdb('goodarticles_p', {
	...AuthManager.get('summary-generator'),
	connectionLimit: 20
});

router.get('/', async function (req, res) {
	if (!req.query.user) {
		// Landing page
		res.render('gans-landing');
		return;
	}
	const {user} = req.query;
	const dbresult = await db.query(`
		select article, date 
		from nominators2 
		where nominator = ? 
		order by date desc
	`, [user]);

	res.render('gans', {
		user,
		dbresult: dbresult.map(row => ({ article: row.article, date: new bot.date(row.date).format('YYYY-MM-DD') }))
	});
});

router.get('/credit/:article', async function (req, res) {
	const article = req.params.article.replace(/_/g, ' ');
	const result = await db.query(`select nominator from nominators2 where article = ?`, [article]);
	res.render('oneline', {
		text: result?.[0]?.nominator
			? `The nominator of "${article}" is ${result[0].nominator}`
			: `Some error occurred.`
	});
});

export default router;
