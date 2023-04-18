/** Base file to reduce the amount of boilerplate code in each file */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as nodemailer from 'nodemailer';
export {fs, path, child_process};

const mailTransporter = nodemailer.createTransport({
    host: 'mail.tools.wmflabs.org',
    port: 465,
});
export async function sendMail(subject: string, body: string) {
    return mailTransporter.sendMail({
        from: 'tools.sdzerobot@tools.wmflabs.org',
        to: 'tools.sdzerobot@tools.wmflabs.org',
        subject: subject,
        text: body,
    });
}

/** Notify by email on facing unexpected errors, see wikitech.wikimedia.org/wiki/Help:Toolforge/Email */
export function emailOnError(err: Error, taskname: string, isFatal = true) {
    logFullError(err, isFatal);
    sendMail(`${taskname} error`, `${taskname} task resulted in the error:\n\n${err.stack}\n`);
    // exit normally
}
export function logFullError(err: Error, isFatal = true) {
    // datetime similar to what mwn log produces, but can't use that directly as mwn may not have loaded
    const dateTimeString = new Date().toISOString().slice(0, 19).replace('T', ' ');
    console.log(`[${dateTimeString}] ${isFatal ? '[E] Fatal error' : '[E] Error'}`);
    console.log(err);
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

import {updateLoggingConfig} from "../mwn/build/log";
updateLoggingConfig({
    printVerbose: !!argv.verbose
});

/** bot account and database access credentials */
const auth = require('./.auth');
export class AuthManager {
    static get(account: string) {
        return auth[account];
    }
}

export const bot = new mwn({
    apiUrl: 'https://en.wikipedia.org/w/api.php',
    ...AuthManager.get('SDZeroBot:oauth2'),
    ...AuthManager.get('SDZeroBot:bp1'),
    ...AuthManager.get('SDZeroBot:oauth1'),
    defaultParams: {
        assert: 'bot'
    },
    maxRetries: 7, // Nov 2020: lag on the roof
    userAgent: 'w:en:User:SDZeroBot'
});

bot.initOAuth();

import TextExtractor from "./TextExtractor";
export { TextExtractor };

// Deprecated exports, import from ./db or ./utils directly
export {mysql, db, enwikidb, toolsdb} from './db';
export * as utils from './utils';
