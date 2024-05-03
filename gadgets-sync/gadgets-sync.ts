import {argv, bot, log, Mwn} from "../botbase";
import {setIntersection} from "../utils";

const header = `
/******************************************************************************/
/**** THIS PAGE TRACKS [[$SOURCE]]. PLEASE AVOID EDITING DIRECTLY. 
/**** EDITS SHOULD BE PROPOSED DIRECTLY to [[$SOURCE]].
/**** A BOT WILL RAISE AN EDIT REQUEST IF IT BECOMES DIFFERENT FROM UPSTREAM.
/******************************************************************************/

`

const CONFIG_PAGE = 'User:SDZeroBot/Gadgets-sync-config.json'

async function getConfig() {
    if (argv.test) {
        return require('./test-config.json')
    }
    const content = (await bot.read(CONFIG_PAGE)).revisions[0].content
    return JSON.parse(content)
}

const editReqCategories = new Set([
    'Wikipedia_interface-protected_edit_requests',
    'Wikipedia_fully_protected_edit_requests',
    'Wikipedia_template-protected_edit_requests',
]);

(async function () {
    await bot.getTokensAndSiteInfo()
    const allConfigs = await getConfig()
    for (const conf of allConfigs.list) {
        // Validations
        const talkTitle = bot.Title.newFromText(conf.talkPage)
        if (!talkTitle || talkTitle.getNamespaceId() % 2 !== 1) {
            log(`[E] Invalid talkPage: ${conf.talkPage}`)
            continue
        }

        let source, destination;
        try {
            source = await bot.rawRequest({
                url: `https://en.wikipedia.org/w/index.php?title=${conf.source}&action=raw`
            })
        } catch (e) {
            if (e.code === 404) {
                log(`[E] ${conf.source} does not exist. Skipping.`)
                continue
            } else throw e;
        }
        try {
            destination = await bot.rawRequest({
                url: `https://en.wikipedia.org/w/index.php?title=${conf.page}&action=raw`
            })
        }  catch (e) {
            if (e.response.status === 404) {
                log(`[E] ${conf.page} does not exist. Skipping.`)
                continue
            } else throw e;
        }

        const substitutedHeader = header.replaceAll('$SOURCE', conf.source)

        if (source.data !== destination.data.replace('^' + Mwn.util.escapeRegExp(substitutedHeader), '')) {
            if (await new bot.Page(talkTitle).exists()) {
                let talkCategories = (await new bot.Page(talkTitle).categories()).map(e => e.category)
                if (setIntersection(talkCategories, editReqCategories).size > 0) {
                    log(`[+] Open edit request already exists on ${conf.talkPage}, skipping`)
                    continue
                }
                log(`[+] [[${conf.page}]] does not match [[${conf.source}]]`)

                // Copy the file locally so that a Special:ComparePages link can be generated
                const syncPage = `User:SDZeroBot/sync/${conf.page}`
                const syncPageData = substitutedHeader + source.data
                const saveResult = await bot.save(syncPage, syncPageData, `Copying from [[${conf.source}]]`)

                const comparePagesLink = `https://en.wikipedia.org/wiki/Special:ComparePages?page1=${encodeURIComponent(conf.page)}&page2=${encodeURIComponent(syncPage)}&rev2=${saveResult.newrevid}`

                await bot.newSection(conf.talkPage, `Sync request {{subst:#time:Y-m-d}}`,
                    `{{sudo|page=${conf.page}|answered=false}} Please sync [[${conf.page}]] with [[${syncPage}]] ([${comparePagesLink} diff]). This brings it in sync with the upstream changes at [[${conf.source}]] ([[Special:PageHistory/${conf.source}|hist]]).\n\nThis edit request is raised automatically based on the configuration at [[${CONFIG_PAGE}]]. Thanks, ~~~~`)
                log(`[S] Created edit request on [[${conf.talkPage}]]`)
            } else {
                log(`[E] ${conf.talkPage} does not exist. Skipping.`)
            }
        }
    }
}())
