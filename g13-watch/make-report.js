// npm run make

const {bot, log, emailOnError, mwn} = require('../botbase');
const sqlite3 = require('sqlite3').verbose();
const xdate = require('../xdate');

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

let end = new xdate();
let start = new xdate().subtract(24, 'hours');

db.each(`
	SELECT * FROM g13
	WHERE ts > ?
	AND ts < ?
`, [start.getTime() / 1000, end.getTime() / 1000], (err, row) => {

	if (err) throw err;

	let page = `[[${row.name}]]`;
	if (row.desc) {
		page += ` <small>${row.desc}</small>`
	}

	table.addRow([
		new xdate(row.ts * 1000).format('YYYY-MM-DD HH:mm'),
		page,
		row.excerpt || ''
	]);

}, async () => {

	let wikitable = table.getText();
	let yesterday = new xdate().subtract(1, 'day');

	let text = 
`<templatestyles src="User:SD0001/grid-styles.css" />
Drafts nominated for G13 ― ${yesterday.format('YYYY-MM-DD')} ― SDZeroBot

For older G13s, please see {{history|2=page history}}
${wikitable}`;

	await bot.save('User:SDZeroBot/G13 Watch', text, 'Updating G13 report');

	log(`[i] Finished`);

});

// Delete data more than 3 days old:
let ts_3days_old = new xdate().subtract(72, 'hours').getTime() / 1000;

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
