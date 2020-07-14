const {bot, mwn, log, utils} = require('../botbase');
const TextExtractor = require('../TextExtractor')(bot);

(async () => {

	await bot.loginGetToken();

	var ts1 = new Date()
	ts1.setDate(ts1.getDate() - 8);
	ts1.setHours(0,0,0,0);

	var ts2 = new Date()
	ts2.setDate(ts2.getDate() - 1);
	ts2.setHours(0,0,0,0);

	// fetch page moves
	var tableInfo = await bot.continuedQuery({
		"action": "query",
		"list": "logevents",
		"leprop": "title|user|timestamp|comment|details",
		"letype": "move",
		"lestart": ts1.toISOString(),
		"leend": ts2.toISOString(),
		"ledir": "newer",
		"lenamespace": "0",
		"lelimit": "max"
	}).then(jsons => {
		var moves = jsons.reduce((items, json) => items.concat(json.query.logevents), [])
			.filter(move => move.params.target_ns === 118);

		var tableInfo = {};
		for (let move of moves) {
			var drafttitle = move.params.target_title;

			// skip moves to draft done during round-robin pageswap process usally using [[User:Andy M. Wang/pageswap]]
			if (drafttitle.startsWith('Draft:Move/')) {
				continue;
			}

			tableInfo[drafttitle] = {
				source: move.title,
				user: move.user,
				time: move.timestamp,
				comment: move.comment
			}
		}
		return tableInfo;
	});

	log('[S] Got page moves');

	// fetch page texts
	await bot.read(Object.keys(tableInfo), {
		redirects: false
	}).then(async (pages) => {
		for (let page of pages) {
			if (page.missing) {
				// page doesn't exits, check the logs to see what happened to it
				let pageobj = new bot.page(page.title);
				let logtext, logentry;
				let deletionlog = await pageobj.logs(null, 1, 'delete/delete');
				if (deletionlog.length === 0) {
					let movelog = await pageobj.logs("title|type|user|timestamp|comment|details", 1, 'move');
					if (movelog.length) {
						logentry = movelog[0];
						logtext = `[[User:${logentry.user}|${logentry.user}]] moved page to [[${logentry.params.target_title}]] ${logentry.comment ? `(${logentry.comment})` : ''}`;
					}
				} else {
					logentry = deletionlog[0];
					logtext = `[[User:${logentry.user}|${logentry.user}]] deleted page ${logentry.comment ? `(${logentry.comment})` : ''}`;
				}
				tableInfo[page.title].excerpt = `[''Deleted'']: ${logtext}`;
				continue;

			} else {
				tableInfo[page.title].excerpt = TextExtractor.getExtract(page.revisions[0].content, 300, 500);
				if (tableInfo[page.title].excerpt === '') {
					// empty extract, check if it's a redirect
					let match = page.revisions[0].content.match(/^\s*#redirect\s*\[\[(.*?)\]\]/i);
					if (match && match[1]) {
						let redirectTarget = match[1];
						if (redirectTarget === tableInfo[page.title].source) {
							tableInfo[page.title].excerpt = `[''Moved back'' to [[${redirectTarget}]]]`;
						} else {
							tableInfo[page.title].excerpt = `[''Redirects'' to [[${redirectTarget}]]]`;
						}
					}
				}
			}
		}
	});

	log(`[S] Got article texts`);

	// fetch creation time and user

	await bot.batchOperation(Object.keys(tableInfo), function(page) {
		return bot.request({
			action: 'query',
			titles: page,
			prop: 'revisions',
			rvprop: 'timestamp',
			rvlimit: 1,
			rvdir: 'newer'
		}).then(data => {
			var page = data.query.pages[0];
			if (!page || page.missing) {
				return;
			}
			tableInfo[page.title].creator = page.revisions[0].user;
			tableInfo[page.title].created = page.revisions[0].timestamp;
		});
	}, 30, 4);

	log(`[S] Got creation times and creators`);


	var wikitable = new mwn.table({ sortable: true });
	wikitable.addHeaders([
		{ style: 'width: 6em;', label: 'Creation date' },
		{ style: 'width: 15em', label: 'Titles' },
		{ style: 'width: 23em', label: 'Excerpt' },
		{ style: 'width: 7em', label: `User` },
		{ label: `Move summary` },
	]);

	for (let [page, data] of Object.entries(tableInfo)) {

		// split large usernames into 14 characters per line to prevent them from
		// causing the username field to be too wide
		var user = utils.arrayChunk(data.user.split(''), 14).map(e => e.join('')).join('<br>');

		wikitable.addRow([
			data.created ? ymdDate(new Date(data.created)) : '',
			`[[${page}]] <small>(moved from [[${data.source}]])</small>`,
			`<small>${data.excerpt || ''}</small>`,
			`[[User:${data.user}|${user}]]`,
			`<small>${data.comment || ''}</small>`,
		]);
	}

	var text = `{{/header|count=${Object.keys(tableInfo).length}|date1=${readableDate(ts1)}|date2=${readableDate(ts2)}|ts=~~~~~}}\n` + TextExtractor.finalSanitise(wikitable.getText());

	await bot.save('User:SDZeroBot/DraftifyWatch', text, 'Updating report');

	log(`[i] Done`);

})();

var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var pad = num => num < 10 ? '0' + num : num;

var ymdDate = function(date) {
	return date.getFullYear() + '-' + pad(date.getMonth()) + '-' + pad(date.getDate());
};

var readableDate = function(date) {
	return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
}