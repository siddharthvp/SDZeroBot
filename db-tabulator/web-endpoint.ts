import * as express from "express";
import { fetchQueriesForPage, processQueriesForPage, TEMPLATE } from "./app";
import { createLogStream, mapPath } from "../utils";

const router = express.Router();

const log = createLogStream(mapPath('~/web-dbtb.out'));

router.get('/', async function (req, res, next) {
	let {page} = req.query as {page: string};
	const queries = await fetchQueriesForPage(page);

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
