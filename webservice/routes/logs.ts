import * as express from "express";
import {exec} from "child_process";
import {mapPath} from "../../utils";
import {numericArg} from "../utils";
import * as secretsJson from '../../.auth';

const router = express.Router();

// Check if logs contain any secrets from .auth.js file.
// If so, redact them while exposing files to the web.

const secretKeys = [
	'password',
	'consumerSecret',
	'accessSecret',
	'OAuth2AccessToken',
	'clientSecret',
	'key'
];

function flattenJSON(obj: Record<string, any> = {}, res: Record<string, string> = {}, extraKey = '') {
	for (let key in obj) {
		if (typeof obj[key] !== 'object') {
			res[extraKey + key] = obj[key];
		} else {
			flattenJSON(obj[key], res, `${extraKey}${key}.`);
		}
	}
	return res;
}

const secretValues = Object.entries(flattenJSON(secretsJson))
	.filter(([key, val]) => secretKeys.find(k => key.endsWith(k)))
	.map(([key, val]) => val);

function sanitize(str: string) {
	for (let secret of secretValues) {
		str = str.replaceAll(secret, '*****');
	}
	return str;
}

router.get('/', (req, res, next) => {
	let {type, log, lines} = req.query as {type: string; log: string; lines: string};
	if (
		(type !== 'out' && type !== 'err') ||
		/[;&|.]/.test(log)
	) {
		res.status(403).send("Forbidden!");
		return;
	}
	exec(`tail -${numericArg(lines, 200)} ${mapPath('~')}/${log}.${type}`, ((error, stdout, stderr) => {
		if (error) {
			res.status(404).send("404. No such file found, that's all I know -_-");
			return;
		}
		res.status(200).send(`<pre>${sanitize(stdout)}</pre>`);
	}));
});

export default router;
