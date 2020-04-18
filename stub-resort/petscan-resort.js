const {utils, log, argv} = require('../botbase');
const auth = require('../.auth');

var StubTagManager = require('./StubTagManager');
var getPetscanList = require('./getPetscanList');

const mwn = require('../mwn/src/index');
const bot = new mwn.bot({
	apiUrl: 'https://en.wikipedia.org/w/api.php',
	username: auth.bot_username,
	password: auth.bot_password
});

bot.loginGetToken().then(function() {
	return getPetscanList(argv.link);

}).then(pagelist => {
	log(`[+] Got titles from PetScan: ${pagelist.length} pages`);

	return bot.seriesBatchOperation(pagelist, function(pg) {

		return bot.edit(pg.id, function(rev) {
			var text = rev.content;
			var stm = new StubTagManager(text);

			if (Array.isArray(argv.remove)) {
				argv.remove.forEach(stm.removeTag);
			} else {
				stm.removeTag(argv.remove);
			}
			if (Array.isArray(argv.add)) {
				argv.add.forEach(stm.addTag);
			} else {
				stm.addTag(argv.add);
			}

			return {
				text: stm.getText(),
				summary: `Stub sorting: replacing ${utils.makeSentence(stm.removedTags)} with ${utils.makeSentence(stm.addedTags)}`,
				minor: 1
			};
		}).catch(err => {
			console.log(err);
			return Promise.reject(err);
		});

	}, 3000).then(console.log);

});