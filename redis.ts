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
 * Note: this triggers a network request even though it doesn't take a callback or return a
 * promise.
 *
 * Usage:
 * 	const redis = await createRedisClient({customOptions});
 * then
 * 	let item = await redis.get('key');
 * 	await redis.set('key', 'value');
 * 	...
 */
export function createRedisClient(config: redis.ClientOpts = {}): Redis {
	return asyncRedis.createClient(getRedisConfig(config));
}

export function getRedisConfig(config: redis.ClientOpts = {}): redis.ClientOpts {
	return {
		host: onToolforge() ? REDIS_HOST : '127.0.0.1',
		port: onToolforge() ? 6379 : 4713,
		// Prefixing per https://wikitech.wikimedia.org/wiki/Help:Toolforge/Redis_for_Toolforge#Security
		// A secret prefix string is stored in redis-key-prefix.txt
		prefix: readFile(__dirname + '/redis-key-prefix.txt'),
		...config
	}
}

/**
 * For typical usage with the default options.
 * Note: this can trigger a network request even though it doesn't take a callback or return a
 * promise.
 */
export function getRedisInstance(): Redis {
	if (!instance) {
		instance = createRedisClient();
	}
	return instance;
}
