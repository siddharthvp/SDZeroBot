module.exports = function(bot) {
	
	class TextExtractor {

		/**
		 * Get extract 
		 * @param {string} pagetext - full page text 
		 * @param {number} [charLimit] - cut off the extract at this many readable characters, or wherever 
		 * the sentence ends after this limit
		 * @param {number} [hardUpperLimit] - cut off the extract at this many readable characters even if 
		 * the sentence hasn't ended
		 */
		static getExtract(pagetext, charLimit, hardUpperLimit) {
	
			// Remove images. Can't be done correctly with just regex as there could be wikilinks 
			// in the captions.
			var extract = TextExtractor.removeImages(pagetext);
	
			// Remove templates beginning on a new line, such as infoboxes.	
			// These ocassionally contain parameters with part of the content 
			// beginning on a newline not starting with a | or * or # or !
			// thus can't be handled with the line regex.
			extract = TextExtractor.removeTemplatesOnNewlines(extract);
	
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
	
			if (charLimit) {
				// We consider a period followed by a space or newline NOT followed by a lowercase char
				// as a sentence ending. Lowercase chars after period+space is generally use of an abbreviation
				// XXX: this still results in issues with name like Arthur A. Kempod.
				//  (?![^[]*?\]\]) so that this is not a period within a link
				//  (?![^{*]?\}\}) so that this is not a period within a template - doesn't work if there 
				//      is a nested templates after the period.
				var sentenceEnd = /\.\s(?![a-z])(?![^[]*?\]\])(?![^{]*?\}\})/g;
		
				if (extract.length > charLimit) {
					var match = sentenceEnd.exec(extract);
					while (match) {
						if (TextExtractor.effCharCount(extract.slice(0, match.index)) > charLimit) {
							extract = extract.slice(0, match.index + 1);
							break;
						} else {
							match = sentenceEnd.exec(extract);
						}
					}
				}
			}
	
			if (hardUpperLimit) {
				if (TextExtractor.effCharCount(extract) > hardUpperLimit) {
					extract = extract.slice(0, hardUpperLimit) + ' ...';
				}
			}
	
			return extract;
		}

		static removeImages(text) {
			var wkt = new bot.wikitext(text);
			wkt.parseLinks();
			wkt.files.forEach(file => {
				wkt.removeEntity(file);
			});
			return wkt.getText();
		}

		static removeTemplatesOnNewlines(text) {
			var templateOnNewline = /^\{\{/m; // g is omitted for a reason, the text is changing.
			var match = templateOnNewline.exec(text);
			while (match) {	
				var template = new bot.wikitext(text.slice(match.index)).parseTemplates(1)[0];
				if (template) {
					text = text.replace(template.wikitext, '');
				} else { // just get rid of that line, otherwise we'd enter an infinite loop
					text = text.replace(/^\{\{.*$/m, '');
				}
				match = templateOnNewline.exec(text);
			}
			return text;
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