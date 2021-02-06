const {utils, bot} = require('../../botbase');

bot.login().then(() => {

	return bot.continuedQuery({
		"action": "query",
		"list": "allusers",
		"auactiveusers": 1,
		"aulimit": "max"
	}, 100).then(function(jsons) {

		var users = jsons.reduce(function(users, json) {
			json.query.allusers.forEach(e => {
				users[e.name] = e.recentactions;

			});
			return users;
		}, {});

		utils.saveObject('active-users', users);
	});

}).catch(console.log);