const {bot, log, emailOnError, mwn} = require('../botbase');
const sqlite3 = require('sqlite3').verbose();

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

let end = new Date();
let start = new Date(); start.setHours(start.getHours() - 24);

const formatTimeStamp = function(date) {
	`${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate} ${date.getUTCHours}:${date.getUTCMinutes}`
};

db.each(`
	SELECT * FROM g13 
	WHERE ts > ?
	AND ts < ?
`, [start.getTime() / 1000, end.getTime() / 1000], (err, row) => {
	
	if (err) throw err;
	
	let page = row.title;
	if (row.desc) {
		page += ` <small>${row.desc}</small>`
	}

	table.addRow([
		formatTimeStamp(new Date(row.ts * 1000)),
		page,
		row.excerpt || ''
	]);

});

console.log(table.getText());
	

})().catch(err => emailOnError(err, 'g13-watch-save'));