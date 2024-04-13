import * as express from "express";
import {
	checkShutoff,
	fetchQueriesForPage,
	metadataStore,
	SHUTOFF_PAGE,
	TEMPLATE,
	SUBSCRIPTIONS_CATEGORY,
	processQueries
} from "./app";
import { createLogStream, mapPath } from "../utils";
import {bot, enwikidb} from "../botbase";
import {getRedisInstance} from "../redis";

const router = express.Router();

const log = createLogStream(mapPath('~/web-dbtb.out'));
const redis = getRedisInstance();

/** Store the list of pages currently undergoing update as a redis set */
const redisKey = 'web-db-tabulator-pages';

const db = new enwikidb();

// TODO: show status of requested updates on web UI, with JS polling

router.get('/', async function (req, res, next) {
	let {page} = req.query as {page: string};

	let [shutoffText, queries, revId] = await Promise.all([
		checkShutoff(),
		fetchQueriesForPage(page),
		getLastNonBotRevId(page).catch(err => {
			res.status(err.code || 500).render('oneline', { text: err.message });
		}),
		metadataStore.init(),
	]);

	if (!revId) return;

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

	// If no queries found, link clicked was probably from a transcluded report.
	// Check if any transclusion(s) are in SUBSCRIPTION_CATEGORY and update them.
	if (queries.length === 0) {
		const title = bot.Title.newFromText(page);
		try {
			// FIXME: use the web replica here as this is a blocking call?
			const transcludedReportPages = await db.query(`
				SELECT lt_namespace, lt_title FROM templatelinks
				JOIN linktarget ON tl_target_id = lt_id
				WHERE tl_from = (SELECT page_id FROM page WHERE page_namespace = ? AND page_title = ?)
				AND (lt_namespace, lt_title) IN (
					SELECT page_namespace, page_title FROM categorylinks
					JOIN page ON page_id = cl_from
					WHERE cl_to = ?
				)
			`, [title.getNamespaceId(), title.getMainText(), SUBSCRIPTIONS_CATEGORY.replace(/ /g, '_')])
			for (let row of transcludedReportPages) {
				let page = new bot.Title(row.lt_title as string, row.lt_namespace as number).toText();
				queries = queries.concat(await fetchQueriesForPage(page));
			}
		} catch (e) {
			log(`[E] Failed to look up transcluded reports`);
			log(e);
		}
	}

	res.status(queries.length ? 202 : 400).render('database-report', {
		page,
		template: TEMPLATE,
		noQueries: queries.length === 0
	});
	if (queries) {
		log(`Started processing ${page}`);
		try {
			await processQueries({[page]: queries});
		} finally {
			redis.srem(redisKey, pgKey).catch(handleRedisError);
		}
		log(`Finished processing ${page}`);
	}
});

async function getLastNonBotRevId(page: string) {
	let response = await bot.query({
		prop: 'revisions',
		titles: page,
		rvprop: 'ids',
		rvlimit: 1,
		rvexcludeuser: 'SDZeroBot'
	});
	let pg = response?.query?.pages?.[0];
	if (!pg) {
		throw new CustomError(500, 'Encountered error while fetching page content.');
	}
	if (pg.invalid || pg.missing) {
		throw new CustomError(404, `The page ${page} does not exist.`);
	}
	return pg.revisions[0].revid;
}

function handleRedisError(e: Error) {
	log(`[E] Error in redis operation: `, e);
	return false; // in sismember check, act as if value is not present
}

class CustomError extends Error {
	code: number;
	constructor(code: number, msg: string) {
		super(msg);
		this.code = code;
	}
}

export default router;
