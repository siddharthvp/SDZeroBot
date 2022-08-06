import { bot, log } from '../botbase';
import { closeTunnels, createLocalSSHTunnel } from "../utils";
import { TOOLS_DB_HOST } from "../db";
import { processArticle, TABLE, db } from "./model";

bot.setOptions({
	silent: true,
	suppressAPIWarnings: true,
	defaultParams: {
		maxlag: 999
	}
});

(async function () {
	await createLocalSSHTunnel(TOOLS_DB_HOST);
	await bot.getSiteInfo();

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

	await db.run(`DROP TABLE IF EXISTS ${TABLE}`);
	await db.run(`CREATE TABLE ${TABLE} (
						  article   VARCHAR(255),
						  nominator VARCHAR(255),
						  date   DATE,
						  lastUpdate DATE,
						  PRIMARY KEY (article)
					  ) COLLATE 'utf8_unicode_ci'`);

	let authorNotFound = [];

	await bot.batchOperation(articles, async (article, idx) => {
		if (idx % 1000 === 0) {
			log(`[i] Processing article #${idx + 1}`);
		}
		try {
			const [nom, date, fallbackStrategy] = await processArticle(article);
			log(`[S] [[${article}]]: nom: ${nom}, date: ${date}` + (fallbackStrategy ? ' (by fallback strategy)': ''));
		} catch(_) {
			log(`[E] ${article}: nominator not found`);
			authorNotFound.push(article);
			return Promise.reject();
		}
	}, 40);

	log(`Identified GA nominator for ${articles.length - authorNotFound.length} GAs out of ${articles.length} total.`);

	await bot.getTokens();
	await bot.save('User:SDZeroBot/Wikipedians by most GANs/Errors/1',
		`No GA nominator could be identified for the following articles:
	
${authorNotFound.map(p => `#[[${p}]]`).join('\n')}
`);
	log(`[S] Saved error list on-wiki`);

	closeTunnels();

})();
