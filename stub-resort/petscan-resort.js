/**
 * node petscan-resort
 * 
 * command line arguments:
 * 
 * --link 	: petscan link from which to get articles
 * --add  	: add a stub tag, this arg can be given multiple times
 * --remove : remove a stub tag if it exists, this arg can be given multiple times
 * --sleep 	: (default 3000) number of milliseconds to pause after each edit
 */

const {utils, mwn, log, argv} = require('../botbase');
const auth = require('../.auth');

var StubTagManager = require('./StubTagManager');
var getPetscanList = require('./getPetscanList');

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

			var tagsToAdd = Array.isArray(argv.add) ? argv.add : [ argv.add ];
			var tagsToRemove = Array.isArray(argv.remove) ? argv.remove : [ argv.remove ];
			tagsToAdd.forEach(tag => stm.addTag(tag));
			tagsToRemove.forEach(tag => stm.removeTag(tag)); 
			
			var summary;
			if (stm.removedTags.length && stm.addedTags.length) {
				summary = `Stub sorting: replacing ${utils.makeSentence(stm.removedTags)} with ${utils.makeSentence(stm.addedTags)}`;
			} else if (stm.removedTags.length) {
				summary = `Stub sorting: removing ${utils.makeSentence(stm.removedTags)}}`;
			} else if (stm.addedTags.length) {
				summary = `Stub sorting: adding ${utils.makeSentence(stm.addedTags)}`;
			} else {  
				return; // no edit	
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
