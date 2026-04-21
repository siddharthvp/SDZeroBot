import {argv, bot, emailOnError, log} from "../botbase"
import * as querystring from "querystring"
import * as fs from "fs"

const HEADER = `
/******************************************************************************/
/**** THIS PAGE TRACKS $SOURCE. PLEASE AVOID EDITING DIRECTLY. 
/**** EDITS SHOULD BE PROPOSED DIRECTLY to $SOURCE.
/**** A BOT WILL RAISE AN EDIT REQUEST IF IT BECOMES DIFFERENT FROM UPSTREAM.
/******************************************************************************/

`

const CONFIG_PAGE = 'User:SDZeroBot/Gadget sync/Config.json'

interface Config {
    description: string;
    list: Array<{
        talkPage: string;
        pages: Array<{
            remote: string;
            local: string;
        }>
    }> | Array<{
        talkPage: string;
        remote: string;
        local: string;
    }>
}

interface Request {
    localPage: string
    remotePage: string
    syncPage: string
    comparePagesLink: string
    histLink: string
}

async function getConfig(): Promise<Config> {
    if (argv.test) {
        return require('./test-config.json')
    }
    const content = (await bot.read(CONFIG_PAGE)).revisions[0].content
    return JSON.parse(content)
}

function parseGithubLink(link: string) {
    const [_, ...parts] =  link.split(':')
    const [org, repo, branch, ...path] = parts.join(':').split('/')
    return [org, repo, branch, path.join('/')]
}

function getRawLink(link: string, interWikis: Record<string, string>) {
    if (link.startsWith('github:')) {
        const [org, repo, branch, path] = parseGithubLink(link)
        return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${path}`
    }
    const [prefix, ...page] = link.split(':')
    if (interWikis[prefix]) {
        return interWikis[prefix].replace('$1', page.join(':')) + '?action=raw'
    }
    return `https://en.wikipedia.org/w/index.php?title=${link}&action=raw`
}
function getHumanLink(link: string) {
    if (link.startsWith('github:')) {
        const [org, repo, branch, path] = parseGithubLink(link)
        return `https://github.com/${org}/${repo}/blob/${branch}/${path}`
    }
    return '[[' + link.replace('/-/raw/', '/-/blob/') + ']]'
}
function getHistoryLink(link: string, interWikis: Record<string, string>) {
    if (link.startsWith('github:')) {
        const [org, repo, branch, path] = parseGithubLink(link)
        return `https://github.com/${org}/${repo}/commits/${branch}/${path}`
    } else if (link.startsWith('gitlab:')) {
        const path = link.replace(/^gitlab:/, '').replace('/-/raw', '/-/commits')
        return `https://gitlab.wikimedia.org/${path}`
    } else if (link.startsWith('toolforge:')) {
        return ''
    } else {
        const [prefix, ...page] = link.split(':')
        if (interWikis[prefix]) {
            return interWikis[prefix].replace('$1', page.join(':')) + '?action=history'
        }
        return `https://en.wikipedia.org/w/index.php?title=${link}&action=history`
    }
}

async function getInterwikiMap() {
    const interwikis = (await bot.query({
        "meta": "siteinfo",
        "siprop": "interwikimap"
    })).query.interwikimap
    return Object.fromEntries(interwikis.map(iw => [iw.prefix, iw.url]))
}

(async function () {
    await bot.getTokensAndSiteInfo()
    const [interWikis, allConfigs] = await Promise.all([
        getInterwikiMap(),
        getConfig()
    ])
    for (const conf of allConfigs.list) {
        // Validations
        const talkTitle = bot.Title.newFromText(conf.talkPage)
        if (!talkTitle || talkTitle.getNamespaceId() % 2 !== 1) {
            log(`[E] Invalid talkPage: ${conf.talkPage}`)
            continue
        }
        let pages = 'pages' in conf ? conf.pages : [ { remote: conf.remote, local: conf.local } ]
        const requests: Array<Request> = [];

        for (const {remote: remotePage, local: localPage} of pages) {
            let localCode, remoteCode
            try {
                let remote = await bot.rawRequest({
                    url: getRawLink(remotePage, interWikis),
                    timeout: 5000
                })
                remoteCode = remote.data.trim()
                // .trim() required for non-wiki remotes
            } catch (e) {
                if (e.response?.status === 404) {
                    log(`[E] ${remotePage} does not exist. Skipping.`)
                    continue
                } else throw e
            }

            const substitutedHeader = HEADER.replaceAll('$SOURCE', getHumanLink(remotePage))
            try {
                let local = await bot.rawRequest({
                    url: getRawLink(localPage, interWikis),
                    timeout: 5000
                })
                localCode = local.data.replace(substitutedHeader, '')
            }  catch (e) {
                if (e.response?.status === 404) {
                    log(`[W] ${localPage} does not exist. Treating as blank.`)
                    localCode = ''
                } else throw e
            }

            if (remoteCode !== localCode) {
                // Copy the file locally so that a Special:ComparePages link can be generated
                const syncPage = `User:SDZeroBot/sync/${localPage}`
                const syncPageData = substitutedHeader + remoteCode
                const saveResult = await bot.save(syncPage, syncPageData, `Copying from [[${remotePage}]] for comparison`)

                const comparePagesLink = `https://en.wikipedia.org/wiki/Special:ComparePages?` + querystring.stringify({
                    page1: localPage,
                    rev1: localCode === '' ? '' : (await new bot.Page(localPage).history(['ids'], 1))[0].revid,
                    page2: syncPage,
                    rev2: saveResult.newrevid
                })

                let histLink = getHistoryLink(remotePage, interWikis)
                requests.push({
                    localPage,
                    remotePage,
                    syncPage,
                    comparePagesLink,
                    histLink: histLink ? ` ([${histLink} hist])` : ''
                })
            }
        }

        const pg = await bot.read(talkTitle)
        const date = new bot.Date().format('D MMMM YYYY')

        if (requests.length === 1) {
            const r = requests[0]
            if (!pg.missing && pg.revisions[0].content.includes(`{{sudo|1=${r.localPage}|answered=no}}`)) {
                log(`[+] Open edit request already exists on ${conf.talkPage}, skipping`)
                continue
            }

            const body = SINGLE_REQUEST_BODY
                .replaceAll('LOCAL', r.localPage)
                .replaceAll('REMOTE', getHumanLink(r.remotePage) + r.histLink)
                .replaceAll('SYNC_PAGE', r.syncPage)
                .replaceAll('DIFF_LINK', r.comparePagesLink)
                .replaceAll('CONFIG_PAGE', CONFIG_PAGE)
                .trim()

            const isMatchingTalk = new bot.Page(r.localPage).toText() === new bot.Title(conf.talkPage).getSubjectPage().toText()
            const heading = `Sync request ${date}` + (isMatchingTalk ? '' : ` for ${r.localPage}`)

            if (argv.test) {
                fs.appendFileSync('test-requests.txt', `=${conf.talkPage}=\n==${heading}==\n${body}\n\n`)
            } else {
                await bot.newSection(conf.talkPage, heading, body)
            }
            log(`[S] Created edit request on [[${conf.talkPage}]]`)

        } else if (requests.length > 1) {

            const PAGES = requests.map((r, idx) => `${idx + 1}=${r.localPage}`).join('|')
            if (!pg.missing && pg.revisions[0].content.includes(`{{sudo|${PAGES}|answered=no}}`)) {
                log(`[+] Open edit request already exists on ${conf.talkPage}, skipping`)
                continue
            }
            const REQUESTS = requests.map((r) => {
                return `* [[${r.localPage}]] ←— [[${r.syncPage}]], based on [[${r.remotePage}]]${r.histLink}`
            }).join('\n')
            const body = MULTI_REQUEST_BODY
                .replace('PAGES', PAGES)
                .replace('REQUESTS', REQUESTS)
                .replace('CONFIG_PAGE', CONFIG_PAGE)
                .trim()
            const heading = `Sync request ${date}`

            if (argv.test) {
                fs.appendFileSync('test-requests.txt', `=${conf.talkPage}=\n==${heading}==\n${body}\n\n`)
            } else {
                await bot.newSection(conf.talkPage, heading, body)
            }
            log(`[S] Created edit request on [[${conf.talkPage}]]`)
        }
    }
})().catch(e => emailOnError(e, 'gadgets-sync'))

const SINGLE_REQUEST_BODY =  `
{{sudo|1=LOCAL|answered=no}}
Please sync [[LOCAL]] with [[SYNC_PAGE]] ([DIFF_LINK diff]). This brings it in sync with the upstream changes at REMOTE.

This edit request is raised automatically based on the configuration at [[CONFIG_PAGE]]. Thanks, ~~~~
`;

const MULTI_REQUEST_BODY = `
{{sudo|PAGES|answered=no}}
Please sync the following pages:
REQUESTS

This edit request is raised automatically based on the configuration at [[CONFIG_PAGE]]. Thanks, ~~~~
`
