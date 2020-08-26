// start job using: npm run start

const {bot, log, emailOnError} = require('../botbase');
const EventSource = require('eventsource');
const TextExtractor = require('../TextExtractor')(bot);
const sqlite3 = require('sqlite3');
const sqlite = require('sqlite');
const xdate = require('../xdate');

process.chdir(__dirname);


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

	const firstrow = await db.get(`SELECT ts FROM g13 ORDER BY ts DESC`);
	
	const lastTs = firstrow ? new Date(firstrow.ts * 1000).toISOString() : 
		new Date().toISOString();

	const stream = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange?since=' + lastTs, {
		headers: {
			'User-Agent': 'w:en:User:SDZeroBot'
		}
	});
	stream.onopen = function() {
		log('[S] Opened eventsource connection');
	};
	stream.onerror = function(event) {
		log('[E] Error: eventsource connection');
		console.log('--- Encountered error', event);
		// should we throw here?
	};

	stream.onmessage = async function(event) {
		let data = JSON.parse(event.data);
		if (data.wiki !== 'enwiki') return;
		if (data.type !== 'categorize') return;
		if (data.title !== 'Category:Candidates for speedy deletion as abandoned drafts or AfC submissions') return;

		let match = /^\[\[:(.*?)\]\] added/.exec(data.comment);
		if (!match) {
			return;
		}
		let title = match[1];
		let ts = data.timestamp;
		log(`[+] Page ${title} at ${new xdate(ts * 1000).format('YYYY-MM-DD HH:mm:ss')}`);
		let pagedata = await bot.read(title, {prop: 'revisions|description'});
		let text = pagedata.revisions[0].content;
		let desc = pagedata.description;
		let extract = TextExtractor.getExtract(text, 300, 550);

		try {
			await db.run(`INSERT INTO g13 VALUES(?, ?, ?, ?)`, [title, desc, extract, ts]);
		} catch (err) {
			// amazing how this library doesn't have object-oriented error handling ...
			if (err.message.startsWith('SQLITE_CONSTRAINT: UNIQUE constraint failed: g13.name')) {
				log(`[W] ${title} entered category more than once`);
				return;
			}
			throw err;
		}
	};
	
}

main().catch(err => {
	emailOnError(err, 'g13-watch-db');
	main();
});
