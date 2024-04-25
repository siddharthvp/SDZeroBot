/**
 * Script to check every half an hour that the
 * stream process is still working, and restart
 * it if it isn't.
 */
import {bot, emailOnError, fs} from '../botbase';
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

	let date = new bot.Date(match?.[1]);
	let currentDate = new bot.Date();

	let diff = currentDate.getTime() - date.getTime();

	let minutesDiff = diff / 1000 / 60;

	if (!match || minutesDiff > 30) {
		let err = new Error();
		let lastSeenTime =  new bot.Date(parseInt(fs.readFileSync('./last-seen.txt').toString()) * 1000);
		err.stack = [
			`no recent log entries. Restarting ${job}`,
			`Last log entry: ${match?.[0]}`,
			`Last event timestamp: ${lastSeenTime.format('YYYY-MM-DD HH:mm:ss')}`,
			`Current time: ${currentDate.format('YYYY-MM-DD HH:mm:ss')}`
		].join('\n\n');
		emailOnError(err, job);

		process.chdir(mapPath(dir));
		restartDeployment(job).catch(err => emailOnError(err, `${job}-restart`));
	}
}
