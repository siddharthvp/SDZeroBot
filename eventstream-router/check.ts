/**
 * Script to check every half an hour that the
 * stream process is still working, and restart
 * it if it isn't.
 */
import {emailOnError} from '../botbase';
import {mapPath} from "../utils";
import {execSync} from 'child_process';
import {restartDeployment} from "../k8s";

const testRgx = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[i\] Reconnected/g;

const streamJobs = {
	'stream': '~/SDZeroBot/eventstream-router'
};

for (const [job, dir] of Object.entries(streamJobs)) {

	const tail = execSync(`tail -100 ${mapPath(`~/${job}.out`)}`).toString();

	// eslint-disable-next-line no-empty
	let match; for (match of tail.matchAll(testRgx)) {} // now match is the last matched

	let date = new Date(match?.[1]);
	let currentDate = new Date();

	let diff = currentDate.getTime() - date.getTime();

	let minutesDiff = diff / 1000 / 60;

	if (!match || minutesDiff > 30) {
		let err = new Error();
		err.stack = `no recent entries. Restarting ${job}\n\nLast entry found: ${match?.[0]} `;
		emailOnError(err, job);

		process.chdir(mapPath(dir));
		restartDeployment(job).catch(err => emailOnError(err, `${job}-restart`));
	}
}
