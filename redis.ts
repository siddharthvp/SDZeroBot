import * as redis from 'redis';
import * as asyncRedis from "async-redis";
import { onToolforge, readFile } from "./utils";

// Source: https://github.com/moaxaca/async-redis (MIT)
// for some reason the Promisified type that we need isn't exported from there
// so we copy-paste that type definition here
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
type Omitted = Omit<redis.RedisClient, keyof redis.Commands<boolean>>;

interface Redis<T = redis.RedisClient> extends Omitted, redis.Commands<Promise<boolean>> {}

export const REDIS_HOST = 'tools-redis';

let instance: Redis;

/**
 * Should be used directly only when there is a need to customise the options. Otherwise, use
 * getRedisClient() which prevents creating multiple connections unnecessarily.
 *
 * Usage:
 * 	const redis = await createRedisClient({customOptions});
 * then
 * 	let item = await redis.get('key');
 * 	await redis.set('key', 'value');
 * 	...
 */
export async function createRedisClient(config: redis.ClientOpts = {}): Promise<Redis> {
	// asyncRedis.createClient doesn't return a promise. Rather this method
	// is marked as async just to indicate to callers that this triggers a network
	// request.
	return asyncRedis.createClient({
		host: onToolforge() ? REDIS_HOST : '127.0.0.1',
		port: onToolforge() ? 6379 : 4713,
		// Prefixing per https://wikitech.wikimedia.org/wiki/Help:Toolforge/Redis_for_Toolforge#Security
		// A secret prefix string is stored in redis-key-prefix.txt
		prefix: readFile('./redis-key-prefix.txt'),
		...config
	});
}

/**
 * For typical usage with the default options.
 */
export async function getRedisInstance(): Promise<Redis> {
	if (!instance) {
		instance = await createRedisClient();
	}
	return instance;
}
