"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.worker = exports.filter = exports.init = void 0;
const botbase_1 = require("../botbase");
const utils_1 = require("./utils");
const { preprocessDraftForExtract } = require('../tasks/commons');
const TextExtractor = require('../TextExtractor')(botbase_1.bot);
const auth = require('../.auth');
let log, pool;
async function init() {
    log = utils_1.streamLog.bind(botbase_1.fs.createWriteStream('./g13-watch.out', { flags: 'a', encoding: 'utf8' }));
    log(`[S] Started`);
    await botbase_1.bot.getSiteInfo();
    pool = await initDb();
}
exports.init = init;
async function initDb() {
    // Create a pool, but almost all the time only one connection will be used
    // Each pool connection is released immediately after use
    const pool = botbase_1.mysql.createPool({
        host: 'tools.db.svc.eqiad.wmflabs',
        user: auth.db_user,
        password: auth.db_password,
        port: 3306,
        database: 's54328__g13watch_p',
        waitForConnections: true,
        connectionLimit: 5
    });
    await pool.execute(`
		CREATE TABLE IF NOT EXISTS g13(
			name VARCHAR(255) UNIQUE,
			description VARCHAR(255),
			excerpt BLOB,
			size INT,
			ts TIMESTAMP NOT NULL
		) COLLATE 'utf8_unicode_ci'
	`); // use utf8_unicode_ci so that MariaDb allows a varchar(255) field to have unique constraint
    // max index column size is 767 bytes. 255*3 = 765 bytes with utf8, 255*4 = 1020 bytes with utf8mb4
    return pool;
}
function filter(data) {
    return data.wiki === 'enwiki' &&
        data.type === 'categorize' &&
        data.title === 'Category:Candidates for speedy deletion as abandoned drafts or AfC submissions';
}
exports.filter = filter;
async function worker(data) {
    let match = /^\[\[:(.*?)\]\] added/.exec(data.comment);
    if (!match) {
        return;
    }
    let title = match[1];
    // data.timestamp is *seconds* since epoch
    // This date object will be passed to db
    let ts = data.timestamp ? new botbase_1.bot.date(data.timestamp * 1000) : null;
    log(`[+] Page ${title} at ${ts}`);
    let pagedata = await botbase_1.bot.read(title, {
        prop: 'revisions|description',
        rvprop: 'content|size'
    });
    let text = pagedata?.revisions?.[0]?.content ?? null;
    let size = pagedata?.revisions?.[0].size ?? null;
    let desc = pagedata?.description ?? null;
    if (desc && desc.size > 255) {
        desc = desc.slice(0, 250) + ' ...';
    }
    let extract = TextExtractor.getExtract(text, 300, 550, preprocessDraftForExtract);
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.execute(`INSERT INTO g13 VALUES(?, ?, ?, ?, ?)`, [title, desc, extract, size, ts]);
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            log(`[W] ${title} entered category more than once`);
            return;
        }
        log(err);
    }
    finally {
        await conn.release();
    }
}
exports.worker = worker;
//# sourceMappingURL=g13-watch.js.map