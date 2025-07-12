import * as express from "express";
import 'express-async-errors';
import OpenAI from "openai";
import {AuthManager, log} from "../../botbase";

const router = express.Router();

const client = new OpenAI({
    apiKey: AuthManager.get('openai').key
});

router.get('/', async function (req, res) {
    return res.render('db-tabulator/autosql/autosql')
});

router.post('/generate', async function (req, res, next) {
    if (!req.body.prompt) {
        return res.status(400).render('webservice/views/oneline', {
            text: 'Bad request: required parameter "prompt" missing'
        })
    }
    const response = await client.responses.create({
        model: 'gpt-4o',
        instructions: 'Using MediaWiki\'s db schema outlined at https://www.mediawiki.org/wiki/Manual:Database_layout, write an SQL SELECT query to retrieve information per the prompt. Respond only with the SQL query, with no formatting.',
        input: req.body.prompt,
    })
    let sql = response.output_text
    if (sql.startsWith('```sql\n') && sql.endsWith('\n```')) {
        sql = sql.substring('```sql\n'.length, sql.length - '\n```'.length);
    }
    const logEntry = {
        prompt: req.body.prompt,
        response: sql.replace(/\s+/g, ' ')
    }
    log(`[S] AutoSQL result ${JSON.stringify(logEntry, null, 2)}`);
    return res.status(200).type('json').send({
        sql: sql,
        warnOnField:
            sql.includes('pl_title') ? 'pl_title' :
            sql.includes('tl_title') ? 'tl_title' :
            null
    }).end()
});

export default router;
