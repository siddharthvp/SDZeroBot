const {sql, utils} = require('../botbase');

sql.queryBot(`
	SELECT page_title, rd_title FROM redirect
	INNER JOIN page
	ON rd_from = page_id
	WHERE page_namespace = 10
	AND page_title like "%-stub"
`).then(function(result) {

	sql.end();
	var map = {};
	result.forEach(row => {
		map[row.page_title] = row.rd_from;
	});

	utils.saveObject('redirect-stub-templates', map);
});