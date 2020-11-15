import {bot, emailOnError, fs, path} from "../botbase";

import {fetchRules, Monitor, Tabulator, ChecksDb} from './internal'

(async function () {

    process.chdir(__dirname);

    await bot.getTokensAndSiteInfo();
    await ChecksDb.connect();

    const rules = await fetchRules();

    Tabulator.init();
    for (let rule of rules) {
        await new Monitor().monitor(rule);
    }

    await Tabulator.postResults();

})().catch(err => emailOnError(err, 'bot-monitor'));
