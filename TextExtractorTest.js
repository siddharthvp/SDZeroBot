/* globals it, before */

const assert = require('assert');
const {bot} = require('./botbase');
const TE = require('./TextExtractor')(bot);

before(function() {
	return bot.getSiteInfo();
});

it('removes templates on new lines', function() {

	let text = `{{use dmy dates}}
{{infobox person 
| name = Arthur A. Kempod
| born = {{birth date and age|1988|04|09}}
| occupation = {{flatlist|Weaver
*Tailer 
*Knitter
}} 
}}
Arthur was an fine tailor.
`;

	assert.strictEqual(TE.removeTemplatesOnNewlines(text), '\n\nArthur was an fine tailor.\n');

});

it('runs preprocessHook', function () {
	let text = `[[User:Example]] 21:09, 30 May 2020 (UTC){{AFC submission|t||ts=20200530210953|u=Harshit567|ns=118|demo=}}
	
==References==`;

	let extract = TE.getExtract(text, 250, 500, function(text) {
		let wkt = new bot.wikitext(text);
		wkt.parseTemplates({
			namePredicate: name => {
				return /infobox/i.test(name) || name === 'AFC submission';
			}
		});
		for (let template of wkt.templates) {
			wkt.removeEntity(template);
		}
		return wkt.getText();
	});

	assert.strictEqual(extract, `[[User:Example]] 21:09, 30 May 2020 (UTC)`);
});
