const {bot, Mwn, log} = require('../../botbase');

(async function() {

await bot.getTokensAndSiteInfo();

let userswithcount = [];

function orz(num) {
	return num || 0;
}

for await (let json of bot.continuedQueryGen({
	"action": "query",
	"list": "allusers",
	"auactiveusers": 1,
	"aulimit": "max"
}, 100)) {
	log(`[+] Got a page of the list of active users`)
	json.query.allusers.forEach(e => {
		let cnt = e.recentactions;
		userswithcount[cnt] = orz(userswithcount[cnt]) + 1;
	});
}

// aggregate
for (let i = userswithcount.length - 1; i >= 0; i--) {
	userswithcount[i] = orz(userswithcount[i+1]) + orz(userswithcount[i]);
}

let table = new Mwn.table();
table.addHeaders([
	{label: 'Statistic', style: 'width: 40em;'},
	{label: 'Value', style: 'width: 20em'}
]);

table.addRow([ 'Number of users active (1+ action) in the last 30 days', orz(userswithcount[1]) + '<ref>Users active in the last 30 days according to [[mw:API:Allusers]] with auactiveusers=1, which is different from the figure on [[Special:Statistics]] ([[phab:T261290]]). Users with recentchanges value equal to 0 ([[phab:T261282]]) are not counted</ref>' ]);
table.addRow([ 'Users with 5+ actions in the last 30 days', orz(userswithcount[5]) ]);
table.addRow([ 'Users with 10+ actions in the last 30 days', orz(userswithcount[10]) ]);
table.addRow([ 'Users with 50+ actions in the last 30 days', orz(userswithcount[50]) ]);
table.addRow([ 'Users with 100+ actions in the last 30 days', orz(userswithcount[100]) ]);
table.addRow([ 'Users with 500+ actions in the last 30 days', orz(userswithcount[500]) ]);
table.addRow([ 'Users with 1000+ actions in the last 30 days', orz(userswithcount[1000]) ]);
table.addRow([ 'Users with 5000+ actions in the last 30 days', orz(userswithcount[5000]) ]);

let wikitext =
`{{hatnote|Last updated by [[User:SDZeroBot|SDZeroBot]] at ~~~~~}}

${table.getText()}

==Notes==
{{reflist}}
`

await bot.save('User:SDZeroBot/Number of active editors', wikitext, 'Updating');

log(`[i] Finished`);

})();
