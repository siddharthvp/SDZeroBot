import {bot} from "../botbase";
import {Monitor, getBotOperator, Rule, RawRule} from "./bot-monitor";

import {expect} from 'chai';
import {ChecksDb} from "./ChecksDb";

describe('typescript', async function () {
    before(function () {
        return bot.getSiteInfo();
    });

    it ('gets bot operator', async function () {
        expect(await getBotOperator('SDZeroBot')).to.equal('SD0001');
    });

});
