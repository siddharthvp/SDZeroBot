const {bot, log, Mwn, emailOnError} = require('../botbase');
const {formatSummary, saveWithBlacklistHandling} = require('./commons');

(async function() {

	await bot.getTokensAndSiteInfo();
	var grid = new bot.Page('User:SDZeroBot/PROD grid');

	var userlink = function(user) {
		return `[[User:${user}|${user}]]`;
	}

	var formatComment = function(comment) {
		return `<small>${formatSummary(comment)}</small>`;
	}

	async function main(date, subpage) {

		var pages = {};

		var deprodded = new Set(),
			afdkept = new Set(),
			afdstillopen = new Set(),
			deleted = new Set(),
			afddeleted = new Set(),
			others = new Set(),
			movedpagefollowed = new Set(),
			faileddeprodget = new Set();

		await grid.history('content', 1, {
			rvstart: date.toISOString(),
			rvuser: 'SDZeroBot'
		}).then(revs => {
			let rev = revs[0];
			var wikitable = rev.content.slice(rev.content.indexOf('{|'));
			var parsedtable = bot.Wikitext.parseTable(wikitable);
			log(`Found ${parsedtable.length} rows in revision`);

			for (let item of parsedtable) {
				let pagename = item.Article.replace(/<small>.*?<\/small>/, '')
					.replace(/\[\[(.*?)\]\]/, '$1').trim();
				pages[pagename] = {
					article: item.Article,
					excerpt: item.Extract.slice(0, 500) + (item.Extract.length > 500 ? ' ...' : ''),
				};
			}
		});

		let totalcount = Object.keys(pages).length;
		log(`[S] extracted pages from grid. Found ${totalcount} pages`);

		// Get PROD concern as well from User:SDZeroBot/PROD sorting ?

		var prodRgx = /\{\{(Proposed deletion|Prod blp)\/dated/;
		var redirectRgx = /^\s*#redirect\s*\[\[(.*?)\]\]/i;

		await bot.batchOperation(Object.keys(pages), function pageWorker(page) {
			let pageobj = new bot.Page(page);

			return pageobj.history('comment|user|content|timestamp', 50, {
				rvsection: 0
			}).then(revs => {
				let currenttext = revs[0].content;

				let prodRgxMatch = currenttext.match(prodRgx);
				if (prodRgxMatch) {
					others.add(page);
					pages[page].note = `Page still has a PROD tag`;
					return;
				}

				let redirectRgxMatch = currenttext.match(redirectRgx);
				if (redirectRgxMatch) {
					pages[page].redirecttarget = redirectRgxMatch[1];

					// check who redirected it and why
					let prevuser = null, prevcomment = null;

					for (let rev of revs) {

						if (!redirectRgx.test(rev.content)) { // not a redirect

							pages[page].note = `Redirected to [[${pages[page].redirecttarget}]] by ${userlink(prevuser)}: ${formatComment(prevcomment)}`;
							others.add(page);
							return; // TODO: also find out who de-prodded it, if different

						} else { // redirect, check if this edit is a page move

							let moveCommentRgx = new RegExp(
								`^${Mwn.util.escapeRegExp(rev.user)} moved page \\[\\[${Mwn.util.escapeRegExp(page)}\\]\\] to \\[\\[(.*?)\\]\\]`
							);
							let match = rev.comment.match(moveCommentRgx);
							if (match) {
								// indeed this was a page move, open the target page now
								let target = match[1];

								// non-mainspace target (draftspace?), don't follow
								if (bot.Title.newFromText(target).namespace !== 0) {
									pages[page].note = rev.comment; // this will have full desc of what happend
									others.add(page);
									return;
								}

								pages[target] = pages[page]; // copy over data
								// update title, keeping the shortdesc
								pages[target].article = pages[page].article.replace(/^\[\[.*?\]\]/, '[[' + target + ']]');
								movedpagefollowed.add(target);
								return pageWorker(target); // recurse
							}
						}
						prevuser = rev.user;
						prevcomment = rev.comment;
					}

					// if we reach here check if it was recreated after deletion (most likely)
					return pageobj.logs('user|comment|timestamp', 1, 'delete/delete').then(logs => {
						let firstrev = revs[revs.length-1];
						if (logs.length && new Date(logs[0].timestamp) < new Date(firstrev.timestamp)) {
							// yes
							pages[page].note = `Deleted by ${userlink(logs[0].user)}: ${formatComment(logs[0].comment)}\n\n` +
							`Recreated as redirect by ${userlink(firstrev.user)}: ${formatComment(firstrev.comment)}`;
							others.add(page);

						} else {
							pages[page].note = `[Could not determine status]`;
							others.add(page);
						}
					});

				}

				// check who de-prodded it
				let prevuser = null, prevcomment = null;
				for (let rev of revs) {
					if (prodRgx.test(rev.content)) {
						pages[page].deproder = prevuser;
						pages[page].comment = prevcomment;
						pages[page].note = `De-prodded by ${userlink(pages[page].deproder)} with comment: ${formatComment(pages[page].comment)}`;

						// check if it was AFD'd later after de-prodding
						return bot.search('prefix:Wikipedia:Articles for deletion/' + page, 5, '', {
							srsort: 'create_timestamp_desc' // get most recent afd first if there are multiple
						}).then(afds => {
							var sanityRgx = new RegExp('Wikipedia:Articles for deletion/' + Mwn.util.escapeRegExp(page) + '( \\((2nd|3rd|\\dth) nomination\\))?$');
							for (let afd of afds) {
								if (!sanityRgx.test(afd.title)) {
									continue;
								}
								return bot.read(afd.title).then(pg => {
									// check this isn't an altogether old AfD
									if (new Date(pg.revisions[0].timestamp) < new Date(rev.timestamp)) {
										return;
									}
									let text = pg.revisions[0].content;
									if (/\{\{REMOVE THIS TEMPLATE WHEN CLOSING THIS AfD/.test(text)) {
										pages[page].note += `\n\nNominated to [[${afd.title}|AfD]]. Still open.`;
										afdstillopen.add(page);
									} else {
										let boldeds = text.match(/'''.*?'''/g);
										let result = boldeds[1] ? boldeds[1].slice(3, -3) : '<undetermined>';
										pages[page].note += `\n\nNominated to [[${afd.title}|AfD]]. Closed as ${result}`;
										afdkept.add(page);
									}
								});
							}

							// if we get here, that means we didn't find any AfDs
							deprodded.add(page);
						});
					}
					prevuser = rev.user;
					prevcomment = rev.comment;
				}

				// if we reach here check if it was recreated after deletion (most likely)
				// duplicates some code above for the redirect case
				return pageobj.logs('user|comment|timestamp', 1, 'delete/delete').then(logs => {
					var firstrev = revs[revs.length-1];
					if (logs.length && new Date(logs[0].timestamp) < new Date(firstrev.timestamp)) {
						// yes
						pages[page].note = `Deleted by ${logs[0].user}: ${formatComment(logs[0].comment)}\n\n` +
						`Recreated by ${userlink(firstrev.user)}: ${formatComment(firstrev.comment)}`;
						others.add(page);

					} else {
						log(`[W] Failed to get de-prodding of ${page}`);
						pages[page].note = `[Could not determine status]`;
						others.add(page);
						faileddeprodget.add(page);
					}
				});

			}).catch(err => {
				if (err.code !== 'missingtitle') {
					return Promise.reject(err);
				}
				// Article doesn't exist. Check deletion log
				return pageobj.logs(null, 1, 'delete/delete').then(logs => {

					if (logs.length) {
						// let prod_comment_rgx = 'Expired [[WP:PROD|PROD]], concern was:';
						// let isProd = logs[0].comment.startsWith(prod_comment_rgx);

						let afd_comment_rgx = /^\[\[Wikipedia:Articles for deletion\//;
						let isAfd = afd_comment_rgx.test(logs[0].comment);
						pages[page].note = `Deleted by ${userlink(logs[0].user)}: ${formatComment(logs[0].comment)}`;
						if (isAfd) {
							afddeleted.add(page);
						} else {
							deleted.add(page);
						}

					} else {
						// Nothing in the deletion log? Check move log then
						return pageobj.logs('details|user|comment', 1, 'move').then(movelogs => {
							if (movelogs.length === 0) {
								log(`[W] wherabouts of ${page} are unknown`);
								pages[pages].note = `[Couldn't determine status]`;
								others.add(page);
							} else {
								let move = movelogs[0];
								if (move.params.target_title === 'Draft:' + page) {
									pages[page].note = `Draftified to [[${move.params.target_title}]] by ${userlink(move.user)}: ${formatComment(move.comment)}`;
									others.add(page);
								} else {
									let target = move.params.target_title;

									// non-mainspace target, don't follow
									if (bot.Title.newFromText(target).namespace !== 0) {
										pages[page].note = `Moved to [[${target}]] by ${userlink(move.user)}: ${formatComment(move.comment)}`;
										others.add(page);
										return;
									}

									// follow the redirect
									pages[target] = pages[page]; // copy over data
									// update title, keeping the shortdesc
									pages[target].article = pages[page].article.replace(/^\[\[.*?\]\]/, '[[' + target + ']]');
									movedpagefollowed.add(target);
									return pageWorker(target); // recurse
								}
							}
						});
					}
				});
			});
		}, 10, 2).then(ret => {

			log(`[E] failures:`);
			console.log(ret.failures);

		});

		log(`[S] analysis complete`);

		// console.log('De-prodded: ' + JSON.stringify([...deprodded], null, 2));
		console.log('afddeleted: ' + JSON.stringify([...afddeleted], null, 2));
		console.log('others: ' + JSON.stringify([...others], null, 2));
		console.log('movedpagefollowed: ' + JSON.stringify([...movedpagefollowed], null, 2));
		console.log('faileddeprodget: ' + JSON.stringify([...faileddeprodget], null, 2));


		var makeTable = function(header3, set) {
			var table = new Mwn.Table();
			table.addHeaders([
				{ style: 'width: 15em;', label: `Article`},
				{ style: 'width: 25em;', label: `Excerpt`},
				header3
			]);
			for (let page of set) {
				table.addRow([
					pages[page].article,
					`<small>${pages[page].excerpt}</small>`,
					pages[page].note
				]);
			}
			return table.getText();
		};

		let deprodtable = makeTable('De-prodding', deprodded);
		let afdstillopentable = makeTable('De-prodding and AfD', afdstillopen);
		let afdkepttable = makeTable('De-prodding and AfD', afdkept);
		let afddeletedtable = makeTable('Deletion', afddeleted);
		let deletedtable = makeTable('Deletion', deleted);
		let othertable = makeTable('Others', others);

		let text =

		`{{User:SDZeroBot/PROD Watch/header|count=${totalcount}|date=${date.format('D MMMM YYYY')}|ts=~~~~~}}<includeonly><section begin=lastupdate />${new bot.Date().toISOString()}<section end=lastupdate /></includeonly>
		
		==De-prods (${deprodded.size})==
		${deprodtable}
		
		==Contested de-prods (${afdkept.size + afdstillopen.size + afddeleted.size})==
		${afdstillopen.size ? `\n===AfDs still open (${afdstillopen.size})===\n${afdstillopentable}\n` : ''}
		===Kept at AfD (${afdkept.size})===
		${afdkepttable}
		
		===Deleted at AfD (${afddeleted.size})===
		${afddeletedtable}
		
		==Others (${others.size})==
		${othertable}
		
		==Deleted (${deleted.size})==
		${deletedtable}
		`.replace(/^\t\t/mg, ''); // remove tabs because of the indentation in this file

		await saveWithBlacklistHandling(new bot.Page(`User:SDZeroBot/PROD Watch/${subpage}`), text, 'Updating report');

	}

	// Triggers:

	await main(new bot.Date().subtract(7, 'days'), 'last week');
	await main(new bot.Date().subtract(14, 'days'), 'last fortnight');
	await main(new bot.Date().subtract(28, 'days'), 'last month');

	log(`[i] Finished`);

})().catch(err => emailOnError(err, 'prod-watch'));
