import {pageFromCategoryEvent, Route} from "../app";
import {RecentChangeStreamEvent} from "../RecentChangeStreamEvent";
import {bot} from "../../botbase";

export default class CategoryLister extends Route {
    readonly name = "category-lister";

    subscriptions: Map<string, string>;

    async init() {
        const pages = (await new bot.Category("Category:SDZeroBot category lister subscriptions")).pages();
        // TODO
    }

    filter(data: RecentChangeStreamEvent): boolean {
        return data.wiki === 'enwiki' &&
            (data.type === 'categorize' && this.subscriptions.has(data.title));
    }

    worker(data: RecentChangeStreamEvent) {
        const cat = pageFromCategoryEvent(data);
        const page = this.subscriptions.get(cat.title);

    }

}
