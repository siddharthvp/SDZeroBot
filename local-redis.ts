import {Redis} from "ioredis"
import {onToolforge} from "./utils";
import {log, AuthManager} from "./botbase";

/**
 * Creates a Redis connection and returns the connection. Be sure
 * to call .quit() on the returned value in non-continuous jobs,
 * otherwise the job won't be able to finish.
 */
export function createLocalRedisConnection(): Redis {
    const localRedis = new Redis({
        host: onToolforge() ? 'redis' : 'localhost',
        port: 6379,

        password: AuthManager.get('local-redis').password,

        socketTimeout: 2000,
        commandTimeout: 4000,
        connectTimeout: 5000,

    });

    localRedis.on('error', err => {
        log(`[E] Local Redis error:`);
        log(err);
    });

    return localRedis;
}
