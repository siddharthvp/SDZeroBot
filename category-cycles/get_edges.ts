import {AuthManager, log, fs, emailOnError} from "../botbase";
import * as mysql from "mysql2";

(async function () {
	const wiki = process.env.DB || 'enwiki';

	const connection = mysql.createConnection({
		host: `${wiki}.analytics.db.svc.wikimedia.cloud`,
		port: 3306,
		...AuthManager.get('db'),
		database: `${wiki}_p`,
	})

	const outputFile = fs.createWriteStream('edges.out')

	const query = connection.query(`
		SELECT cl_from AS subcat, page_id AS parentcat
		FROM categorylinks
		JOIN page ON page_namespace = 14 AND page_title = cl_to
		WHERE cl_type = 'subcat'
	`)

	query.stream()
		.on('data', row => {
			outputFile.write(`${row.subcat}\t${row.parentcat}\n`)
		})
		.on('end', () => {
			log('[S] Query finished and data written to file.')
			outputFile.end()
			connection.end()
		})
		.on('error', (err) => {
			log('[E] Error during query or writing to file:', err)
			outputFile.end()
			connection.end()
			process.exit(1)
		})

})().catch(e => emailOnError(e, 'category-cycles-get-edges'));
