import { argv, log } from '../botbase';
import { streamWithRoutes } from "./app";

log(`[S] Started`);
process.chdir(__dirname);

process.env.EVENTSTREAM_ROUTER = 'true';

import g13Watch from "../reports/g13-watch/eventstream-watch";
import gans from "../most-gans/eventstream-updater";
import botActivityMonitor from "../bot-monitor/eventstream-trigger";
import dbTabulator from "../db-tabulator/eventstream-trigger";
import dbTabulatorMetadata from "../db-tabulator/eventstream-metadata-maintainer";
import shutoffsMonitor from "./routes/shutoffs-monitor";
import dykCountsTask from "./routes/dyk-counts";
import purger from "./routes/purger"

const routeClasses = [
    gans,
    dykCountsTask,
    botActivityMonitor,
    dbTabulatorMetadata,
    shutoffsMonitor,
    purger,
];

// debugging a single route example: -r "./test"
streamWithRoutes(argv.r ? [require(argv.r).default] : routeClasses);
