import * as express from "express";
import 'express-async-errors';
import {ElasticDataStore} from "../elasticsearch";
import {getKey, normalizeCategory} from "./util";

const router = express.Router();

const countStore = new ElasticDataStore('category-counts-enwiki');

router.get('/raw', async (req, res) => {
    let category = normalizeCategory(req.query.category as string);
    if (!category) {
        return res.status(400).render('webservice/views/oneline', {
            text: 'Missing URL parameter "category"'
        })
    }
    const key = getKey(category);

    if (!await countStore.exists(key)) { // TODO: optimize away this query
        return res.status(404).render('webservice/views/oneline', {
            text: 'No data found for [[' + category + ']]'
        });
    }

    const result = await countStore.get(key);

    // Reverse so that the recent dates are up at the top
    const reversedJson = Object.fromEntries(Object.entries(result).reverse());

    return res.status(200).type('json').send(reversedJson);
});

export default router;
