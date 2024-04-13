import {argv, log} from "../botbase";
import {sleep} from "../../mwn/build/utils";
import {fork} from "child_process";

const softTimeout = 1000;
const hardTimeout = 1500;
const processTimeout = 30000;

interface PreprocessContext {
    warnings: Array<string>;
    needsForceKill: boolean;
}

async function timedPromise(timeout: number, promise: Promise<void>, cleanup: () => void) {
    let t: NodeJS.Timeout;
    await Promise.race([
        promise.then(() => true),
        new Promise<boolean>((resolve) => {
            t = setTimeout(() => resolve(false), timeout);
        }),
    ]).then(completed => {
        if (completed) {
            clearTimeout(t);
        } else {
            cleanup();
        }
    });
}

export async function processQueriesExternally(page: string) {
    const controller = new AbortController();
    await timedPromise(
        processTimeout,
        new Promise<void>((resolve, reject) => {
            const { signal } = controller;
            const child = fork(
                __dirname + '/external-update.js',
                ['--page', page].concat(argv.fake ? ['--fake'] : []),
                {
                    execArgv: ['--no-node-snapshot'], // required for node 20+
                    signal
                }
            );
            child.on('message', (message: any) => {
                if (message.code === 'catastrophic-error') {
                    controller.abort(); // This triggers exit event
                }
            });
            child.on('error', (err) => {
                log(`[E] Error from child process`);
                log(err);
                reject();
            })
            child.on('exit', () => resolve());
        }),
        () => {
            log(`[E] Aborting child process as it took more than ${processTimeout/1000} seconds`);
            // FIXME? looks necessary as some errors in child process cause it to never resolve/reject
            controller.abort();
        }
    );
}

export async function applyJsPreprocessing(rows: Record<string, string>[], jsCode: string, queryId: string,
                                           ctx: PreprocessContext): Promise<Record<string, any>[]> {
    log(`[+] Applying JS preprocessing for ${queryId}`);
    let startTime = process.hrtime.bigint();

    // Import dynamically as this has native dependencies
    let {Isolate} = await import('isolated-vm');

    const isolate = new Isolate({
        memoryLimit: 16,
        onCatastrophicError(msg) {
            log(`[E] Catastrophic error in isolated-vm: ${msg}`);
            ctx.needsForceKill = true;
        }
    });
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set('__dbQueryResult', JSON.stringify(rows));

    let result = rows;

    let doPreprocessing = async () => {
        try {
            // jsCode is expected to declare function preprocess(rows) {...}
            let userCode = await isolate.compileScript(jsCode +
                '\n ; JSON.stringify(preprocess(JSON.parse(__dbQueryResult))); \n');

            let userCodeResult = await userCode.run(context, { timeout: softTimeout });
            try {
                if (typeof userCodeResult === 'string') { // returns undefined if non-transferable
                    let userCodeResultParsed = JSON.parse(userCodeResult);
                    if (Array.isArray(userCodeResultParsed)) {
                        result = userCodeResultParsed;
                    } else {
                        log(`[E] JS preprocessing for ${queryId} returned a non-array: ${userCodeResult.slice(0, 100)} ... Ignoring.`);
                        ctx.warnings.push(`JS preprocessing didn't return an array of rows, will be ignored`);
                    }
                } else {
                    log(`[E] JS preprocessing for ${queryId} has an invalid return value: ${userCodeResult}. Ignoring.`);
                    ctx.warnings.push(`JS preprocessing must have a transferable return value`);
                }
            } catch (e) { // Shouldn't occur as we are the ones doing the JSON.stringify
                log(`[E] JS preprocessing for ${queryId} returned a non-JSON: ${userCodeResult.slice(0, 100)}. Ignoring.`);
            }
        } catch (e) {
            log(`[E] JS preprocessing for ${queryId} failed: ${e.toString()}`);
            log(e);
            ctx.warnings.push(`JS preprocessing failed: ${e.toString()}`);
        }
    }

    await timedPromise(
        hardTimeout,
        doPreprocessing(),
        () => {
            // In case isolated-vm timeout doesn't work
            log(`[E] Past ${hardTimeout/1000} second timeout, force-disposing isolate`);
            isolate.dispose();
        }
    );

    let endTime = process.hrtime.bigint();
    let timeTaken = Number(endTime - startTime) / 1e9;
    log(`[+] JS preprocessing for ${queryId} took ${timeTaken.toFixed(3)} seconds, cpuTime: ${isolate.cpuTime}, wallTime: ${isolate.wallTime}.`);

    return result;
}
