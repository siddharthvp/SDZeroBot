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
const district = argv.district;
/** crontabs:
0 1 18 4 * jsub -N kapurtha-recat ~/bin/node ~/SDZeroBot/stub-resort/punjab-recat.js --district=Kapurthala
0 1 19 4 * jsub -N jalandhar-recat ~/bin/node ~/SDZeroBot/stub-resort/punjab-recat.js --district=Jalandhar
0 1 20 4 * jsub -N gurdaspur-recat ~/bin/node ~/SDZeroBot/stub-resort/punjab-recat.js --district=Gurdaspur
**/

bot.login().then(function() {
	return getPetscanList(`https://petscan.wmflabs.org/?min_sitelink_count=&edits%5Bbots%5D=both&cb_labels_any_l=1&sortby=title&cb_labels_yes_l=1&templates_yes=asbox&cb_labels_no_l=1&project=wikipedia&search_max_results=500&edits%5Bflagged%5D=both&language=en&interface_language=en&categories=Punjab,%20India%20geography%20stubs%0A${district}%20district%7C5&edits%5Banons%5D=both&search_wiki=&doit=`);

}).then(pagelist => {
	log(`[+] got petscan`);

	return bot.seriesBatchOperation(pagelist, function(pg) {

		return bot.edit(pg.id, function(rev) {
			var text = rev.content;
			var stm = new StubTagManager(text);
			stm.removeTag('India-geo-stub');
			stm.removeTag('PunjabIN-geo-stub');
			stm.addTag(`${district}-geo-stub`);
			return {
				text: stm.getText(),
				summary: `Stub sorting: replacing ${utils.makeSentence(stm.removedTags)} with ${utils.makeSentence(stm.addedTags)}`,
				minor: 1
			};
		});

	}, 5000).then(console.log);

});