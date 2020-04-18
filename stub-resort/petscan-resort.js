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

			argv.remove.forEach(stm.removeTag);
			argv.add.forEach(stm.addTag);

			return {
				text: stm.getText(),
				summary: `Stub sorting: replacing ${utils.makeSentence(stm.removedTags)} with ${utils.makeSentence(stm.addedTags)}`,
				minor: 1
			};
		});

	}, 3000).then(console.log);

});