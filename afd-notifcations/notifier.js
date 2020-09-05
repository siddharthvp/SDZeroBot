const {bot, log, xdate, emailOnError, utils, mwn} = require('../botbase');

process.chdir(__dirname);

const PercentDefault = 0.25;
const ByteDefault = 1000;

class Notifier {

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

		try {
			for (let afd of Object.entries(notifier.afds)) {
				await notifier.processAfD(afd);
			}
		} catch(e) {
			emailOnError(e, 'notifier');
		} finally {
			let wikitext = `~~~~~\n\n${notifier.table.getText()}`;
			bot.save('User:SDZeroBot/AfD notifier/log', wikitext, 'Logging dry run');

			utils.saveObject('notifications', notifier.notifications);
			log(notifier.aborts);
			utils.saveObject('abort-stats', notifier.aborts);
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
			this.config[item.getValue(1)] = {
				bytes: item.getValue('bytes') || ByteDefault,
				percent: item.getValue('percent') || PercentDefault
			};
		}

		let exclusions = sections[4].content;
		new bot.wikitext(exclusions).parseTemplates({
			namePredicate: name => name === 'U'
		}).map(t => t.getValue(1)).forEach(user => {
			this.config[user] = {
				percent: 101
			};
		});

		log(`[S] Got config`);
		log(this.config);
	}

	/**
	 * @returns {string[]}
	 */
	async getAfDs() {
		let date = new xdate().subtract(1, 'day').format('YYYY MMMM D');
		const afdlog = new bot.page(`Wikipedia:Articles for deletion/Log/${date}`);
		const text = await afdlog.text();
		let rgx = /\{\{(Wikipedia:Articles for deletion\/.*?)}}(?!<!--Relisted-->)/mg;
		this.afds = {};
		let match;
		while (match = rgx.exec(text)) { // eslint-disable-line no-cond-assign
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
		// let tsmatch = afdtext.match(/\d{2}:\d{2}, \d{1,2} \w+ \d{4} \(UTC\)/);
		// if (!tsmatch || !tsmatch[0]) {
		// 	return log(`[E] Failed to read a timestamp in ${afd}`);
		// }
		// let ts = tsmatch[0];
		// let date = new xdate(ts);
		// if (date.setHours(0, 0, 0, 0) !== new xdate().subtract(1, 'day').setHours(0, 0, 0, 0)) {
		// 	// not actually from yesterday; might be a manual relist
		// 	log(`[W] ${afd} not from yesterday (manual relist)?`);
		// 	return;
		// }
		let articleRgx = /\{\{la\|(.*?)\}\}/g;
		let articles = [];
		let match;
		while (match = articleRgx.exec(afdtext)) { // eslint-disable-line no-cond-assign
			let article = match[1];
			articles.push(article);
		}

		this.notifications = [];
		this.aborts = {
			'nobots': 0,
			'already-notified': 0,
			'blocked': 0,
			'blocked-indef': 0,
			'locked': 0
		}
		for (let article of articles) {
			let authors = await this.getAuthorsForArticle(article);
			log(`[i] Got authors: ${authors.filter(e => e.percent > PercentDefault && e.bytes > ByteDefault).map(e => e.name).join(', ')}`);
			for (let {name, percent, bytes} of authors) {
				if (percent > ((this.config[name] && this.config[name].percent) || PercentDefault) &&
					bytes > ((this.config[name] && this.config[name].bytes) || ByteDefault)) {

					let cmt = '';
					await this.notifyUser(name, article, afd).then(() => {
						log(`[T] Notified ${name} about ${article}`);
						cmt = 'Notified';
						this.notifications.push({name, article, afd});
					}, (abortreason) => {
						if (typeof this.aborts[abortreason] === 'number') {
							this.aborts[abortreason]++;
							cmt = abortreason;
						} else {
							log(`[E] Unknown rejection (${abortreason}): ${name}, ${afd}, ${article}`);
						}
					});
					this.table.addRow([`[[${afd}]]`, `[[${article}]] ({{history|1=${article}|2=h}})`, `[[User:${name}|${name}]]`,
						bytes,
						`[https://xtools.wmflabs.org/authorship/en.wikipedia.org/${article.replace(/ /g, '_')} ${Math.round(percent*100)}%]`,
						cmt
					]);
				}
			}
			await bot.sleep(500); // pause for a while after querying WikiWho
		}
	}

	async getAuthorsForArticle(article) {

		const data = await this.queryAuthors(article);
		return data.users.map(us => {
			return {
				name: us.name,
				percent: us.percent,
				bytes: us.bytes
			};
		});

	}

	/**
	 * Query the top contributors to the article using the WikiWho API.
	 * This API has a throttling of 2000 requests a day.
	 * Supported for EN, DE, ES, EU, TR Wikipedias only
	 * @param {string} title
	 * @returns {{totalBytes: number, users: ({id: number, name: string, bytes: number, percent: number})[]}}
	 */
	async queryAuthors(title) {
		let langcodematch = bot.options.apiUrl.match(/([^/]*?)\.wikipedia\.org/);
		if (!langcodematch || !langcodematch[1]) {
			throw new Error('WikiWho API is not supported for bot API url. Re-check.');
		}

		let json;
		try {
			json = await bot.rawRequest({
				url: `https://api.wikiwho.net/${langcodematch[1]}/api/v1.0.0-beta/latest_rev_content/${encodeURIComponent(title)}/?o_rev_id=true&editor=true`
			});
		} catch(err) {
			if (/does not exist/.test(err.response.data.Error)) {
				log(`[W] ${title} does not exist`);
				return { users: [] }; // kludge: dummy object
			}
		}

		const tokens = Object.values(json.revisions[0])[0].tokens;

		let data = {
				totalBytes: 0,
				users: []
			}, userdata = {};

		for (let token of tokens) {
			data.totalBytes += token.str.length;
			let editor = token['editor'];
			if (!userdata[editor]) {
				userdata[editor] = { bytes: 0 };
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

		data.users = Object.entries(userdata).map(([userid, {bytes, name, percent}]) => {
			return {
				id: userid,
				name: name,
				bytes: bytes,
				percent: percent
			};
		}).sort((a, b) => {
			a.bytes < b.bytes ? 1 : -1;
		});

		return data;
	}


	// XXX: everything here can be done for multiple users at once, rewrite this
	async notifyUser(username, article, afd) {
		let user = new bot.user(username);
		try {
			let text = await user.talkpage.text();
			if (/\{\{nobots\}\}/i.test(text)) { // TODO: also check for deny=SDZeroBot
				log(`[C] ${username} has {{nobots}} on their talk page`);
				return Promise.reject('nobots');
			}

			let rgx = new RegExp(`== ?Nomination of \\[\\[:?${article}\\]\\] for deletion ?==`);
			if (rgx.test(text)) {
				log(`[C] ${username} was already notified of ${article}`);
				return Promise.reject('already-notified');
			}

		} catch (err) {
			if (err.code !== 'missingtitle') {
				throw err;
			}
		}

		let blockinfo = await user.info('blockinfo');
		if (blockinfo.blockid) { // blocked
			if (blockinfo.blockexpiry === 'infinite') {
				log(`[C] Not notifying ${username} as account is indef-blocked`);
				return Promise.reject('blocked-indef');
			}
			if (new xdate().add(7, 'days').isBefore(new xdate(blockinfo.blockexpiry))) {
				log(`[C] Not notifying ${username} as account is blocked for 7+ days`);
				return Promise.reject('blocked');
			}
		}

		let globalinfo = await user.globalinfo();
		if (globalinfo.locked) {
			log(`[C] Not notifying ${username} as account is locked`);
			return Promise.reject('locked');
		}

		// return Promise.resolve();
		log(`[+] Notifying ${username}`);

		// bot.newSection() doesn't really check out
		await bot.request({
			action: 'edit',
			title: 'User talk:' + username,
			bot: 1,
			summary: `Nomination of [[${article}]] for deletion at [[${afd}|AfD]]`,
			appendtext: `\n\n{{subst:User:SDZeroBot/AfD notifier/template|1=${article}|afdpage=${afd}}}`,
			token: bot.csrfToken
		}).then(() => {
			// log(`[S] Notified ${username}`);
		}, err => { // errors are logged, don't cause task to stop
			log(`[E] ${username} couldn't be notified due to error: ${err.code}: ${err.info}`);
		});
		await bot.sleep(5000);
	}
}

Notifier.init().catch(err => emailOnError(err, 'afd-notifier'));
