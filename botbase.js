"use strict";
/** Base file to reduce the amount of boilerplate code in each file */
Object.defineProperty(exports, "__esModule", { value: true });
exports.utils = exports.toolsdb = exports.enwikidb = exports.db = exports.mysql = exports.TextExtractor = exports.log = exports.bot = exports.mwn = exports.xdate = exports.argv = exports.emailOnError = exports.child_process = exports.assert = exports.path = exports.fs = void 0;
const fs = require("fs");
exports.fs = fs;
const path = require("path");
exports.path = path;
const assert = require("assert");
exports.assert = assert;
const child_process = require("child_process");
exports.child_process = child_process;
let log;
exports.log = log;
/** Notify by email on facing unexpected errors, see wikitech.wikimedia.org/wiki/Help:Toolforge/Email */
exports.emailOnError = function (err, taskname) {
    if (typeof log !== 'undefined') { // Check if mwn has loaded
        log('[E] Fatal error');
    }
    else { // imitate!
        console.log(`[${new Date().toISOString()}] [E] Fatal error`);
    }
    console.log(err);
    child_process.exec(`echo "Subject: ${taskname} error\n\n${taskname} task resulted in the error:\n\n${err.stack}\n" | /usr/sbin/exim -odf -i tools.sdzerobot@tools.wmflabs.org`, () => { } // Emailing failed, must be a non-toolforge environ
    );
    // exit normally
};
// Errors occurring inside async functions are caught by emailOnError(),
// this is only for anything else, such as failing imports
process.on('uncaughtException', function (err) {
    if (process.argv[1]) {
        var taskname = path.basename(process.argv[1]);
        exports.emailOnError(err, taskname);
    }
    else { // else we're probably running in the console
        console.log(err);
    }
});
const mwn_1 = require("../mwn");
Object.defineProperty(exports, "mwn", { enumerable: true, get: function () { return mwn_1.mwn; } });
/** Colorised and dated console logging. Powered by Semlog, a dependency of mwn */
exports.log = log = mwn_1.mwn.log;
/** Parsed console arguments */
exports.argv = require('minimist')(process.argv.slice(2));
/** Date library, deprecated (now available in mwn) */
exports.xdate = require('./xdate');
/** bot account and database access credentials */
const auth = require('./.auth');
const bot = new mwn_1.mwn({
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
    maxRetries: 7,
    userAgent: 'w:en:User:SDZeroBot'
});
exports.bot = bot;
bot.initOAuth();
exports.TextExtractor = require('./TextExtractor')(bot);
var db_1 = require("./db");
Object.defineProperty(exports, "mysql", { enumerable: true, get: function () { return db_1.mysql; } });
Object.defineProperty(exports, "db", { enumerable: true, get: function () { return db_1.db; } });
Object.defineProperty(exports, "enwikidb", { enumerable: true, get: function () { return db_1.enwikidb; } });
Object.defineProperty(exports, "toolsdb", { enumerable: true, get: function () { return db_1.toolsdb; } });
exports.utils = {
    saveObject: function (filename, obj) {
        fs.writeFileSync('./' + filename + '.json', JSON.stringify(obj, null, 2));
    },
    logObject: function (obj) {
        return console.log(JSON.stringify(obj, null, 2));
    },
    // copied from https://en.wikipedia.org/wiki/MediaWiki:Gadget-twinkleblock.js
    makeSentence: function (arr) {
        if (arr.length < 3) {
            return arr.join(' and ');
        }
        var last = arr.pop();
        return arr.join(', ') + ' and ' + last;
    },
    // copied from https://en.wikipedia.org/wiki/MediaWiki:Gadget-morebits.js
    arrayChunk: function (arr, size) {
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
//# sourceMappingURL=botbase.js.map