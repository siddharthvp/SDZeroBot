/* eslint-disable no-unused-vars */
/* global __mwApiGet, __rawReq, __dbQueryResult, preprocess */
(async function() {
	const bot = {
		async request(url) {
			if (typeof url !== 'string') throw new Error('bot.request() needs a string url');
			const response = await __rawReq.applySyncPromise(undefined, [url]);
			return JSON.parse(response);
		},
		async api(params) {
			if (typeof params !== 'object') throw new Error('bot.api() parameters need to be an object');
			const response = await __mwApiGet.applySyncPromise(undefined, [JSON.stringify(params)]);
			return JSON.parse(response);
		}
	}

	"${JS_CODE}";

	return JSON.stringify(await preprocess(JSON.parse(__dbQueryResult)));
})
