// npm run view

const {log, toolsdb} = require('../botbase');

(async function() {

const db = await new toolsdb().connect('g13watch_p');

const rows = await db.query(`SELECT name, desc, excerpt, size, FROM_UNIXTIME(ts) from g13`);
log(rows);

})();