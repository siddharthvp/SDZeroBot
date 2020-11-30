"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamLog = void 0;
const botbase_1 = require("../botbase");
// Should be bound to a writable stream with options { flags: 'a', encoding: 'utf8' }
// before use
function streamLog(msg) {
    let ts = new botbase_1.bot.date().format('YYYY-MM-DD HH:mm:ss');
    let stringified;
    if (typeof msg === 'string') {
        this.write(`[${ts}] ${msg}\n`);
    }
    else if (stringified = stringifyObject(msg)) {
        this.write(`[${ts}] ${stringified}\n`);
    }
    else {
        this.write(`[${ts}] [Non-stringifiable object!]\n`);
    }
}
exports.streamLog = streamLog;
// JSON.stringify throws on a cyclic object
function stringifyObject(obj) {
    try {
        return JSON.stringify(obj, null, 2);
    }
    catch (e) {
        return null;
    }
}
//# sourceMappingURL=utils.js.map