const {bot, utils, mwn, log} = require('../botbase');

(async function() {

await bot.getTokensAndSiteInfo();

// let users = {};

let userswithcount = [];

function orz(num) {
	return num || 0;
}

for await (let json of bot.continuedQueryGen({
	"action": "query",
	"assert": "bot",
	"list": "allusers",
	"auactiveusers": 1,
	"aulimit": "max"
}, 100)) {
	log(`[+] Got a page of the list of active users`)
	json.query.allusers.forEach(e => {
		let cnt = e.recentactions;
		// users[e.name] = cnt;
		userswithcount[cnt] = orz(userswithcount[cnt]) + 1;
	});
}

for (let i = userswithcount.length - 1; i >= 0; i--) {
	userswithcount[i] = orz(userswithcount[i+1]) + orz(userswithcount[i]);
}

let table = new mwn.table();
table.addHeaders([
	'Statistic',
	'Value'
]);

table.addRow([ 'Number of users active in the last 30 days', orz(userswithcount[0]) ]);
table.addRow([ '"Active" users with 0 actions in the last 30 days', orz(userswithcount[1]) - orz(userswithcount[0]) ]);
table.addRow([ 'Users with 5+ actions in the last 30 days', orz(userswithcount[5]) ]);
table.addRow([ 'Users with 10+ actions in the last 30 days', orz(userswithcount[5]) ]);
table.addRow([ 'Users with 50+ actions in the last 30 days', orz(userswithcount[50]) ]);
table.addRow([ 'Users with 100+ actions in the last 30 days', orz(userswithcount[100]) ]);

log(table.getText());

})();