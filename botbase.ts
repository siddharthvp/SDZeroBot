/** Base file to reduce the amount of boilerplate code in each file */

import fs = require('fs');
import path = require('path');
import child_process = require('child_process');
export {fs, path, child_process};

let log;

/** Notify by email on facing unexpected errors, see wikitech.wikimedia.org/wiki/Help:Toolforge/Email */
export function emailOnError(err: Error, taskname: string) {
    if (typeof log !== 'undefined') { // Check if mwn has loaded
        log('[E] Fatal error');
    } else { // imitate!
        console.log(`[${new Date().toISOString()}] [E] Fatal error`);
    }
    console.log(err);
    child_process.exec(
        `echo "Subject: ${taskname} error\n\n${taskname} task resulted in the error:\n\n${err.stack}\n" | /usr/sbin/exim -odf -i tools.sdzerobot@tools.wmflabs.org`,
        () => {} // Emailing failed, must be a non-toolforge environ
    );
    // exit normally
}

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
export const argv = require('minimist')(process.argv.slice(2));

/** Date library, deprecated (now available in mwn) */
export const xdate = require('./xdate');

/** bot account and database access credentials */
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
    maxRetries: 7, // Nov 2020: lag on the roof
    userAgent: 'w:en:User:SDZeroBot'
});

bot.initOAuth();

export {mwn, bot, log};

export const TextExtractor = require('./TextExtractor')(bot);

export {mysql, db, enwikidb, toolsdb} from './db';

export const utils = {
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
