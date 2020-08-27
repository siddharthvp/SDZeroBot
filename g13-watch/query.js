const {log, argv} = require('../botbase');

const sqlite3 = require('sqlite3');
const sqlite = require('sqlite');

(async function() {
	
	const db = await sqlite.open({
		filename: './g13.db',
		driver: sqlite3.Database
	});

	log('[S] Connected to the g13 database.');

	log(await db.get(argv._));

})();
