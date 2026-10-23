import {Redis} from "ioredis"
import {onToolforge} from "./utils";
import {log, AuthManager} from "./botbase";

export const localRedis = new Redis({
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
