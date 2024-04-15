import * as express from "express";
import {
	checkShutoff,
	fetchQueriesForPage,
	metadataStore,
	SHUTOFF_PAGE,
	SUBSCRIPTIONS_CATEGORY,
	processQueries,
	BOT_NAME
} from "./app";
import { createLogStream, mapPath } from "../utils";
import {bot, enwikidb} from "../botbase";
import {getRedisInstance} from "../redis";
import {EventEmitter} from "events";

const router = express.Router();

const log = createLogStream(mapPath('~/web-dbtb.out'));
const redis = getRedisInstance();

/** Store the list of pages currently undergoing update as a redis set */
const redisKey = 'web-db-tabulator-pages';

const db = new enwikidb();

router.get('/stream', async (req, res) => {
	const {page} = req.query as Record<string, string>;

	res.writeHead(200, {
		"Connection": "keep-alive",
		"Cache-Control": "no-cache",
		"Content-Type": "text/event-stream",
	});

	res.on('close', () => {
		log(`[W] Client closed the connection`);
		res.end();
	});

	function stream(code: string, args?: Record<string, any>) {
		res.write(`data: ${JSON.stringify(Object.assign( {}, { code }, args || {}))}\n\n`);
	}
	function endStream() {
		stream('end');
	}

	let [shutoffText, queries, revId] = await Promise.all([
		checkShutoff(),
		fetchQueriesForPage(page),
		getLastNonBotRevId(page).catch(err => {
			stream('failed-get-last-revid', { code: err.code, message: err.message });
			endStream();
		}),
		metadataStore.init(),
	]);

	if (!revId) return;

	if (shutoffText) {
		stream('shutoff', { SHUTOFF_PAGE });
		return endStream();
	} else {
		stream('shutoff-checked');
	}

	const pgKey = page + ':' + revId;
	if (await redis.sismember(redisKey, pgKey).catch(handleRedisError)) {
		stream('already-in-progress', { page, revId });
		return endStream();
	}
	redis.sadd(redisKey, pgKey).catch(handleRedisError);

	// If no queries found, link clicked was probably from a transcluded report.
	// Check if any transclusion(s) are in SUBSCRIPTION_CATEGORY and update them.
	if (queries.length === 0) {
		stream('looking-up-transclusions');
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

	if (queries.length) {
		stream('started', { numQueries: queries.length });
	} else {
		stream('no-queries');
		redis.srem(redisKey, pgKey).catch(handleRedisError);
		return endStream();
	}

	let handleMessage = (...args) => {
		stream(args[0], { args: args.slice(1) })
	};

	const notifier = new EventEmitter();
	notifier.on('message', handleMessage); // If custom JS is enabled
	queries.forEach(q => q.on('message', handleMessage)); // If custom JS is not enabled

	log(`Started processing ${page}`);
	try {
		await processQueries({[page]: queries}, notifier);
	} finally {
		redis.srem(redisKey, pgKey).catch(handleRedisError);
	}
	log(`Finished processing ${page}`);
	stream('completed');
	return endStream();
});

router.get('/', async function (req, res, next) {
	const {page} = req.query as Record<string, string>;
	res.status(200).render( 'db-tabulator/database-report', { page });
});

async function getLastNonBotRevId(page: string) {
	let response = await bot.query({
		prop: 'revisions',
		titles: page,
		rvprop: 'ids',
		rvlimit: 1,
		rvexcludeuser: BOT_NAME
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
