import {bot} from "../botbase";
import {Monitor, getBotOperator, ChecksDb, RawRule, Rule} from './internal'

import {expect} from 'chai';

describe('Monitor', async function () {
    before(function () {
        return bot.getSiteInfo();
    });

    it('gets bot operator', async function () {
        expect(await getBotOperator('SDZeroBot')).to.equal('SD0001');
    });
});

describe('ChecksDb', async function () {

    before(function () {
        return ChecksDb.connect();
    });

    it('undefined on non-existent access', async function () {
        const last = await ChecksDb.db.get(`SELECT * FROM checks WHERE name = ?`, [
            `SDZeroBot: NPPSot`
        ]);
        expect(last).to.eq(undefined);
    });


});
