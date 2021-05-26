import { emailOnError, mwn } from './botbase';
import { exec } from "child_process";

process.chdir(__dirname + '/webservice');

new mwn().rawRequest({
	url: 'https://sdzerobot.toolforge.org/ping'
}).then(response => {
	let data = response?.data;
	if (data !== 'pong') {
		throw new Error('unexpected response: ' + data);
	}
}).catch(e => {
	exec('npm restart', (error, stdout, stderr) => {
		if (error || stderr) {
			let err = new Error('webservice down, failed to restart');
			err.stack = String(e) + e.stack + '\n**Restarting**\n:' + (error ? (error + stderr) : stderr);
			emailOnError(err, 'webservice');
			return;
		}
		let err = new Error('webservice down, restarting');
		err.stack = String(e) + e.stack;
		emailOnError(err, 'webservice');
	});
});
