// npm run make

const {bot, log, emailOnError, mwn} = require('../botbase');
const sqlite3 = require('sqlite3').verbose();

process.chdir(__dirname);

(async function() {

let db = new sqlite3.Database('./g13.db', (err) => {
	if (err) {
		throw err;
	}
	log('[S] Connected to the g13 database.');
});

await bot.getTokensAndSiteInfo();

let table = new mwn.table();
table.addHeaders([
	{label: 'Date', style: 'width: 5em'},
	{label: 'Draft', style: 'width: 18em'},
	{label: 'Excerpt'}
]);

let end = new bot.date().setHours(0,0,0,0);
let start = new bot.date().subtract(24, 'hours').setHours(0,0,0,0);

let count = 0;

db.each(`
	SELECT * FROM g13
	WHERE ts > ?
	AND ts < ?
`, [start.getTime() / 1000, end.getTime() / 1000], (err, row) => {

	if (err) throw err;
	count += 1;

	let page = `[[${row.name}]]`;
	if (row.desc) {
		page += ` <small>${row.desc}</small>`
	}

	table.addRow([
		new bot.date(row.ts * 1000).format('YYYY-MM-DD HH:mm'),
		page,
		row.excerpt || ''
	]);

}, async () => {

	let wikitable = table.getText();
	let yesterday = new bot.date().subtract(1, 'day');

	let page = new bot.page('User:SDZeroBot/G13 Watch');

	let oldlinks = (await page.history('timestamp|ids', 3)).map(rev => {
		let date = new bot.date(rev.timestamp).subtract(24, 'hours');
		return `[[Special:Permalink/${rev.revid}|${date.format('D MMMM')}]]`;
	}).join(' - ') + ' - {{history|2=older}}';

	let text = `{{/header|count=${count}|date=${yesterday.format('D MMMM YYYY')}|ts=~~~~~|oldlinks=${oldlinks}}}` 
		+ `\n\n${wikitable}`;

	await page.save(text, 'Updating G13 report').catch(async err => {
		if (err.code === 'spamblacklist') {
			for (let site of err.response.error.spamblacklist.matches) {
				text = text.replace(
					new RegExp('https?:\\/\\/' + site, 'g'),
					site
				);
			}
			await page.save(text, 'Updating G13 report');
		} else {
			return Promise.reject(err);
		} 
	});

	log(`[i] Finished`);

});

// Delete data more than 3 days old:
let ts_3days_old = Math.round(new bot.date().subtract(72, 'hours').getTime() / 1000);

db.run(`
	DELETE FROM g13
	WHERE ts < ?
`, [ts_3days_old], (err) => {
	if (err) {
		throw err;
	}
	log(`[S] Deleted data more than 3 days old`);
});


})().catch(err => emailOnError(err, 'g13-watch-save'));
