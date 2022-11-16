import {bot, log} from "./botbase";
import {KubeConfig, CoreV1Api} from "@kubernetes/client-node";

(async function () {
    const kc = new KubeConfig();
    kc.loadFromDefault();
    const k8sApi = kc.makeApiClient(CoreV1Api);
    const namespace = 'tool-sdzerobot';

    const listRequest = await k8sApi.listNamespacedPod(namespace);
    const pods = listRequest.body.items;
    for (const pod of pods) {
        const podName = pod.metadata.name;
        if (podName.startsWith('shell-') && isStale(pod.metadata.creationTimestamp)) {
            log(`[W] Terminating dangling pod ${podName}`);
            await k8sApi.deleteNamespacedPod(podName, namespace);
        }
    }
})();

function isStale(date: Date): boolean {
    return new bot.date().subtract(2, 'hours').isAfter(date);
}
