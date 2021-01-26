"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stringifyObject = exports.createLogStream = void 0;
const botbase_1 = require("../botbase");
function createLogStream(file) {
    let stream = botbase_1.fs.createWriteStream(file, {
        flags: 'a',
        encoding: 'utf8'
    });
    return function (msg) {
        let ts = new botbase_1.bot.date().format('YYYY-MM-DD HH:mm:ss');
        let stringified;
        if (typeof msg === 'string') {
            stream.write(`[${ts}] ${msg}\n`);
        }
        else if (stringified = stringifyObject(msg)) {
            stream.write(`[${ts}] ${stringified}\n`);
        }
        else {
            stream.write(`[${ts}] [Non-stringifiable object!]\n`);
        }
    };
}
exports.createLogStream = createLogStream;
// JSON.stringify throws on a cyclic object
function stringifyObject(obj) {
    try {
        return JSON.stringify(obj, null, 2);
    }
    catch (e) {
        return null;
    }
}
exports.stringifyObject = stringifyObject;
//# sourceMappingURL=utils.js.map