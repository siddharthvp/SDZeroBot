"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchExcerpts = void 0;
const utils_1 = require("../../utils");
const botbase_1 = require("../../botbase");
async function fetchExcerpts(pages, charLimit, charHardLimit) {
    let excerpts = {};
    for (let pageSet of utils_1.arrayChunk(pages, 100)) {
        for await (let pg of botbase_1.bot.readGen(pageSet, {
            rvsection: 0,
            redirects: false
        })) {
            if (pg.invalid || pg.missing) {
                excerpts[pg.title] = '';
            }
            else {
                excerpts[pg.title] = botbase_1.TextExtractor.getExtract(pg.revisions[0].content, charLimit, charHardLimit);
            }
        }
    }
    // Order of pages in API output will be different from the order we have
    return pages.map(pg => {
        // XXX: will page name in pages array always match pg.title from API?
        if (excerpts[pg] !== undefined) {
            return '<small>' + excerpts[pg] + '</small>';
        }
        else {
            botbase_1.log(`[W] no excerpt found for ${pg}`);
            return '';
        }
    });
}
exports.fetchExcerpts = fetchExcerpts;
//# sourceMappingURL=enrichers.js.map