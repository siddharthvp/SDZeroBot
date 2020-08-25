// start job using: npm run start

const {bot, log, emailOnError} = require('../botbase');
const sqlite3 = require('sqlite3');
const sqlite = require('sqlite');

// process.chdir(__dirname);


async function main() {

	await bot.getSiteInfo();

	const db = await sqlite.open({
		filename: './g13.db',
		driver: sqlite3.Database
	});

	log('[S] Connected to the g13 database.');

	const res = await db.get(`SELECT * FROM sqlite_master WHERE type='table'`);
	if (!res) {
		await db.run(`CREATE TABLE g13(
			name varbinary(255) unique, 
			desc varbinary(500),
			excerpt varbinary(1500),
			ts int not null
		)`);
	}

	const row = await db.get(`SELECT ts FROM g13 ORDER BY ts DESC`);
	console.log(row);
}

main();