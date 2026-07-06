const assert = require('assert');
const {bot, TextExtractor} = require('./botbase');

describe('TextExtractor', () => {
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

		assert.strictEqual(TextExtractor.removeTemplatesOnNewlines(text), '\n\nArthur was an fine tailor.\n');

	});

	it('removes templates', () => {
		let text = `lorem {{IPA-en|234}} ipsum.{{sfn|pwer= werf &3r |3=E |er}} Ipsum {{sfne}}. Lorem{{r|er}}.{{sfn|Löchte|2008|p=[https://books.google.com/books?id=jEHzS8W1oY8C&pg=PA107 107]}}`;
		assert.strictEqual(
			TextExtractor.getExtract(text),
			'lorem  ipsum. Ipsum {{sfne}}. Lorem.'
		);
	});

	it('runs preprocessHook', function () {
		let text = `[[User:Example]] 21:09, 30 May 2020 (UTC){{AfC submission|t||ts=20200530210953|u=Harshit567|ns=118|demo=}}
	
==References==`;

		let extract = TextExtractor.getExtract(text, 250, 500);

		assert.strictEqual(extract, `[[User:Example]] 21:09, 30 May 2020 (UTC)`);
	});

	it('strips infobox template even if not on new line', () => {
		let text = `
		This is an article.{{infobox website|url=https://google.com}}
		`;
		let extract = TextExtractor.getExtract(text);
		assert.strictEqual(extract.includes('infobox'), false);
	});

});
