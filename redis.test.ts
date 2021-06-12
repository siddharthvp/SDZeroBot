import { getRedisInstance, REDIS_HOST } from "./redis";
import assert = require("assert");
import { createLocalSSHTunnel } from "./utils";

it('redis', async function () {
	this.timeout(10000);
	await createLocalSSHTunnel(REDIS_HOST);
	const redis = await getRedisInstance();
	await redis.set('qwertyhjupo', '123');
	assert.strictEqual(await redis.get('qwertyhjupo'), '123');
});