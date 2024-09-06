import {argv, log} from '../botbase';
import {streamWithRoutes} from "./app";

log(`[S] Started`);
process.chdir(__dirname);

process.env.EVENTSTREAM_ROUTER = 'true';

import Gans from "../most-gans/eventstream-updater";
import BotActivityMonitor from "../bot-monitor/eventstream-trigger";
import DbTabulatorMetadata from "../db-tabulator/eventstream-metadata-maintainer";
import ShutoffsMonitor from "./routes/shutoffs-monitor";
import DykCounts from "../dyk-counts/eventstream-trigger";
import Purger from "./routes/purger";
import GadgetsSync from "../gadgets-sync/eventstream-trigger";

const routeClasses = [
    Gans,
    DykCounts,
    BotActivityMonitor,
    DbTabulatorMetadata,
    ShutoffsMonitor,
    Purger,
    GadgetsSync,
];

// debugging a single route example: -r "./test"
streamWithRoutes(argv.r ? [require(argv.r).default] : routeClasses);
