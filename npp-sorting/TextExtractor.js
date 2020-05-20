module.exports = function(bot) {
	
	class TextExtractor {

		/**
		 * Get extract 
		 * @param {string} pagetext - full page text 
		 * @param {number} charLimit - cut off the extract at this many readable characters, or wherever 
		 * the sentence ends after this limit
		 * @param {number} hardUpperLimit - cut off the extract at this many readable characters even if 
		 * the sentence hasn't ended
		 */
		static getExtract(pagetext, charLimit, hardUpperLimit) {
	
			// Remove images. Can't be done correctly with just regex as there could be wikilinks 
			// in the captions.
			var wkt = new bot.wikitext(pagetext);
			wkt.parseLinks();
			wkt.files.forEach(file => {
				wkt.removeEntity(file);
			});
	
			// Remove templates beginning on a new line, such as infoboxes.	
			// These ocassionally contain parameters with part of the content 
			// beginning on a newline not starting with a | or * or # or !
			// thus can't be handled with the line regex.
			wkt.parseTemplates();
			var templateOnNewline = /^\{\{/mg;
			var match;
			// eslint-disable-next-line no-cond-assign
			while (match = templateOnNewline.exec(pagetext)) {	
				var template = wkt.templates.find(t => t.dsr[0] === match.index);
				wkt.removeEntity(template);
			}
	
			var extract = wkt.getText();
	
			extract = extract
				.replace(/<!--.*?-->/sg, '')
				// remove refs, including named ref definitions and named ref invocations
				.replace(/<ref.*?(?:\/>|<\/ref>)/sgi, '')
				// the magic
				.replace(/^\s*[{|}=*#:<!].*$/mg, '')
				// trim left to prepare for next step
				.trimLeft()
				// keep only the first paragraph
				.replace(/\n\n.*/s, '')
				.replace(/'''(.*?)'''/g, '$1')
				.replace(/\(\{\{[Ll]ang-.*?\}\}\)/, '')
				.trim();
	
			// We consider a period followed by a space or newline NOT followed by a lowercase char
			// as a sentence ending. Lowercase chars after period+space is generally use of an abbreviation
			var sentenceEnd = /\.\s(?![a-z])/g;
	
			if (extract.length > charLimit) {
				match = sentenceEnd.exec(extract);
				while (match) {
					if (TextExtractor.effCharCount(extract.slice(0, match.index)) > charLimit) {
						extract = extract.slice(0, match.index + 1);
						break;
					} else {
						match = sentenceEnd.exec(extract);
					}
				}
			}
	
			if (TextExtractor.effCharCount(extract) > hardUpperLimit) {
				extract = extract.slice(0, hardUpperLimit) + ' ...';
			}
	
			return extract;
		}
	
		static effCharCount(text) {
			return text
				.replace(/\[\[:?(?:[^|\]]+?\|)?([^\]|]+?)\]\]/g, '$1')
				.replace(/''/g, '')
				.length;
		}
	
	
		/**
		 * Do away with some of the more bizarre stuff from page extracts that aren't worth 
		 * checking for on a per-page basis @param {string} content
		 */
		static finalSanitise(content) {
			return content.replace(/\[\[Category:.*?\]\]/gi, '')
				// Harvard referencing
				.replace(/\{\{[sS]fnp?\|.*?\}\}/g, '')
				// shortcut for named ref invocation
				.replace(/\{\{r\|.*?\}\}/gi, '');
		}
	}

	return TextExtractor;

};