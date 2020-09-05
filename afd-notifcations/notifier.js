const {bot, log, xdate, emailOnError} = require('../botbase');

class Notifier {

	static async init() {
		await bot.getTokensAndSiteInfo();
		let notifier = new Notifier();
		await notifier.getConfig();

		await notifier.getAfDs();
		
		for (let afd of Object.entries(notifier.afds)) {
			await notifier.processAfD(afd);
		}

		await notifier.sendNotifications();
	}

	async getConfig() {
		let userconfig = new bot.page('User:SDZeroBot/AfD notifier');
		let text = await userconfig.text();
		let wkt = new bot.wikitext(text);
		wkt.unbind('<pre>', '</pre>');
		wkt.unbind('<!--', '-->');
		let sections = wkt.parseSections();

		this.config = {};
	
		let rgx = /^\*\s*\{\{[uU]\|(.*?)\}\}\s*[-–—]\s*(\d+)\s*%/mg;
		let percentCustomisations = sections[2].content;
		let match; 
		while (match = rgx.exec(percentCustomisations)) { // eslint-disable-line no-cond-assign
			this.config[match[1]] = match[2];
		}

		rgx = /^\*\s*\{\{[uU]\|(.*?)\}\}/mg;
		let exclusions = sections[4].content;
		while (match = rgx.exec(exclusions)) { // eslint-disable-line no-cond-assign
			this.config[match[1]] = 101;
		}
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
		log(`[i] Processing ${afd}`);
		let tsmatch = afdtext.match(/\d{2}:\d{2}, \d{1,2} \w+ \d{4} \(UTC\)/);
		if (!tsmatch || !tsmatch[0]) {
			return log(`[E] Failed to read a timestamp in ${afd}`);
		}
		let ts = tsmatch[0];
		let date = new xdate(ts);
		if (date.setHours(0, 0, 0, 0) !== new xdate().subtract(1, 'day').setHours(0, 0, 0, 0)) {
			// not actually from yesterday; might be a manual relist
			log(`[W] ${afd} not from yesterday (manual relist)?`);
			return;
		}
		let articleRgx = /\{\{la\|(.*?)\}\}/g;
		let articles = [];
		let match;
		while (match = articleRgx.exec(afdtext)) { // eslint-disable-line no-cond-assign
			let article = match[1];
			articles.push(article);
		}

		this.notifications = [];
		for (let article of articles) {
			let authors = await this.getAuthorsForArticle(article);
			authors.forEach(async ([name, percent]) => {
				if (percent > (this.config[name] || 0.2)) {
					this.notifications.push({ name, article, afd });
					log(`[+] ${afd}: (${article}): will notify ${name}`);
				}
			});
			await bot.sleep(2000); // pause for a while after querying WikiWho
		}
	}
	
	/**
	 * 
	 * @param {string} article 
	 * @returns {Object}   userid: {name, percent}
	 */
	async getAuthorsForArticle(article) {
		
		const data = await this.queryAuthors(article);
		return data.users.map(us => {
			return {
				name: us.name,
				percent: us.percent
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
		const json = await bot.rawRequest({
			url: `https://api.wikiwho.net/${langcodematch[1]}/api/v1.0.0-beta/latest_rev_content/${encodeURIComponent(title)}/?o_rev_id=true&editor=true`
		});
	
		const tokens = Object.values(json.revisions[0])[0].tokens;

		let data = {
				totalBytes: 0,
				users: []
			}, userdata = {};
		
		for (let token of tokens) {
			data.totalBytes += token.str.length;
			let editor = token['editor'];
			if (editor.startsWith('0|')) { // IP
				continue;
			} 
			if (!userdata[editor]) {
				userdata[editor] = { bytes: 0 };
			}
			userdata[editor].bytes += token.str.length;
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
			"ususerids": Object.keys(userdata)
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


	async sendNotifications() {
		this.notifications.forEach(([user, article, afd]) => {
			this.notifyUser(user, article, afd);
		});
	}
	
	// XXX: everything here can be done for multiple users at once, rewrite this
	async notifyUser(username, article, afd) {
		let user = new bot.user(username);
		let text = await user.talkpage.text();
		if (/\{\{nobots\}\}/i.test(text)) { // TODO: also check for deny=SDZeroBot
			log(`[C] ${username} has {{nobots}} on their talk page`);
			return;
		}
		let rgx = new RegExp(`== ?Nomination of \\[\\[:?${article}\\]\\] for deletion ?==`);
		if (rgx.test(text)) {
			log(`[C] ${username} was already notified of ${article}`);
			return;
		}
		
		let blockinfo = await user.info('blockinfo');
		if (blockinfo.blockid) { // blocked
			if (blockinfo.blockexpiry === 'infinite') {
				log(`[C] Not notifying ${username} as account is indef-blocked`);
				return;
			}
			if (new xdate().add(7, 'days').isBefore(new xdate(blockinfo.blockexpiry))) {
				log(`[C] Not notifying ${username} as account is blocked for 7+ days`);
				return;
			}
		}

		let globalinfo = await user.globalinfo();
		if (globalinfo.locked) {
			log(`[C] Not notifying ${username} as account is locked`);
			return;
		}

		// log(`[+] Notifying ${username}`);
		// return user.sendMessage('', `{{subst:User:SDZeroBot/AfD notifier/template|1=${article}|afdpage=${afd}}}`, {
		// 	summary: `[[${article}]] nominated for deletion ([[User:SDZeroBot/AfD notifier|AFDN]])`
		// }).catch(err => { // errors are logged, don't cause task to stop
		// 	log(`[W] ${username} couldn't be notified due to error: ${err.code}: ${err.info}`);
		// });
	}
}

Notifier.init().catch(err => emailOnError(err, 'afd-notifier'));