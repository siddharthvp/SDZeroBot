import {arrayChunk} from "../../utils";
import {bot, log, TextExtractor} from "../../botbase";

export async function fetchExcerpts(pages: string[], charLimit: number, charHardLimit: number): Promise<string[]> {
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
            log(`[W] no excerpt found for ${pg}`);
            return '';
        }
    });
}
