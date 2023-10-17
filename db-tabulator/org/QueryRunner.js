"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runQuery = void 0;
const botbase_1 = require("../../botbase");
const consts_1 = require("./consts");
const utils_1 = require("./utils");
const utils_2 = require("../../utils");
const queriesLog = utils_2.createLogStream('queries.log');
async function runQuery() {
    let query = `SET STATEMENT max_statement_time = ${consts_1.QUERY_TIMEOUT} FOR ${this.config.sql.trim()}`;
    queriesLog(`Page: [[${this.page}]], context: ${this.context}, query: ${query}`);
    return utils_1.db.timedQuery(query).then(([timeTaken, queryResult]) => {
        const timeTakenFormatted = timeTaken.toFixed(2);
        botbase_1.log(`[+] ${this}: Took ${timeTakenFormatted} seconds`);
        return [queryResult, timeTakenFormatted];
    }).catch(async (err) => {
        if (err.sqlMessage) {
            // SQL server error
            let message = `SQL Error: ${err.code || ''}: ${err.sqlMessage}`;
            if (err.errno === 1969) {
                // max_statement_time exceeded
                message += ` - ${consts_1.BOT_NAME} applies a timeout of ${consts_1.QUERY_TIMEOUT} seconds on all queries.`;
            }
            else if (err.errno === 1040) {
                // too many connections (should not happen)
                botbase_1.log(`[E] Too Many Connections Error!`);
                throw err;
            }
            else {
                message += ` – Consider using [https://quarry.wmflabs.org/ Quarry] to to test your SQL.`;
            }
            return this.saveWithError(message);
        }
        else {
            throw err;
        }
    });
}
exports.runQuery = runQuery;
//# sourceMappingURL=QueryRunner.js.map