import { argv, bot, log, mwn } from "../botbase";
import {Rule, RuleError, Monitor} from "./index";

export class Alert {
    rule: Rule
    name: string
    actions: number

    constructor(monitor: Monitor) {
        Object.assign(this, monitor);
    }

    async alert() {
        if (!argv.dry && this.rule.alertPage) {
            await this.alertTalkPage();
        }
    }

    async alertTalkPage() {
        let page = new bot.page(this.rule.alertPage);
        let text = await page.text();
        let header = `== ${this.rule.bot}: ${this.rule.task} failure ==`;
        if (text.includes(header)) {
            log(`[i] Aborting notification for ${this.rule.bot} because it already exists`);
            return;
        }
        log(`[i] Notifying for ${this.rule.bot}`);
        await page.newSection(
            header,
            this.getMessage() + ' – ~~~~',
            { redirect: true, nocreate: true }
        ).catch(err => {
            if (err.code === 'missingtitle') {
                throw new RuleError(`Missing alert page: ${this.rule.alertPage}`);
            } else if (err.code === 'protectedpage') {
                throw new RuleError(`Alert page is protected: ${this.rule.alertPage}`);
            } else throw err;
        });
    }

    getMessage() {
        return mwn.template('subst:Wikipedia:Bot activity monitor/Notification', {
            bot: this.rule.bot,
            task: this.rule.task,
            action: this.rule.action === 'edit' ? 'edit' : `"${this.rule.action}" action`,
            actual: String(this.actions),
            expected: String(this.rule.minEdits),
            duration: this.rule.duration
        });
    }

    // async alert() {
    //     if (this.rule.alertMode === 'talkpage') {
    //         await this.alertTalkPage();
    //     } else if (this.rule.alertMode === 'email') {
    //         await this.alertEmail();
    //     } else if (this.rule.alertMode === 'ping') {
    //         await this.alertPing();
    //     } else {
    //         throw new RuleError(`Invalid alert mode: ${this.rule.alertMode}: must be "talkpage", "email" or "ping"`);
    //     }
    // }
    // async alertEmail() {
    //     await new bot.user(this.rule.emailUser).email(
    //         this.getHeader(),
    //         this.getMessage(),
    //         {ccme: true}
    //     ).catch(err => {
    //         if (err.code === 'notarget') {
    //             throw new RuleError(`Invalid username for email: ${this.rule.emailUser}`);
    //         } else if (err.code === 'nowikiemail') {
    //             throw new RuleError(`Email is disabled for ${this.rule.emailUser}`);
    //         } else throw err;
    //     });
    // }
    // static pingpage = 'Wikipedia:Bot activity monitor/Pings'
    // async alertPing() {
    //     let pingUser = this.rule.pingUser || await getBotOperator(this.rule.bot) || this.rule.bot;
    //     await new bot.page(Alert.pingpage).edit((rev) => {
    //         return {
    //             appendtext: `{{re|${pingUser}}} ${this.rule.bot}'s task ${this.rule.task} failed: found ${this.actions} ${this.rule.action === 'edit' ? 'edits' : 'log actions'} against ${this.rule.minEdits} expected.`,
    //             summary: `Reporting [[:User:${this.rule.bot}|${this.rule.bot}]]: ${this.rule.task}`
    //         }
    //     });
    // }
    // getHeader() {
    //     if (typeof this.rule.header === 'string') {
    //         return this.rule.header
    //             .replace('$TASK', this.rule.task.replace(/\$/g, '$$$$'))
    //             .replace('$BOT', this.rule.bot.replace(/\$/g, '$$$$'));
    //     }
    //     return `${this.rule.bot}: ${this.rule.task} failure`; // default
    // }

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
