

/**
 * Stub template redirect mapping
 * Update using https://quarry.wmflabs.org/query/43113
 */
const redirectMap = require('./redirect-stub-templates');

/**
 * @class
 * StubTagManager - Facilitates adding and removing stub tags from the
 * wikitext.
 * All tags are stored in this.tags in normalised form:
 *  - redirects resolved using the redirectMap
 *  - first char uppercase
 *  - No braces
 * This condition is maintained while adding tags.
 */
class StubTagManager {

	constructor(wikitext) {
		this.originalText = wikitext;
		this.tags = new Set((wikitext.match(/\{\{[^{]*?-stub(?:\|.*?)?\}\}/g) || [])
			.map(StubTagManager.normalise));
		this.originalTags = [...this.tags];
		this.addedTags = [];
		this.removedTags = [];
	}

	static normalise(tag) {
		tag = tag.trim().replace(/^\{\{/, '').replace(/\}\}$/, '');
		tag = tag[0].toUpperCase() + tag.slice(1);
		return redirectMap[tag] || tag;
	}

	/** @param {String[]} tags */
	validateExisting(tags) {
		return tags.map(StubTagManager.normalise).sort().toString() === [...this.tags].sort().toString();
	}

	addTag(tag) {
		tag = StubTagManager.normalise(tag);
		if (!this.tags.has(tag)) {
			this.tags.add(tag);
			this.addedTags.push(tag);
			return true;
		}
		return false;
	}

	removeTag(tag) {
		tag = StubTagManager.normalise(tag);
		if (this.tags.has(tag)) {
			this.tags.delete(tag);
			this.removedTags.push(tag);
			return true;
		}
		return false;
	}

	hasTag(tag) {
		tag = StubTagManager.normalise(tag);
		return this.tags.has(tag);
	}

	removeAll() {
		this.removedTags = this.removedTags.concat([...this.tags]);
		this.tags = new Set();
	}

	// doesn't account for normalisation changes
	hasChanged() {
		return !!this.addedTags.length || !!this.removedTags.length;
	}

	// existing tags are re-inserted after normalisation
	getText() {
		// remove all
		return this.originalText.replace(/\{\{[^{]*-stub(\|.*?)?\}\}\s*/g, '').trim()
			// add
			+ '\n\n\n' + [...this.tags].map(e => '{{' + e + '}}').join('\n');
	}

	// you probably want to override this for yourself
	makeEditSummary() {
		return this.removedTags.map(e => '–{{' + e + '}}')
			.concat(this.addedTags.map(e => '+{{' + e + '}}'))
			.join(', ');
	}

}

module.exports = StubTagManager;