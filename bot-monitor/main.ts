import {bot, emailOnError, argv} from "../botbase";
import {fetchRules, Monitor, Tabulator, checksDb, alertsDb} from './index';
import {closeTunnels} from "../utils";

(async function () {

    process.chdir(__dirname);

    await Promise.all([
        bot.getTokensAndSiteInfo(),
        checksDb.connect(),
        alertsDb.connect(),
    ]);

    const rules = await fetchRules();

    Tabulator.init();
    for (let rule of rules) {
        await new Monitor().monitor(rule);
    }

    await Tabulator.postResults();

    closeTunnels();

})().catch(err => emailOnError(err, 'bot-monitor'));
