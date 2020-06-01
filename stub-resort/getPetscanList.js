
const {mwn} = require('../botbase');

module.exports = function(url) {
	if (url.indexOf('&format=json') === -1) {
		url += '&format=json';
	}
	return mwn.rawRequest({
		method: 'get',
		url: url,
		responseType: 'json'
	}).then(res => {
		return res['*'][0].a['*'];
	});
};