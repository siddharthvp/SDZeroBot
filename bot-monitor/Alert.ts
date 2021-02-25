import {argv, bot, log} from "../botbase";
import {Rule, RuleError, Monitor} from "./index";

// TODO: avoid redundant notifications

export class Alert {
    rule: Rule
    name: string
    actions: number

    static pingpage = 'Wikipedia:Bot activity monitor/Pings'

    constructor(monitor: Monitor) {
        // ah, the boilerplate
        this.rule = monitor.rule;
        this.name = monitor.name;
        this.actions = monitor.actions;
    }

    async alert() {
        return;
        if (argv.dry || !this.rule.alertMode) {
            return;
        }

        if (this.rule.alertMode === 'talkpage') {
            await this.alertTalkPage();
        } else if (this.rule.alertMode === 'email') {
            await this.alertEmail();
        } else if (this.rule.alertMode === 'ping') {
            await this.alertPing();
        } else {
            throw new RuleError(`Invalid alert mode: ${this.rule.alertMode}: must be "talkpage", "email" or "ping"`);
        }
    }

    async alertTalkPage() {
        await new bot.page(this.rule.alertPage).newSection(
            this.getHeader(),
            this.getMessage() + ' ~~~~',
            {redirect: true, nocreate: true}
        ).catch(err => {
            if (err.code === 'missingtitle') {
                throw new RuleError(`Missing alert page: ${this.rule.alertPage}`);
            } else if (err.code === 'protectedpage') {
                throw new RuleError(`Alert page is protected: ${this.rule.alertPage}`);
            } else throw err;
        });
    }

    async alertEmail() {
        await new bot.user(this.rule.emailUser).email(
            this.getHeader(),
            this.getMessage(),
            {ccme: true}
        ).catch(err => {
            if (err.code === 'notarget') {
                throw new RuleError(`Invalid username for email: ${this.rule.emailUser}`);
            } else if (err.code === 'nowikiemail') {
                throw new RuleError(`Email is disabled for ${this.rule.emailUser}`);
            } else throw err;
        });
    }

    async alertPing() {
        let pingUser = this.rule.pingUser || await getBotOperator(this.rule.bot) || this.rule.bot;
        await new bot.page(Alert.pingpage).edit((rev) => {
            return {
                appendtext: `{{re|${pingUser}}} ${this.rule.bot}'s task ${this.rule.task} failed: found ${this.actions} ${this.rule.action === 'edit' ? 'edits' : 'log actions'} against ${this.rule.minEdits} expected.`,
                summary: `Reporting [[:User:${this.rule.bot}|${this.rule.bot}]]: ${this.rule.task}`
            }
        });
    }

    getHeader() {
        if (typeof this.rule.header === 'string') {
            return this.rule.header
                .replace('$TASK', this.rule.task.replace(/\$/g, '$$$$'))
                .replace('$BOT', this.rule.bot.replace(/\$/g, '$$$$'));
        }
        return `${this.rule.task} failure`; // default
    }

    getMessage() {
        return `The bot task ${this.name} failed to run per the requirements specified at [[${Monitor.configpage}]]. Found only ${this.actions} ${this.rule.action === 'edit' ? 'edits' : 'log actions'}, expected ${this.rule.minEdits}.`;
    }

}

export async function getBotOperator(botName: string) {
    try {
        const userpage = await new bot.user(botName).userpage.text();
        const rgx = /\{\{[bB]ot\s*\|\s*([^|}]*)/;
        const match = rgx.exec(userpage);
        if (!match) {
            return null;
        }
        return match[1];
    } catch (e) {
        if (e.code !== 'missingtitle') {
            log(`[E] Unexpected error getting operator name: ${e}`);
        }
        return null;
    }
}
