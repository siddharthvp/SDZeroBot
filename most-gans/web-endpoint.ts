import * as express from "express";
import { toolsdb } from '../db';
import { AuthManager, bot } from "../botbase";
import { TABLE } from '../../SDZeroBot/most-gans/model';

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
		SELECT article, date 
		FROM ${TABLE} 
		WHERE nominator = ? 
		ORDER BY date DESC 
	`, [user]);

	res.render('gans', {
		user,
		dbresult: dbresult.map(row => ({ article: row.article, date: new bot.date(row.date).format('YYYY-MM-DD') }))
	});
});

router.get('/credit/:article', async function (req, res) {
	const article = req.params.article.replace(/_/g, ' ');
	const result = await db.query(`SELECT nominator FROM ${TABLE} WHERE article = ?`, [article]);
	if (req.query.raw) {
		return res.type('text').send(result?.[0]?.nominator || '<Unknown>');
	}
	res.render('oneline', {
		text: result?.[0]?.nominator
			? `The nominator of "${article}" is ${result[0].nominator}`
			: `Some error occurred.`
	});
});

export default router;
