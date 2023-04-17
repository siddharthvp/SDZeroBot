import {exec} from "child_process";
import {mapPath} from "./utils";
import {log} from "./botbase";

const pythonInterpreterPath = '~/www/python/venv/bin/python';
const toolforgeJobsScriptPath = '~/toolforge-jobs.py';
const toolforgeJobsCfgPath = '~/toolforge-jobs-framework-cli.cfg';

/**
 * This relies on the fact that python is available in node16 container.
 * The python venv is already setup. We run the toolforge-jobs.py script
 * which is a copy of /usr/bin/toolforge-jobs copied to tool's home directory as /usr/bin is
 * not mounted on the container.
 */
export function toolforgeJobs(...args: string[]) {
    return new Promise<void>((resolve, reject) => {
        exec(mapPath(`${pythonInterpreterPath} ${toolforgeJobsScriptPath} --cfg ${toolforgeJobsCfgPath} ${args.join(' ')}`), function (err, stdout, stderr) {
            if (stdout) {
                log(stdout);
            }
            if (stderr) {
                log(`[E] Stderr from toolforge-jobs ${args.join(' ')}`);
                log(stderr);
            }
            if (err) {
                log(err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}
