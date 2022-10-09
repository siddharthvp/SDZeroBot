import {bot} from './botbase';
import * as yaml from "js-yaml";
import * as fs from "fs";

/**
 * Module for manipulating job configurations
 */

let appConf;

function init() {
    if (!appConf) return;

    const tfjConf = yaml.load(fs.readFileSync('/data/project/sdzerobot/toolforge-jobs-framework-cli.cfg', 'utf8'));
    appConf.apiUrl = tfjConf.api_url;

    const kubeConf = yaml.load(fs.readFileSync('/data/project/sdzerobot/.kube/config'), 'utf8');

}

export async function restartJob(name: string) {
    const jobData = await getJobDetails(name);
    if (!jobData.continuous) {
        throw new Error("non-contuout job given to restartJob");
    }
    await bot.rawRequest({
        method: 'POST',
        url: appConf.apiUrl + '/run/',
        data: {
            name: name,
            continuous: 'true',
            mem: jobData.mem,
            cpu: jobData.cpu
        }
    });
}

export async function runJob(name: string) {
    const jobData = await getJobDetails(name);
    if (!jobData || !jobData.schedule) {
        throw new Error("non-cronjob given to runJob");
    }
    await bot.rawRequest({
        method: 'POST',

    })
}

async function getJobDetails(name: string) {
    init();
    const response = await bot.rawRequest({
        method: 'GET',
        url: appConf.apiUrl + '/show/' + name,
        responseType: 'json'
    });
    return response.data;
}

export async function deleteJob(name: string) {
    init();

}
