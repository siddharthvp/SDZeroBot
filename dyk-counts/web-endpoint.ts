import * as express from "express";
import { enwikidb } from "../db";
import { getRedisInstance } from "../redis";

const router = express.Router();
const db = new enwikidb();

const redis = getRedisInstance()

router.get('/credits/:user', async (req, res, next) => {
	const user = req.params.user.replace(/ /g, '_');
	const result = await db.query(`
		SELECT COUNT(*) AS count FROM revision_userindex
		JOIN page ON rev_page = page_id
		JOIN actor_revision ON rev_actor = actor_id
		WHERE page_namespace = 3
		AND actor_name = 'DYKUpdateBot'
		AND SUBSTRING_INDEX(page_title, '/', 1) = ?
	`, [user]);
	const count = result[0].count;
	res.end(String(count));
});

router.get('/noms/:user', async (req, res, next) => {
	const user = req.params.user.replace(/_/g, ' ');

	let count = await redis.hget('dyk-counts', user) as unknown as string;
	res.end(count || '0');
});

export default router;
