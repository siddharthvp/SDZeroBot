import { bot, utils, log } from '../botbase';
import { localRedis } from '../local-redis.js';
import { DAY, SECOND } from '../millis.js';

/**
 * Common ORES-related utilities used across bot's
 * sortlist tasks.
 */

/**
 *
 * @param {String[]} models - Array of model names, such as
 * drafttopic, articlequality, etc
 * @param {Array} revids - Array of revision IDs
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
export async function oresQueryRevisions(models: string[], revids: number[]) {
	log(`[i] Fetching ORES inferences for ${revids.length} articles for models: ${models.join(', ')}`);
	let oresData = {};

	let uncachedRevidsSet = new Set();
	for (let revid of revids) {
		await Promise.all(models.map(async model => {
			const cachedResult = await localRedis.get(`ores:${model}:${revid}`);
			if (cachedResult) {
				oresData[revid] = oresData[revid] || {};
				oresData[revid][model] = JSON.parse(cachedResult);
			} else {
				uncachedRevidsSet.add(revid);
			}
		}));
	}
	let uncachedRevids = Array.from(uncachedRevidsSet);
	log(`[i] ${revids.length - uncachedRevids.length} resolved from Redis cache, ${uncachedRevids.length} to be fetched`);

	const requestsLimit = Math.floor(20 / models.length);
	const sets = utils.arrayChunk(uncachedRevids, requestsLimit);
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
				oresData[revid] = {};
				models.forEach(async model => {
					if (data[model].error) {
						log(`[E] ORES response-level error (revid=${revid}, model=${model}): ${JSON.stringify(data[model].error)}`);
					} else {
						oresData[revid][model] = data[model].score.prediction;
						await localRedis.set(`ores:${model}:${revid}`, JSON.stringify(data[model].score.prediction), 'EX', 3 * DAY / SECOND);
					}
				});
			});
		}).catch(function (err) {
			console.log(err);
			return Promise.reject(err);
		});
	}, 100, 2).then(({failures}) => {
		// fail if all ORES calls didn't succeed eventually
		let numFailing = Object.keys(failures).length;
		if (numFailing > 0) {
			log(`[E] ${numFailing} ORES calls failed.`);
			throw Object.values(failures)[0];
		}
		return oresData;
	});
}

/**
 * Use this function as the argument to a sort() function on the
 * array of topics.
 * eg. topicsList.sort(sortTopics);
 */
export function sortOresTopics(a, b) {
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
}

/**
 *
 * @param {String[]} topics - ORES topics (unprocessed)
 * @param {Object} sorter - Object mapping ORES topics with array of
 * pagedata objects. This is modified in-place.
 * @param {Object} pagedata - a {title, revid, issues, quality} object
 */
export function processOresTopicsForPage(topics, sorter, pagedata) {
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