import * as express from "express";
import { checkShutoff, fetchQueriesForPage, processQueriesForPage, SHUTOFF_PAGE, TEMPLATE } from "./app";
import { createLogStream, mapPath } from "../utils";
import {bot} from "../botbase";
import {getRedisInstance} from "../redis";

const router = express.Router();

const log = createLogStream(mapPath('~/web-dbtb.out'));
const redis = getRedisInstance();

/** Store the list of pages currently undergoing update as a redis set */
const redisKey = 'web-db-tabulator-pages';

router.get('/', async function (req, res, next) {
	let {page} = req.query as {page: string};

	const [shutoffText, queries, revId] = await Promise.all([
		checkShutoff(),
		fetchQueriesForPage(page),
		getLatestRevId(page),
	]);

	if (revId === -1) {
		return res.status(404).render('oneline', { text: `The page ${page} does not exist.` });
	}

	if (shutoffText) {
		log(`[E] Refused run on ${page} as task is shut off. Shutoff page content: ${shutoffText}`);
		return res.status(422).render('oneline', {
			text: `Bot is current shut off via ${SHUTOFF_PAGE}. The page should be blank for it to work.`
		});
	}

	const pgKey = page + ':' + revId;
	if (await redis.sismember(redisKey, pgKey).catch(handleRedisError)) {
		return res.status(409).render('oneline', {
			text: `An update is already in progress for report(s) on page ${page} (revid ${revId})`
		});
	}
	redis.sadd(redisKey, pgKey).catch(handleRedisError);

	res.status(queries.length ? 202 : 400).render('database-report', {
		page,
		template: TEMPLATE,
		noQueries: queries.length === 0
	});
	if (queries) {
		log(`Started processing ${page}`);
		try { // should never throw but still ...
			await processQueriesForPage(queries);
		} finally {
			redis.srem(redisKey, pgKey).catch(handleRedisError);
		}
		log(`Finished processing ${page}`);
	}
});

async function getLatestRevId(page: string) {
	let response = await bot.query({ prop: 'revisions', titles: page, rvprop: 'ids', rvlimit: 1 });
	let pg = response.query.pages[0];
	if (pg.missing) {
		return -1;
	}
	return pg.revisions[0].revid;
}

function handleRedisError(e: Error) {
	log(`[E] Error in redis operation: `, e);
	return false; // in sismember check, act as if value is not present
}

export default router;
