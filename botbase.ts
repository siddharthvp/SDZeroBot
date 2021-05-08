/** Base file to reduce the amount of boilerplate code in each file */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
export {fs, path, child_process};

/** Notify by email on facing unexpected errors, see wikitech.wikimedia.org/wiki/Help:Toolforge/Email */
export function emailOnError(err: Error, taskname: string) {
    // datetime similar to what mwn log produces, but can't use that directly as mwn may not have loaded
    const dateTimeString = new Date().toISOString().slice(0, 19).replace('T', ' ');
    console.log(`\x1b[31m%s\x1b[0m`, `[${dateTimeString}] [E] Fatal error`);
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
export {mwn};

/** Colorised and dated console logging. */
export const log = mwn.log;

/** Parsed console arguments */
export const argv = require('minimist')(process.argv.slice(2));

/** Date library, deprecated (now available in mwn) */
export const xdate = require('./xdate');

/** bot account and database access credentials */
const auth = require('./.auth');

export const bot = new mwn({
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

export const TextExtractor = require('./TextExtractor')(bot);

export {mysql, db, enwikidb, toolsdb} from './db';

// exported like this for compatibility; better import utils directly
import * as utils from './utils';
export {utils};