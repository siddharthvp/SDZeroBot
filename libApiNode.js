/**
 * libApi for node.js
 * @author SD0001
 *
 */


module.exports = {
	/**
	 * Send an API query that automatically continues till the limit is reached.
	 *
	 * @param {*} bot - the object used for API calls
	 * @param {Object} query - The API query
	 * @param {number} [limit=10] - limit on the maximum number of API calls to go through
	 * @param {boolean} [silent=false] - suppress console logging
	 * @returns {Promise<Object[]>} - resolved with an array of responses of individual calls.
	 */
	ApiQueryContinuous: function(bot, query, limit, silent) {
		limit = limit || 10;
		var responses = [];
		var callApi = function(query, count) {
			return bot.request(query).then(function(response) {
				if (!silent) console.log('Got part ' + count + ' of continuous API query');
				responses.push(response);
				if (response.continue && count < limit) {
					return callApi(Object.assign({}, query, response.continue), count + 1);
				} else {
					return responses;
				}
			});
		};
		return callApi(query, 1);
	},

	/** @class */
	/** Mostly for debugging only */
	ApiQueryContinuousClass: function(apiobj) {
		this.onEachResponse = null; /** function */
		this.limit = 10;

		var self = this;
		this.get = function(query) {
			var responses = [];
			var callApi = function(query, count) {
				return apiobj.request(query).then(function(response) {
					console.log('Got part ' + count + ' of continuous API query');
					responses.push(response);
					self.onEachResponse(response);
					if (response.continue && count < self.limit) {
						return callApi(Object.assign({}, query, response.continue), count + 1);
					} else {
						return responses;
					}
				});
			};
			return callApi(query, 1);
		};
	},

	/**
	 * Function for using API action=query with more than 50/500 items in multi-input fields.
	 *
	 * Several fields in the query API take multiple inputs but with a limit of 50 (or
	 * 500 for users with highapilimits).
	 * Example: the fields titles, pageids and revids in any query, ususers in list=users, etc.
	 *
	 * This function allows you to send a query as if this limit didn't exist. The array given to
	 * the multi-input field is split into batches of 50 (500 for bots) and individual queries
	 * are sent sequentially for each batch. A promise is returned finally resolved with the
	 * array of responses of each API call.
	 *
	 * @param {*} bot - object to use for the API calls
	 * @param {Object} query - the query object, the multi-input field should be an array
	 * @param {string} [batchFieldName=titles] - the name of the multi-input field
	 * @param {boolean} [hasApiHighLimit=false] - set true to use api high limits available
	 * with bot or sysop accounts
	 * @returns {Promise<Object[]>} - promise resolved when all the API queries have settled,
	 * with the array of responses.
	 */
	ApiMassQuery: function(bot, query, batchFieldName, hasApiHighLimit) {
		batchFieldName = batchFieldName || 'titles';
		var batchValues = query[batchFieldName];
		var limit = hasApiHighLimit ? 500 : 50;
		var numBatches = Math.ceil(batchValues.length / limit);
		var batches = new Array(numBatches);
		for (var i = 0; i < numBatches; i++) {
			batches[i] = new Array(limit);
		}
		for (var i = 0; i < batchValues.length; i++) {
			batches[Math.floor(i/limit)][i % limit] = batchValues[i];
		}
		var responses = new Array(numBatches);
		return new Promise(function(resolve, reject) {
			var sendQuery = function(idx) {
				if (idx === numBatches) {
					resolve(responses);
					return;
				}
				query[batchFieldName] = batches[idx];
				bot.request(query).then(function(response) {
					responses[idx] = response;
				}).finally(function() {
					sendQuery(idx + 1);
				});
			};
			sendQuery(0);
		});

	},


	/**
	 * Execute an asynchronous function on a large number of pages (or other arbitrary items).
	 * Similar to Morebits.batchOperation in [[MediaWiki:Gadget-morebits.js]], but designed for
	 * working with promises.
	 *
	 * @param {Array} list - list of items to execute actions upon. The array would
	 * usually be of page names (strings).
	 * @param {Function} worker - function to execute upon each item in the list. Must
	 * return a promise.
	 * @param {number} [batchSize=50] - number of concurrent operations to take place.
	 * Set this to 1 for sequential operations. Default 50. Set this according to how
	 * expensive the API calls made by worker are.
	 * @returns {Promise} - resolved when all API calls have finished.
	 */
	ApiBatchOperation: function(list, worker, batchSize) {
		batchSize = batchSize || 50;
		var successes = 0, failures = 0;
		var incrementSuccesses = function() { successes++; };
		var incrementFailures = function() { failures++; };
		var updateStatusText = function() {
			var percentageFinished = Math.round((successes + failures) / list.length * 100);
			var percentageSuccesses = Math.round(successes / (successes + failures) * 100);
			var statusText = `Finished ${successes + failures}/${list.length} (${percentageFinished}%) tasks, of which ${successes} (${percentageSuccesses}%) were successful, and ${failures} failed.`;
			console.log(statusText);
		}
		var numBatches = Math.ceil(list.length / batchSize);

		return new Promise(function(resolve, reject) {
			var sendBatch = function(batchIdx) {
				if (batchIdx === numBatches - 1) { // last batch
					var numItemsInLastBatch = list.length - batchIdx * batchSize;
					var finalBatchPromises = new Array(numItemsInLastBatch);
					for (var i = 0; i < numItemsInLastBatch; i++) {
						var idx = batchIdx * batchSize + i;
						finalBatchPromises[i] = worker(list[idx], idx);
						finalBatchPromises[i].then(incrementSuccesses, incrementFailures).finally(updateStatusText);
					}
					// XXX: Promise.allSettled isn't working with mwbot
					Promise.all(finalBatchPromises).then(resolve);
					return;
				}
				for (var i = 0; i < batchSize; i++) {
					var idx = batchIdx * batchSize + i;
					var promise = worker(list[idx], idx);
					promise.then(incrementSuccesses, incrementFailures).finally(updateStatusText);
					if (i === batchSize - 1) { // last item in batch: trigger the next batch's API calls
						promise.finally(function() {
							sendBatch(batchIdx + 1);
						});
					}
				}
			};
			sendBatch(0);
		});
	},

	/**
	 * Execute an asynchronous function on a number of pages (or other arbitrary items)
	 * sequentially, with a time delay between actions.
	 * Using this with delay=0 is same as using ApiBatchOperation with batchSize=1
	 * @param {Array} list
	 * @param {Function} worker - must return a promise
	 * @param {number} [delay=5000] - number of milliseconds of delay
	 * @returns {Promise} - resolved when all API calls have finished
	 */
	ApiSeriesBatchOperation: function(list, worker, delay) {
		delay = delay || 5000;
		var successes = 0, failures = 0;
		var incrementSuccesses = function() { successes++; };
		var incrementFailures = function() { failures++; };
		var updateStatusText = function() {
			var percentageFinished = Math.round((successes + failures) / list.length * 100);
			var percentageSuccesses = Math.round(successes / (successes + failures) * 100);
			var statusText = `Finished ${successes + failures}/${list.length} (${percentageFinished}%) tasks, of which ${successes} (${percentageSuccesses}%) were successful, and ${failures} failed.`;
			console.log(statusText);
		}

		return new Promise(function(resolve, reject) {
			var trigger = function(idx) {
				if (!list[idx]) {
					resolve();
					return;
				}
				return worker(list[idx])
					.then(incrementSuccesses, incrementFailures)
					.finally(function() {
						updateStatusText();
						setTimeout(function() {
							trigger(idx + 1);
						}, delay);
					});
			};
			trigger(0);
		});
	},

	/** @deprecated, no reason to use this instead of bot.request */
	// mwApi: function() {
	// 	const axios = require('axios');

	// 	this.setUserAgent = function(ua) {
	// 		axios.defaults.headers.common['Api-User-Agent'] = ua;
	// 		axios.defaults.headers.common['User-Agent'] = ua;
	// 	};
	// 	/** UNTESTED */
	// 	this.post = function(query) {
	// 		query.format = 'json';
	// 		return new Promise(function(resolve, reject) {
	// 			axios.post('https://en.wikipedia.org/w/api.php?', query).then(function(x) {
	// 				var result = x.data;
	// 				var code;
	// 				if (result.error) {
	// 					code = result.error.code === undefined ? 'unknown' : result.error.code;
	// 					reject(code, result);
	// 				} else if (result.errors) {
	// 					code = result.errors[0].code === undefined ? 'unknown' : result.errors[0].code;
	// 					reject(code, result);
	// 				} else {
	// 					resolve(result);
	// 				}
	// 			}, function() {
	// 				reject('http');
	// 			});
	// 		});
	// 	};
	// 	this.get = function(query) {
	// 		query.action = 'query';
	// 		query.format = 'json';
	// 		return new Promise(function(resolve, reject) {
	// 			axios.get('https://en.wikipedia.org/w/api.php?', {
	// 				params: query
	// 			}).then(function(x) {
	// 				var result = x.data;
	// 				var code;
	// 				if (result.error) {
	// 					code = result.error.code === undefined ? 'unknown' : result.error.code;
	// 					reject(code, result);
	// 				} else if (result.errors) {
	// 					code = result.errors[0].code === undefined ? 'unknown' : result.errors[0].code;
	// 					reject(code, result);
	// 				} else {
	// 					resolve(result);
	// 				}
	// 			}, function() {
	// 				reject('http');
	// 			});
	// 		})
	// 	};
	// }

};