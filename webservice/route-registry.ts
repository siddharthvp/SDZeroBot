import * as express from "express";

import indexRouter from "./routes/index";
import logsRouter from "./routes/logs";
import summaryRouter from "./routes/summary";
import dbReportRouter from '../../SDZeroBot/db-tabulator/web-endpoint';
import gansRouter from '../../SDZeroBot/most-gans/web-endpoint';
import articleSearchRouter from './routes/articlesearch';
import dykRouter from './routes/dyk';
import gitsync from "./routes/gitsync";

export function registerRoutes(app: express.Router) {
	app.use('/', indexRouter);
	app.use('/logs', logsRouter);
	app.use('/logs.php', logsRouter); // support old URLs from the time webservice was in php
	app.use('/database-report', dbReportRouter);
	app.use('/gans', gansRouter);
	app.use('/summary', summaryRouter);
	app.use('/articlesearch', articleSearchRouter);
	app.use('/dyk', dykRouter);
	app.use('/gitsync', gitsync);
}
