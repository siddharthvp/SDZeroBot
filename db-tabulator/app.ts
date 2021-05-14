import { argv, bot, emailOnError, log, mwn, TextExtractor } from "../botbase";
import { enwikidb, SQLError } from "../db";
import { Template } from "../../mwn/build/wikitext";
import { arrayChunk, lowerFirst, readFile, writeFile } from "../utils";

export const BOT_NAME = 'SDZeroBot';
export const TEMPLATE = 'User:SDZeroBot/Database report';
export const TEMPLATE_END = 'User:SDZeroBot/Database report end';
export const SUBSCRIPTIONS_CATEGORY = 'SDZeroBot database report subscriptions';
export const QUERY_TIMEOUT = 600;
export const FAKE_INPUT_FILE = 'fake-configs.wikitext';
export const FAKE_OUTPUT_FILE = 'fake-output.wikitext';

export const db = new enwikidb({
	connectionLimit: 10
}).init();

export async function fetchQueries(): Promise<Record<string, Query[]>> {
	if (argv.fake) {
		let text = readFile(FAKE_INPUT_FILE);
		return { 'Fake-Configs': getQueriesFromText(text, 'Fake-Configs') };
	}
	let allQueries: Record<string, Query[]> = {};
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
		allQueries[pg.title] = getQueriesFromText(text, pg.title);
	}
	return allQueries;
}

function getQueriesFromText(text: string, title: string): Query[] {
	let templates = bot.wikitext.parseTemplates(text, {
		namePredicate: name => name === TEMPLATE
	});
	if (templates.length === 0) {
		log(`[E] Failed to parse template on ${title}`);
		return [];
	}
	return templates.map(template => new Query(template, title));
}

export async function processQueries(allQueries: Record<string, Query[]>) {
	await bot.batchOperation(Object.entries(allQueries), async ([page, queries]) => {
		log(`[+] Processing page ${page}`);
		await processQueriesForPage(queries);
	}, 10);
}

export async function fetchQueriesForPage(page: string): Promise<Query[]> {
	// Only work in bot/op userspaces until BRFA approval
	if (!page.startsWith('User:SD0001/') && page.startsWith('User:SDZeroBot/')) {
		return null;
	}
	let text = (await bot.read(page))?.revisions?.[0]?.content;
	if (!text) {
		return null;
	}
	return getQueriesFromText(text, page);
}

// All queries are on same page. Processing is done sequentially
// to avoid edit-conflicting with self.
export async function processQueriesForPage(queries: Query[]) {
	let index = 0;
	for (let query of queries) {
		if (++index !== 1) log(`[+] Processing query ${index} on ${query.page}`);
		await query.process().catch(() => {});
	}
}

class Query {

	/// Step 1. Parse the query
	/// Step 2. Run the query
	/// Step 3. Format the result
	/// Step 4. Save the page

	page: string;
	template: Template;
	sql: string;
	wikilinkConfig: Array<{columnIndex: number, namespace: number, showNamespace: boolean}>;
	excerptConfig: Array<{srcIndex: number, destIndex: number, namespace: number, charLimit: number, charHardLimit: number}>;
	warnings: string[] = [];

	constructor(template: Template, page: string) {
		this.page = page;
		this.template = template;
	}

	async process() {
		try {
			this.parseQuery();
			const result = await this.runQuery();
			const resultText = await this.formatResults(result);
			await this.save(resultText);
		} catch (err) {
			if (err instanceof HandledError) return;
			emailOnError(err, 'quarry2wp');
			throw err; // propagate error
		}
	}

	getTemplateValue(param: string) {
		return this.template.getValue(param)?.replace(/<!--.*?-->/g, '').trim();
	}

	parseQuery() {
		if (process.env.CRON && ['manual', 'no'].includes(this.getTemplateValue('update').toLowerCase())) {
			log(`[+] Skipping ${this.page} as automatic updates are disabled.`);
			throw new HandledError();
		}

		// remove semicolons to disallow multiple SQL statements used together
		this.sql = this.getTemplateValue('sql').replace(/;/g, '');

		this.wikilinkConfig = this.getTemplateValue('wikilinks')
			?.split(',')
			.map(e => {
				const [columnIndex, namespace, showHide] = e.trim().split(':');
				return {
					columnIndex: parseInt(columnIndex),
					namespace: namespace ? parseInt(namespace) : 0,
					showNamespace: showHide === 'show'
				};
			})
			.filter(config => {
				if (isNaN(config.namespace)) {
					this.warnings.push(`Invalid namespace number: ${config.namespace}. Refer to [[WP:NS]] for namespace numbers`);
					return false;
				} else if (isNaN(config.columnIndex)) {
					this.warnings.push(`Invalid column number: ${config.columnIndex}.`);
					return false;
				}
				return true;
			}) || [];

		this.excerptConfig = this.getTemplateValue('excerpts')
			?.split(',')
			.map(e => {
				const [srcIndex, destIndex, namespace, charLimit, charHardLimit] = e.trim().split(':');
				const config = {
					srcIndex: parseInt(srcIndex),
					destIndex: destIndex ? parseInt(destIndex) : parseInt(srcIndex) + 1,
					namespace: namespace ? parseInt(namespace) : 0,
					charLimit: charLimit ? parseInt(charLimit) : 250,
					charHardLimit: charHardLimit ? parseInt(charHardLimit) : 500
				};
				if (
					isNaN(config.srcIndex) || isNaN(config.destIndex) || isNaN(config.namespace) ||
					isNaN(config.charLimit) || isNaN(config.charHardLimit)
				) {
					this.warnings.push(`Invalid excerpt config: one or more numeral values found in: <code>${e}</code>. Ignoring.`);
					return null;
				} else {
					return config;
				}
			})
			.filter(e => e) // filter out nulls
			|| [];
	}

	async runQuery() {
		let query = `SET STATEMENT max_statement_time = ${QUERY_TIMEOUT} FOR ${this.sql.trim()}`;
		return db.query(query).catch(async (err: SQLError) => {
			if (err.sqlMessage) {
				// SQL server error
				let message = `SQL Error: ${err.code || ''}: ${err.sqlMessage}`;
				if (err.errno === 1969) {
					// max_statement_time exceeded
					message += ` - ${BOT_NAME} applies a timeout of ${QUERY_TIMEOUT} seconds on all queries.`;
				} else if (err.errno === 1040) {
					// too many connections (should not happen)
					log(`[E] Too Many Connections Error!`);
					throw err;
				} else {
					message += ` – Consider using [https://quarry.wmflabs.org/ Quarry] to to test your SQL.`;
				}
				return this.saveWithError(message);
			} else {
				throw err;
			}
		});
	}

	transformColumn(result: Array<Record<string, string>>, columnIdx: number, transformer: (cell: string) => string): Array<Record<string, string>> {
		return result.map((row) => {
			return Object.fromEntries(Object.entries(row).map(([key, value], colIdx) => {
				if (columnIdx === colIdx + 1) {
					return [key, transformer(value)];
				} else {
					return [key, value];
				}
			}));
		});
	}

	/**
	 * Add column at given `columnIdx`. Move existing columns at columnIdx and later one place rightwards.
	 */
	addColumn(result: Array<Record<string, string>>, columnIdx: number, contents: string[]): Array<Record<string, string>> {
		return result.map((row, idx) => {
			let newRow = Object.entries(row);
			newRow.splice(columnIdx - 1, 0, ['Excerpt', contents[idx]]);
			return Object.fromEntries(newRow);
		});
	}

	async fetchExcerpts(pages: string[], charLimit: number, charHardLimit: number): Promise<string[]> {
		let excerpts: Record<string, string> = {};
		for (let pageSet of arrayChunk(pages, 100)) {
			for await (let pg of bot.readGen(pageSet, {
				rvsection: 0,
				redirects: false
			})) {
				if (pg.invalid || pg.missing) {
					excerpts[pg.title] = '';
				} else {
					excerpts[pg.title] = TextExtractor.getExtract(pg.revisions[0].content, charLimit, charHardLimit);
				}
			}
		}
		// Order of pages in API output will be different from the order we have
		return pages.map(pg => {
			// XXX: will page name in pages array always match pg.title from API?
			if (excerpts[pg] !== undefined) {
				return '<small>' + excerpts[pg] + '</small>';
			} else {
				log(`[W] no excerpt found for ${pg} while processing query on ${this.page}`);
				return '';
			}
		});
	}

	async formatResults(result) {

		let table = new mwn.table({
			style: this.getTemplateValue('table_style') || 'overflow-wrap: anywhere'
		});

		if (result.length === 0) {
			return 'No items retrieved.'; // XXX
		}

		let numColumns = Object.keys(result[0]).length;
		for (let i = 1; i <= numColumns; i++) {
			// Stringify everything
			result = this.transformColumn(result, i, (value: string | number | null | Date) => {
				if (value === null) return '';
				if (value instanceof Date) return value.toISOString(); // is this ever possible?
				return String(value);
			});
		}

		// Add excerpts
		for (let {srcIndex, destIndex, namespace, charLimit, charHardLimit} of this.excerptConfig) {
			result = this.transformColumn(result, srcIndex, pageName => pageName.replace(/_/g, ' '));
			const listOfPages = result.map(row => {
				try {
					return new bot.page(Object.values(row)[srcIndex - 1] as string, namespace).toText()
				} catch (e) { return '::'; } // new bot.page() failing, use invalid page name so that
				// fetchExcerpts return empty string extract
			});
			const excerpts = await this.fetchExcerpts(listOfPages, charLimit, charHardLimit);
			result = this.addColumn(result, destIndex, excerpts);
		}

		// Number of columns increased due to excerpts
		numColumns += this.excerptConfig.length;

		// Add links
		this.wikilinkConfig.forEach(({columnIndex, namespace, showNamespace}) => {
			result = this.transformColumn(result, columnIndex, value => {
				try {
					let pageName = new bot.title(value, namespace).toText();
					return showNamespace ? `[[${pageName}]]` : `[[${pageName}|${value.replace(/_/g, ' ')}]]`;
				} catch (e) {
					return value.replace(/_/g, ' ');
				}
			});
		});

		this.getTemplateValue('remove_underscores')?.split(',').forEach(num => {
			let columnIndex = parseInt(num.trim());
			if (isNaN(columnIndex)) {
				this.warnings.push(`Found non-numeral value in <code>remove_underscores</code>: "${num}". Ignoring. Please use a comma-separated list of column numbers`);
			} else if (columnIndex > numColumns) {
				this.warnings.push(`Found "${num}" in <code>remove_underscores</code> though the table only has ${numColumns} column{{subst:plural:${numColumns}||s}}. Ignoring.`);
			} else {
				result = this.transformColumn(result, columnIndex, value => value.replace(/_/g, ' '));
			}
		});

		let widths = this.getTemplateValue('widths')?.split(',').map(e => {
			let [colIdx, width] = e.split(':');
			return {
				column: parseInt(colIdx),
				width: width
			};
		});

		table.addHeaders(Object.keys(result[0]).map((columnName, columnIndex) => {
			let columnConfig: {label: string, style?: string} = {
				label: columnName,
			};
			let width = widths?.find(e => e.column === columnIndex + 1)?.width;
			if (width) {
				columnConfig.style = `width: ${width}`;
			}
			return columnConfig;
		}));

		for (let row of result) {
			table.addRow(Object.values(row));
		}

		// Get DB replag, but no need to do this any more than once in 6 hours (when triggered via
		// webservice or eventstream-router).
		if (
			db.replagHours === undefined ||
			db.replagHoursCalculatedTime.isBefore(new bot.date().subtract(6, 'hours'))
		) {
			await db.getReplagHours();
		}

		return this.warnings.map(text => `[WARN: ${text}]\n\n`).join('') +
			db.makeReplagMessage(2) +
			TextExtractor.finalSanitise(table.getText()) + '\n' +
			'----\n' +
			'&sum; ' + result.length + ' items.';
	}

	async save(queryResult: string, isError = false) {
		let page = new bot.page(this.page);
		if (argv.fake) {
			writeFile(
				FAKE_OUTPUT_FILE,
				this.insertResultIntoPageText(
					readFile(FAKE_OUTPUT_FILE) || readFile(FAKE_INPUT_FILE),
					queryResult
				)
			);
			return;
		}
		try {
			await page.edit(rev => {
				let text = rev.content;
				let newText = this.insertResultIntoPageText(text, queryResult);
				return {
					text: newText,
					summary: isError ? 'Encountered error in database report update' : 'Updating database report'
				};
			});
		} catch (err) {
			if (isError) { // error on an error logging attempt, just throw now
				throw err;
			}
			// In case of errors like `contenttoobig` we can still edit the page
			// to add the error message, but not in case of errors like protectedpage
			log(`[E] Couldn't save to ${this.page} due to error ${err.code}`);
			log(err);
			if (err.code !== 'protectedpage') {
				return this.saveWithError(`Error while saving report: ${err.message}`);
			} else throw err;
		}

	}

	async saveWithError(message: string) {
		await this.save(`{{error|[${message}]}}`, true);
		throw new HandledError();
	}

	insertResultIntoPageText(text: string, queryResult: string) {
		// Does not support the case of two template uses with very same wikitext
		let beginTemplateStartIdx = text.indexOf(this.template.wikitext);
		if (beginTemplateStartIdx === -1) {
			throw new Error(`Failed to find template in wikitext on page ${this.page}`);
		}
		let beginTemplateEndIdx = beginTemplateStartIdx + this.template.wikitext.length;
		let endTemplateStartIdx = text.indexOf(`{{${TEMPLATE_END}}}`, beginTemplateEndIdx);
		if (endTemplateStartIdx === -1) { // caps, XXX
			endTemplateStartIdx = text.indexOf(`{{${lowerFirst(TEMPLATE_END)}}}`, beginTemplateEndIdx);
		}
		let textToReplace = text.slice(
			beginTemplateEndIdx,
			endTemplateStartIdx === -1 ? undefined : endTemplateStartIdx
		);
		return text.slice(0, beginTemplateEndIdx) +
			text.slice(beginTemplateEndIdx).replace(textToReplace, '\n' + queryResult.replace(/\$/g, '$$$$') + '\n');
	}
}

// hacky way to prevent further execution in process(), but not actually report as error
class HandledError extends Error {}
