const {bot, log, mwn} = require('../botbase');

(async function() {

await bot.loginGetToken();

var d = new Date();
d.setDate(d.getDate() - 20);
d.setHours(0, 0, 0, 0);

var grid = new bot.page('User:SDZeroBot/PROD grid');

var pages = {};

var deprodded = new Set(),
	deleted = new Set(),
	deletedAtAfd = new Set(),
	others = new Set(),
	movedpagefollowed = new Set(),
	faileddeprodget = new Set();

await grid.history('content|timestamp', 1, {
	rvstart: d.toISOString(),
}).then(revs => {
	let rev = revs[0];
	var wikitable = rev.content.slice(rev.content.indexOf('{|'));
	var parsedtable = bot.wikitext.parseTable(wikitable);
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

// Get PROD concern
// var sorting = new bot.page('User:SDZeroBot/PROD sorting');
// await sorting.history('content', 1, {
// 	rvstart: d.toISOString()
// }).then(revs => {
// 	let rev = revs[0];

// });

var prodRgx = /\{\{(Proposed deletion|Prod blp)\/dated/;
var redirectRgx = /^\s*#redirect\s*\[\[(.*?)\]\]/i;

await bot.batchOperation(Object.keys(pages), function pageWorker(page) {
	let pageobj = new bot.page(page);

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

					pages[page].note = `Redirected to [[${pages[page].redirecttarget}]] by ${userlink(prevuser)}: ${small(prevcomment)}`;
					others.add(page);
					return; // TODO: also find out who de-prodded it, if different

				} else { // redirect, check if this edit is a page move

					// XXX: this is yet uncovered in tests

					let moveCommentRgx = new RegExp(
						`^${mwn.util.escapeRegExp(rev.user)} moved page \\[\\[${mwn.util.escapeRegExp(page)}\\]\\] to \\[\\[(.*?)\\]\\]`
					);
					let match = rev.comment.match(moveCommentRgx);
					if (match) {
						// indeed this was a page move, open the target page now
						let target = match[1];

						// non-mainspace target (draftspace?), don't follow
						if (bot.title.newFromText(target).namespace !== 0) {
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
					pages[page].note = `Deleted by ${userlink(logs[0].user)}: ${small(logs[0].comment)}\n\n` +
					`Recreated as redirect by ${userlink(firstrev.user)}: ${small(firstrev.comment)}`;
					others.add(page);

				} else {
					pages[page].note = `[Could not determine status]`;
					others.add(page);
					return;
				}
			});

		}

		// check who de-prodded it
		let prevuser = null, prevcomment = null;
		for (let rev of revs) {
			if (prodRgx.test(rev.content)) {
				pages[page].deproder = prevuser;
				pages[page].comment = prevcomment;
				pages[page].note = `De-prodded by ${userlink(pages[page].deproder)} with comment: <small>${pages[page].comment || ''}</small>`;

				deprodded.add(page);

				// check if it was AFD'd later after de-prodding
				return bot.search('prefix:Wikipedia:Articles for deletion/' + page, 5, '', {
					srsort: 'create_timestamp_desc' // get most recent afd first if there are multiple
				}).then(afds => {
					var sanityRgx = new RegExp('Wikipedia:Articles for deletion/' + mwn.util.escapeRegExp(page) + '( \\((2nd|3rd|\\dth) nomination\\))?$');
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
							} else {
								let boldeds = text.match(/'''.*?'''/g);
								pages[page].note += `\n\nNominated to [[${afd.title}|AfD]]. Closed as ${boldeds[1] || '<undetermined>'}`;
							}
						});
					}
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
				pages[page].note = `Deleted by ${logs[0].user}: ${small(logs[0].comment)}\n\n` +
				`Recreated by ${userlink(firstrev.user)}: ${small(firstrev.comment)}`;
				others.add(page);

			} else {
				log(`[W] Failed to get de-prodding of ${page}`);
				pages[page].note = `[Could not determine status]`;
				others.add(page);
				faileddeprodget.add(page);
			}
		});

	}).catch(err => {
		if (err !== 'missingarticle') {
			return Promise.reject(err);
		}
		// Article doesn't exist. Check deletion log
		return pageobj.logs(null, 1, 'delete/delete').then(logs => {

			if (logs.length) {
				let prod_comment_rgx = 'Expired [[WP:PROD|PROD]], concern was:';
				let afd_comment_rgx = /\[\[Wikipedia:Articles for deletion\//;

				let isProd = logs[0].comment.startsWith(prod_comment_rgx);
				let isAfd = afd_comment_rgx.test(logs[0].comment);
				pages[page].note = `Deleted by ${userlink(logs[0].user)}: ${small(logs[0].comment)}`;
				if (isAfd) {
					deletedAtAfd.add(page);
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
							pages[page].note = `Draftified to [[${move.params.target_title}]] by ${userlink(move.user)}: ${small(move.comment)}`;
							others.add(page);
						} else {
							let target = move.params.target_title;

							// non-mainspace target, don't follow
							if (bot.title.newFromText(target).namespace !== 0) {
								pages[page].note = `Moved to [[${target}]] by ${userlink(move.user)}: ${small(move.comment)}`;
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
console.log('deletedAtAfd: ' + JSON.stringify([...deletedAtAfd], null, 2));
console.log('others: ' + JSON.stringify([...others], null, 2));
console.log('movedpagefollowed: ' + JSON.stringify([...movedpagefollowed], null, 2));
console.log('faileddeprodget: ' + JSON.stringify([...faileddeprodget], null, 2));


var makeTable = function(header3, set) {
	var table = new mwn.table();
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
let deletedAtAfdTable = makeTable('Deletion', deletedAtAfd);
let deletedtable = makeTable('Deletion', deleted);
let othertable = makeTable('Others', others);

let text =

`{{User:SDZeroBot/ProdWatch/header|count=${totalcount}|date=${readableDate(d)}|ts=~~~~~}}

==De-prodded (${deprodded.size})==
${deprodtable}

==De-prodded but deleted at AfD (${deletedAtAfd.size})==
${deletedAtAfdTable}

==Deleted (${deleted.size})==
${deletedtable}

==Others (${others.size})==
${othertable}
`;

await bot.save(`User:SDZeroBot/ProdWatch/${ymdDate(d)}`, text, 'Updating report');

log(`[i] Done`);

})();


var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var pad = num => num < 10 ? '0' + num : num;

var ymdDate = function(date) {
	return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
};
var readableDate = function(date) {
	return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
}


var userlink = function(user) {
	return `[[User:${user}|${user}]]`;
}

var small = function(comment) {
	return `<small>${comment}</small>`;
}