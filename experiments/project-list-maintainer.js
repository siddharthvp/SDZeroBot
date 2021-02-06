const {bot, log} = require('../botbase');

(async function() {

await bot.getTokensAndSiteInfo();

let page = bot.page('Wikipedia:WikiProject_Articles_for_creation/WikiProject_templates.json');
let json = JSON.parse(await page.text());

let templates = Object.values(json).map(t => 'Template:' + t);

const redirectRgx = /^#redirect/i;

let reports = []

await bot.readGen(templates, {
	prop: 'revisions|templates',
    tltemplates: 'Template:Dmbox',
    tllimit: 'max'
}).then(data => {
	for (let pg of data.query.pages) {
		if (pg.missing) {
			reports.push(`[[${pg.title}]] is missing (deleted or moved away without a redirect)`);
		}
		let text = pg.revisions[0].content;
		if (redirectRgx.test(text)) {
			reports.push(`[[${pg.title}]] is now a redirect`);
		}
		if (pg.templates) {
			reports.push(`[[${pg.title}]] is now a disambiguation page`);
		}
	}
});

log(`[S] Making ${reports.length} reports`);

let msg = 'I found the following project banners whose entries may need to be updated or removed:\n' +
	reports.map(e => `*${e}`).join('\n') + '\n' +
	'Regards, ~~~~';

page.getTalkPage().newSection('Possibly required updates', msg);


})();