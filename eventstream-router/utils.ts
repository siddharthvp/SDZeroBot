import { argv, log } from "../botbase";
import { RecentChangeStreamEvent } from "./RecentChangeStreamEvent";
import { stringifyObject } from "../utils";

export function logError(err, task?) {
	let taskFmt = task ? `[${task}]` : '';
	let stringified;
	if (err.stack) {
		log(`${taskFmt} ${err.stack}`);
	} else if (stringified = stringifyObject(err)) {
		log(`${taskFmt} ${stringified}`);
	} else {
		log(`${taskFmt}`);
		console.log(err);
	}
}

export function pageFromCategoryEvent(data: RecentChangeStreamEvent) {
	let match = /^\[\[:(.*?)\]\] (added|removed)/.exec(data.comment);
	if (!match) {
		return null;
	}
	return {
		title: match[1],
		added: match[2] === 'added',
		removed: match[2] === 'removed'
	};
}

export function debug(msg) {
	if (argv.debug) {
		log(msg);
	}
}
