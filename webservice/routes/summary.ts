import * as express from "express";
import 'express-async-errors';
import {bot, TextExtractor} from '../../../SDZeroBot/botbase';

const router = express.Router();

router.get('/', async (req, res, next) => {
	let {page, charLimit, charHardLimit} = req.query;
	let apiPage = await bot.read(page);
	let output;
	if (apiPage.missing) {
		 output = 'MISSING PAGE!';
	} else {
		output = TextExtractor.getExtract(apiPage.revisions[0].content, charLimit || 250, charHardLimit || 500);
	}
	res.type('txt').end(output);
});

export default router;
