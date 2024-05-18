import * as express from "express";
import {exec} from "child_process";
import {mapPath} from "../../../SDZeroBot/utils";
import {numericArg} from "../utils";

const router = express.Router();

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
		res.status(200).send(`<pre>${stdout}</pre>`);
	}));
});

export default router;
