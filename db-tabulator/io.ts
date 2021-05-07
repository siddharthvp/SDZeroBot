import { bot, argv, fs, log } from "../botbase";
import { Query } from "./Query";
import { FAKE_INPUT_FILE, TEMPLATE } from "./consts";

export async function fetchQueries() {
	if (argv.fake) {
		let text = fs.readFileSync(FAKE_INPUT_FILE).toString();
		return getQueriesFromText(text, 'Fake-Configs');
	}
	let queries: Query[] = [];
	let pages = (await new bot.page(TEMPLATE).transclusions());
	for await (let pg of bot.readGen(pages)) {
		if (pg.ns === 0) { // sanity check: don't work in mainspace
			continue;
		}
		// Only work in bot/op userspaces until BRFA approval
		if (!pg.title.startsWith('User:SD0001/') && !pg.title.startsWith('User:SDZeroBot/')) {
			continue;
		}
		let text = pg.revisions[0].content;
		queries = queries.concat(getQueriesFromText(text, pg.title));
	}
	return queries;
}

export async function fetchQueriesForPage(page: string) {
	// Only work in bot/op userspaces until BRFA approval
	if (!page.startsWith('User:SD0001/') && page.startsWith('User:SDZeroBot/')) {
		return [];
	}
	let text = (await bot.read(page))?.revisions?.[0]?.content;
	if (!text) {
		return [];
	}
	return getQueriesFromText(text, page);
}

function getQueriesFromText(text: string, title: string) {
	let templates = bot.wikitext.parseTemplates(text, {
		namePredicate: name => name === TEMPLATE
	});
	if (templates.length === 0) {
		log(`[E] Failed to parse template on ${title}`);
		return [];
	}
	return templates.map(template => {
		return new Query(template, title);
	});
}

export async function processQueries(queries: Query[]) {
	await bot.batchOperation(queries, async (query) => {
		log(`[i] Processing page ${query.page}`);
		await query.process();
	}, 10);
}