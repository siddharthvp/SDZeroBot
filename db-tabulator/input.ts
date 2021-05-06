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
		let text = pg.revisions[0].content;
		queries = queries.concat(getQueriesFromText(text, pg.title));
	}
	return queries;
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

