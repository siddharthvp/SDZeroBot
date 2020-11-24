const {enwikidb, utils} = require('../botbase');

(async () => {
	let db = new enwikidb().init();
	const result = await db.query(`
		SELECT page_title, rd_title FROM redirect
		INNER JOIN page
		ON rd_from = page_id
		WHERE page_namespace = 10
		AND page_title like "%-stub"
	`);
	await db.end();

	let map = {};
	result.forEach(row => {
		map[row.page_title] = row.rd_title;
	});

	utils.saveObject('redirect-stub-templates', map);
})();
