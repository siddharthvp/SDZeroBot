import {bot, log} from "./botbase";
import k8s from "@kubernetes/client-node";

(async function () {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    const listRequest = await k8sApi.listNamespacedPod('tool-sdzerobot');
    const pods = listRequest.body.items;
    for (const pod of pods) {
        const podName = pod.metadata.name;
        if (podName.startsWith('shell-') && isStale(pod.metadata.creationTimestamp)) {
            log(`[W] Terminating dangling pod ${podName}`);
            await k8sApi.deleteNamespacedPod(podName, 'tool-sdzerobot');
        }
    }
})();

function isStale(date: Date): boolean {
    return new bot.date().subtract(2, 'hours').isAfter(date);
}
