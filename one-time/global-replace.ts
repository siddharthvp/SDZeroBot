import {Mwn, type MwnOptions} from "mwn";
import {AuthManager, log} from "../botbase.js";
import * as globalSearchResult from '../global-replace/searchResults.json';
import * as replaceConfig from '../global-replace/replaceConfig.json';
import * as diff from 'diff';
import * as readline from 'readline';

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

(async function () {
	const mwnOptions: MwnOptions = {
		...AuthManager.get('SD0001:global-replace'),
		defaultParams: {
			assert: 'user',
			maxlag: undefined,
		}
	}
	console.log('Performing replacement: ', replaceConfig);

	const searchResults = globalSearchResult.hits;
	for (const hit of searchResults) {
		const bot = await Mwn.init({
			apiUrl: `https://${hit.wiki}.org/w/api.php`,
			...mwnOptions
		});

		log(`[+] Processing ${hit.title} on ${hit.wiki}`)
		try {
			const editResponse = await bot.edit(hit.title, async (rev) => {
				const text = rev.content;
				const replacedText = text.replaceAll(replaceConfig.find, replaceConfig.replace);
				if (text === replacedText) {
					log(`[W] No changes made`);
					return false;
				}

				const delta = diff.diffLines(text, replacedText);
				for (const part of delta) {
					const color = part.added ? '\x1b[32m' : part.removed ? '\x1b[31m' : '\x1b[0m';
					const prefix = part.added ? '+' : part.removed ? '-' : ' ';
					const lines = part.value.split('\n').filter(line => line.length);
					lines.forEach(line => {
						console.log(color + prefix + ' ' + line + '\x1b[0m');
					});
				}
				const response = await confirm('Confirm edit?');

				if (response) {
					log(`[+] Edit confirmed`);
					return {
						text: replacedText,
						summary: replaceConfig.summary,
					};

				} else {
					log(`[-] Edit cancelled`);
					return false;
				}
			});

			if (editResponse.newrevid) {
				log(`[S] Edit saved: https://${hit.wiki}.org/wiki/Special:Diff/${editResponse.newrevid}`);
			}
			console.log('\n\n');
		} catch (e) {
			if (e.code === 'missingtitle') {
				log(`[W] Page is missing`);
				continue;
			}

			console.error(e);
			if (!await confirm('Continue after error?')) {
				process.exit(1);
			}
		}
	}
	rl.close();

})();

async function confirm(message: string) {
	process.stdout.write(''); // Flush
	return new Promise<boolean>(resolve => {
		rl.question(`\x1b[33m> \x1b[1m${message} (y/N)\x1b[22m\x1b[0m `, answer => {
			resolve(answer.toLowerCase() === 'y');
		});
	});
}
