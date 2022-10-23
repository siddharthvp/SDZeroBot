import * as express from "express";
import { checkShutoff, fetchQueriesForPage, processQueriesForPage, SHUTOFF_PAGE, TEMPLATE } from "./app";
import { createLogStream, mapPath } from "../utils";

const router = express.Router();

const log = createLogStream(mapPath('~/web-dbtb.out'));

router.get('/', async function (req, res, next) {
	let {page} = req.query as {page: string};

	const [shutoffText, queries] = await Promise.all([
		checkShutoff(),
		fetchQueriesForPage(page)
	]);

	if (shutoffText) {
		log(`[E] Refused run on ${page} as task is shut off. Shutoff page content: ${shutoffText}`);
		res.render('oneline', {
			text: `Bot is current shut off via ${SHUTOFF_PAGE}. The page should be blank for it to work.`
		});
		return;
	}

	res.render('database-report', {
		page,
		template: TEMPLATE,
		noQueries: !queries || queries.length === 0
	});
	if (queries) {
		log(`Started processing ${page}`);
		await processQueriesForPage(queries);
		log(`Finished processing ${page}`);
	}
});

export default router;
