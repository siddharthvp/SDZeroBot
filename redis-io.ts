import {Redis} from "ioredis"
import {onToolforge} from "./utils";
import {log, AuthManager} from "./botbase";

export const redis = new Redis({
    host: onToolforge() ? 'tools-redis' : 'localhost',
    port: onToolforge() ? 6379 : 4713,

    // Prefixing per https://wikitech.wikimedia.org/wiki/Help:Toolforge/Redis_for_Toolforge#Security
    keyPrefix: AuthManager.get('redis').keyPrefix,

    socketTimeout: 2000,
    commandTimeout: 4000,
    connectTimeout: 5000,
});

redis.on('error', err => {
    log(`[E] Redis error:`);
    log(err);
});
