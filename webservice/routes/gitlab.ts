import * as express from "express";
import 'express-async-errors';

const router = express.Router();

router.use(async function(req, res, next) {
    const response = await fetch('https://gitlab.wikimedia.org' + req.path);
    if (response.status !== 200) {
        return res.status(response.status).type(response.headers.get('Content-Type')).end(await response.text());
    }
    if (!response.headers.get('Content-Type').startsWith('text/plain')) {
        return res.status(400).send(`Gitlab returned response type ` + response.headers.get('Content-Type')
            + `, expected text/plain`);
    }

    if (req.path.endsWith('.js')) {
        res.type('text/javascript');
    } else if (req.path.endsWith('.css')) {
        res.type('text/css');
    } else if (req.path.endsWith('.json')) {
        res.type('application/json');
    } else {
        res.type('text/plain');
    }
    res.setHeader('Cache-Control', 'max-age=3600, public, must-revalidate, stale-while-revalidate=60, stale-if-error=300, s-maxage=3600');
    const code = await response.text();
    res.end(code);
});

export default router;
