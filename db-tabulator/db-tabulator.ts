import {bot, enwikidb, mwn} from "../botbase";
import {Template} from "../../mwn/src/wikitext";

/**
 * Specs:
 *
 * Support setting table attributes and widths for each column
 * Support linkification of items --done
 * Support article extracts
 * Support multiple tables on a page
 * Report back query errors to the user
 * Report the first results immediately on setup (Use EventStream)
 *
 */

let db: enwikidb

(async function () {

	await bot.getTokensAndSiteInfo();
	db = new enwikidb().init();

	let pages = (await new bot.page('User:SDZeroBot/Database report').transclusions());

	let queries = [];
	for await (let pg of bot.readGen(pages)) {
		let text = pg.revisions[0].content;
		let templates = bot.wikitext.parseTemplates(text, {
			namePredicate: name => name === 'User:SDZeroBot/Database report'
		});
		for (let template of templates) {
			queries.push(new Query(template, pg.title));
		}
	}

})();

class InputError extends Error {
	constructor(msg) {
		super(msg);
	}
}

// WILL NEED TO FIGURE OUT A WAY TO STRUCTURE ALL THIS!

class Column {
	name: string
	values: string[]
	format: string
	link: null | {
		ns: number
		withNs: boolean
	}
	excerpt: null | {
		ns: number
		name: string
		index: number
	}

	applyFormatting(entries) {
		return entries.map(t => {
			return this.format.replace(/\$1/g, t.replace(/$/g, '$$$$'));
		});
	}

	async addExcerpts(entries: string[]) {
		let reader = bot.readGen(entries,{
			rvsection: '0'
		});
		for await (let pg of reader) {
			if (pg.missing) {
				return
			}
		}
	}

	addLinks(entries: string[]) {
		let linkedItems = entries.map((pg) => {
			let target = new bot.page(pg, this.link.ns);
			if (this.link.withNs) {
				return `[[${target.toText()}]]`;
			} else {
				return `[[${target.toText()}|${target.getMainText()}]]`;
			}
		});
	}
}

class Query {
	page: string
	wikitext: string
	sql: string
	wikilinkFields: {column: string, ns: number}[]
	excerptFields: {column: string, ns: number, colIdx: number}[]
	columns: Column[]
	widths: number[]

	constructor(template: Template, page: string) {
		this.sql = template.getValue('sql');
		this.page = page;
		this.wikitext = template.wikitext;

		this.wikilinkFields = [];
		this.excerptFields = [];

		let widths = template.getValue('widths');
		if (widths) {
			this.widths = widths.split(',').map(w => w.trim());
		}

		template.parameters.forEach(p => {

			// Linkify settings
			let match = /wikilink(\d?)$/i.exec(String(p.name));
			if (match) {
				let num = match[1];
				let nsParamName = 'wikilink' + (num || '') + '-ns';
				let ns = template.getValue(nsParamName);
				let nsNum;
				if (!ns) {
					nsNum = 0;
				} else if (isNaN(parseInt(ns))) {
					nsNum = bot.title.nameIdMap[ns];
					if (!nsNum) {
						throw new InputError(`Invalid namespace: ${nsParamName}: ${ns}`);
					}
				} else {
					nsNum = parseInt(ns);
				}
				this.wikilinkFields.push({
					column: p.value,
					ns: nsNum
				});
			}

			// Excerpt settings
			match = /excerpt(\d?)$/i.exec(String(p.name));
			if (match) {
				let num = match[1];
				let nsParamName = 'wikilink' + (num || '') + '-ns';
				let ns = template.getValue(nsParamName);
				let nsNum;
				if (!ns) {
					nsNum = 0;
				} else if (isNaN(parseInt(ns))) {
					nsNum = bot.title.nameIdMap[ns];
					if (!nsNum) {
						throw new InputError(`Invalid namespace: ${nsParamName}: ${ns}`);
					}
				} else {
					nsNum = parseInt(ns);
				}
				let col = template.getValue('excerpt' + (num || '') + '-col');
				let colIdx;
				if (col && !isNaN(parseInt(col))) {
					colIdx = parseInt(col);
				}
				this.excerptFields.push({
					column: p.value,
					ns: nsNum,
					colIdx
				});
			}
		});

	}

	async query() {
		let query = `SET MAX_STATEMENT_TIME=600 for ${this.query}`;
		let result = await db.query(query);

		let table = new mwn.table();
		if (result.length === 0) {
			return 'No items retrieved.'; // XXX
		}

		this.columns = Object.keys(result[0]);

		for (let {column, ns, colIdx} of this.excerptFields) {
			this.columns.splice(colIdx, 0, 'Excerpt'); // XXX: make that customisable!
		}

		let cols = this.columns.map((col, idx) => {
			let colConfig = {
				label: col
			};
			if (this.widths[idx]) {
				colConfig.style = `width: ${this.widths[idx]};`;
			}
		});

		// Add links
		// Add excerpts

		table.addHeaders(cols);
		for (let row of result) {
			table.addRow(Object.values(row));
		}
		return table.getText();


	}

	async save() {
		let page = new bot.page(this.page);
		await page.edit((async rev => {
			let text = rev.content;
			text = text.replace(this.wikitext, await this.query());
			return text;
		}));
	}
}
