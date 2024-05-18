import {emailOnError, Mwn} from './botbase';

process.chdir(__dirname + '/webservice');

new Mwn().rawRequest({
	url: 'https://sdzerobot.toolforge.org/ping'
}).then(response => {
	let data = response?.data;
	if (data !== 'pong') {
		throw new Error('unexpected response: ' + data);
	}
}).catch(e => {
	let err = new Error('webservice down');
	err.stack = String(e) + e.stack;
	emailOnError(err, 'webservice');
});
