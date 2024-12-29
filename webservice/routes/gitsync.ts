import * as express from "express";
import * as multer from 'multer';
import {Mwn} from "../../../mwn";

const router = express.Router();
const upload = multer();

// Handles multipart/form-data requests
router.post('/savepage', upload.none(), async (req, res) => {

    try {
        const client = await Mwn.init({
            apiUrl: req.body.apiUrl,
            username: req.body.username,
            password: req.body.password,
            OAuth2AccessToken: req.body.oauth2Token,
            userAgent: 'gitsync ([[:c:User:Mdaniels5757]])'
        })
        if (new client.title(req.body.page).namespace === 0) {
            return res.status(400).contentType('json').send({
                error: 'Aborting edit to target page as it is in main namespace'
            })
        }
        const saveResponse = await client.save(
            req.body.page,
            req.body.content,
            req.body.editSummary
        )

        res.status(200).contentType('json').send({
            edit: (saveResponse.nochange ? 'nochange' : 'successful')
        })
    } catch (err) {
        res.status(500).contentType('json').send({
            error: err.message
        })
    }
})

export default router;
