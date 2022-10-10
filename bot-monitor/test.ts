import {bot} from "../botbase";
import {Monitor, getBotOperator, checksDb, RawRule, Rule, fetchRules} from './index'

import {expect} from 'chai';

describe('Rule', async function () {
    before(function () {
        return bot.getSiteInfo();
    });
    it('fetchRules', async () => {
       const rules = await fetchRules();
       expect(rules).to.be.instanceOf(Array).of.length.greaterThan(10);
    });

});

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
        return checksDb.connect();
    });

    it('undefined on non-existent access', async function () {
        const last = await checksDb.db.get(`SELECT * FROM checks WHERE name = ?`, [
            `SDZeroBot: NPPSot`
        ]);
        expect(last).to.eq(undefined);
    });


});
