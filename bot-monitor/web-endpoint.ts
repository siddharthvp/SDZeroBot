import * as express from "express";
import {alertsDb} from "./AlertsDb";
import {Mwn} from "../../mwn";

const router = express.Router();
const mwn = new Mwn();

router.get('/pause', async (req, res) => {
    const { bot, webKey, pauseTill } = req.query as Record<string, string>;
    if (!webKey || !bot) {
       throw new CustomError(400, "Missing one of required query params: bot, webKey");
    }
    if (!pauseTill) {
        // XXX: show a landing page
        return;
    }
    const rowsUpdated = await alertsDb.setPauseTillTime(bot, webKey, new Date(pauseTill));
    if (!rowsUpdated) {
        throw new CustomError(403, "Unauthorized"); // XXX: not really
    }
    res.render('oneline', {
        message: `Notifications for this bot task have been paused till ${new mwn.Date(pauseTill).format('HH:mm, D MMMM YYYY', "system")}`
    });
});

class CustomError extends Error {
    code: number;
    constructor(code: number, msg: string) {
        super(msg);
        this.code = code;
    }
}

export default router;
