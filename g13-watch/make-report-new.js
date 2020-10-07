// npm run make

const {bot, log, toolsdb, emailOnError, mwn} = require('../botbase');

(async function() {

await bot.getTokensAndSiteInfo();

const db = await new toolsdb('g13watch_p').connect();
log('[S] Connected to the g13 database.');

let table = new mwn.table();
table.addHeaders([
	{label: 'Date', style: 'width: 5em'},
	{label: 'Draft', style: 'width: 18em'},
	{label: 'Size', style: 'width: 4em'},
	{label: 'Excerpt'}
]);

let end = new bot.date().setUTCHours(0,0,0,0);
let start = new bot.date().subtract(24, 'hours').setUTCHours(0,0,0,0);

let count = 0;

const result = await db.query(`
	SELECT * FROM g13
	WHERE ts > ?
	AND ts < ?
`, [start.getTime() / 1000, end.getTime() / 1000]);

result.forEach(row => {
	count += 1;

	let page = `[[${row.name}]]`;
	if (row.desc) {
		page += ` <small>${row.desc}</small>`
	}

	table.addRow([
		new bot.date(row.ts * 1000).format('YYYY-MM-DD HH:mm'),
		page,
		row.size,
		row.excerpt || ''
	]);
});

let wikitable = table.getText();
let yesterday = new bot.date().subtract(1, 'day');

let page = new bot.page('User:SDZeroBot/G13 Watch/new');

// let oldlinks = (await page.history('timestamp|ids', 3)).map(rev => {
// 	let date = new bot.date(rev.timestamp).subtract(24, 'hours');
// 	return `[[Special:Permalink/${rev.revid}|${date.format('D MMMM')}]]`;
// }).join(' - ') + ' - {{history|2=older}}';

let text = `{{/header|count=${count}|date=${yesterday.format('D MMMM YYYY')}|ts=~~~~~|oldlinks=}}<includeonly><section begin=lastupdate />${new bot.date().toISOString()}<section end=lastupdate /></includeonly>` 
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

// Delete data more than 3 days old:
let ts_3days_old = Math.round(new bot.date().subtract(72, 'hours').getTime() / 1000);
await db.run(`DELETE FROM g13 WHERE ts < ?`, [ts_3days_old]);
db.end();

log(`[S] Deleted data more than 3 days old`);

log(`[i] Finished`);

})().catch(err => emailOnError(err, 'g13-watch-save'));
