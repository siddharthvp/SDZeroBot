import {Redis} from "ioredis"
import {onToolforge, readFile} from "./utils";
import {log} from "./botbase";

export const redis = new Redis({
    host: onToolforge() ? 'tools-redis' : 'localhost',
    port: onToolforge() ? 6379 : 4713,

    // Prefixing per https://wikitech.wikimedia.org/wiki/Help:Toolforge/Redis_for_Toolforge#Security
    // A secret prefix string is stored in redis-key-prefix.txt
    keyPrefix: readFile(__dirname + '/redis-key-prefix.txt'),

    socketTimeout: 2000,
    commandTimeout: 4000,
    connectTimeout: 5000,
});

redis.on('error', err => {
    log(`[E] Redis error:`);
    log(err);
});
