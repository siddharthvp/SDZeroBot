import assert = require("assert");
import { bot } from "../botbase";
import { getCurrentUsername, processArticle } from "./model";

describe('most-gans', () => {
	before(() => {
		return bot.getSiteInfo();
	})

	it('processArticle', async () => {
		// note processArticle makes a write to DB!
		const [nom, date, fallbackStrategy] = await processArticle('1896 Michigan Wolverines football team');
		assert.strictEqual(nom, 'Wizardman');
		assert.strictEqual(date, '2010-12-21');
	});

	it('getCurrentUsername', async function () {
		this.timeout(10000);
		assert.strictEqual(await getCurrentUsername('Dr. Blofeld', '2018-01-01'), 'Encyclopædius');
		assert.strictEqual(await getCurrentUsername('DeltaQuad', '2020-06-20'), 'AmandaNP');
		assert.strictEqual(await getCurrentUsername('DeltaQuad', '2020-06-26T11:00:00Z'), 'DeltaQuad (usurp)');
		assert.strictEqual(await getCurrentUsername('DeltaQuad', '2020-06-27'), 'DeltaQuad');

		// old renames - legacy log formats
		assert.strictEqual(await getCurrentUsername('Santros57Q', '2008-01-06'), 'Santos25Q');
		assert.strictEqual(await getCurrentUsername('HInBC', '2006-01-01'), 'H');
	});

});