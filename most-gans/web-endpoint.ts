import * as express from "express";
import { createLocalSSHTunnel, TOOLS_DB_HOST, toolsdb } from '../db';
import { AuthManager } from "../botbase";

const router = express.Router();

createLocalSSHTunnel(TOOLS_DB_HOST);

// readonly db instance
const db = new toolsdb('goodarticles_p', {
	...AuthManager.get('summary-generator'),
	connectionLimit: 20
}).init();

router.get('/', async function (req, res, next) {

	if (!req.query.user) {
		// Landing page
		res.render('gans-landing');
		return;
	}

	const user = decodeURIComponent(req.query.user as string);

	const result = await db.query(`
        select article from nominators
        where nominator = ? 	
    `, [user]);

	res.render('gans', {
		user,
		count: result.length,
		articles: result.map(e => e.article)
	});

});

export default router;
