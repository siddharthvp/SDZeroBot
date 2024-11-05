import {bot, emailOnError, log} from "../botbase";
import {ApiQueryCategoryInfoParams} from "types-mediawiki/api_params";
import {ElasticDataStore} from "../elasticsearch";
import {getKey, normalizeCategory} from "./util";

(async function () {
    const countStore = new ElasticDataStore('category-counts-enwiki');
    await bot.getTokensAndSiteInfo();

    const pg = await bot.read('User:SDZeroBot/Category counter');
    const text = pg.revisions[0].content;

    const templates = new bot.Wikitext(text).parseTemplates({
        namePredicate: name => name === 'User:SDZeroBot/Category counter/cat',
    });

    const names = templates.map(t => t.getParam(1).value);
    const namesNorm = names.map(name => normalizeCategory(name)).filter(Boolean);

    for await (let json of bot.massQueryGen({
        action: 'query',
        titles: namesNorm,
        prop: 'categoryinfo'
    } as ApiQueryCategoryInfoParams)) {

        for (let pg of json.query.pages) {
            if (pg.missing) continue;

            const count = pg.categoryinfo.size;
            const date = new bot.Date().format('YYYY-MM-DD', 'utc');

            const key = getKey(pg.title)
            try {
                await countStore.append(key, {
                    [date]: count
                });
            } catch (e) {
                log(`[E] Failed to insert count of ${count} for ${key}`);
                log(e);
            }
        }
    }

    // Backup data to NFS
    process.chdir(__dirname);
    fs.writeFileSync(
        `backups/category-counts-backup-${new bot.Date().format('YYYY-MM-DD', 'utc')}.json`,
        JSON.stringify(countStore.dump(), null, 2)
    );

})().catch(err => emailOnError(err, 'cat-counts'));
