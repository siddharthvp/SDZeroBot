import * as express from "express";

import indexRouter from "./routes/index";
import logsRouter from "./routes/logs";
import summaryRouter from "./routes/summary";
import dbReportRouter from '../db-tabulator/web-endpoint';
import gansRouter from '../most-gans/web-endpoint';
import articleSearchRouter from './routes/articlesearch';
import dykRouter from '../dyk-counts/web-endpoint';
import gitsync from "./routes/gitsync";
import botMonitorRouter from '../bot-monitor/web-endpoint'
import gitlabRouter from './routes/gitlab';
import autoSqlRouter from "../db-tabulator/autosql/web-endpoint";
import categoryCountRouter from "../category-counts/web-endpoint";

export function registerRoutes(app: express.Router) {
	app.use('/', indexRouter);
	app.use('/logs', logsRouter);
	app.use('/logs.php', logsRouter); // support old URLs from the time webservice was in php
	app.use('/database-report', dbReportRouter);
	app.use('/autosql', autoSqlRouter)
	app.use('/gans', gansRouter);
	app.use('/summary', summaryRouter);
	app.use('/articlesearch', articleSearchRouter);
	app.use('/dyk', dykRouter);
	app.use('/gitsync', gitsync);
	app.use('/bot-monitor', botMonitorRouter);
	app.use('/gitlab', gitlabRouter);
	app.use('/category-counts', categoryCountRouter);
}
