import assert = require("assert");
import { bot } from "../botbase";
import {getCurrentUsername, processArticle, db, getCurrentTitle} from "./model";

describe('most-gans', () => {
	before(() => {
		return bot.getSiteInfo();
	})

	it('processArticle', async function () {
		this.timeout(100000);
		db.run = () => Promise.resolve(); // stub it out
		const testCases = [
			['1896 Michigan Wolverines football team', 'Wizardman', '2010-12-21'],
			['Fight for This Love', 'Lil-unique1', '2010-06-25'], // has rev-delled talkpage revs
			['Norman Finkelstein', 'Giggy']
		];
		for (let [article, nomExpected, dateExpected] of testCases) {
			const [nom, date] = await processArticle(article);
			assert.strictEqual(nom, nomExpected);
			if (dateExpected) assert.strictEqual(date, dateExpected);
		}
	});

	it('getCurrentUsername', async function () {
		this.timeout(10000);
		assert.strictEqual(await getCurrentUsername('Dr. Blofeld', '2018-01-01'), 'Dr. Blofeld');
		assert.strictEqual(await getCurrentUsername('Encyclopædius', '2021-01-01'), 'Dr. Blofeld');
		assert.strictEqual(await getCurrentUsername('DeltaQuad', '2020-06-20'), 'AmandaNP');
		assert.strictEqual(await getCurrentUsername('DeltaQuad', '2020-06-26T11:00:00Z'), 'DeltaQuad (usurp)');
		assert.strictEqual(await getCurrentUsername('DeltaQuad', '2020-06-27'), 'DeltaQuad');

		// old renames - legacy log formats
		assert.strictEqual(await getCurrentUsername('Santros57Q', '2008-01-06'), 'Santos25Q');
		assert.strictEqual(await getCurrentUsername('HInBC', '2006-01-01'), 'H');

		// non-existing user
		assert.strictEqual(await getCurrentUsername('Jh3rifesd9', '2018-01-01'), 'Jh3rifesd9');

		let startTime = process.hrtime.bigint();
		assert.strictEqual(await getCurrentUsername('HInBC', new bot.date().subtract(15, 'seconds').toISOString()), 'HInBC');
		let endTime = process.hrtime.bigint();
		// API call shouldn't have taken place, so takes less time
		assert.strictEqual(Number(endTime - startTime)/1e6 < 10, true);
	});

	it('getCurrentTitle', async function() {
		this.timeout(10000);
		assert.strictEqual(await getCurrentTitle('Shivers (song)', '2014-11-19'), 'Shivers (The Boys Next Door song)');
	});

});
