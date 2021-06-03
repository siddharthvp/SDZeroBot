// npm run view

const {log, toolsdb} = require('../../botbase');

(async function() {

const db = new toolsdb('g13watch_p');

const rows = await db.query(`SELECT * FROM g13`);
log(rows);

})();
