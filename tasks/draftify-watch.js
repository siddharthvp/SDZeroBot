const {bot, mwn, log, xdate, utils, emailOnError} = require('../botbase');
const TextExtractor = require('../TextExtractor')(bot);

(async () => {

	await bot.getTokensAndSiteInfo();

	var ts1 = new xdate().subtract(8, 'days'); 
	ts1.setHours(0, 0, 0, 0);
	var ts2 = new xdate().subtract(1, 'day');
	ts2.setHours(0, 0, 0, 0);

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

			// skip moves to draft done during round-robin pageswap process usually using [[User:Andy M. Wang/pageswap]]
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
				// page doesn't exist, check the logs to see what happened to it
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
				tableInfo[page.title].footer = true;
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
							tableInfo[page.title].footer = true;
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

	let tableHeaders = [
		{ style: 'width: 6em;', label: 'Creation date' },
		{ style: 'width: 15em', label: 'Titles' },
		{ style: 'width: 23em', label: 'Excerpt' },
		{ style: 'width: 7em', label: `User` },
		{ label: `Move summary` },
	];

	var maintable = new mwn.table();
	maintable.addHeaders(tableHeaders);

	let footertable = new mwn.table();
	footertable.addHeaders(tableHeaders);

	for (let [page, data] of Object.entries(tableInfo)) {

		let table = data.footer ? footertable : maintable;

		// split large usernames into 14 characters per line to prevent them from
		// causing the username field to be too wide
		var user = utils.arrayChunk(data.user.split(''), 14).map(e => e.join('')).join('<br>');

		table.addRow([
			data.created ? new xdate(data.created).format('YYYY-MM-DD') : '',
			`[[${page}]] <small>(moved from [[${data.source}]])</small>`,
			`<small>${data.excerpt || ''}</small>`,
			`[[User:${data.user}|${user}]]`,
			`<small>${data.comment || ''}</small>`,
		]);
	}
	
	let text = `{{/header|count=${Object.keys(tableInfo).length}|date1=${ts1.format('D MMMM YYYY')}|date2=${ts2.format('D MMMM YYYY')}|ts=~~~~~}}` +
	`\n\n` + TextExtractor.finalSanitise(maintable.getText()) + 
	`\n\n==Moved back or deleted==` + 
	`\n` + TextExtractor.finalSanitise(footertable.getText());

	await bot.save('User:SDZeroBot/Draftify Watch', text, 'Updating report');

	log('[i] Finished');

})().catch(err => emailOnError(err, 'draftify-watch'));
