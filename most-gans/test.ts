import assert = require("assert");
import { bot } from "../botbase";
import {getCurrentUsername, processArticle, db, getCurrentTitle, decodeHtmlEntities} from "./model";

describe('most-gans', () => {
	before(() => {
		return bot.getSiteInfo();
	})

	async function processArticleTest(article: string, nomExpected: string, dateExpected?: string) {
		db.run = () => Promise.resolve(); // stub it out
		const [nom, date] = await processArticle(article);
		assert.strictEqual(nom, nomExpected);
		if (dateExpected) assert.strictEqual(date, dateExpected);
	}

	it('1896 Michigan Wolverines football team', async function() {
		await processArticleTest('1896 Michigan Wolverines football team', 'Wizardman', '2010-12-21');
	})
	it('Fight for This Love', async function() {
		await processArticleTest('Etchmiadzin Cathedral', 'Yerevantsi', '2013-12-27');
	})
	it('Norman Finkelstein', async function() {
		this.timeout(	10000);
		await processArticleTest('Norman Finkelstein', 'Giggy');
	})
	it('Etchmiadzin Cathedral', async function() {
		// user renamed between nomination and promotion
		await processArticleTest('Etchmiadzin Cathedral', 'Yerevantsi', '2013-12-27');
	})
	it('Panagiotis Stamatakis', async function() {
		await processArticleTest('Panagiotis Stamatakis', 'UndercoverClassicist', '2023-02-04');
	})
	it('Serious Sam: The First Encounter', async function() {
		await processArticleTest('Serious Sam: The First Encounter', 'IceWelder', '2023-10-30');
	})
	it('The Wing of Madoola', async function() {
		await processArticleTest('The Wing of Madoola', 'KGRAMR', '2023-12-28')
	})
	it('A Little Kiss', async function() {
		// apostrophe in username, html entities in signature
		await processArticleTest('A Little Kiss', "Penny Lane's America");
	})
	it('After Hours (The Office)', async function() {
		await processArticleTest('After Hours (The Office)', '');
	})

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

	it('decodeHtmlEntities', function () {
		assert.strictEqual(
			decodeHtmlEntities('[[User:NoD&#39;ohnuts|NoD&#39;ohnuts]] ([[User talk:NoD&#39;ohnuts|talk]])'),
			"[[User:NoD'ohnuts|NoD'ohnuts]] ([[User talk:NoD'ohnuts|talk]])"
		);
	});

});
