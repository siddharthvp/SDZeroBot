import {bot, log, emailOnError, mwn, argv} from '../botbase';

const PercentDefault = 0.25;
const ByteDefault = 1000;

class Notifier {
	table: InstanceType<typeof mwn.table>
	notificationScheme: Map<string, Array<string>>
	afds: { [afdtitle: string]: string }
	config: {
		[username: string]: {
			bytes?: number
			percent: number
		}
	}
	date: string

	static async init() {
		await bot.getTokensAndSiteInfo();
		let notifier = new Notifier();
		await notifier.getConfig();

		await notifier.getAfDs();

		notifier.table = new mwn.table();
		notifier.table.addHeaders([
			`! scope="col" style="width: 14em" | AfD`,
			`! scope="col" style="width: 14em" | Article`,
			`! scope="col" style="width: 9em" | User`,
			`! scope="col" style="width: 4em" | Bytes`,
			`! scope="col" style="width: 4em" | Percent`,
			`! scope="col" style="width: 14em" | Comment`
		]);

		notifier.notificationScheme = new Map();

		try {
			for (let afd of Object.entries(notifier.afds)) {
				await notifier.processAfD(afd);
			}
			log(`[i] Finished`);
		} catch(e) {
			emailOnError(e, 'notifier');
		} finally {
			await notifier.notifyUsers();
			let wikitext = `~~~~~\n\n${notifier.table.getText()}`;
			bot.save('User:SDZeroBot/AfD notifier/log', wikitext, 'Logging');
		}
	}

	async getConfig() {
		let userconfig = new bot.page('User:SDZeroBot/AfD notifier');
		let text = await userconfig.text();
		let wkt = new bot.wikitext(text);
		wkt.unbind('<pre>', '</pre>');
		wkt.unbind('<!--', '-->');
		let sections = wkt.parseSections();

		this.config = {};

		let percentCustomisations = sections[2].content;
		let items = new bot.wikitext(percentCustomisations).parseTemplates({
			namePredicate: name => name === '/user'
		});
		for (let item of items) {
			let username = item.getValue(1);
			if (!username) {
				continue;
			}
			this.config[username] = {
				bytes: parseInt(item.getValue('bytes')) || ByteDefault,
				percent: parseInt(item.getValue('percent')) || PercentDefault
			};
		}

		let exclusions = sections[4].content;
		new bot.wikitext(exclusions).parseTemplates({
			namePredicate: name => name === 'U'
		}).forEach(t => {
			let user = t.getValue(1);
			if (!user) {
				return;
			}
			this.config[user] = {
				percent: 101
			};
		});

		log(`[S] Got config`);
		log(this.config);
	}

	async getAfDs() {
		this.date = new bot.date().subtract(1, 'day').format('YYYY MMMM D');
		const afdlog = new bot.page(`Wikipedia:Articles for deletion/Log/${this.date}`);
		const text = await afdlog.text();
		let rgx = /\{\{(Wikipedia:Articles for deletion\/.*?)}}(?!<!--Relisted-->)/mg;
		this.afds = {};
		for (let match of text.matchAll(rgx)) {
			this.afds[match[1]] = '';
		}
		log(`[S] Got list of ${Object.keys(this.afds).length} AfDs`);

		(await bot.read(Object.keys(this.afds))).map(pg => {
			this.afds[pg.title] = pg.revisions[0].content;
		});

		log(`[S] Got content of AfDs`);
	}

	async processAfD([afd, afdtext]) {
		log(`[+] Processing ${afd}`);
		let tsmatch = afdtext.match(/\d{2}:\d{2}, \d{1,2} \w+ \d{4} \(UTC\)/);
		if (!tsmatch || !tsmatch[0]) {
			return log(`[E] Failed to read a timestamp in ${afd}`);
		}
		let ts = tsmatch[0];
		let date = new bot.date(ts);
		if (date.format('YYYY MMMM D') !== this.date) {
			// not actually from yesterday; might be a manual relist
			log(`[W] ${afd} not from yesterday (manual relist)?`);
			log(`[W] Date found: ${date.format('YYYY MMMM d')}, expected: ${this.date}`);
			return;
		}

		// don't notify if discussion is already closed (likely a speedy keep)
		if (/The following discussion is an archived debate/.test(afdtext)) {
			return log(`[W] ${afd} already closed`);
		}

		let articleRgx = /\{\{la\|(.*?)\}\}/g;
		let articles = [];
		for (let match of afdtext.matchAll(articleRgx)) {
			let article = match[1];
			articles.push(article);
		}

		let usersWhoEditedTheAfD = new Set((await new bot.page(afd).history(['user'], 100)).map(e => e.user));

		const knownAbortReasons = ['nobots', 'already-notified', 'blocked', 'blocked-indef', 'locked',
			'user-bot'];

		for (let article of articles) {
			let authors = await this.getAuthorsForArticle(article);
			log(`[i] Got authors: ${authors.filter(e => e.percent > PercentDefault && e.bytes > ByteDefault).map(e => e.name).join(', ')}`); // best-effort logging

			for (let {name, percent, bytes, refBytes} of authors) {
				if (percent < (this.config[name]?.percent || PercentDefault)) {
					continue;
				}
				if (bytes < (this.config[name]?.bytes || ByteDefault)) {
					continue;
				}
				if (usersWhoEditedTheAfD.has(name)) {
					continue;
				}

				// contribution was entirely references (could be refill, citation bot, etc)
				if (refBytes / (refBytes + bytes) > 0.9) {
					continue;
				}

				let cmt = '';
				await this.checkWhetherToNotify(name, article, afd).then(() => {
					log(`[T] Notified ${name} about ${article}`);
					cmt = 'Sent notification';
				}, (abortreason) => {
					if (knownAbortReasons.includes(abortreason)) {
						cmt = abortreason;
					} else {
						log(`[E] Unknown rejection (${abortreason}): ${name}, ${afd}, ${article}`);
					}
				});
				this.table.addRow([
					`[[${afd}]]`,
					`[[${article}]] ({{history|1=${article}|2=h}})`,
					`[[User:${name}|${name}]]`,
					bytes,
					`[https://xtools.wmflabs.org/authorship/en.wikipedia.org/${article.replace(/ /g, '_')} ${Math.round(percent*100)}%]`,
					cmt
				]);
			}
			await bot.sleep(500); // pause for a while after querying WikiWho
		}
	}

	async getAuthorsForArticle(article) {
		try {
			let data = await this.queryAuthors(article);
			return data.users;
		} catch(err) {
			if (/does not exist/.test(err.message)) {
				log(`[W] ${article} does not exist`);
				return [];
			}
		}
	}

	/**
	 * Query the top contributors to the article using the WikiWho API.
	 * This API has a throttling of 2000 requests a day.
	 * @param {string} title
	 * @returns {{totalBytes: number, users: ({id: number, name: string, bytes: number, percent: number})[]}}
	 */
	async queryAuthors(title) {
		let json;
		try {
			json = await bot.rawRequest({
				url: `https://api.wikiwho.net/en/api/v1.0.0-beta/latest_rev_content/${encodeURIComponent(title)}/?editor=true`
			});
		} catch(err) {
			throw new Error(err?.response?.data?.Error);
		}

		const tokens = Object.values(json.revisions[0])[0].tokens;

		let data = {
			totalBytes: 0,
			users: []
		}, userdata = {};

		function checkCoalesce(tokens, i, j, value) {
			return tokens.slice(i, j).map(t => t.str).join('') === value;
		}

		let inRef = false, inCmt = false, inCategory = false;

		for (let i = 0; i < tokens.length; i++) {

			if (inCmt) {
				if (tokens[i].str === '-->') {
					inCmt = false;
				}
				continue;
			} else {
				if (tokens[i].str === '<!--') {
					inCmt = true;
					continue;
				}
			}

			if (inCategory) {
				if (tokens[i].str === ']]') {
					inCategory = false;
				}
				continue;
			} else {
				if (checkCoalesce(tokens, i, i + 3, '[[category:')) {
					inCategory = true;
					i += 2;
					continue;
				}
			}

			// Consider references as content, but avoid notifying users
			// whose only contribs are the references (this handles use of refill,
			// citation bot, etc)
			let addRefBytes = function(...tokens) {
				for (let token of tokens) {
					let editor = token.editor;
					if (!userdata[editor]) {
						userdata[editor] = { bytes: 0, refBytes: 0 };
					}
					userdata[editor].refBytes += token.str.length;
					if (editor.startsWith('0|')) { // IP
						userdata[editor].name = editor.slice(2);
					}
				}
			};

			if (inRef) {
				addRefBytes(tokens[i]);
				if (checkCoalesce(tokens, i, i + 4, '</ref>')) {
					addRefBytes(tokens[i+1], tokens[i+2], tokens[i+3]);
					i += 3;
					inRef = false;
				}
				continue;
			} else {
				if (checkCoalesce(tokens, i, i + 2, '<ref')) {
					inRef = true;
					addRefBytes(tokens[i], tokens[i+1]);
					i++;
					continue;
				}
			}

			let token = tokens[i];
			data.totalBytes += token.str.length;
			let editor = token.editor;
			if (!userdata[editor]) {
				userdata[editor] = { bytes: 0, refBytes: 0 };
			}
			userdata[editor].bytes += token.str.length;
			if (editor.startsWith('0|')) { // IP
				userdata[editor].name = editor.slice(2);
			}
		}

		Object.entries(userdata).map(([userid, {bytes}]) => {
			userdata[userid].percent = bytes / data.totalBytes;
			if (userdata[userid].percent < 0.02) {
				delete userdata[userid];
			}
		});

		await bot.request({
			"action": "query",
			"list": "users",
			"ususerids": Object.keys(userdata).filter(us => !us.startsWith('0|')) // don't lookup IPs
		}).then(json => {
			json.query.users.forEach(us => {
				userdata[String(us.userid)].name = us.name;
			});
		});

		data.users = Object.entries(userdata).map(([userid, {bytes, refBytes, name, percent}]) => {
			return {
				id: userid,
				name,
				bytes,
				percent,
				refBytes
			};
		}).sort((a, b) => {
			return a.bytes < b.bytes ? 1 : -1;
		});
		return data;
	}


	// XXX: everything here can be done for multiple users at once
	async checkWhetherToNotify(username, article, afd) {
		let user = new bot.user(username);
		if (/bot\b/i.test(username)) {
			log(`[W] Didn't notify ${username} as user is bot?`);
			return Promise.reject('bot-user');
		}
		try {
			let text = await user.talkpage.text();
			if (/\{\{nobots\}\}/i.test(text)) { // TODO: also check for deny=SDZeroBot
				log(`[C] ${username} has {{nobots}} on their talk page`);
				return Promise.reject('nobots');
			}

			let rgx = new RegExp(`== ?Nomination of \\[\\[:?${mwn.util.escapeRegExp(article)}\\]\\] for deletion ?==`);
			if (rgx.test(text)) {
				log(`[C] ${username} was already notified of ${article}`);
				return Promise.reject('already-notified');
			}

		} catch (err) {
			if (err?.code !== 'missingtitle') {
				return Promise.reject(err);
			}
		}

		if (!mwn.util.isIPAddress(username)) { // IP blocks can't be looked up this way, TODO: handle this
			let blockinfo = await user.info('blockinfo');
			if (blockinfo.blockid) { // blocked
				if (blockinfo.blockexpiry === 'infinite') {
					log(`[C] Not notifying ${username} as account is indef-blocked`);
					return Promise.reject('blocked-indef');
				}
				if (new bot.date().add(7, 'days').isBefore(new bot.date(blockinfo.blockexpiry))) {
					log(`[C] Not notifying ${username} as account is blocked for 7+ days`);
					return Promise.reject('blocked');
				}
			}

			let globalinfo = await user.globalinfo();
			if (globalinfo.locked) {
				log(`[C] Not notifying ${username} as account is locked`);
				return Promise.reject('locked');
			}
		}

		let key = `${username}____${afd}`; // Hack: can't really use an array or object as key,
		// as .has() method doesn't correctly work with non-primitive keys

		if (this.notificationScheme.has(key)) {
			this.notificationScheme.get(key).push(article);
		} else {
			this.notificationScheme.set(key, [article]);
		}
		return Promise.resolve();
	}

	async notifyUsers() {
		for (let [username_afd, articles] of this.notificationScheme.entries()) {
			let [username, afd] = username_afd.split('____');
			log(`[+] Notifying ${username} about ${afd}`);
			if (!argv.dry) {
				// bot.newSection() doesn't really check out
				await bot.request({
					action: 'edit',
					title: 'User talk:' + username,
					bot: 1,
					summary: articles.length === 1 ?
						`Nomination of [[${articles[0]}]] for deletion at [[${afd}|AfD]]` :
						`Nomination of [[${articles[0]}]] and other articles for deletion at [[${afd}|AfD]]`,
					appendtext: articles.length === 1 ?
						`\n\n{{subst:User:SDZeroBot/AfD notifier/template|1=${articles[0]}|afdpage=${afd}}}` :
						`\n\n{{subst:User:SDZeroBot/AfD notifier/templatemulti|afdpage=${afd}` +
							articles.map((e, i) => `|${i}=${e}`).join('') + '}}',
					token: bot.csrfToken
				}).then(() => {
					// log(`[S] Notified ${username}`);
				}, err => { // errors are logged, don't cause task to stop
					log(`[E] ${username} couldn't be notified due to error: ${err.code}: ${err.info}`);
				});
				await bot.sleep(5000);
			}
		}
	}

}

Notifier.init().catch(err => emailOnError(err, 'afd-notifier'));

// // BROWSER TESTING:

// Object.values((await $.get(`https://api.wikiwho.net/en/api/v1.0.0-beta/latest_rev_content/${encodeURIComponent(Morebits.pageNameNorm)}/?editor=true`)).revisions[0])[0].tokens

// await (async function queryAuthors(title) {
// 		let json;
// 		try {
// 			json = await $.get(`https://api.wikiwho.net/en/api/v1.0.0-beta/latest_rev_content/${encodeURIComponent(Morebits.pageNameNorm)}/?editor=true`);
// 		} catch(err) {
// 			throw new Error(err && err.response && err.response.data
// 				&& err.response.data.Error);
// 		}

// 		const tokens = Object.values(json.revisions[0])[0].tokens;

// 		let data = {
// 				totalBytes: 0,
// 				users: []
// 			}, userdata = {};

// 		function checkCoalesce(tokens, i, j, value) {
// 			return tokens.slice(i, j).map(t => t.str).join('') === value;
// 		}

// 		let inRef = false, inCmt = false, inCategory = false;

// 		for (let i = 0; i < tokens.length; i++) {

// 			if (inCmt) {
// 				if (tokens[i].str === '-->') {
// 					inCmt = false;
// 				}
// 				continue;
// 			} else {
// 				if (tokens[i].str === '<!--') {
// 					inCmt = true;
// 					continue;
// 				}
// 			}

// 			if (inCategory) {
// 				if (tokens[i].str === ']]') {
// 					inCategory = false;
// 				}
// 				continue;
// 			} else {
// 				if (checkCoalesce(tokens, i, i + 3, '[[category:')) {
// 					inCategory = true;
// 					i += 2;
// 					continue;
// 				}
// 			}

// 			// Consider references as content, but avoid notifying users
// 			// whose only contribs are the references (this handles use of refill,
// 			// citation bot, etc)
// 			let addRefBytes = function(...tokens) {
// 				for (let token of tokens) {
// 					let editor = token.editor;
// 					if (!userdata[editor]) {
// 						userdata[editor] = { bytes: 0, refBytes: 0 };
// 					}
// 					userdata[editor].refBytes += token.str.length;
// 					if (editor.startsWith('0|')) { // IP
// 						userdata[editor].name = editor.slice(2);
// 					}
// 				}
// 			};

// 			if (inRef) {
// 				addRefBytes(tokens[i]);
// 				if (checkCoalesce(tokens, i, i + 4, '</ref>')) {
// 					addRefBytes(tokens[i+1], tokens[i+2], tokens[i+3]);
// 					i += 3;
// 					inRef = false;
// 				}
// 				continue;
// 			} else {
// 				if (checkCoalesce(tokens, i, i + 2, '<ref')) {
// 					inRef = true;
// 					addRefBytes(tokens[i], tokens[i+1]);
// 					i++;
// 					continue;
// 				}
// 			}

// 			let token = tokens[i];
// 			data.totalBytes += token.str.length;
// 			let editor = token.editor;
// 			if (!userdata[editor]) {
// 				userdata[editor] = { bytes: 0, refBytes: 0 };
// 			}
// 			userdata[editor].bytes += token.str.length;
// 			if (editor.startsWith('0|')) { // IP
// 				userdata[editor].name = editor.slice(2);
// 			}
// 		}

// 		Object.entries(userdata).map(([userid, {bytes}]) => {
// 			userdata[userid].percent = bytes / data.totalBytes;
// 			if (userdata[userid].percent < 0.02) {
// 				delete userdata[userid];
// 			}
// 		});

// 		await new mw.Api().get({
// 			"action": "query",
// 			"list": "users",
// 			"ususerids": Object.keys(userdata).filter(us => !us.startsWith('0|')) // don't lookup IPs
// 		}).then(json => {
// 			json.query.users.forEach(us => {
// 				userdata[String(us.userid)].name = us.name;
// 			});
// 		});

// 		data.users = Object.entries(userdata).map(([userid, {bytes, refBytes, name, percent}]) => {
// 			return {
// 				id: userid,
// 				name,
// 				bytes,
// 				percent,
// 				refBytes
// 			};
// 		}).sort((a, b) => {
// 			return a.bytes < b.bytes ? 1 : -1;
// 		});
// 		return data;
// 	})().then(res => res.users)
