const {bot, log, xdate, emailOnError} = require('../botbase');

class Notifier {

	static async init() {
		await bot.getTokensAndSiteInfo();
		let notifier = new Notifier();
		notifier.config = await notifier.getConfig();
		let AfDs = await notifier.getAfDs();
		for (let afd of AfDs) {
			await notifier.processAfD(afd);
		}
	}

	async getConfig() {
		let userconfig = new bot.page('User:SDZeroBot/AfD notifier/userconfig');
		let text = await userconfig.text();
		// TODO: set up exclusion page

		// return a map {{user: percentage}}
		return {};
	}
	
	/**
	 * @returns {string[]}
	 */
	async getAfDs() {
		let date = new xdate().subtract(1, 'day').format('YYYY MMMM D');
		const afdlog = new bot.page(`Wikipedia:Articles for deletion/Log/${date}`);
		const text = await afdlog.text();
		let rgx = /\{\{(Wikipedia:Articles for deletion\/.*?)}}(?!<!--Relisted-->)/mg;
		let AfDs = [];
		let match;
		while (match = rgx.exec(text)) { // eslint-disable-line no-cond-assign
			AfDs.push(match[1]);
		}
		return AfDs;
	}
	
	async processAfD(afd) {
		log(`[+] Processing ${afd}`);
		let afdpage = new bot.page(afd);
		let text = await afdpage.text();
		let ts = text.match(/\d{2}:\d{2}, \d{1,2} \w+ \d{4} \(UTC\)/)[0];
		let date = new xdate(ts);
		if (date.setHours(0, 0, 0, 0) !== new xdate().subtract(1, 'day').setHours(0, 0, 0, 0)) {
			// not actually from yesterday; might be a manual relist
			return;
		}
		let articleRgx = /\{\{la\|(.*?)\}\}/g;
		let articles = [];
		let match;
		// eslint-disable-next-line no-cond-assign
		while (match = articleRgx.exec(text)) {
			let article = match[1];
			articles.push(article);
		}

		for (let article of articles) {
			let authors = await Notifier.getAuthorsForArticle(article);
			Object.values(authors).forEach(async ([name, percent]) => {
				if (!this.config[name] || percent > this.config[name].percent) {
					await this.notifyUser(name, article, afd);
				}
			});
			// await bot.sleep(2000); // pause for a while after querying WikiWho
		}
	}
	
	/**
	 * 
	 * @param {string} article 
	 * @returns {Object}   userid: {name, percent}
	 */
	async getAuthorsForArticle(article) {
		
		const json = await bot.rawRequest(`https://api.wikiwho.net/en/api/v1.0.0-beta/latest_rev_content/${encodeURIComponent(article)}/?o_rev_id=true&editor=true&token_id=true&out=true&in=true`);
	
		const tokens = Object.values(json.revisions[0])[0].tokens
	
		let counts = {}, totalCount = 0;
	
		for (let token of tokens) {
			totalCount += token.str.length;
			let editor = token['editor'];
			if (editor.startsWith('0|')) { // IP
				continue;
			} 
			if (!counts[editor]) {
				counts[editor] = 0;
			}
			counts[editor] += token.str.length;
		}
	
		const data = {};
		const users = Object.entries(counts)
			.sort((a, b) => a[1] < b[1] ? 1 : -1)
			.filter(([userid, bytes]) => { // eslint-disable-line no-unused-vars
				let percent = bytes/totalCount;
				return percent > 0.1;
			})
			.forEach(([userid, bytes]) => {
				data[userid] = { bytes };
			});
		
		// this is broken, use mwn version instead

		await bot.request({
			"action": "query",
			"list": "users",
			"formatversion": "2",
			"ususerids": users.map(e => e[0])
		}).then(json => {
			json.query.users.forEach(us => {
				data[us.id].name = us.name;
			});
		});
	
		return users;
	
	}
	
	// XXX: pathetic, everything here can be done for multiple users at once, rewrite this
	async notifyUser(username, article, afd) {
		let user = new bot.user(username);
		let text = await user.talkpage.text();
		if (/\{\{nobots\}\}/i.test(text)) { // TODO: also check for deny=SDZeroBot
			return;
		}
		// TODO: also check if user was already notified
		
		// get blockinfo
		let blockinfo = await user.info('blockinfo');
		if (blockinfo.blockid) { // blocked
			if (blockinfo.blockexpiry === 'infinite') {
				return;
			}
			if (new xdate().add(7, 'days').isBefore(new xdate(blockinfo.blockexpiry))) {
				return;
			}
		}

		// TODO: query globaluserinfo API to check if user is globally locked 
		// (implement globalinfo() in mwn#user)

		log(`[+] Notifying ${username}`);
		return user.sendMessage('', `{{subst:afd notice|1=${article}|2=${afd.slice('Wikipedia:Articles for deletion/'.length)}}}`, {
			summary: 'Afd notification'
		}).catch(err => { // errors are logged, don't cause task to stop
			log(`[W] ${username} couldn't be notified due to error: ${err.code}: ${err.info}`);
		});
	}
}

Notifier.init().catch(err => emailOnError(err, 'afd-notifier'));