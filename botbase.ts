/** Base file to reduce the amount of boilerplate code in each file */

import fs = require('fs');
import path = require('path');
import assert = require('assert');

let log;

/** Notify by email on facing unexpected errors, see wikitech.wikimedia.org/wiki/Help:Toolforge/Email */
const emailOnError = function (err: Error, taskname: string) {
    if (typeof log !== 'undefined') { // Check if mwn has loaded
        log('[E] Fatal error');
    } else { // imitate!
        console.log(`[${new Date().toISOString()}] [E] Fatal error`);
    }
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

import {mwn} from '../mwn';

/** Colorised and dated console logging. Powered by Semlog, a dependency of mwn */
log = mwn.log;

/** Parsed console arguments */
const argv = require('minimist')(process.argv.slice(2));

/** Date library, deprecated (now available in mwn) */
const xdate = require('./xdate');

/** bot account and databse access credentials */
const auth = require('./.auth');

const bot = new mwn({
    apiUrl: 'https://en.wikipedia.org/w/api.php',
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

import * as mysql from 'mysql2/promise';

abstract class db {
    conn: mysql.Connection
    config: mysql.ConnectionOptions
    connected = false

    async connect(isRetry = false) {
        try {
            this.conn = await mysql.createConnection(this.config);
        } catch(e) {
            if (!isRetry) { // retry, but only once
                log(`[W] ${e.code}, retrying in 5 seconds...`);
                await bot.sleep(5000);
                return this.connect(true);
            } else throw e;
        }
        this.connected = true;
        return this;
    }
    async query(...args: any[]) {
        if (!this.connected) {
            await this.connect();
        }
        const result = await this.conn.query(...args).catch(err => {
            console.log(`err.code:`, err.code);
            return Promise.reject(err);
        });
        return result[0].map(row => {
            Object.keys(row).forEach(prop => {
                if (row[prop]) {
                    row[prop] = row[prop].toString();
                }
            });
            return row;
        });
    }
    async run(...args: any[]) {
        if (!this.connected) {
            await this.connect();
        }
        // convert `undefined`s in bind parameters to null
        if (args[1] instanceof Array) {
            args[1] = args[1].map(item => item === undefined ? null : item);
        }
        const result = await this.conn.execute(...args);
        return result;
    }
    // Always call end() when no more database operations are immediately required
    async end() {
        await this.conn.end();
        this.connected = false;
    }
}

class enwikidb extends db {
    replagHours: number
    constructor() {
        super();
        this.config = {
            host: 'enwiki.analytics.db.svc.eqiad.wmflabs',
            port: 3306,
            user: auth.db_user,
            password: auth.db_password,
            database: 'enwiki_p',
            //timezone: 'Z',
            //stringifyObjects: true
        };
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
        this.config = {
            host: 'tools.db.svc.eqiad.wmflabs',
            port: 3306,
            user: auth.db_user,
            password: auth.db_password,
            database: 's54328__' + dbname
        }
    }
}

const TextExtractor = require('./TextExtractor')(bot);

const utils = {
    saveObject: function(filename, obj) {
        fs.writeFileSync('./' + filename + '.json', JSON.stringify(obj, null, 2));
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

export {bot, mwn, mysql, db, enwikidb, toolsdb, fs, path, assert, argv, xdate, emailOnError, log, utils, TextExtractor };
