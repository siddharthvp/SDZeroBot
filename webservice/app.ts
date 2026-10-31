import createError from "http-errors";
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import hbs from 'hbs';
import cors from 'cors';

import {bot, logFullError, Mwn} from "../botbase";
import {humanDate} from "../../mwn/build/log";
import {registerRoutes} from "./route-registry";
import {MINUTE} from "../millis";

const app = express();

// view engine setup
app.set('views', path.join(__dirname, '..'));
app.set('view engine', 'hbs');
app.set('view options', { layout: 'webservice/views/layout' });
hbs.registerHelper('wikilink',  (pageName, displayName) => {
	return `<a href="https://en.wikipedia.org/wiki/${Mwn.util.wikiUrlencode(pageName)}" title="${pageName.replace(/"/g, '&#34;')}">${typeof displayName === 'string' ? displayName : pageName}</a>`;
});

morgan.token('date', () => humanDate());
// Bridge older Express types (optional res.req) and Node types (required res.req).
app.use(morgan('[:date] :method :url :status :response-time ms') as express.RequestHandler);
app.use(express.json() as express.RequestHandler);
app.use(express.urlencoded({extended: false}) as express.RequestHandler);
app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// bot account setup: get siteinfo once and refresh tokens every 10 minutes
// XXX: more systematic way for token handling?
bot.getSiteInfo();
setInterval(function () {
	bot.getTokens();
}, 10 * MINUTE);

bot.setOptions({
	retryPause: 2000,
	defaultParams: {
		maxlag: undefined
	}
});

registerRoutes(app);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
	next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
	// set locals, only providing error in development
	res.locals.message = err.message;
	res.locals.error = req.app.get('env') === 'development' ? err : {};

	// render the error page
	res.status(err.status || 500);
	res.render('webservice/views/error');

	if (!err.status || err.status === 500) {
		logFullError(err, false);
	}
});

export default app;
