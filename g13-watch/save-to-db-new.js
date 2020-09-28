// start job using: npm run start

const {bot, log, toolsdb, emailOnError} = require('../botbase');
const EventSource = require('eventsource');
const TextExtractor = require('../TextExtractor')(bot);

async function main() {

	await bot.getSiteInfo();
	bot.options.suppressAPIWarnings = true; // ignore rvslots errors

	const db = await new toolsdb().connect('g13watch_p');

	log('[S] Connected to the g13 database.');

	await db.execute(`
		CREATE TABLE IF NOT EXISTS g13(
			name varchar(255) unique, 
			description varchar(255), 
			excerpt blob, 
			size int, 
			ts int not null
		) COLLATE 'utf8_unicode_ci'
	`); // use utf8_unicode_ci so that MariaDb allows a varchar(255) field to have unique constraint
	// max index column size is 767 bytes. 255*3 = 765 bytes with utf8, 255*4 = 1020 bytes with utf8mb4 

	const firstrow = await db.query(`SELECT ts FROM g13 ORDER BY ts DESC LIMIT 1`)[0];

	const lastTs = firstrow ?
		new bot.date(firstrow.ts * 1000).toISOString() :
		new bot.date().toISOString();

	const stream = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange?since=' + lastTs, {
		headers: {
			'User-Agent': 'w:en:User:SDZeroBot'
		}
	});
	stream.onopen = function () {
		log('[S] Opened eventsource connection');
	};
	stream.onerror = function (event) {
		log('[E] Error: eventsource connection');
		console.log('--- Encountered error', event);
		// should we throw here?
	};

	stream.onmessage = async function (event) {
		try {
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
			log(`[+] Page ${title} at ${new bot.date(ts * 1000).format('YYYY-MM-DD HH:mm:ss')}`);
			let pagedata = await bot.read(title, {
				prop: 'revisions|description', 
				rvprop: 'content|size'
			});
			let text = pagedata.revisions && pagedata.revisions[0] && pagedata.revisions[0].content;
			let size = text && pagedata.revisions[0].size;
			let desc = pagedata.description;
			if (desc && desc.size > 255) {
				desc = desc.slice(0, 250) + ' ...';
			}
			let extract = text && TextExtractor.getExtract(text, 300, 550, function preprocessHook(text) {
				let wkt = new bot.wikitext(text);
				wkt.parseTemplates({
					namePredicate: name => {
						return /infobox/i.test(name) || name === 'AFC submission';
					}
				});
				for (let template of wkt.templates) {
					wkt.removeEntity(template);
				}
				return wkt.getText();
			});
	
			try {
				await db.execute(`INSERT INTO g13 VALUES(?, ?, ?, ?, ?)`, [title, desc, extract, size, ts]);
			} catch (err) {
				if (err.code === 'ER_DUP_ENTRY') {
					log(`[W] ${title} entered category more than once`);
					return;
				}
				throw err;
			}
		} catch (err) {
			emailOnError(err, 'g13-watch-db');
		}

	};

}

main().catch(err => {
	emailOnError(err, 'g13-watch-db');
	main();
});