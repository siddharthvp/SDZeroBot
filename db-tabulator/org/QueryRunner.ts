import {log} from "../../botbase";
import {SQLError} from "../../db";
import {BOT_NAME, QUERY_TIMEOUT} from "./consts";
import {db} from "./utils";
import {createLogStream} from "../../utils";

const queriesLog = createLogStream('queries.log');

export async function runQuery() {
    let query = `SET STATEMENT max_statement_time = ${QUERY_TIMEOUT} FOR ${this.config.sql.trim()}`;
    queriesLog(`Page: [[${this.page}]], context: ${this.context}, query: ${query}`);
    return db.timedQuery(query).then(([timeTaken, queryResult]) => {
        const timeTakenFormatted = timeTaken.toFixed(2);
        log(`[+] ${this}: Took ${timeTakenFormatted} seconds`);
        return [queryResult, timeTakenFormatted] as [Array<Record<string, string | number>>, string];
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
