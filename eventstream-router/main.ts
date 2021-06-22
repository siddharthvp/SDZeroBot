import { log } from '../botbase';
import { getRoutes, LastSeen, start } from "./app";

log(`[S] Started`);
process.chdir(__dirname);

const lastSeen = new LastSeen('./last-seen.txt');
const routes = getRoutes('./routes.json');

start(routes, lastSeen);
