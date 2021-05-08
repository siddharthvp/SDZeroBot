import * as express from "express";
import { fetchQueriesForPage, processQueriesForPage, TEMPLATE } from "./app";

const router = express.Router();

router.get('/', async function (req, res, next) {
	let {page} = req.query as {page: string};
	const queries = await fetchQueriesForPage(page);

	res.render('database-report', {
		page,
		template: TEMPLATE,
		noQueries: !!queries
	});
	if (queries) {
		await processQueriesForPage(queries);
	}
});

export default router;
