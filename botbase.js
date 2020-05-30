/** Base file to reduce the amount of boilerplate code in each file */

const fs = require('fs');
const util = require('util');
const assert = require('assert');

var mwn; // kludge: so that this works well on both toolforge and my local
try {
	mwn = require('mwn');
} catch(e) {
	mwn = require('../mwn/src/bot');
}
const mysql = require('mysql');

/** Parsed console arguments */
const argv = require('minimist')(process.argv.slice(2));

/** Colorised and dated console logging. Semlog is a dependency of mwn */
const log = require('semlog').log;

/** bot account and databse access credentials */
const auth = require('./.auth');

const bot = new mwn({
	apiUrl: 'https://en.wikipedia.org/w/api.php',
	username: auth.bot_username,
	password: auth.bot_password,
	hasApiHighLimit: true,
});
bot.setDefaultParams({ assert: 'bot' });
bot.setUserAgent('w:en:User:SDZeroBot');

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

/** Notify by email on facing unexpected errors, see wikitech.wikimedia.org/wiki/Help:Toolforge/Email */
const emailOnError = function(err, taskname) {
	require('child_process').exec(
		`echo "Subject: ${taskname} error\n\n${taskname} task resulted in the error:\n\n${err}\n" | /usr/sbin/exim -odf -i tools.sdzerobot@tools.wmflabs.org`,
		err => console.log(err)
	);
};

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
module.exports = { bot, mwn, sql, mysql, fs, util, assert, argv, log, utils, emailOnError };