import * as express from "express";
import { createLocalSSHTunnel, toolsdb } from '../db';

const router = express.Router();

createLocalSSHTunnel('tools.db.svc.eqiad.wmflabs');

router.get('/', async function (req, res, next) {
	const user = decodeURIComponent(req.query.user as string);

	const db = new toolsdb('goodarticles_p').init();
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
