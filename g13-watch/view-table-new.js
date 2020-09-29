// npm run view

const {log, toolsdb} = require('../botbase');

(async function() {

const db = await new toolsdb('g13watch_p').connect();

const rows = await db.query(`SELECT name, desc, excerpt, size, FROM_UNIXTIME(ts) from g13`);
log(rows);

})();