import * as express from "express";
import { fetchQueriesForPage, processQueries } from "./io";
import { TEMPLATE } from "./consts";

const router = express.Router();

router.get('/', async function (req, res, next) {
	let {page} = req.query as {page: string};
	const queries = await fetchQueriesForPage(page);

	res.render('database-report', {
		page,
		template: TEMPLATE,
		noQueries: queries.length === 0
	});
	if (queries.length) {
		await processQueries(queries);
	}
});

export default router;
