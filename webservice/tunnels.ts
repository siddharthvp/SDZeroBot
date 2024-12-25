import {closeTunnels, createLocalSSHTunnel} from "../utils";
import {COMMONSWIKI_DB_HOST, TOOLS_DB_HOST} from "../db";
import {REDIS_HOST} from "../redis";

createLocalSSHTunnel(COMMONSWIKI_DB_HOST);
createLocalSSHTunnel(TOOLS_DB_HOST);
createLocalSSHTunnel(REDIS_HOST);

process.on('exit', () => closeTunnels());
