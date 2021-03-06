/**
 * Common ORES-related utilities used across bot's
 * sortlist tasks.
 */

const { bot, utils, log } = require('../botbase');
const { rejectWithError } = require("../../mwn/build/error");

module.exports = {

	/**
	 *
	 * @param {String[]} models - Array of model names, such as
	 * drafttopic, articlequality, etc
	 * @param {Array} revids - Array of revision IDs
	 * @param {Array} errors - list of errors, modified in-place
	 * @returns {Promise<Object>}
	 * {
	 * 	"34242343": {
	 * 		"drafttopic": [],
	 * 		"articlequality": "C"
	 * 	},
	 * 	"94542343": {
	 * 		"drafttopic": ["Culture.Asia", "Culture.Sports"],
	 * 		"articlequality": "GA"
	 * 	}
	 * }
	 */
	queryRevisions: function(models, revids, errors) {
		var oresdata = {};
		var sets = utils.arrayChunk(revids, 50);
		return bot.seriesBatchOperation(sets, (set, i) => {
			return bot.rawRequest({
				method: 'get',
				url: 'https://ores.wikimedia.org/v3/scores/enwiki/',
				params: {
					models: models.join('|'),
					revids: set.join('|')
				},
				responseType: 'json'
			}).then(function(response) {
				let json = response.data;
				log(`[+][${i+1}/${sets.length}] Ores API call ${i+1} succeeded.`);
				Object.entries(json.enwiki.scores).forEach(([revid, data]) => {
					oresdata[revid] = {};
					models.forEach(model => {
						if (data[model].error) { // is this needed?
							errors.push(revid);
							return;
						}
						oresdata[revid][model] = data[model].score.prediction;
					});
				});
			});
		}, 0, 2).then(({failures}) => {
			// fail if all ORES calls didn't succeed eventually
			if (Object.keys(failures).length) {
				return rejectWithError({
					code: 'ores',
					info: 'ORES error'
				});
			}
			return oresdata;
		});
	},

	/**
	 * Use this function as the argument to a sort() function on the
	 * array of topics.
	 * eg. topicsList.sort(OresUtils.sortTopics);
	 */
	sortTopics: function(a, b) {
		var isStarred = x => x.endsWith('*');
		var meta = x => x.split('/').slice(0, -1).join('/');

		if (isStarred(a) && isStarred(b)) {
			return a > b ? 1 : -1;
		} else if (isStarred(a) && meta(a) === meta(b)) {
			return -1;
		} else if (isStarred(b) && meta(a) === meta(b)) {
			return 1;
		} else {
			// don't put the big biography section at the top
			if (a.startsWith('Culture/Biography') &&
				(b.startsWith('Culture/F') || b.startsWith('Culture/I') || b.startsWith('Culture/L'))) {
				return 1;
			} else if (b.startsWith('Culture/Biography') &&
				(a.startsWith('Culture/F') || a.startsWith('Culture/I') || a.startsWith('Culture/L'))) {
				return -1;
			}
			return a > b ? 1 : -1;
		}
	},

	/**
	 *
	 * @param {String[]} topics - ORES topics (unprocessed)
	 * @param {Object} sorter - Object mapping ORES topics with array of
	 * pagedata objects. This is modified in-place.
	 * @param {Object} pagedata - a {title, revid, issues, quality} object
	 */
	processTopicsForPage: function(topics, sorter, pagedata) {
		if (topics && topics.length) {
			topics = topics.map(t => t.replace(/\./g, '/'));
			topics.forEach(function(topic) {
				// Remove Asia.Asia* if Asia.South-Asia is present (example)
				if (topic.endsWith('*')) {
					var metatopic = topic.split('/').slice(0, -1).join('/');
					for (var i = 0; i < topics.length; i++) {
						if (topics[i] !== topic && topics[i].startsWith(metatopic)) {
							return;
						}
					}
				}
				if (sorter[topic]) {
					sorter[topic].push(pagedata);
				} else {
					sorter[topic] = [ pagedata ];
				}
			});
		} else {
			sorter["Unsorted/Unsorted*"].push(pagedata);
		}
	}

};
