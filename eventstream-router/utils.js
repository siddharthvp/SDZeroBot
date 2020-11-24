"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamLog = void 0;
const botbase_1 = require("../botbase");
// Should be bound to a writable stream with options { flags: 'a', encoding: 'utf8' }
// before use
function streamLog(msg) {
    let ts = new botbase_1.bot.date().format('YYYY-MM-DD HH:mm:ss');
    if (typeof msg === 'string') {
        this.write(`[${ts}] ${msg}\n`);
    }
    else {
        this.write(`[${ts}] ${JSON.stringify(msg)}\n`);
    }
}
exports.streamLog = streamLog;
