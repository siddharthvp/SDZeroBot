/** Base file to reduce the amount of boilerplate code in each file */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let mwn;
try {
	mwn = require('../mwn/build/bot').mwn;
} catch(err) {
	// duplication of process.on() and emailOnError() as those can't be used before
	// mwn has loaded
	if (process.argv[1]) {
		console.log('[E]: failed to load mwn');
		var taskname = path.basename(process.argv[1]);
		require('child_process').exec(
			`echo "Subject: ${taskname} error\n\n${taskname} task resulted in the error:\n\n${err.stack}\n" | /usr/sbin/exim -odf -i tools.sdzerobot@tools.wmflabs.org`,
			() => {} // Emailing failed, must be a non-toolforge environ
		);
	} else { // else we're probably running in the console
		console.log(err);
	}
	process.exit();
}

/** Colorised and dated console logging. Powered by Semlog, a dependency of mwn */
const log = mwn.log;

/** Notify by email on facing unexpected errors, see wikitech.wikimedia.org/wiki/Help:Toolforge/Email */
const emailOnError = function(err, taskname) {
	log('[E] Fatal error');
	console.log(err);
	require('child_process').exec(
		`echo "Subject: ${taskname} error\n\n${taskname} task resulted in the error:\n\n${err.stack}\n" | /usr/sbin/exim -odf -i tools.sdzerobot@tools.wmflabs.org`,
		() => {} // Emailing failed, must be a non-toolforge environ
	);
	// exit normally
};

// Errors occurring inside async functions are caught by emailOnError(),
// this is only for anything else, such as failing imports
process.on('uncaughtException', function(err) {
	if (process.argv[1]) {
		var taskname = path.basename(process.argv[1]);
		emailOnError(err, taskname);
	} else { // else we're probably running in the console
		console.log(err);
	}
});

/** Parsed console arguments */
const argv = require('minimist')(process.argv.slice(2));

/** Date library, deprecated (now available in mwn) */
const xdate = require('./xdate');

/** bot account and databse access credentials */
const auth = require('./.auth');

const bot = new mwn({
	apiUrl: 'https://en.wikipedia.org/w/api.php',
	hasApiHighLimit: true,
	username: auth.bot_username,
	password: auth.bot_password,
	OAuthCredentials: {
		consumerToken: auth.oauth_consumer_token,
		consumerSecret: auth.oauth_consumer_secret,
		accessToken: auth.oauth_access_token,
		accessSecret: auth.oauth_access_secret,
	},
	defaultParams: {
		assert: 'bot'
	},
	userAgent: 'w:en:User:SDZeroBot'
});

bot.initOAuth();

const mysql = require('mysql2/promise');

class db { // abstract class
	constructor() {
		this.connected = false;
		this.inUse = false;
	}
	async query(...args) {
		if (!this.connected) {
			await this.connect();
		}
		this.inUse = true;
		const result = await this.conn.query(...args).catch(err => {
			console.log(`err.code:`, err.code);
			return Promise.reject(err);
		});
		this.inUse = false;
		return result[0].map(row => {
			Object.keys(row).forEach(prop => {
				if (row[prop]) {
					row[prop] = row[prop].toString();
				}
			});
			return row;
		});
	}
	async run(...args) {
		if (!this.connected) {
			await this.connect();
		}
		// convert `undefined`s in bind parameters to null
		if (args[1] instanceof Array) {
			args[1] = args[1].map(item => item === undefined ? null : item);
		}
		this.inUse = true;
		const result = await this.conn.execute(...args);
		this.inUse = false;
		return result;
	}
	// Always call end() when no more database operations are immediately required
	async end() {
		// Don't end connection if there are operations active
		if (this.inUse) {
			return;
		}
		await this.conn.end();
		this.connected = false;
	}
}

class enwikidb extends db {
	async connect() {
		this.conn = await mysql.createConnection({host: 'enwiki.analytics.db.svc.eqiad.wmflabs', port: 3306, user: auth.db_user, password: auth.db_password, database: 'enwiki_p'});
		this.connected = true;
		return this;
	}
	async getReplagHours() {
		const lastrev = await this.query(`SELECT MAX(rev_timestamp) AS ts FROM revision`);
		const lastrevtime = new bot.date(lastrev[0].ts);
		this.replagHours = Math.round((Date.now() - lastrevtime.getTime()) / 1000 / 60 / 60);
		return this.replagHours;
	}
	/**
	 * Return replag hatnote wikitext. Remember getReplagHours() must have been called before.
	 * @param {number} threshold - generate message only if replag hours is greater than this
	 * @returns {string}
	 */
	makeReplagMessage(threshold) {
		return this.replagHours > threshold ? `{{hatnote|Replica database lag is high. Changes newer than ${this.replagHours} hours may not be reflected.}}\n` : '';
	}
}

class toolsdb extends db {
	constructor(dbname) {
		super();
		this.dbname = dbname;
	}
	async connect() {
		this.conn = await mysql.createConnection({
			host: 'tools.db.svc.eqiad.wmflabs',
			port: 3306,
			user: auth.db_user,
			password: auth.db_password,
			database: 's54328__' + this.dbname
		});
		this.connected = true;
		return this;
	}
}

const TextExtractor = require('./TextExtractor')(bot);

const utils = {
	saveObject: function(filename, obj) {
		fs.writeFileSync('./' + filename + '.json', JSON.stringify(obj, null, 2), console.log);
	},

	logObject: function(obj) {
		return console.log(JSON.stringify(obj, null, 2));
	},

	// copied from https://en.wikipedia.org/wiki/MediaWiki:Gadget-twinkleblock.js
	makeSentence: function(arr) {
		if (arr.length < 3) {
			return arr.join(' and ');
		}
		var last = arr.pop();
		return arr.join(', ') + ' and ' + last;
	},
	// copied from https://en.wikipedia.org/wiki/MediaWiki:Gadget-morebits.js
	arrayChunk: function(arr, size) {
		var result = [];
		var current;
		for (var i = 0; i < arr.length; ++i) {
			if (i % size === 0) { // when 'i' is 0, this is always true, so we start by creating one.
				current = [];
				result.push(current);
			}
			current.push(arr[i]);
		}
		return result;
	}
};

// export everything
module.exports = { bot, mwn, mysql, db, enwikidb, toolsdb, fs, assert, argv, xdate, log, utils, emailOnError, TextExtractor };
