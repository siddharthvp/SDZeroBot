import * as express from "express";
import 'express-async-errors';
import OpenAI from "openai";
import {AuthManager, log} from "../../botbase";

const router = express.Router();

const client = new OpenAI({
    apiKey: AuthManager.get('openai').key
});

router.get('/', async function (req, res) {
    return res.render('db-tabulator/autosql/landing')
});

router.post('/generate', async function (req, res, next) {
    if (!req.body.prompt) {
        return res.status(400).render('webservice/views/oneline', {
            text: 'Bad request: required parameter "prompt" missing'
        })
    }
    const response = await client.chat.completions.create({
        messages: [{
            role: 'user',
            content:
                'Using MediaWiki\'s db schema outlined at https://www.mediawiki.org/wiki/Manual:Database_layout, write an SQL query to perform the below-mentioned. Respond only with the SQL query.\n\n' +
                req.body.prompt
        }],
        model: 'gpt-3.5-turbo',
    })
    const sql = response.choices[0].message.content
    const logEntry = {
        prompt: req.query.prompt,
        response: sql

    }
    return res.render('db-tabulator/autosql/result', {
        sql: sql,
        warnOnField:
            sql.includes('pl_title') ? 'pl_title' :
            sql.includes('tl_title') ? 'tl_title' :
            null
    })
});

export default router;
