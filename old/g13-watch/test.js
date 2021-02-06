// start job using: npm run start

const {log, toolsdb} = require('./botbase');

(async function main() {


	const db = await new toolsdb().connect('g13watch_p');

	log('[S] Connected to the g13 database.');

	let [title, desc, extract, size, ts] = ['aplaca', 'fdsdf', 'ewrw', 45, 324];

	try {
		await db.execute(`INSERT INTO g13 VALUES(?, ?, ?, ?, ?)`, [title, desc, extract, size, ts]);
	} catch (err) {
		if (err.code === 'ER_DUP_ENTRY') {
			return;
		}
		throw err;
	}

})()