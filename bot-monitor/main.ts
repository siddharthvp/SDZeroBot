import {bot, emailOnError, argv} from "../botbase";
import {fetchRules, Monitor, Tabulator, checksDb} from './index';

(async function () {

    process.chdir(__dirname);

    await Promise.all([
        bot.getTokensAndSiteInfo(),
        checksDb.connect()
    ]);

    const rules = await fetchRules();

    Tabulator.init();
    for (let rule of rules) {
        await new Monitor().monitor(rule);
    }

    await Tabulator.postResults();

})().catch(err => emailOnError(err, 'bot-monitor'));
