const fs = require('fs');
const util = require('util');

const mwbot = require('mwbot');
const mysql = require('mysql');

/** Parsed console arguments */
const argv = require('minimist')(process.argv.slice(2));

/** Colorised and dated console logging. Semlog is a dependency of mwbot */
const log = require('semlog').log;

/** library of methods for bulk API processing */
const libApi = require('./libApiNode');

/** bot account and databse access credentials */
const auth = require('./.auth');

const bot = new mwbot();
bot.setGlobalRequestOptions({
	qs: {
		format: 'json',
		formatversion: '2'
	},
	headers: {
		'User-Agent': 'w:en:User:SDZeroBot'
	},
	json: true
});
bot.loginBot = function() {
	return bot.loginGetEditToken({
		apiUrl: 'https://en.wikipedia.org/w/api.php',
		username: auth.bot_username,
		password: auth.bot_password
	}).then(() => {
		bot.globalRequestOptions.qs.assert = 'bot';
	});
};

const sql = mysql.createConnection({
	host: 'enwiki.analytics.db.svc.eqiad.wmflabs',
	port: 3306,
	user: auth.db_user,
	password: auth.db_password,
	database: 'enwiki_p'
});

/**
 * Wrapper around sql.query that returns a promise
 * and stringifies non-null items in output.
 */
sql.queryBot = function(query) {
	const promisifiedfn = util.promisify(sql.query).bind(sql);
	return promisifiedfn(query).then(results => {
		return results.map(row => {
			Object.keys(row).forEach(prop => {
				if (row[prop]) { // not null
					row[prop] = row[prop].toString();
				}
			});
			return row;
		});
	});
};

const utils = {
	saveObject: function(filename, obj) {
		fs.writeFileSync('./' + filename + '.json', JSON.stringify(obj, null, 2), console.log);
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
	},
	// copied from https://doc.wikimedia.org/mediawiki-core/master/js/source/util.html#mw-util-method-escapeRegExp
	escapeRegExp: function(str) {
		// eslint-disable-next-line no-useless-escape
		return str.replace( /([\\{}()|.?*+\-^$\[\]])/g, '\\$1' );
	}
};

module.exports = { bot, mwbot, sql, mysql, fs, util, argv, log, libApi, utils };