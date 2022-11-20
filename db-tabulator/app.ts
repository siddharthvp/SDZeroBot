import { argv, bot, emailOnError, log, mwn, TextExtractor } from "../botbase";
import { enwikidb, SQLError } from "../db";
import { Template } from "../../mwn/build/wikitext";
import { arrayChunk, createLogStream, lowerFirst, readFile, writeFile } from "../utils";
import {NS_CATEGORY, NS_FILE, NS_MAIN} from "../namespaces";
import { MwnDate } from "../../mwn/build/date";
import { formatSummary } from "../reports/commons";

export const BOT_NAME = 'SDZeroBot';
export const TEMPLATE = 'Database report';
export const TEMPLATE_END = 'Database report end';
export const SUBSCRIPTIONS_CATEGORY = 'SDZeroBot database report subscriptions';
export const QUERY_TIMEOUT = 600;
export const CONCURRENCY = 5;
export const MAX_SUBPAGES = 20;
export const SHUTOFF_PAGE = 'User:SDZeroBot/Shutoff/Database reports';
export const FAKE_INPUT_FILE = 'fake-configs.wikitext';
export const FAKE_OUTPUT_FILE = 'fake-output.wikitext';

const db = new enwikidb({
	connectionLimit: CONCURRENCY
});

export async function fetchQueries(): Promise<Record<string, Query[]>> {
	if (argv.fake) {
		let text = readFile(FAKE_INPUT_FILE);
		return { 'Fake-Configs': getQueriesFromText(text, 'Fake-Configs') };
	}
	let allQueries: Record<string, Query[]> = {};
	let pages = (await new bot.page('Template:' + TEMPLATE).transclusions());
	for await (let pg of bot.readGen(pages)) {
		if (pg.ns === 0) { // sanity check: don't work in mainspace
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
		log(`[E] Failed to find template on ${title}`);
		return [];
	}
	return templates.map((template, idx) => new Query(template, title, idx + 1));
}

let lastEditsData: Record<string, MwnDate>;

// Called from the cronjob
export async function processQueries(allQueries: Record<string, Query[]>) {
	await db.getReplagHours();
	// Get the date of the bot's last edit to each of the subscribed pages
	// The API doesn't have an efficient query for this, so using the DB instead
	let [timeTaken, lastEditsDb] = await db.timedQuery(`
		SELECT page_namespace, page_title,
			(SELECT MAX(rc_timestamp) FROM recentchanges_userindex
			 JOIN actor_recentchanges ON rc_actor = actor_id AND actor_name = ?
			 WHERE rc_namespace = page_namespace AND rc_title = page_title
			) AS last_edit
		FROM page 
		JOIN categorylinks ON cl_from = page_id AND cl_to = ?
	`, [BOT_NAME, SUBSCRIPTIONS_CATEGORY.replace(/ /g, '_')]);
	log(`[i] Retrieved last edits data. DB query took ${timeTaken.toFixed(2)} seconds.`);

	lastEditsData = Object.fromEntries(lastEditsDb.map((row) => [
		new bot.page(row.page_title as string, row.page_namespace as number).toText(),
		row.last_edit && new bot.date(row.last_edit)
	]));

	await bot.batchOperation(Object.entries(allQueries), async ([page, queries]) => {
		log(`[+] Processing page ${page}`);
		await processQueriesForPage(queries);
	}, CONCURRENCY);
}

export async function fetchQueriesForPage(page: string): Promise<Query[]> {
	let text = (await bot.read(page))?.revisions?.[0]?.content;
	if (!text) {
		return [];
	}
	return getQueriesFromText(text, page);
}

// All queries are on same page. Processing is done sequentially
// to avoid edit-conflicting with self.
export async function processQueriesForPage(queries: Query[]) {
	for (let query of queries) {
		if (query.idx !== 1) log(`[+] Processing query ${query.idx} on ${query.page}`);
		await query.process().catch(() => {});
	}
}

export async function checkShutoff() {
	let text = (await bot.read(SHUTOFF_PAGE))?.revisions?.[0]?.content;
	return text?.trim();
}

const queriesLog = createLogStream('queries.log');

export class Query {

	/// Step 1. Parse the query
	/// Step 2. Run the query
	/// Step 3. Format the result
	/// Step 4. Save the page

	/** Page on which the query exists */
	page: string;

	/** Index of the query on the page (1 if only one query on the page) */
	idx: number;

	/** Time taken to run the SQL, formatted to 2 decimal places */
	queryRuntime: string;

	/** Represents the {{database report}} template placed on the page */
	template: Template;

	/** Configurations parsed from the template */
	config: {
		sql?: string
		wikilinks?: Array<{columnIndex: number, namespace: string, showNamespace: boolean}>;
		excerpts?: Array<{srcIndex: number, destIndex: number, namespace: string, charLimit: number, charHardLimit: number}>;
		comments?: number[];
		pagination?: number;
		maxPages?: number;
		removeUnderscores?: number[];
		hiddenColumns?: number[];
	} = {};

	/** Warnings generated while template parsing or result formatting, to be added to the page */
	warnings: string[] = [];

	/** Total number of pages in the report (for paginated queries) */
	numPages: number;

	/** Invocation mode */
	context: string;

	constructor(template: Template, page: string, idxOnPage: number) {
		this.page = page;
		this.template = template;
		this.idx = idxOnPage;
		this.context = getContext();
	}

	toString() {
		return this.page + (this.idx !== 1 ? ` (#${this.idx})` : '');
	}

	async process() {
		try {
			this.parseQuery();
			const result = await this.runQuery();
			const resultText = await this.formatResults(result);
			await this.save(resultText);
		} catch (err) {
			if (err instanceof HandledError) return;
			emailOnError(err, 'db-tabulator');
			throw err; // propagate error
		}
	}

	getTemplateValue(param: string) {
		return this.template.getValue(param)?.replace(/<!--.*?-->/g, '').trim();
	}

	static checkIfUpdateDue(lastUpdate: MwnDate, interval: number): boolean {
		if (!lastUpdate) {
			return true;
		}
		let daysDiff = (new bot.date().getTime() - lastUpdate.getTime())/8.64e7;
		return daysDiff >= interval - 0.5;
	}

	// Errors in configs are reported to user through [[Module:Database report]] in Lua
	parseQuery() {
		if (this.context === 'cron') {
			let interval = parseInt(this.getTemplateValue('interval'));
			if (isNaN(interval)) {
				log(`[+] Skipping ${this} as periodic updates are not configured`);
				throw new HandledError();
			}
			if (!Query.checkIfUpdateDue(lastEditsData[this.page], interval)) {
				log(`[+] Skipping ${this} as update is not due.`);
				throw new HandledError();
			}
		}

		// Use of semicolons for multiple statements will be flagged as error at query runtime
		this.config.sql = this.getTemplateValue('sql')
			// Allow pipes to be written as {{!}}
			.replace(/\{\{!\}\}/g, '|');

		this.config.wikilinks = this.getTemplateValue('wikilinks')
			?.split(',')
			.map(e => {
				const [columnIndex, namespace, showHide] = e.trim().split(':');
				return {
					columnIndex: parseInt(columnIndex),
					namespace: namespace || '0',
					showNamespace: showHide === 'show'
				};
			})
			.filter(config => /^c?\d+/i.test(config.namespace) && !isNaN(config.columnIndex)) || [];

		this.config.comments = this.getTemplateValue('comments')
			?.split(',')
			.map(e => parseInt(e.trim()))
			.filter(e => !isNaN(e)) || [];

		this.config.excerpts = this.getTemplateValue('excerpts')
			?.split(',')
			.map(e => {
				const [srcIndex, destIndex, namespace, charLimit, charHardLimit] = e.trim().split(':');
				return {
					srcIndex: parseInt(srcIndex),
					destIndex: destIndex ? parseInt(destIndex) : parseInt(srcIndex) + 1,
					namespace: namespace || '0',
					charLimit: charLimit ? parseInt(charLimit) : 250,
					charHardLimit: charHardLimit ? parseInt(charHardLimit) : 500
				};
			})
			.filter(config => !isNaN(config.srcIndex) && !isNaN(config.destIndex) && /^c?\d+/i.test(config.namespace) &&
				!isNaN(config.charLimit) && !isNaN(config.charHardLimit))
			|| [];

		this.config.hiddenColumns = this.getTemplateValue('hide')
			?.split(',')
			.map(e => parseInt(e.trim()))
			.filter(e => !isNaN(e)) || [];

		this.config.removeUnderscores = this.getTemplateValue('remove_underscores')
			?.split(',')
			.map(num => parseInt(num.trim()))
			.filter(e => !isNaN(e)) || [];

		this.config.pagination = parseInt(this.getTemplateValue('pagination'));
		if (isNaN(this.config.pagination)) {
			this.config.pagination = Infinity;
		}
		this.config.maxPages = Math.min(MAX_SUBPAGES,
			this.getTemplateValue('max_pages') ? parseInt(this.getTemplateValue('max_pages')) : 5
		);

	}

	async runQuery() {
		let query = `SET STATEMENT max_statement_time = ${QUERY_TIMEOUT} FOR ${this.config.sql.trim()}`;
		queriesLog(`Page: [[${this.page}]], context: ${this.context}, query: ${query}`);
		return db.timedQuery(query).then(([timeTaken, queryResult]) => {
			this.queryRuntime = timeTaken.toFixed(2);
			log(`[+] ${this}: Took ${this.queryRuntime} seconds`);
			return queryResult;
		}).catch(async (err: SQLError) => {
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

	transformColumn(result: Array<Record<string, string>>, columnIdx: number, transformer: (cell: string, rowIdx: number) => string): Array<Record<string, string>> {
		return result.map((row, rowIdx) => {
			return Object.fromEntries(Object.entries(row).map(([key, value], colIdx) => {
				if (columnIdx === colIdx + 1) {
					return [key, transformer(value, rowIdx)];
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

	removeColumn(result: Array<Record<string, string>>, columnIdx: number): Array<Record<string, string>> {
		return result.map((row) => {
			let newRow = Object.entries(row);
			newRow.splice(columnIdx - 1, 1);
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
				log(`[W] no excerpt found for ${pg} while processing query ${this}`);
				return '';
			}
		});
	}

	async formatResults(result) {

		if (result.length === 0) {
			return 'No items retrieved.'; // XXX
		}
		if (result.length > this.config.pagination) {
			const resultSets = arrayChunk(result, this.config.pagination).slice(0, this.config.maxPages);
			this.numPages = resultSets.length;
			const resultTexts: string[] = [];
			let pageNumber = 1;
			for (let resultSet of resultSets) {
				resultTexts.push(await this.formatResultSet(resultSet, pageNumber++));
			}
			return resultTexts;
		} else {
			this.numPages = 1;
			return this.formatResultSet(result, 0);
		}
	}

	async formatResultSet(result, pageNumber: number) {

		let numColumns = Object.keys(result[0]).length;
		for (let i = 1; i <= numColumns; i++) {
			// Stringify everything
			result = this.transformColumn(result, i, (value: string | number | null | Date) => {
				if (value === null) return '';
				if (value instanceof Date) return value.toISOString();
				return String(value);
			});
		}

		// Add excerpts
		for (let {srcIndex, destIndex, namespace, charLimit, charHardLimit} of this.config.excerpts) {
			result = this.transformColumn(result, srcIndex, pageName => pageName.replace(/_/g, ' '));
			let nsId, nsColNumber;
			if (!isNaN(parseInt(namespace))) {
				nsId = parseInt(namespace);
			} else {
				nsColNumber = parseInt(namespace.slice(1)) - 1;
			}
			const listOfPages = result.map((row) => {
				try {
					let cells = Object.values(row);
					return new bot.page(
						cells[srcIndex - 1] as string,
						nsId ?? Number(cells[nsColNumber])
					).toText();
				} catch (e) { return '::'; } // new bot.page() failing, use invalid page name so that
				// fetchExcerpts returns empty string extract
			});
			const excerpts = await this.fetchExcerpts(listOfPages, charLimit, charHardLimit);
			result = this.addColumn(result, destIndex, excerpts);
		}

		// Number of columns increased due to excerpts
		numColumns += this.config.excerpts.length;

		// Add links
		this.config.wikilinks.forEach(({columnIndex, namespace, showNamespace}) => {
			let nsId, nsColNumber;
			if (!isNaN(parseInt(namespace))) {
				nsId = parseInt(namespace);
			} else {
				nsColNumber = parseInt(namespace.slice(1)) - 1;
			}
			result = this.transformColumn(result, columnIndex, (value, rowIdx) => {
				try {
					let title = new bot.title(value, nsId ?? Number(Object.values(result[rowIdx])[nsColNumber]));
					// title.getNamespaceId() need not be same as namespace passed to new bot.title
					let colon = [NS_CATEGORY, NS_FILE].includes(title.getNamespaceId()) ? ':' : '';
					let pageName = title.toText();
					return (showNamespace || title.getNamespaceId() === NS_MAIN) ?
						`[[${colon}${pageName}]]` : `[[${colon}${pageName}|${value.replace(/_/g, ' ')}]]`;
				} catch (e) {
					return value.replace(/_/g, ' ');
				}
			});
		});

		// Format edit summaries / log action summaries
		this.config.comments.forEach(columnIndex => {
			result = this.transformColumn(result, columnIndex, (value) => {
				return formatSummary(value);
			});
		});

		this.config.removeUnderscores.forEach(columnIndex => {
			if (columnIndex > numColumns) {
				this.warnings.push(`Found "${columnIndex}" in <code>remove_underscores</code> though the table only has ${numColumns} column{{subst:plural:${numColumns}||s}}. Ignoring.`);
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

		// Last step: changes column numbers
		this.config.hiddenColumns.sort().forEach((columnIdx, idx) => {
			// columnIdx - idx because column numbering changes when one is removed
			result = this.removeColumn(result, columnIdx - idx);
		});

		const row_template = this.getTemplateValue('row_template');
		const header_template = this.getTemplateValue('header_template');
		const skip_table = this.getTemplateValue('skip_table');

		let table: InstanceType<typeof mwn.table>;
		let tableText = '';
		if (!skip_table) {
			table = new mwn.table({
				style: this.getTemplateValue('table_style') || 'overflow-wrap: anywhere'
			});
			if (header_template) {
				tableText = table.text + '{{' + header_template + '}}\n';
			} else {
				table.addHeaders(Object.keys(result[0]).map((columnName, columnIndex) => {
					let columnConfig: { label: string, style?: string } = {
						label: columnName,
					};
					let width = widths?.find(e => e.column === columnIndex + 1)?.width;
					if (width) {
						columnConfig.style = `width: ${width}`;
					}
					return columnConfig;
				}));
				tableText = table.text;
			}
		}

		if (row_template) {
			for (let row of result) {
				tableText += '{{' + row_template + Object.values(row).map((val, idx) => `|${idx + 1}=` + val).join('') + '}}\n';
			}
			if (!skip_table) {
				tableText += '|}'; // complete the table syntax
			}
		} else {
			if (skip_table) {
				// Using skip_table without row_template
				throw new HandledError(); // module shows the error on page
			}
			for (let row of result) {
				table.addRow(Object.values(row));
			}
			tableText = TextExtractor.finalSanitise(table.getText());
			// XXX: header gets skipped if header_template is used without row_template,
			// but module does show a warning
		}

		// Get DB replag, but no need to do this any more than once in 6 hours (when triggered via
		// webservice or eventstream-router).
		if (
			db.replagHours === undefined ||
			db.replagHoursCalculatedTime.isBefore(new bot.date().subtract(6, 'hours'))
		) {
			await db.getReplagHours();
		}

		let warningsText = this.warnings.map(text => `[WARN: ${text}]\n\n`).join('');

		return (pageNumber <= 1 ? warningsText : '') +
			db.makeReplagMessage(2) +
			tableText + '\n' +
			'----\n' +
			mwn.template('Database report/footer', {
				count: result.length,
				page: pageNumber && String(pageNumber),
				num_pages: pageNumber && String(this.numPages),
				query_runtime: String(this.queryRuntime)
			});
	}

	async save(queryResult: string | string[], isError = false) {
		if (argv.fake) {
			writeFile(
				FAKE_OUTPUT_FILE,
				this.insertResultIntoPageText(
					readFile(FAKE_OUTPUT_FILE) || readFile(FAKE_INPUT_FILE),
					queryResult as string
				)
			);
			return;
		}
		let page = new bot.page(this.page);
		let firstPageResult = Array.isArray(queryResult) ? queryResult[0] : queryResult;
		try {
			await page.edit(rev => {
				let text = rev.content;
				let newText = this.insertResultIntoPageText(text, firstPageResult);
				return {
					text: newText,
					summary: (isError ? 'Encountered error in updating database report' : 'Updating database report') + (
						this.context === 'web' ? ': web triggered' :
							this.context === 'cron' ? ': periodic update' :
								this.context === 'eventstream' ? ': new transclusion' :
									'manual'
					)
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
			if (err.code === 'protectedpage') {
				throw err;
			}
			return this.saveWithError(`Error while saving report: ${err.message}`);
		}
		if (Array.isArray(queryResult)) {
			for (let [idx, resultText] of Object.entries(queryResult)) {
				let pageNumber = parseInt(idx) + 1;
				if (pageNumber ===  1) continue; // already saved above
				let subpage = new bot.page(this.page + '/' + pageNumber);
				await subpage.save(
					`{{Database report/subpage|page=${pageNumber}|num_pages=${this.numPages}}}\n` +
					resultText,
					'Updating database report'
				);
			}
			for (let i = this.numPages + 1; i <= MAX_SUBPAGES; i++) {
				let subpage = new bot.page(this.page + '/' + i);
				let apiPage = await bot.read(subpage.toText());
				if (apiPage.missing) {
					break;
				}
				await subpage.save(
					`{{Database report/subpage|page=${i}|num_pages=${this.numPages}}}\n` +
					`{{Database report/footer|count=0|page=${i}|num_pages=${this.numPages}}}`,
					'Updating database report subpage - empty'
				);
			}
		}
	}

	async saveWithError(message: string): Promise<never> {
		await this.save(`{{error|1=[${message}]}}`, true);
		throw new HandledError();
	}

	insertResultIntoPageText(text: string, queryResult: string) {
		// Does not support the case of two template usages with very same wikitext
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

function getContext() {
	if (process.env.CRON) return 'cron';
	if (process.env.WEB) return 'web';
	if (process.env.EVENTSTREAM_ROUTER) return 'eventstream';
	return 'manual';
}
