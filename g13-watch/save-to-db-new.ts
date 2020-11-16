// start job using: npm run start

import {fs, bot, log, toolsdb, emailOnError, mysql} from '../botbase';

const {preprocessDraftForExtract} = require('../tasks/commons');
const TextExtractor = require('../TextExtractor')(bot);
const auth = require('../.auth');

async function main() {

	await bot.getSiteInfo();
	log(`[S] Started`);

	// Create a pool, but almost all the time only one connection will be used
	// Each pool connection is released immediately after use
	const pool = mysql.createPool({
		host: 'tools.db.svc.eqiad.wmflabs',
		user: auth.db_user,
		password: auth.db_password,
		port: 3306,
		database: 's54328__g13watch_p',
		waitForConnections: true,
		connectionLimit: 5,
		queueLimit: 10
	});

	await pool.execute(`
		CREATE TABLE IF NOT EXISTS g13(
			name varchar(255) unique,
			description varchar(255),
			excerpt blob,
			size int,
			ts int not null
		) COLLATE 'utf8_unicode_ci'
	`); // use utf8_unicode_ci so that MariaDb allows a varchar(255) field to have unique constraint
	// max index column size is 767 bytes. 255*3 = 765 bytes with utf8, 255*4 = 1020 bytes with utf8mb4

	const firstrow = await pool.query(`SELECT ts FROM g13 ORDER BY ts DESC LIMIT 1`)[0];

	log(`[i] firstrow ts: ${firstrow.ts}`);
	let stream = new bot.stream('recentchange', {
		since: firstrow ?
			new bot.date(firstrow.ts * 1000):
			new bot.date().subtract(20, 'minutes')
	});

	stream.addListener({
		wiki: 'enwiki',
		type: 'categorize',
		title: 'Category:Candidates for speedy deletion as abandoned drafts or AfC submissions'
	}, async (data) => {
		let match = /^\[\[:(.*?)\]\] added/.exec(data.comment);
		if (!match) {
			return;
		}

		let title = match[1];
		let ts = data.timestamp;
		log(`[+] Page ${title} at ${new bot.date(ts * 1000).format('YYYY-MM-DD HH:mm:ss')}`);
		let pagedata = await bot.read(title, {
			prop: 'revisions|description',
			rvprop: 'content|size'
		});
		let text = pagedata?.revisions[0]?.content;
		let size = pagedata.revisions[0].size;
		let desc = pagedata.description;
		if (desc && desc.size > 255) {
			desc = desc.slice(0, 250) + ' ...';
		}
		let extract = TextExtractor.getExtract(text, 300, 550, preprocessDraftForExtract);

		fs.appendFile(
			__dirname + '/db-new.txt',
			JSON.stringify([title, desc, extract, size, ts]) + '\n',
			console.log
		);

		let conn;
		try {
			conn = await pool.getConnection();
			await conn.execute(`INSERT INTO g13 VALUES(?, ?, ?, ?, ?)`, [title, desc, extract, size, ts]);
		} catch (err) {
			if (err.code === 'ER_DUP_ENTRY') {
				log(`[W] ${title} entered category more than once`);
				return;
			}
			emailOnError(err, 'g13-watch-db');
		} finally {
			await conn.release();
		}
	});
}

while (true) {
	main().catch(err => emailOnError(err, 'g13-watch-db'));
}

