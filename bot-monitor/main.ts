import {bot, emailOnError, fs, path} from "../botbase";
import {fetchRules, Monitor} from "./bot-monitor";
import {Tabulator} from "./Tabulator";
import {ChecksDb} from "./ChecksDb";

(async function () {

    await bot.getTokensAndSiteInfo();
    await ChecksDb.connect();

    const rules = await fetchRules();

    Tabulator.init();
    for (let rule of rules) {
        await new Monitor().monitor(rule);
    }

    await Tabulator.postResults();

})().catch(err => emailOnError(err, 'bot-monitor'));
