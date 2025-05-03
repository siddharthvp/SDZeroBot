const {bot} = require('../botbase');

// Helper functions for sorting
/**
 * @param {string} param
 * @param {Object} data1
 * @param {Object} data2
 * @returns {number}
 */
function promote(param, data1, data2) {
	if (data1[param] && !data2[param]) return -1;
	else if (!data1[param] && data2[param]) return 1;
	else return 0;
}
/**
 * @param {string} param
 * @param {Object} data1
 * @param {Object} data2
 * @returns {number}
 */
function demote(param, data1, data2) {
	if (data1[param] && !data2[param]) return 1;
	else if (!data1[param] && data2[param]) return -1;
	else return 0;
}
/**
 * @param {string} param
 * @param {Object} data1
 * @param {Object} data2
 * @returns {number}
 */
function sortDesc(param, data1, data2) {
	if (data1[param] === undefined || data1[param] === undefined) return 0;
	if (data1[param] > data2[param]) return -1;
	else if (data1[param] < data2[param]) return 1;
	else return 0;
}
/**
 * @param {string} param
 * @param {Object} data1
 * @param {Object} data2
 * @returns {number}
 */
function sortAsc(param, data1, data2) {
	if (data1[param] === undefined || data1[param] === undefined) return 0;
	if (data1[param] > data2[param]) return 1;
	else if (data1[param] < data2[param]) return -1;
	else return 0;
}


/**
 * @param {bot.Page} page
 * @param {string} text
 * @param {string} summary
 * @returns {Promise}
 */
async function saveWithBlacklistHandling(page, text, summary) {
	return page.save(text, summary).catch(async err => {
		if (err.code === 'spamblacklist') {
			for (let site of err.spamblacklist.matches) {
				text = text.replace(
					new RegExp('https?:\\/\\/\\S*' + site, 'gi'),
					site
				);
			}
			await page.save(text, summary);
		} else {
			return Promise.reject(err);
		}
	});
}

/**
 * Format edit summary for inclusion in a bot report
 * @param {string} text
 * @returns {string}
 */
function formatSummary(text) {
	if (!text) { // no summary given or revdelled/suppressed summary
		return '';
	}
	return text
		// Ensure HTML comments are displayed as-is, and <div> and other tags don't render
		.replace(/</g, '&lt;')

		.replace(/\{\{.*?\}\}/g, '<nowiki>$&</nowiki>')
		.replace(/\[\[((?:Category|File|Image):.*?)\]\]/gi, '[[:$1]]')
		.replace(/~{3,5}/g, '<nowiki>$&</nowiki>');
}

/**
 * Format arbitrary text for inclusion in table cell.
 * Escapes the double pipe sequence.
 * @param {string} text
 * @returns {string}
 */
function escapeForTableCell(text) {
	return text.replace(/\|\|/g, '&#124;&#124;');
}

module.exports = {
	comparators: {promote, demote, sortAsc, sortDesc},
	saveWithBlacklistHandling,
	formatSummary,
	escapeForTableCell
};
