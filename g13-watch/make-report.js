const {bot, log, emailOnError, mwn} = require('../botbase');
const sqlite3 = require('sqlite3').verbose();
const xdate = require('../xdate');

(async function() {

let db = new sqlite3.Database('./g13.db', async (err) => {
	if (err) {
		console.error(err.message);
	}
	log('[S] Connected to the g13 database.');
});

let table = new mwn.table();
table.addHeaders([
	{label: 'Date', style: 'width: 5em'},
	{label: 'Draft', style: 'width: 18em'},
	{label: 'Excerpt'}
]);

let end = new xdate();
let start = new xdate().subtract(24, 'hours');

await db.each(`
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

	let text = `Drafts nominated for G13 ― ${yesterday.format('YYYY-MM-DD')} ― SDZeroBot` 
		+ `\n\nFor older G13s, please see {{history|2=page history}}`
		+ `\n\n${wikitable}`;

	await bot.save('User:SDZeroBot/G13 Watch', text, 'Updating G13 report');

	log(`[i] Finished`);

});


})().catch(err => emailOnError(err, 'g13-watch-save'));
