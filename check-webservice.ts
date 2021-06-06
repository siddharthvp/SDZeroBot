import { emailOnError, mwn } from './botbase';

process.chdir(__dirname + '/webservice');

new mwn().rawRequest({
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
