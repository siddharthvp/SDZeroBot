import { argv, bot, emailOnError, enwikidb, log, mwn } from "../botbase";
import { readFile, writeFile } from "../filesystem";
import { Template } from "../../mwn/build/wikitext";
import { BOT_NAME, FAKE_INPUT_FILE, FAKE_OUTPUT_FILE, QUERY_TIMEOUT, TEMPLATE_END } from "./consts";
import { spawn } from "child_process";

let db = new enwikidb({
	connectionLimit: 10
}).init();

export class Query {

	/// Step 1. Parse the query
	/// Step 2. Run the query
	/// Step 3. Format the result
	/// Step 4. Save the page

	page: string;
	template: Template;
	sql: string;
	wikilinkConfig: {columnIndex: number, namespace: number, showNamespace: boolean}[] | null;
	widths: number[];

	constructor(template: Template, page: string) {
		this.page = page;
		this.template = template;
	}

	async process() {
		try {
			try {
				this.parseQuery(this.template);
			} catch (err) {
				if (err instanceof InputError) {
					return this.saveWithError(err.message);
				} else throw err;
			}
			const result = await this.runQuery();
			const resultText = this.formatResults(result);
			await this.save(resultText);
		} catch (err) {
			emailOnError(err, 'quarry2wp');
			log(`[E] Unexpected error:`);
			log(err);
			throw err; // propagate error
		}
	}

	parseQuery(template: Template) {
		this.sql = template.getValue('sql');

		this.wikilinkConfig = template.getValue('wikilinks')
			?.split(',')
			.map(e => {
				const [columnIndex, namespace, showHide] = e.trim().split(':');
				const config = {
					columnIndex: parseInt(columnIndex),
					namespace: namespace ? parseInt(namespace) : 0,
					showNamespace: showHide === 'show'
				};
				if (isNaN(config.namespace)) {
					throw new InputError(`Invalid namespace number: ${config.namespace}. See [[WP:NS]] for namespace numbers`);
				}
				if (isNaN(config.columnIndex)) {
					throw new InputError(`Invalid column number: ${config.columnIndex}.`);
				}
				return config;
			});
	}

	async runQuery() {
		let query = `SET STATEMENT max_statement_time = ${QUERY_TIMEOUT} FOR ${this.sql.trim()}`;
		return db.query(query).catch(async (err: SQLError) => {
			if (err.code === 'ECONNREFUSED' && process.env.LOCAL) {
				return this.spawnLocalSSHTunnel();
			} else if (err.errno) {
				// SQL server error
				let message = 'SQL Error: ' + err.sqlMessage;
				if (err.errno === 1969) {
					// max_statement_time exceeded
					message += `- ${BOT_NAME} applies a timeout of ${QUERY_TIMEOUT} seconds on all queries.`;
				} else if (err.errno === 1040) {
					// too many connections (should not happen)
					log(`[E] Too Many Connections Error!`);
					throw err;
				} else {
					message += `Consider using Quarry to to test your SQL.`;
				}
				return this.saveWithError(message);
			} else {
				throw err;
			}
		});
	}

	// For local dev
	static sshTunnelSpawned = false;
	async spawnLocalSSHTunnel() {
		if (Query.sshTunnelSpawned) {
			await bot.sleep(3000);
			return this.runQuery();
		}
		log('[i] No local SSH tunnel? Spawning...');
		// relies on "ssh toolforge" command connecting successfully
		spawn('ssh', ['-L', '4711:enwiki.analytics.db.svc.eqiad.wmflabs:3306', 'toolforge'], {
			detached: true
		});
		Query.sshTunnelSpawned = true;
		await bot.sleep(3000);
		return this.runQuery();
	}

	formatResults(result) {

		let table = new mwn.table();
		if (result.length === 0) {
			return 'No items retrieved.'; // XXX
		}

		// for(let {column, ns, colIdx} of this.excerptFields) {
		// 	this.columns.splice(colIdx, 0, 'Excerpt'); // XXX: make that customisable!
		// }

		// Add links
		this.wikilinkConfig?.forEach(({columnIndex, namespace, showNamespace}) => {
			result = result.map((row) => {
				return Object.fromEntries(Object.entries(row).map(([key, value], colIdx) => {
					if (columnIndex === colIdx + 1) {
						let pageName = new bot.title(value, namespace).toText();
						return showNamespace
							? [key, `[[${pageName}]]`]
							: [key, `[[${pageName}|${value}]]`];
					} else {
						return [key, value];
					}
				}));
			});
		});

		table.addHeaders(Object.keys(result[0]).map((columnName) => {
			let columnConfig = {
				label: columnName
			};
			// if (this.widths[idx]) {
			// 	columnConfig.style = `width: ${this.widths[idx]};`;
			// }
			return columnConfig;
		}));

		for(let row of result) {
			table.addRow(Object.values(row));
		}
		return table.getText() + '\n' +
			'----\n' +
			'&sum; ' + result.length + ' items.\n';
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
			log(`[W] Couldn't save to ${this.page} due to error ${err.code}`);
			if (err.code !== 'protectedpage') {
				return this.saveWithError(err.message);
			} else throw err;
		}

	}

	async saveWithError(message: string) {
		await this.save(`{{error|[${message}]}}`, true);
	}

	insertResultIntoPageText(text: string, queryResult: string) {
		let beginTemplateStartIdx = text.indexOf(this.template.wikitext);
		if (beginTemplateStartIdx === -1) {
			// edit conflict?
			throw new Error('Failed to find config');
		}
		let beginTemplateEndIdx = beginTemplateStartIdx + this.template.wikitext.length;
		let endTemplateStartIdx = text.indexOf(`{{${TEMPLATE_END}}}`, beginTemplateEndIdx);
		if (endTemplateStartIdx === -1) { // caps, XXX
			endTemplateStartIdx = text.indexOf(`{{${lowerfirst(TEMPLATE_END)}}}`, beginTemplateEndIdx);
		}
		let textToReplace = text.slice(
			beginTemplateEndIdx,
			endTemplateStartIdx === -1 ? undefined : endTemplateStartIdx
		);
		return text.slice(0, beginTemplateEndIdx) +
			text.slice(beginTemplateEndIdx).replace(textToReplace, '\n' + queryResult.replace(/\$/g, '$$$$'));
	}
}

export class InputError extends Error {
	constructor(msg) {
		super(msg);
	}
}


export class SQLError extends Error {
	code: string;
	errno: number;
	fatal: boolean;
	sql: string;
	sqlState: string;
	sqlMessage: string;
}

function lowerfirst(str: string) {
	return str[0].toLowerCase() + str.slice(1);
}
