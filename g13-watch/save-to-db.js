// start job using: npm run start

const {bot, log, emailOnError} = require('../botbase');
const EventSource = require('eventsource');
const TextExtractor = require('../TextExtractor')(bot);
const sqlite3 = require('sqlite3').verbose();

process.chdir(__dirname);

(async function() {

await bot.getTokensAndSiteInfo();

let stream = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');
stream.onopen = function() {
	log('[S] Opened eventsource connection');
};
stream.onerror = function(event) {
	log('[E] Error: eventsource connection');
	console.log('--- Encountered error', event);
};

let db = new sqlite3.Database('./g13.db', (err) => {
	if (err) {
		throw err;
	}
	log('[S] Connected to the g13 database.');
});
db.get(`SELECT * FROM sqlite_master WHERE type='table'`, [], (err, row) => {
	if (err) throw err;
	if (!row) {
		db.run(`CREATE TABLE g13(
			name varbinary(255) unique, 
			desc varbinary(500),
			excerpt varbinary(1500),
			ts int not null
		)`);
	}
});

stream.onmessage = async function(event) {
	let data = JSON.parse(event.data);
	if (data.wiki !== 'enwiki') return;
	if (data.type !== 'categorize') return;
	if (data.title !== 'Category:Candidates for speedy deletion as abandoned drafts or AfC submissions') return;

	let ts = data.timestamp;
	let title = data.comment.match(/\[\[:(.*?)\]\]/)[1];
	let pagedata = await bot.read(title, {prop: 'revisions|description'});
	let text = pagedata.revisions[0].content;
	let desc = pagedata.description;
	let extract = TextExtractor.getExtract(text, 300, 550);

	db.run(`INSERT INTO g13 VALUES(?, ?, ?, ?)`, [title, desc, extract, ts], (err) => {
		if (!err) return;
		// amazing how this library doesn't have object-oriented error handling ...
		if (err.message.startsWith('SQLITE_CONSTRAINT: UNIQUE constraint failed: g13.name')) {
			log(`[W] ${title} entered category more than once`);
			return;
		}
		throw err;
	});

};
	
})().catch(err => emailOnError(err, 'g13-watch-db'));