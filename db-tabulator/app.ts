import { argv, bot, emailOnError, log, Mwn, TextExtractor } from "../botbase";
import { enwikidb, SQLError } from "../db";
import { Template } from "../../mwn/build/wikitext";
import { arrayChunk, createLogStream, lowerFirst, readFile, stripOuterNowikis, writeFile } from "../utils";
import {NS_CATEGORY, NS_FILE, NS_MAIN} from "../namespaces";
import { formatSummary } from "../reports/commons";
import {MetadataStore} from "./MetadataStore";
import {HybridMetadataStore} from "./HybridMetadataStore";
import {applyJsPreprocessing, processQueriesExternally} from "./preprocess";

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

export const metadataStore: MetadataStore = new HybridMetadataStore();

export async function fetchQueries(): Promise<Record<string, Query[]>> {
	if (argv.fake) {
		let text = readFile(FAKE_INPUT_FILE);
		return { 'Fake-Configs': getQueriesFromText(text, 'Fake-Configs') };
	}
	return metadataStore.getQueriesToRun();
}

export function getQueriesFromText(text: string, title: string): Query[] {
	let templates = bot.wikitext.parseTemplates(text, {
		namePredicate: name => name === TEMPLATE
	});
	if (templates.length === 0) {
		log(`[E] Failed to find template on ${title}`);
		return [];
	}
	return templates.map((template, idx) =>
		new Query(template, title, idx + 1, !!template.getValue('preprocess_js')?.trim()));
}

export async function processQueries(allQueries: Record<string, Query[]>) {
	await bot.batchOperation(Object.entries(allQueries), async ([page, queries]) => {
		if (queries.filter(q => q.needsExternalRun).length > 0) {
			// Needs an external process for security
			log(`[+] Processing page ${page} using child process`);
			await processQueriesExternally(page);
		} else {
			log(`[+] Processing page ${page}`);
			await processQueriesForPage(queries);
		}
	}, CONCURRENCY);
}

export async function fetchQueriesForPage(page: string): Promise<Query[]> {
	if (argv.fake) {
		return getQueriesFromText(readFile(FAKE_INPUT_FILE), 'Fake-Configs');
	}
	let text = (await bot.read(page, { redirects: false }))?.revisions?.[0]?.content;
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
		sql?: string;
		outputPage?: string;
		wikilinks?: Array<{columnIndex: number, namespace: string, showNamespace: boolean}>;
		excerpts?: Array<{srcIndex: number, destIndex: number, namespace: string, charLimit: number, charHardLimit: number}>;
		comments?: number[];
		pagination?: number;
		maxPages?: number;
		removeUnderscores?: number[];
		hiddenColumns?: number[];
		interval?: number;
		silent?: boolean;
	} = {};

	isValid = true;

	/** Warnings generated while template parsing or result formatting, to be added to the page */
	warnings: string[] = [];

	/** Total number of pages in the report (for paginated queries) */
	numPages: number;

	/** Invocation mode */
	context: string;

	/** Internal tracking: for edit summary */
	endNotFound = false;

	/** Internal tracking: for queries with JS preprocessing enabled */
	needsExternalRun = false;
	needsForceKill = false;

	constructor(template: Template, page: string, idxOnPage: number, external?: boolean) {
		this.page = page;
		this.template = template;
		this.idx = idxOnPage;
		this.needsExternalRun = external;
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
			await metadataStore.updateLastTimestamp(this);
		} catch (err) {
			if (err instanceof HandledError) return;
			emailOnError(err, 'db-tabulator');
			throw err; // propagate error
		}
	}

	getTemplateValue(param: string) {
		return this.template.getValue(param)?.replace(/<!--.*?-->/g, '').trim();
	}

	getSql() {
		let sql = this.getTemplateValue('sql');
		if (/^\s*<nowiki ?>/.test(sql)) {
			return stripOuterNowikis(sql);
		} else {
			// @deprecated
			return sql
				// Allow pipes to be written as {{!}}
				?.replace(/\{\{!\}\}/g, '|');
		}
	}

	// Errors in configs are reported to user through [[Module:Database report]] in Lua
	parseQuery() {
		this.config.interval = parseInt(this.getTemplateValue('interval'));

		// Use of semicolons for multiple statements will be flagged as error at query runtime
		this.config.sql = this.getSql();

		if (!this.config.sql) {
			this.isValid = false;
			return;
		}

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

		let outputPage = this.getTemplateValue('output_page');
		if (outputPage && isFinite(this.config.pagination)) {
			let thisTitle = new bot.title(this.page);
			let outputTitle = new bot.title(this.config.outputPage);
			if (outputTitle.toText().startsWith(thisTitle.toText() + '/')) {
				this.config.outputPage = outputPage;
			}
		}

		this.config.silent = !!this.getTemplateValue('silent');

		return this;
	}

	async runQuery() {
		let query = `SET STATEMENT max_statement_time = ${QUERY_TIMEOUT} FOR ${this.config.sql.trim()}`;
		query = this.appendLimit(query);
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

	appendLimit(query: string): string {
		if (!Number.isFinite(this.config.pagination)) {
			return query;
		}
		let proposedLimit = this.config.pagination * this.config.maxPages;

		let endRgx = /(?:limit\s+(\d+))?;?\s*$/i; // can either the limit clause or just a semicolon
		let matchResult = query.match(endRgx);
		if (matchResult?.[1]) {
			let existingLimit = parseInt(matchResult[1]);
			proposedLimit = Math.min(existingLimit, proposedLimit);
		}
		return query.replace(endRgx, '') + ` LIMIT ${proposedLimit}`;
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
		if (this.getTemplateValue('preprocess_js')) {
			const jsCode = stripOuterNowikis(this.getTemplateValue('preprocess_js'));
			try {
				result = await applyJsPreprocessing(result, jsCode, this.toString(), this);
			} catch (e) {
				log(`[E] Error in applyJsPreprocessing`);
				log(e);
			}
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
				let title = bot.title.makeTitle(nsId ?? Number(Object.values(result[rowIdx])[nsColNumber]), value);
				if (!title) {
					return value.replace(/_/g, ' ');
				}
				// title.getNamespaceId() need not be same as namespace passed to bot.title.makeTitle
				let colon = [NS_CATEGORY, NS_FILE].includes(title.getNamespaceId()) ? ':' : '';
				let pageName = title.toText();
				return (showNamespace || title.getNamespaceId() === NS_MAIN) ?
					`[[${colon}${pageName}]]` : `[[${colon}${pageName}|${value.replace(/_/g, ' ')}]]`;
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
		const row_template_named_params = this.getTemplateValue('row_template_named_params')
		const header_template = this.getTemplateValue('header_template');
		const footer_template = this.getTemplateValue('footer_template');
		const skip_table = this.getTemplateValue('skip_table');
		const table_style = this.getTemplateValue('table_style') || 'overflow-wrap: anywhere';
		const table_class = (this.getTemplateValue('table_class') || 'wikitable sortable')
			.split(/\s+/g).map(e => e.trim()).filter(e => e);

		let table: InstanceType<typeof Mwn.table>;
		let tableText = '';

		// NOTE: header_template appears:
		// - above table start if row_template is not being used
		// - below table start if row_template is being used
		if (header_template && (skip_table || !row_template)) {
			tableText = '{{' + header_template + '}}\n';
		}
		if (!skip_table) {
			table = new Mwn.table({
				style: table_style,
				classes: table_class,
				sortable: table_class.includes('sortable'),
				plain: !table_class.includes('wikitable')
			});
			if (header_template && row_template) {
				tableText += table.text + '{{' + header_template + '}}\n';
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
			}
		}

		if (row_template) {
			if (!skip_table && !header_template) {
				// Add table top structure.
				// Not applicable if skip_table is used.
				// If header_template is there, tableText already include table top structure by now.
				tableText += table.text;
			}
			for (let row of result) {
				if (row_template_named_params) {
					tableText += '{{' + row_template + Object.entries(row).map(([key, val]) => `|${key}=` + val).join('') + '}}\n';
				} else {
					tableText += '{{' + row_template + Object.values(row).map((val, idx) => `|${idx + 1}=` + val).join('') + '}}\n';
				}
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
			tableText += TextExtractor.finalSanitise(table.getText());
		}

		if (skip_table && footer_template) {
			tableText += '{{' + footer_template + '}}\n';
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
			(this.config.silent ? '' : '----\n' +
				Mwn.template('Database report/footer', {
					count: result.length,
					page: pageNumber && String(pageNumber),
					num_pages: pageNumber && String(this.numPages),
					query_runtime: this.queryRuntime,
					last_updated: new bot.date().format('D MMMM YYYY HH:mm') + ' (UTC)',
				})
			);
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
		let outputPage = this.config.outputPage || this.page;
		let page = new bot.page(outputPage);
		let firstPageResult = Array.isArray(queryResult) ? queryResult[0] : queryResult;
		try {
			await page.edit(rev => {
				let text = rev.content;
				let newText = this.insertResultIntoPageText(text, firstPageResult);
				return {
					text: newText,
					summary: this.generateEditSummary(isError)
				};
			});
		} catch (err) {
			if (isError) { // error on an error logging attempt, just throw now
				throw err;
			}
			// In case of errors like `contenttoobig` we can still edit the page
			// to add the error message, but not in case of errors like protectedpage
			log(`[E] Couldn't save to ${outputPage} due to error ${err.code}`);
			log(err);
			if (err.code === 'protectedpage') {
				throw err;
			}
			return this.saveWithError(`Error while saving report: ${err.message}`);
		}
		if (Array.isArray(queryResult)) { // paginated result (output_page is not applicable in this case)
			for (let [idx, resultText] of Object.entries(queryResult)) {
				let pageNumber = parseInt(idx) + 1;
				if (pageNumber ===  1) continue; // already saved above
				let subpage = new bot.page(outputPage + '/' + pageNumber);
				await subpage.save(
					`{{Database report/subpage|page=${pageNumber}|num_pages=${this.numPages}}}\n` +
					resultText,
					'Updating database report'
				);
			}
			for (let i = this.numPages + 1; i <= MAX_SUBPAGES; i++) {
				let subpage = new bot.page(outputPage + '/' + i);
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

	generateEditSummary(isError: boolean) {
		const updateMode =
			this.context === 'web' ? 'web triggered' :
				this.context === 'cron' ? 'periodic update' :
					this.context === 'eventstream' ? 'new transclusion' :
						'manual';
		const endNotFoundNote = this.endNotFound ?
			', overwriting rest of page as end template not found' : '';
		return (isError ? 'Encountered error in updating database report' : 'Updating database report')
			+ ': ' + updateMode + endNotFoundNote;
	}

	async saveWithError(message: string): Promise<never> {
		await this.save(`{{error|1=[${message}]}}`, true);
		throw new HandledError();
	}

	insertResultIntoPageText(text: string, queryResult: string) {
		if (this.config.outputPage) {
			return queryResult;
		}
		// Does not support the case of two template usages with very same wikitext
		let beginTemplateStartIdx = text.indexOf(this.template.wikitext);
		if (beginTemplateStartIdx === -1) {
			throw new Error(`Failed to find template in wikitext on page ${this.page}`);
		}
		let beginTemplateEndIdx = beginTemplateStartIdx + this.template.wikitext.length;
		let endTemplateStartIdx = text.indexOf(`{{${TEMPLATE_END}}}`, beginTemplateEndIdx);
		if (endTemplateStartIdx === -1) { // caps, XXX
			endTemplateStartIdx = text.indexOf(`{{${lowerFirst(TEMPLATE_END)}}}`, beginTemplateEndIdx);
			if (endTemplateStartIdx === -1) {
				// Still no? Record for edit summary
				this.endNotFound = true;
			}
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
