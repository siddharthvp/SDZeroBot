import {bot} from '../botbase';
import {processArticle, TABLE, db} from "./model";
import {pageFromCategoryEvent, Route} from "../eventstream-router/app";
import type {ResultSetHeader} from "mysql2";
import {NS_MAIN} from "../namespaces";

/**
 * Keep the db updated with new GA promotions and demotions.
 */
export default class Gans extends Route {
	name = "gans";

	async init() {
		super.init();
		this.log(`[S] Started`);
		await bot.getSiteInfo();
	}

	filter(data) {
		return data.wiki === 'enwiki' &&
			(
				(data.type === 'categorize' && data.title === 'Category:Good articles') ||
				(data.type === 'log' && (data.log_type === 'move' || data.log_type === 'renameuser'))
			);
	}

	worker(data) {
		if (data.type === 'categorize') {
			const {title, added} = pageFromCategoryEvent(data);
			if (added) {
				this.processAddition(title);
			} else {
				this.processRemoval(title);
			}

		} else if (data.log_type === 'move') {
			const oldTitle = data.title;
			const newTitle = data.log_params.target;
			this.processMove(oldTitle, newTitle);

		} else if (data.log_type === 'renameuser') {
			const oldUsername = data.log_params.olduser;
			const newUsername = data.log_params.newuser;
			this.processRename(oldUsername, newUsername);
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
		db.run(`DELETE FROM ${TABLE} WHERE article = ?`, [article]).catch(err => {
			this.log(`[E] Failed to remove [[${article}]]`);
			this.log(err);
		});
	}

	async processMove(oldTitle: string, newTitle: string) {
		const oldTitleObj = bot.Title.newFromText(oldTitle);
		if (oldTitleObj && oldTitleObj.getNamespaceId() !== NS_MAIN) {
			return;
		}
		db.run(`
			UPDATE ${TABLE} 
			SET article = ?, lastUpdate = UTC_TIMESTAMP()
			WHERE article = ?
		`, [newTitle, oldTitle]).then(result => {
			const affectedRows = (result?.[0] as ResultSetHeader)?.affectedRows;
			if (affectedRows > 0) {
				this.log(`[+] [[${oldTitle}]] moved to [[${newTitle}]]. Updated ${affectedRows} row(s).`);
			}
		}).catch(err => {
			this.log(`[E] Failed processing move: oldTitle: [[${oldTitle}]], newTitle: [[${newTitle}]]`);
			this.log(err);
		});
	}

	async processRename(oldUsername: string, newUsername: string) {
		db.run(`
			UPDATE ${TABLE} 
			SET nominator = ?, lastUpdate = UTC_TIMESTAMP()
			WHERE nominator = ?
		`, [oldUsername, newUsername]).then(result => {
			const affectedRows = (result?.[0] as ResultSetHeader)?.affectedRows;
			this.log(`[+] ${oldUsername} renamed to ${newUsername}. Updated ${affectedRows} row(s).`);
		}).catch(err => {
			this.log(`[E] Failed processing user rename: [[User:${oldUsername}]] to [[User:${newUsername}]]`);
			this.log(err);
		});
	}
}
