import { argv, bot, log, mwn } from '../botbase';
import { enwikidb, ENWIKI_DB_HOST } from "../db";
import { createLocalSSHTunnel, readFile, saveObject, writeFile } from "../utils";

(async function () {

	let data: Record<string, any> = {};

	if (argv.nodb) {
		data = JSON.parse(readFile(__dirname + '/../data.json'));
	} else {
		await createLocalSSHTunnel(ENWIKI_DB_HOST);
		await bot.sleep(2000);
		let db = new enwikidb().init();

		let table = await db.query(`
			select sub.page_title, count(*) as "num_editors"
			from (select page_title, count(*) as user_edits
				  from revision
						   join page on rev_page = page_id
						   join actor on rev_actor = actor_id
						   join user on actor_user = user_id
				  where page_namespace = 108
					and page_is_redirect = 0
				  group by page_id, user_id
				 ) as sub
			group by page_title
		`);

		// let table = Table.fromData(dbResult);

		for(let row of table) {
			data[row.page_title] = {
				num_editors: row.num_editors
			};
		}
		// TODO: implement Table#merge(table: Table, on: string, columns: string[])

		table = await db.query(`
			select page_title, count(*) as num_revisions
			from page
					 join revision on rev_page = page_id
			where page_namespace = 108
			  and page_is_redirect = 0
			group by page_id
		`);

		for(let row of table) {
			data[row.page_title].num_revisions = row.num_revisions;
		}

		await bot.getSiteInfo();
		bot.setOptions({silent: true});
		await bot.batchOperation(Object.keys(data), async function worker(page, idx) {
			if (idx % 100 === 0) log(`[i] Processing page #${idx + 1}`);
			try {
				const viewData = await new bot.page('Book:' + page).pageViews({
					granularity: 'monthly'
				});
				data[page].pageviews = viewData.reduce((accu, cur) => {
					return accu + cur.views;
				}, 0);
			} catch (e) {
				data[page].pageviews = 'N/A';
				if (e.response.status === 429) { // uh-oh
					await bot.sleep(10000);
					return worker(page, idx);
				}
				console.error(e.response.status, e.response.statusText, e.response.data);
				throw [e.response.status, e.response.statusText, e.response.data];
			}
		}, 50);

	}

	// let massquery = bot.massQueryGen({
	// 	action: 'query',
	// 	prop: 'pageviews',
	// 	titles: Object.keys(data).map(t => 'Book:' + t.replace(/_/g, ' ')).slice(0, 100),
	// 	pvipmetric: 'pageviews',
	// 	pvipdays: 30
	// }, 'titles', 40);
	//
	// for await (let json of massquery) {
	// 	json.query.pages.forEach(pg => {
	// 		if (!pg.pageviews ) {
	// 			log(`[E] No pageviews for ${pg.title}`);
	// 			return true;
	// 		}
	// 		data[pg.title.slice('Book:'.length).replace(/ /g, '_')].pageviews = Object.values(pg.pageviews).reduce((accu, cur) => {
	// 			return accu + (cur === null ? 0 : cur);
	// 		}, 0);
	// 	})
	// }

	let wikitable = new mwn.table({
		classes: ['plainlinks']
	});
	wikitable.addHeaders([
		'Title',
		'Number of revisions',
		'Number of editors*',
		'Pageviews (30 days)'
	]);
	for (let [title, {num_editors, num_revisions, pageviews}] of Object.entries(data)) {
		title = 'Book:' + title.replace(/_/g, ' ');
		wikitable.addRow([
			`[[${title}]]`,
			`[https://en.wikipedia.org/w/index.php?title=${mwn.util.wikiUrlencode(title)}&action=history ${num_revisions}]`,
			num_editors,
			`[https://en.wikipedia.org/w/index.php?title=${mwn.util.wikiUrlencode(title)}&action=info ${pageviews}]`
		]);
	}

	let text = wikitable.getText();
	writeFile('./books-output.wikitext', text);


})();
