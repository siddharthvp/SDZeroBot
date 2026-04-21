import { bot, emailOnError, log } from "../botbase";
import {fetchRules, Monitor, Tabulator, checksDb, alertsDb} from './index';
import {closeTunnels} from "../utils";

(async function () {

    log('[i] Started');
    process.chdir(__dirname);

    await Promise.all([
        bot.getTokensAndSiteInfo(),
        checksDb.connect(),
        // can mostly work even if alertsDb fails to connect
        alertsDb.connect().catch(err => emailOnError(err, 'bot-monitor (non-fatal)')),
    ]);

    const rules = await fetchRules();

    Tabulator.init();
    for (let rule of rules) {
        await new Monitor().monitor(rule);
    }

    await Tabulator.postResults();
    log('[i] Finished');

    closeTunnels();

})().catch(err => emailOnError(err, 'bot-monitor'));
