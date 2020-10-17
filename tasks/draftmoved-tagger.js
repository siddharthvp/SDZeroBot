const {bot, log, xdate, argv} = require('../botbase');

(async function() {

log(`[i] Started`);

await bot.getTokensAndSiteInfo();

let report = new bot.page('User:JJMC89 bot/report/Draftifications/monthly');

let revisions = (await report.history('content|timestamp', 20));

const tmpRgx = /\{\{[dD]rafts moved from mainspace.*?\}\}/;

for (let rev of revisions) {

	let month = new xdate(rev.timestamp).subtract(1, 'month').format('MMMM YYYY');

	let moves = bot.wikitext.parseTable(rev.content.slice(rev.content.indexOf('{|'), rev.content.lastIndexOf('|}') +  2));
	log(`[+] Parsed ${moves.length} moves for ${month}`);

	for (let move of moves) {
		let draftname = move.Target.replace(/^\[\[/, '').replace(/\]\]$/, '');
		let draft = new bot.page(draftname);
		if (draft.namespace !== 118) {
			log(`[i] Skipped ${draft} as it's not a draft`);
			continue;
		}

		if (!argv.dry) {
			await draft.edit(rev => {
				log(`[+] Editing ${draft.toText()}`);
				let text = rev.content;
				if (/^#redirect/i.test(text)) {
					log(`[i] Skipped ${draft} as it's a redirect`);
					return;
				}
				text = text.replace(tmpRgx, `{{Drafts moved from mainspace|date=${month}}}`);
				if (!tmpRgx.test(text)) {
					text += `\n\n{{Drafts moved from mainspace|date=${month}}}`;
				}
				return {
					text,
					summary: `Draft moved from mainspace (${month})`,
					minor: true
				};
			}).then(data => {
				if (!data.nochange) {
					log(`[S] Edited ${draft}: ${JSON.stringify(data)}`);
				}
			}).catch(err => {
				if (err.code === 'nocreate-missing') {
					log(`[i] Skipped ${draft} as missing`);
					return;
				} else {
					return Promise.reject(err);
				}
			});
		}

	}
}

log(`[i] Finished`);


})();
