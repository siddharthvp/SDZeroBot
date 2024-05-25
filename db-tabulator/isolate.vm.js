/* eslint-disable no-unused-vars */
/* global __mwApiGet, __dbQueryResult, preprocess */
(async function() {
	"${JS_CODE}";

	async function mwApiGet(params) {
		const response = await __mwApiGet.applySyncPromise(undefined, [JSON.stringify(params)]);
		return JSON.parse(response);
	}

	return JSON.stringify(await preprocess(JSON.parse(__dbQueryResult)));
})
