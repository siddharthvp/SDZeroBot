import {argv, bot, mwn, path} from "../botbase";
import {MwnTitle, MwnDate} from "../../mwn";
import {getFromDate} from "./index";
import {readFile} from "../utils";
import {NS_USER_TALK} from "../namespaces";

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
    alertPage: MwnTitle

    // alertMode: 'email' | 'talkpage' | 'ping'
    // emailUser: string
    // header: string
    // pingUser: string
}

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
    | 'notify'

    // | 'alert_mode'
    // | 'alert_page'
    // | 'email_user'
    // | 'header'
    // | 'ping_user'

export class RuleError extends Error {}

export async function fetchRules(): Promise<RawRule[]> {
    let text = !argv.fake ?
        await new bot.page('Wikipedia:Bot activity monitor/Configurations').text() :
        readFile(path.join(__dirname, 'fake-config.wikitext'));

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
    if (!rule.task) {
        throw new RuleError(`No task name specified!`);
    }
    let alertPage = rule.notify && bot.title.newFromText(rule.notify, NS_USER_TALK);
    if (rule.notify && (!alertPage || alertPage.namespace === 0)) {
        throw new RuleError(`Invalid alert page: ${rule.notify}`);
    }
    if (rule.min_edits && isNaN(parseInt(rule.min_edits))) {
        throw new RuleError(`Invalid min_edits: ${rule.min_edits}: must be a number`);
    }

    return {
        bot: rule.bot,
        task: rule.task,
        action: rule.action || 'edit',
        namespace: rule.namespace && rule.namespace.match(/\d+/g).map(num => parseInt(num)),
        duration: rule.duration,
        fromDate,
        titleRegex: (rule.title && new RegExp('^' + mwn.util.escapeRegExp(rule.title) + '$')) ||
            (rule.title_regex && new RegExp('^' + rule.title_regex + '$')),
        summaryRegex: (rule.summary && new RegExp('^' + mwn.util.escapeRegExp(rule.summary) + '$')) ||
            (rule.summary_regex && new RegExp('^' + rule.summary_regex + '$')),
        minEdits: rule.min_edits ? parseInt(rule.min_edits) : 1,
        alertPage

        // alertMode: rule.alert_mode as 'talkpage' | 'email' | 'ping',
        // emailUser: rule.email_user || rule.bot,
        // pingUser: rule.ping_user,
        // header: rule.header,
    };
}
