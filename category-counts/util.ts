import {bot} from "../botbase";
import {NS_CATEGORY} from "../namespaces";

export function normalizeCategory(name: string) {
    if (!name) {
        return null;
    }
    const title = bot.Title.newFromText(name, NS_CATEGORY);
    if (title) {
        return title.toText();
    }
    return null;
}

/**
 * Pass in validated category names only.
 */
export function getKey(category: string) {
    return bot.Title.newFromText(category, NS_CATEGORY).getMain();
}
