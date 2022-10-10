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
    exec(mapPath(`${pythonInterpreterPath} ${toolforgeJobsScriptPath} --cfg ${toolforgeJobsCfgPath} ${args.join(' ')}`), function (err, stdout, stderr) {
        if (stdout) {
            console.log(stdout);
        }
        if (stderr) {
            log(`[E] Error in toolforge-jobs`);
            console.log(stderr);
        }
    });
}
