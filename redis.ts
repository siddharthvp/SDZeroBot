import * as redis from 'redis';
import * as asyncRedis from "async-redis";
import { randomBytes } from "crypto";

// Source: https://github.com/moaxaca/async-redis (MIT)
// for some reason the Promisified type that we need isn't exported from there
// so we copy-paste that type definition here
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
type Omitted = Omit<redis.RedisClient, keyof redis.Commands<boolean>>;
interface Promisified<T = redis.RedisClient> extends Omitted, redis.Commands<Promise<boolean>> {}

export const REDIS_HOST = 'tools-redis';

/**
 * Usage:
 * 	const redis = new Redis({customOptions}).connect();
 * then
 * 	let item = await redis.get('key');
 * 	await redis.set('key', 'value');
 * 	...
 * Note that this does send a network call even though it doesn't take a callback or return a promise,
 * so it only be invoked where redis is going to be used
 */
export class Redis {
	config: redis.ClientOpts;
	constructor(config: redis.ClientOpts = {}) {
		this.config = {
			host: process.env.LOCAL ? '127.0.0.1' : REDIS_HOST,
			port: process.env.LOCAL ? 4713 : 6379,
			// Prefixing per https://wikitech.wikimedia.org/wiki/Help:Toolforge/Redis_for_Toolforge#Security
			prefix: randomBytes(20).toString('hex'),
			...config
		};
	}
	connect(): Promisified {
		return asyncRedis.createClient(this.config);
	}
}