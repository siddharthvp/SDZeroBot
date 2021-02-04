import {bot, toolsdb} from '../botbase';
import {Route} from "./route";

export default class gans extends Route {
	db: toolsdb;

	async init() {
		super.init();
		this.log(`[S] Started`);
		await bot.getSiteInfo();

		this.db = new toolsdb('goodarticles_p').init();
	}

	filter(data) {
		return data.wiki === 'enwiki' &&
			data.type === 'categorize' &&
			data.title === 'Category:Good articles';
	}

	worker(data) {
		let match = /^\[\[:(.*?)\]\] (added|removed)/.exec(data.comment);
		let article = match[1];
		if (match[2] === 'added') {
			this.processAddition(article);
		} else if (match[2] === 'removed') {
			this.processRemoval(article);
		} else {
			// should never happen
			return Promise.reject(`${article} neither an additon nor removal?`);
		}
	}


	async processAddition(article) {
		const GANregex = /\{\{(GA ?(c(andidate)?|n(om(inee)?)?)|Good article nominee)\s*(\||\}\})/i;
		let talkpage = new bot.page(new bot.page(article).getTalkPage());
		let talkpageedits = talkpage.historyGen(
			['content', 'user', 'timestamp'],
			100,
			{ rvsection: '0', rvlimit: 100 } // one-pass
		);
		let GA_template_seen = false, GA_user = null;
		for await (let rev of talkpageedits) {
			let GAN_template_present = GANregex.test(rev.content);
			if (GAN_template_present) {
				GA_template_seen = true;
				GA_user = rev.user;
			} else {
				if (GA_template_seen) {
					break;
				}
			}
		}
		if (!GA_user) {
			this.log(`[E] New GA [[${article}]]: nominator not found`);
			// whine
		} else {
			this.log(`[S] Adding [[${article}]]: nominator "${GA_user}"`);
			this.db.run(`REPLACE INTO nominators VALUES(?, ?)`, [article, GA_user]);
			return Promise.resolve();
		}
	}

	async processRemoval(article) {
		this.log(`[S] Removing [[${article}]] from database`);
		this.db.run(`DELETE FROM nominators WHERE article = ?`, [article]);
	}
}

