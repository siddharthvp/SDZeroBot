import {argv, AuthManager, fs, log, Mwn} from "../botbase";
import {fork} from "child_process";
import EventEmitter from "events";
import type {Query} from "./app";
import {RawRequestParams} from "../../mwn/build/core";
import {AxiosRequestHeaders} from "axios";

const softTimeout = 1500;
const hardTimeout = 2000;
const processTimeout = 30000;

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

export async function processQueriesExternally(page: string, notifier?: EventEmitter) {
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
                if (notifier) {
                    notifier.emit('message', message.code, ...message.args);
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
            notifier.emit('process-timed-out');
        }
    );
}

const apiClient = new Mwn({
    apiUrl: 'https://en.wikipedia.org/w/api.php',
    maxRetries: 0,
    silent: true,
    userAgent: '[[w:en:Template:Database report]] via [[w:en:SDZeroBot]], node.js isolated-vm',
    OAuth2AccessToken: AuthManager.get('sdzerobot-dbreports').OAuth2AccessToken,
    defaultParams: {
        maxlag: undefined
    }
});
apiClient.setRequestOptions({ timeout: 10000 });

const postprocessCodeTemplate = fs.readFileSync(__dirname + '/isolate.vm.js')
    .toString()
    .replace(/^\/\*.*?\*\/$/m, ''); // remove linter comments /* ... */

class SandboxedRequest {
    headers: AxiosRequestHeaders = {
        // Bot grant enables apihighlimit (for Action API), and helps avoid throttling for some REST APIs.
        // It has no write access.
        'Authorization': `Bearer ${AuthManager.get('sdzerobot-dbreports').OAuth2AccessToken}`
    }
    getConfig(url: string): RawRequestParams {
        return {
            method: 'GET',
            url: url,
            timeout: 10000,
            headers: this.headers
        }
    }
}

class SandboxedWikidataQueryServiceRequest extends SandboxedRequest {
    headers: AxiosRequestHeaders = {
        'X-BIGDATA-TIMEOUT': 600,
        'Accept': 'application/sparql-results+json'
    };
}

const supportedDomains = [
    { prefix: 'https://en.wikipedia.org/api/rest_v1/', req: new SandboxedRequest() },
    { prefix: 'https://wikimedia.org/api/rest_v1/', req: new SandboxedRequest() },
    { prefix: 'https://en.wikipedia.org/w/rest.php/', req: new SandboxedRequest() },
    { prefix: 'https://en.wikipedia.org/w/api.php?', req: new SandboxedRequest() },
    { prefix: 'https://api.wikimedia.org/', req: new SandboxedRequest() },
    { prefix: 'https://query.wikidata.org/', req: new SandboxedWikidataQueryServiceRequest() },
]

async function makeSandboxedHttpRequest(url: string) {
    let domain = supportedDomains.find(domain => url.startsWith(domain.prefix));
    if (!domain) {
        return JSON.stringify({ error: `Disallowed domain. Allowed domains are: ${supportedDomains.map(e => e.prefix).join(', ')}` });
    }

    try {
        const response = await apiClient.rawRequest(domain.req.getConfig(url));
        try {
            return JSON.stringify(response.data);
        } catch (e) {
            return JSON.stringify({ error: `Non JSON response from ${url}: ${response.data}` });
        }
    } catch (err) {
        let errMsg = err.statusCode ? (err.statusCode + ': ' + err.statusMessage) : err.message;
        return JSON.stringify({ error: errMsg });
    }
}

export async function applyJsPostProcessing(rows: Record<string, string>[], jsCode: string, query: Query): Promise<Record<string, any>[]> {
    log(`[+] Applying JS postprocessing for ${query}`);
    query.emit('postprocessing');
    let startTime = process.hrtime.bigint();

    // Import dynamically as this has native dependencies
    let {Isolate, Callback, Reference} = await import('isolated-vm');

    const isolate = new Isolate({
        memoryLimit: 16,
        onCatastrophicError(msg) {
            log(`[E] Catastrophic error in isolated-vm: ${msg}`);
            query.needsForceKill = true;
        }
    });
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set('__dbQueryResult', JSON.stringify(rows));

    await jail.set('log', new Callback(function(arg) {
        console.log(arg);
        query.emit('js-logging', arg);
    }));

    // Support readonly API access
    await jail.set('__mwApiGet', new Reference(async function (rawParams: string) {
        let params = JSON.parse(rawParams);
        // Disallow write operations
        params.action = 'query';
        params.format = 'json';
        delete params.token;
        try {
            return JSON.stringify(await apiClient.query(params));
        } catch (err) {
            return Promise.reject(err.message);
        }
    }));

    await jail.set('__rawReq', new Reference(makeSandboxedHttpRequest));

    let result = rows;

    await timedPromise(
        hardTimeout,
        (async () => {
            let processingResult = await doPostProcessing(context, jsCode, query)
            if (processingResult) {
                result = processingResult;
            }
        })(),
        () => {
            // In case isolated-vm timeout doesn't work
            log(`[E] Past ${hardTimeout/1000} second timeout, force-disposing isolate`);
            isolate.dispose();
        }
    );

    let endTime = process.hrtime.bigint();
    let timeTaken = (Number(endTime - startTime) / 1e9).toFixed(3);
    log(`[+] JS postprocessing for ${query} took ${timeTaken} seconds, cpuTime: ${isolate.cpuTime}, wallTime: ${isolate.wallTime}.`);
    query.emit('postprocessing-complete', timeTaken);

    return result;
}

async function doPostProcessing(context, jsCode: string, query: Query) {
    try {
        // jsCode is expected to declare function postprocess(rows) {...}
        let fullCode = postprocessCodeTemplate.replace('"${JS_CODE}"', jsCode);
        let wrapped = await context.eval(fullCode, {
            reference: true,
            timeout: softTimeout
        });
        let userCodeResult = await wrapped.apply(undefined, [], {
            result: { promise: true },
            timeout: softTimeout
        });
        try {
            if (typeof userCodeResult === 'string') { // returns undefined if non-transferable
                let userCodeResultParsed = JSON.parse(userCodeResult);
                if (Array.isArray(userCodeResultParsed)) {
                    return userCodeResultParsed;
                } else {
                    log(`[E] JS postprocessing for ${query} returned a non-array: ${userCodeResult.slice(0, 100)} ... Ignoring.`);
                    query.warnings.push(`JS postprocessing didn't return an array of rows, will be ignored`);
                    query.emit('js-no-array');
                }
            } else {
                log(`[E] JS postprocessing for ${query} has an invalid return value: ${userCodeResult}. Ignoring.`);
                query.warnings.push(`JS postprocessing must have a transferable return value`);
                query.emit('js-invalid-return');
            }
        } catch (e) { // Shouldn't occur as we are the ones doing the JSON.stringify
            log(`[E] JS postprocessing for ${query} returned a non-JSON: ${userCodeResult.slice(0, 100)}. Ignoring.`);
        }
    } catch (e) {
        log(`[E] JS postprocessing for ${query} failed: ${e.toString()}`);
        log(e);
        query.warnings.push(`JS postprocessing failed: ${e.toString()}`);
        query.emit('js-failed', e.toString());
    }
}
