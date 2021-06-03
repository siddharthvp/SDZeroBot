import * as express from "express";
import { bot, TextExtractor } from '../../../SDZeroBot/botbase';

const router = express.Router();

router.get('/', async (req, res, next) => {
	let {query, limit} = req.query as Record<string, string>;
	let limitNum = parseInt(limit);
	if (isNaN(limitNum)) {
		limitNum = 50;
	}
	const result = await bot.search(query, Math.min(limitNum, 500), []);
	const titles = result.map(p => p.title) as string[];
	const pages = await bot.read(titles, { rvsection: 0 });
	await bot.batchOperation(pages, async (pg, idx) => {
		pages[idx].excerpt = await bot.parseWikitext(TextExtractor.getExtract(pg.revisions[0].content, 250, 500), {
			disablelimitreport: true
		});
	});
	res.render('articlesearch', {
		query: req.query.query,
		data: pages,
	});
});

export default router;
