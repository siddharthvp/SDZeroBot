// TODO: write documentation

const {utils, log, argv} = require('../botbase');
const auth = require('../.auth');

var StubTagManager = require('./StubTagManager');
var getPetscanList = require('./getPetscanList');

const mwn = require('../mwn/src/bot');
const bot = new mwn({
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
				argv.remove.forEach(tag => stm.removeTag(tag));
			} else if (argv.remove) {
				stm.removeTag(argv.remove);
			}
			if (Array.isArray(argv.add)) {
				argv.add.forEach(tag => stm.addTag(tag));
			} else if (argv.add) {
				stm.addTag(argv.add);
			}
			
			var summary;
			if (stm.removedTags.length && stm.addedTags.length) {
				summary = `Stub sorting: replacing ${utils.makeSentence(stm.removedTags)} with ${utils.makeSentence(stm.addedTags)}`;
			} else if (stm.removedTags.length) {
				summary = `Stub sorting: removing ${utils.makeSentence(stm.removedTags)}}`;
			} else if (stm.addedTags.length) {
				summary = `Stub sorting: adding ${utils.makeSentence(stm.addedTags)}`;
			} else {  // should only happen if there are no tags added or removed - only re-formatting is taking place
				// can't abort the edit as bot.edit doensn't let us do so 
				summary = `Stub sorting`;	
			}
			return {
				text: stm.getText(),
				summary: summary,
				minor: 1
			};
		}).catch(err => {
			console.log(err);
			return Promise.reject(err);
		});

	}, argv.sleep || 3000).then(console.log);

});
