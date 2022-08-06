import { bot, log, toolsdb } from "../botbase";
import { NS_USER, NS_USER_TALK } from "../namespaces";
import { createLogStream } from "../utils";

export const db = new toolsdb('goodarticles_p');
export const TABLE = 'nominators2';

const GANTemplateRegex = /\{\{GA ?(c(andidate)?|n(om(inee)?)?)\s*(\||\}\})/i;
const GANTemplateNameRegex = /^GA ?(c(andidate)?|n(om(inee)?)?)$/i;

export async function processArticle(article: string) {
	let talkpage = new bot.page(new bot.page(article).getTalkPage());
	let talkpageedits = talkpage.historyGen(
		['content', 'user', 'timestamp'],
		{ rvsection: '0', rvlimit: 100 } // one-pass
	);

	// Parse the signature in the template not more than once
	//  If not successful, fallback to considering the user who added the tag, also take the nom_date from that edit.

	let GA_template_seen = false,
		GA_user = null,
		GA_date = null, // promotion date
		fallback_strategy = false;
	for await (let rev of talkpageedits) {
		if (!fallback_strategy) {
			// `rev.content &&` to protect against revdel'd/suppressed revisions.
			// we just assume the hidden revisions don't have the GA template.
			let template = rev.content && bot.wikitext.parseTemplates(rev.content, {
				namePredicate: name => GANTemplateNameRegex.test(name)
			})[0];
			if (template) {
				// found it!
				let nominatorSignature = template.getValue('nominator');
				let nom = getUsernameFromSignature(nominatorSignature);
				if (nom) {
					return addToDb(article, nom, GA_date);
				} else {
					fallback_strategy = true;
				}
			} else {
				GA_date = rev.timestamp;
			}
		} // no else
		if (fallback_strategy) {
			let GAN_template_present = GANTemplateRegex.test(rev.content);
			if (GAN_template_present) {
				GA_template_seen = true;
				GA_user = rev.user;
			} else {
				if (GA_template_seen) {
					break;
				}
			}
		}
	}

	if (GA_user) {
		return addToDb(article, GA_user, GA_date, true);
	} else {
		return Promise.reject();
	}
}

const dbWriteFailures = createLogStream(__dirname + '/db-write-failures.out');

function addToDb(article: string, nom: string, date, fallbackStrategy = false): Promise<[string, string, boolean]> {
	let date_str = new bot.date(date).format('YYYY-MM-DD');
	db.run(`REPLACE INTO ${TABLE} VALUES (?, ?, ?, ?)`, [article, nom, date_str, null]).catch(err => {
		log(`[E] Db error ${err}`);
		log(err);
		dbWriteFailures(JSON.stringify(err));
	});
	return Promise.resolve([nom, date_str, fallbackStrategy]);
}

function getUsernameFromSignature(sig: string) {
	if (typeof sig !== 'string') {
		return;
	}
	let wkt = new bot.wikitext(sig);
	wkt.parseLinks();
	let userPageLinks = [], userTalkPageLinks = [];
	wkt.links.forEach(link => {
		if (!link.target.title.includes('/')) {
			if (link.target.namespace === NS_USER) {
				userPageLinks.push(link.target.getMainText());
			} else if (link.target.namespace === NS_USER_TALK) {
				userTalkPageLinks.push(link.target.getMainText());
			}
		}
	});
	if (userPageLinks.length === 1) return userPageLinks[0];
	let usernameGuess;
	if (userTalkPageLinks.length === 1) usernameGuess = userTalkPageLinks[0];
	else if (userPageLinks.length > 1) usernameGuess = userPageLinks[0];
	else if (userTalkPageLinks.length > 1) usernameGuess = userTalkPageLinks[0];
	// else {
	// 	let sigTrimmed = sig.trim();
	// 	if (sigTrimmed.split(/\s/).length === 1) {
	// 		usernameGuess = sigTrimmed;
	// 	}
	// }
	log(`[W] Possibly problematic signature: ${sig}. Guessed ${usernameGuess || '<nothing>'}`);
	return usernameGuess;
}

/**
 * Given the title of an article on a given date, find the current title.
 */
export async function getCurrentTitle(title: string, date: string): Promise<string> {
	const rename = (await bot.query({
		"list": "logevents",
		"letype": "move",
		"leprop": "timestamp|details|comment|title",
		"letitle": title,
		"lestart": new bot.date(date).add(10, 'seconds').toISOString(),
		"ledir": "newer",
		"lelimit": "1"
	})).query.logevents[0];
	if (!rename) {
		return title;
	}
	let newTitle = rename.params?.target_title;
	if (!newTitle) {
		log(`[E] Failed to parse new title for [[${title}]]`);
		return Promise.reject();
	}
	return getCurrentTitle(newTitle, rename.timestamp);
}

/**
 * Given the username of an account on a given date, find the current username of
 * the account.
 */
export async function getCurrentUsername(username: string, date: string): Promise<string> {
	const rename = (await bot.query({
		"list": "logevents",
		"letype": "renameuser",
		"leprop": "timestamp|details|comment|title",
		"letitle": "User:" + username,
		"lestart": new bot.date(date).add(10, 'seconds').toISOString(),
		"ledir": "newer",
		"lelimit": "1"
	})).query.logevents[0];
	if (!rename) {
		return username;
	}
	let newUsername =
		rename.params?.newuser ||
		rename.params?.[0] ||
		rename.comment?.match(/to "\[\[User:(.*?)\|.*?\]\]/)?.[1];
	if (!newUsername) {
		log(`[E] Failed to parse new username for ${username}`);
		return Promise.reject();
	}
	return getCurrentUsername(newUsername, rename.timestamp);
}
// Rename logs:
// 2006: https://en.wikipedia.org/wiki/Special:ApiSandbox#action=query&format=json&list=logevents&leprop=timestamp%7Ccomment%7Cdetails%7Ctitle&letype=renameuser&lestart=2006-06-06T05%3A17%3A45.000Z&ledir=older
// 2007: https://en.wikipedia.org/wiki/Special:ApiSandbox#action=query&format=json&list=logevents&leprop=timestamp%7Ccomment%7Cdetails%7Ctitle&letype=renameuser&lestart=2007-06-06T05%3A17%3A45.000Z&ledir=older
// 2008: https://en.wikipedia.org/wiki/Special:ApiSandbox#action=query&format=json&list=logevents&leprop=timestamp%7Ccomment%7Cdetails%7Ctitle&letype=renameuser&lestart=2008-06-06T05%3A17%3A45.000Z&ledir=older
// 2013-current: https://en.wikipedia.org/wiki/Special:ApiSandbox#action=query&format=json&list=logevents&leprop=timestamp%7Ccomment%7Cdetails%7Ctitle&letype=renameuser&lestart=2013-06-06T05%3A17%3A45.000Z&ledir=older
