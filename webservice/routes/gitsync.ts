import * as express from "express";
import * as multer from 'multer';
import {mwn} from "../../../mwn";

const router = express.Router();
const upload = multer()

// Handles multipart/form-data requests
router.post('/savepage', upload.none(), async (req, res) => {

    try {
        const client = await mwn.init({
            apiUrl: req.body.apiUrl,
            username: req.body.username,
            password: req.body.password,
            OAuth2AccessToken: req.body.oauth2Token,
            userAgent: 'gitsync ([[en:User:SD0001]])'
        })
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
