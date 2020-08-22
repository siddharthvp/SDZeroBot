const {log} = require('../botbase');
const sqlite3 = require('sqlite3').verbose();

(async function() {

let db = new sqlite3.Database('./g13.db', async (err) => {
	if (err) {
		console.error(err.message);
	}
	log('[S] Connected to the g13 database.');
});

db.each(`SELECT * FROM g13 `, [], (err, row) => {
	if (err) throw err;
	console.log(row);
});

})();