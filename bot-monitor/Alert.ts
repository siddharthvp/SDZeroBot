import { argv, bot, log, mailTransporter, Mwn } from "../botbase";
import {Rule, RuleError, Monitor, subtractFromNow, alertsDb} from "./index";

export class Alert {
    rule: Rule
    name: string
    actions: number

    constructor(monitor: Monitor) {
        Object.assign(this, monitor);
    }

    async alert() {
        if (argv.dry) return;
        await Promise.all([
            this.rule.alertPage && this.alertTalkPage(),
            this.rule.email && this.alertEmail(),
        ]);
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
            this.getTalkMessage() + ' – ~~~~',
            { redirect: true, nocreate: true }
        ).catch(err => {
            if (err.code === 'missingtitle') {
                throw new RuleError(`Missing alert page: ${this.rule.alertPage}`);
            } else if (err.code === 'protectedpage') {
                throw new RuleError(`Alert page is protected: ${this.rule.alertPage}`);
            } else throw err;
        });
    }

    getTalkMessage() {
        return Mwn.template('subst:Wikipedia:Bot activity monitor/Notification', {
            bot: this.rule.bot,
            task: this.rule.task,
            action: this.rule.action === 'edit' ? 'edit' : `"${this.rule.action}" action`,
            actual: String(this.actions),
            expected: String(this.rule.minEdits),
            duration: this.rule.duration
        });
    }

    async alertEmail() {
        let lastAlertedTime = await alertsDb.getLastEmailedTime(this.rule);
        if (lastAlertedTime.isAfter(subtractFromNow(this.rule.duration, 1))) {
            log(`[i] Aborting email for "${this.name}" because one was already sent in the last ${this.rule.duration}`);
            return;
        }
        log(`[i] Sending email for "${this.name}" to ${this.rule.email}`);
        let subject = `[${this.rule.bot}] ${this.rule.task} failure`;

        if (this.rule.email.includes('@')) {
            await mailTransporter.sendMail({
                from: 'tools.sdzerobot@tools.wmflabs.org',
                to: this.rule.email,
                subject: subject,
                html: this.getEmailBodyHtml(),
            });
        } else {
            await new bot.User(this.rule.email).email(
                subject,
                this.getEmailBodyPlain(),
                {ccme: true}
            ).catch(err => {
                if (err.code === 'notarget') {
                    throw new RuleError(`Invalid username for email: ${this.rule.email}`);
                } else if (err.code === 'nowikiemail') {
                    throw new RuleError(`Email is disabled for ${this.rule.email}`);
                } else throw err;
            });
        }
        await alertsDb.saveLastEmailedTime(this.rule).catch(async () => {
            // Try that again, we don't want to send duplicate emails!
            await alertsDb.saveLastEmailedTime(this.rule);
        });
    }

    getEmailBodyHtml(): string {
        return `${this.rule.bot}'s task <b>${this.rule.task}</b> failed to run per the configuration specified at <a href="https://en.wikipedia.org/wiki/Wikipedia:Bot_activity_monitor/Configurations">Wikipedia:Bot activity monitor/Configurations</a>. Detected only ${this.actions} ${this.rule.action === 'edit' ? 'edit' : `"${this.rule.action}" action`}s in the last ${this.rule.duration}, whereas at least ${this.rule.minEdits} were expected.` +
            `<br><br>` +
            `If your bot is behaving as expected, then you may want to <a href="https://en.wikipedia.org/wiki/Wikipedia:Bot_activity_monitor/Configurations?action=edit">modify the task configuration instead</a>. Or to unsubscribe from these email notifications, remove the |email= parameter from the {{/task}} template.` +
            `<br><br>` +
            `Thanks!`;
    }

    getEmailBodyPlain(): string {
        return `${this.rule.bot}'s task "${this.rule.task}" failed to run per the configuration specified at Wikipedia:Bot activity monitor/Configurations (<https://en.wikipedia.org/wiki/Wikipedia:Bot_activity_monitor/Configurations>). Detected only ${this.actions} ${this.rule.action === 'edit' ? 'edit' : `"${this.rule.action}" action`}s in the last ${this.rule.duration}, whereas at least ${this.rule.minEdits} were expected.` +
            `\n\n` +
            `If your bot is behaving as expected, then you may want to modify the task configuration instead. Or to unsubscribe from these email notifications, remove the |email= parameter from the {{/task}} template. Thanks!`;
    }

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
