import { bot } from '../botbase';
import { processArticle, TABLE, db } from "./model";
import { pageFromCategoryEvent, Route } from "../eventstream-router/app";

/**
 * Keep the db updated with new GA promotions and demotions.
 */
export default class gans extends Route {

	async init() {
		super.init();
		this.log(`[S] Started`);
		await bot.getSiteInfo();
	}

	filter(data) {
		return data.wiki === 'enwiki' &&
			data.type === 'categorize' &&
			data.title === 'Category:Good articles';
	}

	worker(data) {
		const {title, added} = pageFromCategoryEvent(data);
		if (added) {
			this.processAddition(title);
		} else {
			this.processRemoval(title);
		}
	}

	async processAddition(article) {
		try {
			const [nom, date, fallbackStrategy] = await processArticle(article);
			this.log(`[S] [[${article}]]: nom: "${nom}", date: ${date}` + (fallbackStrategy ? ' (by fallback strategy)': ''));
		} catch(_) {
			this.log(`[E] New GA [[${article}]]: nominator not found`);
			// whine
		}
	}

	async processRemoval(article) {
		this.log(`[S] Removing [[${article}]] from database if present`);
		db.run(`DELETE FROM ${TABLE} WHERE article = ?`, [article]);
	}
}
