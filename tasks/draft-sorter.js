const {bot, argv, log, utils, emailOnError} = require('../botbase');
const OresUtils = require('../OresUtils');

(async function() {

await bot.getTokensAndSiteInfo()

let yesterday = new bot.date().subtract(1, 'day').format('DD MMMM YYYY')

let revidsTitles = {}

await bot.request({
	"action": "query",
	"prop": "info",
	"generator": "categorymembers",
	"gcmtitle": `Category:AfC submissions by date/${yesterday}`,
	"gcmnamespace": "118",
	"gcmtype": "page",
	"gcmlimit": "max"
}).then(json => {
	let pages = json.query.pages
	log(`[S] Fetched ${pages.length} drafts in ${yesterday} category`)
	for (let pg of pages) {
		revidsTitles[pg.lastrevid] = pg.title
	}
})

let pagelist = Object.keys(revidsTitles)
if (argv.size) {
	pagelist = pagelist.slice(0, argv.size)
}
let oresdata = {}

if (argv.noores) {
	oresdata = require('./oresdata')
} else {
	let errors = [];
	oresdata = await OresUtils.queryRevisions(['drafttopic'], pagelist, errors)

	utils.saveObject('oresdata', oresdata)
	utils.saveObject('errors', errors)
}


Object.entries(oresdata).forEach(async function([revid, {drafttopic}]) {

	var title = revidsTitles[revid]
	if (!title) {
		log(`[E] revid ${revid} couldn't be matched to title`)
	}

	var topics = drafttopic; // Array of topics
	if (!topics || !topics.length) {
		topics = ['unsorted']
	}

	// Process ORES API output for topics
	topics = topics
		.map(topic => {
			// Remove Asia.Asia* if Asia.South-Asia is present (example)
			if (topic.endsWith('*')) {
				let metatopic = topic.split('.').slice(0, -1).join('.')
				for (let i = 0; i < topics.length; i++) {
					if (topics[i] !== topic && topics[i].startsWith(metatopic)) {
						return
					}
				}
				return metatopic.split('.').pop()
			}
			return topic.split('.').pop()
		})
		.filter(e => e) // filter out undefined from above
		.map(topic => {
			// convert topic string to normalised form
			return topic
				.replace(/[A-Z]/g, match => match[0].toLowerCase()) 
				.replace(/ /g, '-')
				.replace(/&/g, 'and')
		})

	let template = `{{draft topics|${topics.join('|')}}}`
	log(`[+] ${title}: ${template}`)

	if (!argv.dry) {
		await bot.edit(title, rev => {
			let text = rev.content
	
			// remove first if already exists
			text = text.replace(/\{\{[dD]raft topics\|[^}]*?\}\}\n?/g, '')
			
			// add template
			text = text.trim() + `\n\n${template}`
	
			return {
				text: text,
				summary: `Draft topics: ${topics.join(', ')}`,
				minor: 1
			}
		}).catch(err => {
			if (err.code === 'missingarticle') {
				log(`[W] ${title} has been deleted`)
			} else {
				emailOnError(err, 'draft-sorter non-fatal')
				// keep going
			}
		})
	} 
	

});


})().catch(err => emailOnError(err, 'draft-sorter'));