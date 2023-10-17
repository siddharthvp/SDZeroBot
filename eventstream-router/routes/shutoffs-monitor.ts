import {Route} from "../app";
import {bot, sendMail} from "../../botbase";
import {NS_USER} from "../../namespaces";

export default class ShutoffsMonitorTask extends Route {
    readonly name: string = 'shutoff-monitor';

    async init() {
        super.init();
        this.log('[S] Started');
    }

    filter(data): boolean {
        return data.wiki === 'enwiki' &&
            data.namespace === NS_USER &&
            data.type === 'edit' &&
            data.title.startsWith('User:SDZeroBot/Shutoff/') &&
            data.user !== 'SD0001'
    }

    async worker(data) {
        const text = (await bot.read(data.title))?.revisions?.[0]?.content;
        this.log(`[W] ${data.title} was edited by ${data.user} with comment ${data.comment}`);
        sendMail(
            `${data.title} was edited`,
            `${data.title} was edited by ${data.user} with comment ${data.comment}. New page content: ${text}`
        );
    }

}
