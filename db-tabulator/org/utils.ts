import {enwikidb} from "../../db";
import {CONCURRENCY} from "./consts";


export const db = new enwikidb({
    connectionLimit: CONCURRENCY
});

// hacky way to prevent further execution in process(), but not actually report as error
export class HandledError extends Error {}

export function getInvocationMode() {
    if (process.env.CRON) return 'cron';
    if (process.env.WEB) return 'web';
    if (process.env.EVENTSTREAM_ROUTER) return 'eventstream';
    return 'manual';
}
