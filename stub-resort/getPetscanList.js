
const {bot} = require('../botbase');

module.exports = function(url) {
	if (url.indexOf('&format=json') === -1) {
		url += '&format=json';
	}
	return bot.rawRequest({
		method: 'GET',
		uri: url,
		json: true
	}).then(res => {
		return res['*'][0].a['*'];
	});
};