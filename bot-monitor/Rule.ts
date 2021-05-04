import {argv, bot, fs, mwn, path} from "../botbase";
import {MwnDate} from "../../mwn";
import {getFromDate} from "./index";

export type BotConfigParam =
    | 'bot'
    | 'task'
    | 'action'
    | 'namespace'
    | 'title'
    | 'title_regex'
    | 'summary'
    | 'summary_regex'
    | 'min_edits'
    | 'duration'
    | 'alert_mode'
    | 'alert_page'
    | 'email_user'
    | 'header'
    | 'ping_user'

export type RawRule = Record<BotConfigParam, string>

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

export async function fetchRules(): Promise<RawRule[]> {
    let text = !argv.fake ?
        await new bot.page('Wikipedia:Bot activity monitor/Configurations').text() :
        fs.readFileSync(path.join(__dirname, 'fake-config.wikitext')).toString();

    let templates = new bot.wikitext(text).parseTemplates({
        namePredicate: name => name === '/task'
    });
    return templates.map(t => {
        let rule = {};
        t.parameters.forEach(p => {
            rule[p.name] = p.value;
        });
        return rule;
    }) as RawRule[];
}


export function parseRule(rule: RawRule): Rule {
    rule.duration = rule.duration || '3 days';
    let fromDate = getFromDate(rule.duration);

    if (!rule.bot) {
        throw new RuleError(`No bot account specified!`);
    }
    if (rule.alert_page) {
        let title = bot.title.newFromText(rule.alert_page);
        if (!title) {
            throw new RuleError(`Invalid alert page: ${rule.alert_page}`);
        } else if (title.namespace === 0) {
            throw new RuleError(`Invalid alert page: ${rule.alert_page}`);
        }
    }
    if (rule.min_edits && isNaN(parseInt(rule.min_edits))) {
        throw new RuleError(`Invalid min_edits: ${rule.min_edits}: must be a numbeer`);
    }

    return {
        bot: rule.bot,
        task: rule.task || '',
        action: rule.action || 'edit',
        namespace: rule.namespace && rule.namespace.match(/\d+/g).map(num => parseInt(num)),
        duration: rule.duration,
        fromDate,
        titleRegex: (rule.title && new RegExp('^' + mwn.util.escapeRegExp(rule.title) + '$')) ||
            (rule.title_regex && new RegExp('^' + rule.title_regex + '$')),
        summaryRegex: (rule.summary && new RegExp('^' + mwn.util.escapeRegExp(rule.summary) + '$')) ||
            (rule.summary_regex && new RegExp('^' + rule.summary_regex + '$')),
        alertMode: rule.alert_mode || 'talkpage',
        alertPage: rule.alert_page || 'User talk:' + rule.bot,
        emailUser: rule.email_user || rule.bot,
        pingUser: rule.ping_user,
        header: rule.header,
        minEdits: rule.min_edits ? parseInt(rule.min_edits) : 1
    };
}
