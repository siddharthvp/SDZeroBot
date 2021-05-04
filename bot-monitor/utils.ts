import {bot} from "../botbase";
import {MwnDate} from "../../mwn";
import {RuleError} from "./index";

export function getFromDate(duration: string, times = 1): MwnDate {
    try {
        let durationParts = duration.split(' ');
        let num = parseInt(durationParts[0]);
        let unit = durationParts[1];
        // Add support for weeks which MwnDate doesn't support (using 1 week = 7 days)
        // moment does support it directly, but moment doesn't raise an error on
        // invalid durations – it just keeps the date object unaltered, so it isn't
        // suitable here
        if (/weeks?/.test(unit)) {
            unit = 'days';
            num *= 7;
        }
        // @ts-ignore
        return new bot.date().subtract(num * times, unit);
    } catch (err) {
        throw new RuleError(`Invalid duration: ${duration}: ${err.message}`);
    }
}

