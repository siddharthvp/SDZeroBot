import * as express from "express";
import {alertsDb} from "./AlertsDb";
import {bot} from "../botbase";

const router = express.Router();

alertsDb.connect();

router.all('/pause', async (req, res, next) => {
    try {
        const { task, webKey } = req.query as Record<string, string>;
        const { date, unpause } = req.body as Record<string, string>;
        if (!webKey || !task) {
            return next(new CustomError(400, "Missing one of required query params: task, webKey"));
        }

        let current = '';
        let dateVal = '';
        if (date) { // POST
            const tillDate = new bot.Date(date);
            const rowsUpdated = await alertsDb.setPausedTillTime(task, webKey, tillDate);
            if (!rowsUpdated) {
                return next(new CustomError(403, "Unauthorized"));
            }
            current = `<span style="color: green; font-weight: bold">Successfully paused notifications till ${tillDate.format('D MMMM YYYY')} (UTC).</span>`;
            dateVal = tillDate.format('YYYY-MM-DD');
        } else if (unpause) { // POST
            const rowsUpdated = await alertsDb.setPausedTillTime(task, webKey);
            if (!rowsUpdated) {
                return next(new CustomError(403, "Unauthorized"));
            }
            current = `<span style="color: green; font-weight: bold">Successfully unpaused notifications.</span>`;
        } else { // GET
            let pausedTill = await alertsDb.getPausedTillTime(task, webKey);
            if (pausedTill) {
                current = `Notifications are currently paused till ${pausedTill.format('D MMMM YYYY')} (UTC).`;
                dateVal = pausedTill.format('YYYY-MM-DD');
            }
        }

        return res.render('bot-monitor/web-endpoint', {
            task,
            webKey,
            current,
            dateVal
        });
    } catch (e) {
        next(e);
    }
});

export class CustomError extends Error {
    status: number;
    constructor(status: number, msg: string) {
        super(msg);
        this.status = status;
    }
}


export default router;
