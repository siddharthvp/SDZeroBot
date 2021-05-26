/**
 * Script to check every half an hour that the
 * stream process is still working, and restart
 * it if it isn't.
 */
import {emailOnError} from '../botbase';
import {mapPath} from "../utils";
import {exec, execSync} from 'child_process';

const testRgx = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[i\] Reconnected/g;
const tail = execSync(`tail -100 ${mapPath('~/stream.out')}`).toString();

// eslint-disable-next-line no-empty
let match; for (match of tail.matchAll(testRgx)) {} // now match is the last matched

let date = new Date(match[1]);
let currentDate = new Date();

let diff = currentDate.getTime() - date.getTime();

let minutesDiff = diff / 1000 / 60;

if (minutesDiff > 30) {
	let err = new Error('no recent entries. Restarting stream');
	err.stack = 'Last entry found: ' + match[0];
	emailOnError(err, 'stream');

	process.chdir(__dirname);
	exec('npm restart', (error, stdout, stderr) => {
		if (error) {
			emailOnError(error, 'stream-restart');
		}
		if (stderr) {
			let err = new Error('npm restart raised an error');
			err.stack = stderr;
			emailOnError(err, 'stream-restart');
		}
	});
}
