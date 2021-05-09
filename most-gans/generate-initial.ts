import { bot, log, mwn, toolsdb } from '../botbase';

(async function () {
	await bot.getSiteInfo();
	bot.options.suppressAPIWarnings = true;
	bot.options.defaultParams.maxlag = 999;

	let articles: string[] = (await bot.continuedQuery({
		"action": "query",
		"list": "categorymembers",
		"cmtitle": "Category:Good articles",
		"cmlimit": "max",
		"cmtype": "page"
	}, 40).then(jsons => {
		return jsons.reduce((articles, json) => {
			return articles.concat(json.query.categorymembers.map(pg => pg.title));
		}, []);
	}));

	const GANregex = /\{\{GA ?(c(andidate)?|n(om(inee)?)?)\s*(\||\}\})/i;
	let table: { [user: string]: number } = {};
	let authorNotFound = [];
	let db = new toolsdb('goodarticles_p').init();
	await db.run(`CREATE TABLE IF NOT EXISTS nominators (
						  article   VARCHAR(255),
						  nominator VARCHAR(255),
						  PRIMARY KEY (article)
					  ) COLLATE 'utf8_unicode_ci'`);
	await bot.batchOperation(articles, async (article) => {
		let talkpage = new bot.page(new bot.page(article).getTalkPage());
		let talkpageedits = talkpage.historyGen(
			['content', 'user', 'timestamp'],
			{rvsection: '0', rvlimit: 100} // one-pass
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
			log(`[E] ${article}: nominator not found`);
			authorNotFound.push(article);
			return Promise.reject();
		} else {
			log(`[S] ${article}: found ${GA_user}`);
			db.run(`REPLACE INTO nominators VALUES (?, ?)`, [article, GA_user]);
			if (table[GA_user]) table[GA_user]++; else table[GA_user] = 1;
			return Promise.resolve();
		}
	}, 40, 0);

	await bot.getTokens();

	// let wikitable = new mwn.table();
	// wikitable.addHeaders(['Rank', 'User', 'Count']);
	//
	// Object.entries(table).sort((a, b) => {
	// 	return a[1] < b[1] ? 1 : -1;
	// }).slice(0, 500).forEach((r, idx) => {
	// 	wikitable.addRow([
	// 		String(idx + 1),
	// 		`[[User:${r[0]}|${r[0]}]]`,
	// 		String(r[1])
	// 	]);
	// });

	// 	await bot.save('User:SDZeroBot/Wikipedians by most GANs',
	// `Updated ${new bot.date().format('D MMMM YYYY')}. Identified GA nominator for ${articles.length -
	// authorNotFound.length} GAs out of ${articles.length} total. See [[/Errors]] for a list of pages whose GA
	// nominator could not be identified.  ${wikitable.getText()} `);

	await bot.save('User:SDZeroBot/Wikipedians by most GANs/Errors/1',
		`No GA nominator could be identified for the following articles:
	
${authorNotFound.map(p => `*[[${p}]]`).join('\n')}
`);

	process.exit();

})();
