import * as createError from "http-errors";
import * as express from "express";
import * as path from "path";
import * as cookieParser from "cookie-parser";
import * as morgan from "morgan";
import * as hbs from 'hbs';
import * as cors from 'cors';

// All paths to SDZeroBot files must be via ../../SDZeroBot rather than via ../
// The latter will work locally but not when inside toolforge www/js directory!
import { bot, Mwn } from "../../SDZeroBot/botbase";
import { humanDate } from "../../mwn/build/log";
import { registerRoutes } from "./route-registry";

const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
hbs.registerHelper('wikilink',  (pageName, displayName) => {
	return `<a href="https://en.wikipedia.org/wiki/${Mwn.util.wikiUrlencode(pageName)}" title="${pageName.replace(/"/g, '&#34;')}">${typeof displayName === 'string' ? displayName : pageName}</a>`;
});

morgan.token('date', () => humanDate());
app.use(morgan('[:date] :method :url :status :response-time ms'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public'), {
	setHeaders: (res, path, stat) => {
		res.setHeader('Supports-Loading-Mode', 'fenced-frame')
	}
}));

// bot account setup: get siteinfo once and refresh tokens every 10 minutes
// XXX: more systematic way for token handling?
bot.getSiteInfo();
setInterval(function () {
	bot.getTokens();
}, 600000);

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
	res.render('error');
});

export default app;
