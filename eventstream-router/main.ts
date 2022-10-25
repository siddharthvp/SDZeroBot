import { argv, log } from '../botbase';
import { streamWithRoutes } from "./app";

log(`[S] Started`);
process.chdir(__dirname);

import g13Watch from "../reports/g13-watch/eventstream-watch";
import gans from "../most-gans/eventstream-updater";
import botActivityMonitor from "../bot-monitor/eventstream-trigger";
import dbTabulator from "../db-tabulator/eventstream-trigger";

const routeClasses = [gans, botActivityMonitor, dbTabulator];

// debugging a single route example: -r "./test"
streamWithRoutes(argv.r ? [require(argv.r).default] : routeClasses);
