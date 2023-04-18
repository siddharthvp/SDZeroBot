import {log} from "./botbase";
import * as k8s from "@kubernetes/client-node";

const kubeConfig = new k8s.KubeConfig();
kubeConfig.loadFromDefault();

const namespace = 'tool-sdzerobot';

export async function restartDeployment(name: string) {
    const api = kubeConfig.makeApiClient(k8s.AppsV1Api);
    const headers = {'content-type': 'application/strategic-merge-patch+json'};
    const body = {
        spec: {
            template: {
                metadata: {
                    annotations: {
                        'kubectl.kubernetes.io/restartedAt': new Date().toISOString()
                    }
                }
            }
        }
    };
    // K8s is straightforward, ain't it?
    return api.patchNamespacedDeployment(name, namespace, body, undefined, undefined,
        undefined, undefined, undefined, {headers});
}

export async function invokeCronJob(name: string) {
    // https://stackoverflow.com/questions/66471826/kubernetes-client-javascript-create-job-from-cronjob
    const api = kubeConfig.makeApiClient(k8s.BatchV1Api);
    try {
        const cronJob = await api.readNamespacedCronJob(name, namespace);
        const cronJobSpec = cronJob.body.spec.jobTemplate.spec;
        const job = new k8s.V1Job();
        const metadata = new k8s.V1ObjectMeta();
        job.apiVersion = 'batch/v1';
        job.kind = 'Job';
        job.spec = cronJobSpec;
        metadata.name = name + '-manual';
        metadata.annotations = {
            'cronjob.kubernetes.io/instantiate': 'manual',
        };
        job.metadata = metadata;
        return api.createNamespacedJob(namespace, job);
    } catch (err) {
        log(`[E] Failed to create job: ${err.message}`);
        throw err;
    }
}
