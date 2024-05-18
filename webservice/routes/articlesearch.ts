import * as express from "express";
import 'express-async-errors';
import {JSDOM} from 'jsdom';
import {bot, TextExtractor} from '../../../SDZeroBot/botbase';
import {numericArg} from "../utils";

const router = express.Router();

router.get('/', async (req, res, next) => {
	let {query, limit, charLimit, hardCharLimit} = req.query as Record<string, string>;
	const result = await bot.search(query, numericArg(limit, 50, 500), []);
	const titles = result.map(p => p.title) as string[];
	const pages = await bot.read(titles, { rvsection: 0 });

	const window = new JSDOM('').window;
	let wikitextToParse = pages.map(pg => {
		return `<p id="${stringToId(pg.title)}">` +
			TextExtractor.getExtract(
				pg.revisions[0].content,
				numericArg(charLimit, 250),
				numericArg(hardCharLimit, 500)
			) +
			'</p>';
	}).join('');

	const parsedHTML = await bot.parseWikitext(wikitextToParse, { disablelimitreport: true, disableeditsection: true });
	const domElement = window.document.createElement('div');
	domElement.innerHTML = parsedHTML;
	for (let i = 0; i < pages.length; i++) {
		const pElement = domElement.querySelector('#' + stringToId(pages[i].title));
		pages[i].excerpt = pElement ? pElement.innerHTML : '[Not found]';
	}

	res.render('webservice/views/articlesearch', {
		query: req.query.query,
		data: pages,
	});
});

// Extreme KLUDGE
export function stringToId(str: string) {
	return encodeURIComponent('a' + str)
		.replace(/%/g, 'ZeZ')
		.replace(/'/g, 'apso')
		.replace(/\(/g, 'leftBrakc')
		.replace(/!/g, 'excl')
		.replace(/\)/g, 'rightBrakc')
}

export default router;
