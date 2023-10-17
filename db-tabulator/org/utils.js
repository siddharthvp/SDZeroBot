"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInvocationMode = exports.HandledError = exports.db = void 0;
const db_1 = require("../../db");
const consts_1 = require("./consts");
exports.db = new db_1.enwikidb({
    connectionLimit: consts_1.CONCURRENCY
});
// hacky way to prevent further execution in process(), but not actually report as error
class HandledError extends Error {
}
exports.HandledError = HandledError;
function getInvocationMode() {
    if (process.env.CRON)
        return 'cron';
    if (process.env.WEB)
        return 'web';
    if (process.env.EVENTSTREAM_ROUTER)
        return 'eventstream';
    return 'manual';
}
exports.getInvocationMode = getInvocationMode;
//# sourceMappingURL=utils.js.map