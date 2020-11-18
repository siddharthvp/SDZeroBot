"use strict";
// start job using: npm run start
Object.defineProperty(exports, "__esModule", { value: true });
const botbase_1 = require("../botbase");
const { preprocessDraftForExtract } = require('../tasks/commons');
const TextExtractor = require('../TextExtractor')(botbase_1.bot);
const auth = require('../.auth');
function logError(err) {
    botbase_1.fs.appendFileSync('./errlog.txt', `\n[${new botbase_1.bot.date().format('YYYY-MM-DD HH:mm:ss')}]: ${err.stack}`);
}
function logWarning(evt) {
    try {
        const stringified = JSON.stringify(evt, null, 2);
        botbase_1.fs.appendFileSync('./warnlog.txt', `\n[${new botbase_1.bot.date().format('YYYY-MM-DD HH:mm:ss')}: ${stringified}`);
    }
    catch (e) { // JSON.stringify fails on circular object
        logError(e);
    }
}
async function main() {
    await botbase_1.bot.getSiteInfo();
    process.chdir(__dirname); // errlog and warnlog should go to /g13-watch
    botbase_1.log(`[S] Started`);
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
    // SELECT statement here returns a JS Date object
    const firstrowts = new botbase_1.bot.date((await pool.query(`SELECT ts FROM g13 ORDER BY ts DESC LIMIT 1`))?.[0]?.[0]?.ts);
    const tsUsable = firstrowts.isValid() && new botbase_1.bot.date().subtract(7, 'days').isBefore(firstrowts);
    botbase_1.log(`[i] firstrow ts: ${firstrowts}: ${tsUsable}`);
    let stream = new botbase_1.bot.stream('recentchange', {
        since: !botbase_1.argv.fromNow && tsUsable ? firstrowts : new botbase_1.bot.date().subtract(2, 'minutes'),
        onerror: evt => {
            botbase_1.log(`[W] event source encountered error: ${evt}`);
            console.log(evt);
            logWarning(evt);
        }
    });
    stream.addListener({
        wiki: 'enwiki',
        type: 'categorize',
        title: 'Category:Candidates for speedy deletion as abandoned drafts or AfC submissions'
    }, async (data) => {
        let match = /^\[\[:(.*?)\]\] added/.exec(data.comment);
        if (!match) {
            return;
        }
        let title = match[1];
        // data.timestamp is *seconds* since epoch
        // This date object will be passed to db
        let ts = data.timestamp ? new botbase_1.bot.date(data.timestamp * 1000) : null;
        botbase_1.log(`[+] Page ${title} at ${ts}`);
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
                botbase_1.log(`[W] ${title} entered category more than once`);
                return;
            }
            logError(err);
        }
        finally {
            await conn.release();
        }
    });
}
async function go() {
    await main().catch(err => {
        logError(err);
        go();
    });
}
go();
//# sourceMappingURL=save-to-db-new.js.map