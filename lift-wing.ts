import {bot, log} from "./botbase";
import {getAccessToken} from "./wm-api";

type Model = {
    articletopic: string[];
    drafttopic: string[];
    articlequality: string;
    draftquality: string;
    damaging: boolean;
    goodfaith: boolean;
};

type ModelOutput<T extends keyof Model> = {
    error?: any;
    score?: {
        prediction: Model[T],
        probability: Record<string, number>
    }
};

export async function liftWingRequest<T extends keyof Model>(model: T, revId: number): Promise<ModelOutput<T>> {
    const response = await bot.rawRequest({
        method: 'POST',
        url: `https://api.wikimedia.org/service/lw/inference/v1/models/enwiki-${model}:predict`,
        data: {
            rev_id: revId
        },
        headers: {
            'Authorization': `Bearer ${await getAccessToken()}`,
            'Content-Type': 'application/json'
        }
    });
    const json = response.data;
    return json.enwiki.scores[revId][model as string];
}

export async function liftWingBatchRequest(models: Array<keyof Model>, revids: number[], errors?: any[]) {
    const combinations = models.flatMap(m => revids.map(r => [m, r])) as [keyof Model, number][];
    const out = Object.fromEntries(models.map(m => [m, {}]));
    await bot.batchOperation(combinations, async ([model, revid]) => {
        const result = await liftWingRequest(model, revid);
        if (result.error) {
            log(`[E] ORES response-level error (revid=${revid}, model=${model}): ${JSON.stringify(result.error)}`);
            if (errors) errors.push(result.error);
        } else {
            out[model][revid] = result.score.prediction;
        }
    }, 100, 2);
    return out as Record<keyof Model, Record<number, string | boolean | string[]>>;
}
