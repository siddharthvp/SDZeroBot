const {bot} = require('../botbase');
const assert = require('assert');
const {populateWikidataShortdescs} = require("./commons");

describe('commons', () => {
	before('login', async function () {
		await bot.getTokensAndSiteInfo();
	});

	it('populateWikidataShortdescs', async function () {
		const tableInfo = {};
		tableInfo['Celeste (video game)'] = {}; // wd label different from enwiki article title
		tableInfo['Wipeout Omega Collection'] = {};
		tableInfo['Mario & Sonic at the London 2012 Olympic Games'] = {
			shortdesc: 'existing shortdesc'
		};
		await populateWikidataShortdescs(tableInfo);
		assert.strictEqual(tableInfo['Wipeout Omega Collection'].shortdesc, '2017 racing game compilation');
		assert.strictEqual(tableInfo['Celeste (video game)'].shortdesc, '2018 video game');
		assert.strictEqual(tableInfo['Mario & Sonic at the London 2012 Olympic Games'].shortdesc, 'existing shortdesc');
	});

});
