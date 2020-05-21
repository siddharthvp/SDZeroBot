/* globals it, before */

const assert = require('assert');
const {bot} = require('../botbase');
const TE = require('./TextExtractor')(bot);

before(function() {
	this.timeout(10000);
	return bot.login();
});

it('removes templates on new lines', function() {

	var text = `{{use dmy dates}}
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

	assert.equal(TE.removeTemplatesOnNewlines(text), '\n\nArthur was an fine tailor.\n'); 

});