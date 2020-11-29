import {bot, log, mwn} from './botbase';

(async function () {
	await bot.getTokensAndSiteInfo();
	bot.options.suppressAPIWarnings = true;

	let articles = (await bot.continuedQuery({
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

	const GANregex = /\{\{GA ?(candidate|n(om(inee)?)?)(\|.*?)?\}\}/i;
	let table: {[user: string]: number} = {};
	let authorNotFound = [];
	await bot.batchOperation(articles, async (article) => {
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
			log(`[E] ${article}: not found`);
			authorNotFound.push(article);
			return Promise.reject();
		} else {
			log(`[S] ${article}: found ${GA_user}`);
			if (table[GA_user]) table[GA_user]++;
			else table[GA_user] = 1;
			return Promise.resolve();
		}
	}, 40, 0);

	await bot.sleep(600000);
	await bot.getTokensAndSiteInfo();

	let wikitable = new mwn.table();
	wikitable.addHeaders(['User', 'Count']);

	Object.entries(table).sort((a, b) => {
		return a[1] < b[1] ? 1 : -1;
	}).slice(0, 500).forEach(r => {
		wikitable.addRow([ `[[User:${r[0]}|${r[0]}]]`, String(r[1]) ]);
	});

	await bot.save('User:SDZeroBot/Wikipedians by most GANs',
`Updated ${new bot.date().format('D MMMM YYYY')}. Identified GA nominator for ${articles.length - authorNotFound.length} GAs out of ${articles.length} total. See [[/Errors]] for a list of pages whose GA nominator could not be identified.

${wikitable.getText()}
`);

	await bot.save('User:SDZeroBot/Wikipedians by most GANs/Errors',
`No GA nominator could be identified for the following articles:
	
${authorNotFound.map(p => `*[[${p}]]`).join('\n')}
`);

})();
