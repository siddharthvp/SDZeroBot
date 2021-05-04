import {bot, emailOnError, argv} from "../botbase";
import {fetchRules, Monitor, Tabulator, ChecksDb} from './index';
import {updateLoggingConfig} from '../../mwn/build/log';

(async function () {

    process.chdir(__dirname);

    updateLoggingConfig({
        printVerbose: !!argv.verbose
    });

    await Promise.all([
        bot.getTokensAndSiteInfo(),
        ChecksDb.connect()
    ]);

    const rules = await fetchRules();

    Tabulator.init();
    for (let rule of rules) {
        await new Monitor().monitor(rule);
    }

    await Tabulator.postResults();

})().catch(err => emailOnError(err, 'bot-monitor'));
