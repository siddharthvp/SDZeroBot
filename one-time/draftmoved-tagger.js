// jsub -N tag -mem 1g ~/bin/node ~/SDZeroBot/tasks/draftmoved-tagger.js

const {bot, log, argv} = require('../botbase');

(async function() {

log(`[i] Started`);

await bot.getTokensAndSiteInfo();

let report = new bot.page('User:JJMC89 bot/report/Draftifications/monthly');

let revisions = (await report.history('content|timestamp', 20));

const tmpRgx = /\{\{[dD]rafts moved from mainspace.*?\}\}/;

for (let rev of revisions) {

	let month = new bot.date(rev.timestamp).subtract(1, 'month').format('MMMM YYYY');

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
				let text = rev.content;
				if (/^#redirect/i.test(text)) {
					log(`[i] Skipped ${draft} as it's a redirect`);
					return;
				}
				let replaced = false;
				let newtext = text.replace(tmpRgx, () => {
					replaced = true;
					return `{{Drafts moved from mainspace|date=${month}}}`;
				});
				if (!replaced) {
					newtext += `\n\n{{Drafts moved from mainspace|date=${month}}}`;
				} else if (newtext === text) {
					log(`Skipped ${draft} as correct tag already present`);
					return;
				}
				return {
					text: newtext,
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
			await bot.sleep(5000);
		}

	}
}

log(`[i] Finished`);


})();
