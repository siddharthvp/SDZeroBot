import {argv, bot, fs, mwn, path} from "../botbase";
import {MwnDate} from "../../mwn/src";
import {getFromDate, Monitor} from "./internal";

export interface RawRule {
    bot: string
    task: string
    action: string
    namespace: number | number[]
    pages: string
    summary: string
    minEdits: number
    duration: string
    alertMode: 'email' | 'talkpage' | 'ping'
    alertpage: string
    emailuser: string
    header: string
    pingUser: string
}

export interface Rule {
    bot: string
    task: string
    action: string
    namespace: number | number[]
    titleRegex?: RegExp
    summaryRegex?: RegExp
    minEdits: number
    duration: string
    fromDate: MwnDate
    alertMode: 'email' | 'talkpage' | 'ping'
    alertPage: string
    emailUser: string
    header: string
    pingUser: string
}

export class RuleError extends Error {
    constructor(msg) {
        super(msg);
    }
}

export function parseRule(rule: RawRule): Rule {
    let fromDate = getFromDate(rule.duration);

    if (typeof rule.namespace === 'string') {
        throw new RuleError(`Invalid namespace: ${rule.namespace}`);
    }
    if (!rule.bot) {
        throw new RuleError(`No bot account specified!`);
    }
    if (rule.alertpage) {
        let title = bot.title.newFromText(rule.alertpage);
        if (!title) {
            throw new RuleError(`Invalid alert page: ${rule.alertpage}`);
        } else if (title.namespace === 0) {
            throw new RuleError(`Invalid alert page: ${rule.alertpage}`);
        }
    }
    if (rule.minEdits && typeof rule.minEdits !== 'number') {
        throw new RuleError(`Invalid minEdits: ${rule.minEdits}: must be a numbeer`);
    }

    return {
        bot: rule.bot,
        task: rule.task || '',
        action: rule.action || 'edit',
        namespace: rule.namespace,
        duration: rule.duration || '1 day',
        fromDate,
        titleRegex: rule.pages && (rule.pages.startsWith('#') ?
                new RegExp('^' + rule.pages.slice(1) + '$') :
                new RegExp('^' + mwn.util.escapeRegExp(rule.pages) + '$')
        ),
        summaryRegex: rule.summary && (rule.summary.startsWith('#') ?
                new RegExp('^' + rule.summary.slice(1) + '$') :
                new RegExp('^' + mwn.util.escapeRegExp(rule.summary) + '$')
        ),
        alertMode: rule.alertMode || 'talkpage',
        alertPage: rule.alertpage || 'User talk:' + rule.bot,
        emailUser: rule.emailuser || rule.bot,
        pingUser: rule.pingUser,
        header: rule.header,
        minEdits: rule.minEdits || 1
    };
}

export async function fetchRules(): Promise<RawRule[]> {
    return !argv.fake ?
        await bot.parseJsonPage(Monitor.configpage) :
        JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-config.json')).toString())
}
