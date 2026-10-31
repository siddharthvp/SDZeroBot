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
        expect(await checksDb.checkCached({
            bot: 'SDZeroBot',
            task: 'non-existent',
            action: 'edit',
            namespace: '0',
            title: '',
            title_regex: '',
            summary: '',
            summary_regex: '',
            min_edits: '1',
            duration: '1 day',
            notify: '',
            email: ''
        })).to.equal(undefined);
    });


});
