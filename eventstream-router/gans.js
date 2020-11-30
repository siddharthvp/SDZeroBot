"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.worker = exports.filter = exports.init = void 0;
const botbase_1 = require("../botbase");
const utils_1 = require("./utils");
let log, db;
async function init() {
    log = utils_1.streamLog.bind(botbase_1.fs.createWriteStream('./gans.out', { flags: 'a', encoding: 'utf8' }));
    log(`[S] Started`);
    await botbase_1.bot.getSiteInfo();
    db = new botbase_1.toolsdb('goodarticles_p').init();
    /**
     * This table should exist already (created by a most-gans.ts):
     * CREATE TABLE IF NOT EXISTS nominators(
            article VARCHAR(255) PRIMARY KEY,
            nominator VARCHAR(255)
        ) COLLATE 'utf8_unicode_ci'
     *
     */
}
exports.init = init;
function filter(data) {
    return data.wiki === 'enwiki' &&
        data.type === 'categorize' &&
        data.title === 'Category:Good_articles';
}
exports.filter = filter;
async function worker(data) {
    let match = /^\[\[:(.*?)\]\] (added|removed)/.exec(data.comment);
    let article = match[1];
    if (match[2] === 'added') {
        processAddition(article);
    }
    else if (match[2] === 'removed') {
        processRemoval(article);
    }
    else {
        // should never happen
        return Promise.reject(`${article} neither an additon nor removal?`);
    }
}
exports.worker = worker;
async function processAddition(article) {
    const GANregex = /\{\{GA ?(c(andidate)?|n(om(inee)?)?)\s*(\||\}\})/i;
    let talkpage = new botbase_1.bot.page(new botbase_1.bot.page(article).getTalkPage());
    let talkpageedits = talkpage.historyGen(['content', 'user', 'timestamp'], 100, { rvsection: '0', rvlimit: 100 } // one-pass
    );
    let GA_template_seen = false, GA_user = null;
    for await (let rev of talkpageedits) {
        let GAN_template_present = GANregex.test(rev.content);
        if (GAN_template_present) {
            GA_template_seen = true;
            GA_user = rev.user;
        }
        else {
            if (GA_template_seen) {
                break;
            }
        }
    }
    if (!GA_user) {
        log(`[E] "${article}": nominator not found`);
        // whine
    }
    else {
        log(`[S] "${article}": found "${GA_user}"`);
        db.run(`REPLACE INTO nominators VALUES(?, ?)`, [article, GA_user]);
        return Promise.resolve();
    }
}
async function processRemoval(article) {
    db.run(`DELETE FROM nominators WHERE article = ?`, [article]);
}
//# sourceMappingURL=gans.js.map