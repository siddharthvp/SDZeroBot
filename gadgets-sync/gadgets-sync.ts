import {argv, bot, log} from "../botbase"
import * as querystring from "querystring"
import * as fs from "fs";

const header = `
/******************************************************************************/
/**** THIS PAGE TRACKS [[$SOURCE]]. PLEASE AVOID EDITING DIRECTLY. 
/**** EDITS SHOULD BE PROPOSED DIRECTLY to [[$SOURCE]].
/**** A BOT WILL RAISE AN EDIT REQUEST IF IT BECOMES DIFFERENT FROM UPSTREAM.
/******************************************************************************/

`

const CONFIG_PAGE = 'User:SDZeroBot/Gadgets-sync-config.json'

type Config = {
    description: string
    list: Array<{
        source: string
        page: string
        talkPage: string
    }>
}

async function getConfig(): Promise<Config> {
    if (argv.test) {
        return require('./test-config.json')
    }
    const content = (await bot.read(CONFIG_PAGE)).revisions[0].content
    return JSON.parse(content)
}

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

        const substitutedHeader = header.replaceAll('$SOURCE',
            conf.source.replace('/-/raw/', '/-/blob/'))

        let localCode, remoteCode
        try {
            let remote = await bot.rawRequest({
                url: `https://en.wikipedia.org/w/index.php?title=${conf.source}&action=raw`,
                timeout: 5000
            })
            remoteCode = remote.data.trim()
            // .trim() required for non-wiki remotes
        } catch (e) {
            if (e.response?.status === 404) {
                log(`[E] ${conf.source} does not exist. Skipping.`)
                continue
            } else throw e
        }

        try {
            let local = await bot.rawRequest({
                url: `https://en.wikipedia.org/w/index.php?title=${conf.page}&action=raw`,
                timeout: 5000
            })
            localCode = local.data.replace(substitutedHeader, '')
        }  catch (e) {
            if (e.response?.status === 404) {
                log(`[W] ${conf.page} does not exist. Treating as blank.`)
                localCode = ''
            } else throw e
        }

        if (remoteCode !== localCode) {
            const pg = await bot.read(talkTitle)
            if (!pg.missing && pg.revisions[0].content.includes(`{{sudo|1=${conf.page}|answered=no}}`)) {
                log(`[+] Open edit request already exists on ${conf.talkPage}, skipping`)
                continue
            }
            log(`[+] [[${conf.page}]] does not match [[${conf.source}]]`)

            // Copy the file locally so that a Special:ComparePages link can be generated
            const syncPage = `User:SDZeroBot/sync/${conf.page}`
            const syncPageData = substitutedHeader + remoteCode
            const saveResult = await bot.save(syncPage, syncPageData, `Copying from [[${conf.source}]] for comparison`)

            const comparePagesLink = `https://en.wikipedia.org/wiki/Special:ComparePages?` + querystring.stringify({
                page1: conf.page,
                rev1: localCode === '' ? '' : (await new bot.Page(conf.page).history(['ids'], 1))[0].revid,
                page2: syncPage,
                rev2: saveResult.newrevid
            })

            const date = new bot.Date().format('D MMMM YYYY')
            const isMatchingTalk = new bot.Page(conf.page).toText() === new bot.Title(conf.talkPage).getSubjectPage().toText()
            const header = `Sync request ${date}` + (isMatchingTalk ? '' : ` for ${conf.page}`)

            let histLink = `([[Special:PageHistory/${conf.source}|hist]])`
            if (conf.source.startsWith('toolforge:')) {
                histLink = ''
            } else if (conf.source.startsWith('gitlab:')) {
                histLink = `([[${conf.source.replace('/-/raw/', '/-/commits/')}|hist]])`
            }

            let remotePage = conf.source
                // for gitlab, transform URL to point to the pretty view
                .replace('/-/raw/', '/-/blob/')

            const body = REQUEST_BODY
                .replaceAll('LOCAL', conf.page)
                .replaceAll('REMOTE', remotePage)
                .replaceAll('SYNC_PAGE', syncPage)
                .replaceAll('DIFF_LINK', comparePagesLink)
                .replaceAll('HIST_LINK', histLink ? ' ' + histLink : '')
                .replaceAll('CONFIG_PAGE', CONFIG_PAGE)
                .trim()
            if (argv.test) {
                fs.appendFileSync('test-requests.txt', `=${conf.talkPage}=\n==${header}==\n${body}\n\n`)
            } else {
                await bot.newSection(conf.talkPage, header, body)
            }
            log(`[S] Created edit request on [[${conf.talkPage}]]`)
        }
    }
}())

const REQUEST_BODY =  `
{{sudo|1=LOCAL|answered=no}}
Please sync [[LOCAL]] with [[SYNC_PAGE]] ([DIFF_LINK diff]). This brings it in sync with the upstream changes at [[REMOTE]]HIST_LINK.

This edit request is raised automatically based on the configuration at [[CONFIG_PAGE]]. Thanks, ~~~~
`;
