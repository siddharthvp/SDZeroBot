const {mwn, bot, log, argv, TextExtractor, emailOnError} = require('../botbase');
const OresUtils = require('./OresUtils');
const {populateWikidataShortdescs, normaliseShortdesc} = require('./commons');

(async function () {

	/* GET DATA FROM DATABASE */

	log('[i] Started');

	await bot.getTokensAndSiteInfo();

	let revidsTitles = {},
		tableInfo = {};

	let talkpages = (await new bot.category('Good article nominees awaiting review').pages())
		.map(page => page.title);

	let articles = talkpages.map(pg => pg.slice('Talk:'.length));


	/* GET CONTENT AND SHORTDESCS */

	for await (let data of bot.massQueryGen({
		"action": "query",
		"prop": "revisions|description",
		"rvprop": "ids|content",
		"rvsection": '0',
		"rvslots": "main",
		"titles": articles
	})) {
		log(`[+] Got a page of the API response for article texts and descriptions`);
		let pages = data.query.pages;

		pages.forEach(pg => {
			try {
				if (pg.missing) {
					return;
				}
				revidsTitles[pg.revisions[0].revid] = pg.title;
				tableInfo[pg.title] = {
					shortdesc: normaliseShortdesc(pg.description),
					excerpt: TextExtractor.getExtract(pg.revisions[0].content, 300, 550)
				};
			} catch (e) {
				log(`[E] error in processing ${pg.title}`);
			}

		});
	}

	log('[S] Got articles');

	await populateWikidataShortdescs(tableInfo);
	log('[S] Got WD shortdescs');

	/* GET NOMINATION DATA */

	let counts = {
		old: 0,
		recent: 0,
		new: 0
	};

	for await (let data of bot.massQueryGen({
		"action": "query",
		"prop": "revisions",
		"rvprop": "content",
		"rvsection": "0",
		"rvslots": "main",
		"titles": talkpages,
	})) {
		log(`[+] Got a page of the API response for talk page texts`);
		let pages = data.query.pages;
		pages.forEach(async pg => {
			if (pg.missing) {
				return;
			}
			let article = pg.title.slice('Talk:'.length);
			if (!tableInfo[article]) {
				log(`[E] no article found for talk page ${pg.title}`);
				return;
			}

			let text = pg.revisions[0].content;

			const getGATemplateFromText = function(text) {
				let wkt = new bot.wikitext(text);
				let template = wkt.parseTemplates({
					count: 1,
					namePredicate: name => name === 'GA nominee'
				})[0];

				if (!template) {
					template = wkt.parseTemplates({
						recursive: true
					}).find(t => t.name === 'GA nominee');
				}
				return template;
			};

			let template = getGATemplateFromText(text);

			if (!template) {
				// get whole page
				text = (await bot.read(pg.title)).revisions[0].content;
				template = getGATemplateFromText(text);

				if (!template) {
					log(`[E] No {{GA nominee}} on ${pg.title}`);
				}
				return;
			}

			tableInfo[article].date = template && template.getValue(1);
			tableInfo[article].nominator = template && template.getValue('nominator');

			let date = new bot.date(tableInfo[article].date);
			if (date.isAfter(new bot.date().subtract(30, 'days'))) {
				tableInfo[article].class = 'new';
				counts.new++;
			} else if (date.isAfter(new bot.date().subtract(90, 'days'))) {
				counts.recent++;
				tableInfo[article].class = 'recent';
			} else {
				counts.old++;
				tableInfo[article].class = 'old';
			}

		});
	}



	/* GET DATA FROM ORES */

	let pagelist = Object.keys(revidsTitles);
	if (argv.size) {
		pagelist = pagelist.slice(0, argv.size);
	}

	let oresdata = await OresUtils.queryRevisions(['drafttopic'], pagelist);


	/* PROCESS ORES DATA, SORT PAGES INTO TOPICS */

	/**
	 * sorter: Object with topic names as keys,
	 * array of page objects as values, each page object being
	 * {
	 * 	title: 'title of the page ,
	 *	revid: '972384329',
	 * }
	 * Populated through OresUtils.processTopicsForPage
	 */
	let sorter = {
		"Unsorted/Unsorted*": []
	};

	Object.entries(oresdata).forEach(function ([revid, ores]) {

		let title = revidsTitles[revid];
		if (!title) {
			log(`[E] revid ${revid} couldn't be matched to title`);
		}

		let topics = ores.drafttopic; // Array of topics
		let toInsert = { title, revid };

		OresUtils.processTopicsForPage(topics, sorter, toInsert);

	});

	/* FORMAT DATA TO BE SAVED ON THE WIKI */

	let isStarred = x => x.endsWith('*');
	let meta = x => x.split('/').slice(0, -1).join('/');

	let createSection = function (topic) {
		let pagetitle = topic;
		if (isStarred(topic)) {
			pagetitle = meta(topic);
		}
		let table = new mwn.table();
		table.addHeaders([
			{label: 'Date', class: 'date-header'},
			{label: 'Article', class: 'article-header'},
			{label: 'Excerpt', class: 'excerpt-header'},
			{label: 'Nominator', class: 'nominator-header'}
		]);

		sorter[topic].map(function (page) {
			let tabledata = tableInfo[page.title];

			let formatted_date = new bot.date(tabledata.date).format('YYYY-MM-DD HH:mm');

			let row = [
				{ label: formatted_date || '[Failed to parse]', class: tabledata.class },
				`[[${page.title}]] ${tabledata.shortdesc ? `(<small>${tabledata.shortdesc}</small>)` : ''}`,
				tabledata.excerpt,
				tabledata.nominator || '[Failed to parse]'
			];

			row.class = tabledata.class;
			return row;

		}).sort(function (a, b) {
			// sort by date
			return a[0].label < b[0].label ? -1 : 1;

		}).forEach(function (row) {
			table.addRow(row);
		});

		return [pagetitle, table.getText()];
	};

	let makeMainPage = function () {
		let content = mwn.template('/header', {
			count: Object.keys(revidsTitles).length,
			countold: counts.old,
			countrecent: counts.recent,
			countnew: counts.new,
			date: new bot.date().format('D MMMM YYYY'),
			ts: '~~~~~'
		}) + '<includeonly>' +
				`<section begin=lastupdate />${new bot.date().toISOString()}<section end=lastupdate />` +
			'</includeonly>' + '\n';

		Object.keys(sorter).sort(OresUtils.sortTopics).forEach(topic => {
			let [sectionTitle, sectionText] = createSection(topic);
			content += `\n==${sectionTitle}==\n`;
			content += sectionText + '\n';
		});
		content += '\n{{reflist-talk}}';
		content = TextExtractor.finalSanitise(content);

		if (!argv.dry) {
			return bot.save('User:SDZeroBot/GAN sorting', content, 'Updating report');
		}

	}
	await makeMainPage();

	log(`[i] Finished`);

})().catch(err => emailOnError(err, 'gan-sorting'));
