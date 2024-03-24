import {closeTunnels, createLocalSSHTunnel} from "../../SDZeroBot/utils";
import {ENWIKI_DB_HOST, TOOLS_DB_HOST} from "../../SDZeroBot/db";
import {REDIS_HOST} from "../../SDZeroBot/redis";

createLocalSSHTunnel(ENWIKI_DB_HOST);
createLocalSSHTunnel(TOOLS_DB_HOST);
createLocalSSHTunnel(REDIS_HOST);

process.on('exit', () => closeTunnels());
