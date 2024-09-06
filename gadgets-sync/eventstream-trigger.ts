import {Route} from "../eventstream-router/app";
import {RecentChangeStreamEvent} from "../eventstream-router/RecentChangeStreamEvent";
import {invokeCronJob} from "../k8s";

export default class GadgetsSync extends Route {
    name = 'gadgets-sync';

    async init() {
        super.init();
        this.log('[S] Started');
    }

    filter(data: RecentChangeStreamEvent): boolean {
        return data.wiki === 'enwiki' &&
            data.type === 'edit' &&
            data.title === 'User:SDZeroBot/Gadgets-sync-config.json';
    }

    async worker(data: RecentChangeStreamEvent) {
        invokeCronJob('gadgets-sync');
    }

}
