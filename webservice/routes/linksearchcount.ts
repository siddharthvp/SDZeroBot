import * as express from "express";
import { enwikidb } from "../../../SDZeroBot/db";
const router = express.Router();

const db = new enwikidb().init();

router.get('/', async (req, res, next) => {
	let {target} = req.query;
	console.log(target);
	let result = await db.query(
		"SET STATEMENT max_statement_time = 20 FOR SELECT COUNT(*) AS count FROM externallinks WHERE el_index_60 LIKE ?",
		[target]
	);
	res.send(String(result[0].count));
});

export default router;
