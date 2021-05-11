import * as fs from "fs";

export function readFile(file) {
	try {
		return fs.readFileSync(file).toString();
	} catch (e) {
		return null;
	}
}

export function writeFile(file, text) {
	return fs.writeFileSync(file, text);
}

export function saveObject(filename, obj) {
	fs.writeFileSync('./' + filename + '.json', JSON.stringify(obj, null, 2));
}

export function logObject(obj) {
	return console.log(JSON.stringify(obj, null, 2));
}

export function makeSentence(list: string[]) {
	var text = '';
	for (let i = 0; i < list.length; i++) {
		text += list[i];
		if (list.length - 2 === i) {
			text += " and ";
		} else if (list.length - 1 !== i) {
			text += ", ";
		}
	}
	return text;
}

/**
 * Make template wikitext from the template name and parameters
 * @param {string} name - name of the template. Include "subst:" if necessary
 * @param {Object} parameters - object with keys and values being the template param names and values.
 * Use numbers as keys for unnamed parameters.
 * If a value is falsy (undefined or null or empty string), the param doesn't appear in output.
 * @returns {string}
 */
export function makeTemplate(name: string, parameters: Record<string | number, string>): string {
	let parameterText = Object.entries(parameters)
		.filter(([k, v]) => !!v) // ignore params with no value
		.map(([name, value]) => `|${name}=${value}`)
		.join('');
	return '{{' + name + parameterText + '}}';
}

export function arrayChunk(arr, size) {
	var numChunks = Math.ceil(arr.length / size);
	var result = new Array(numChunks);
	for(var i = 0; i < numChunks; i++) {
		result[i] = arr.slice(i * size, (i + 1) * size);
	}
	return result;
}

export function lowerFirst(str: string) {
	return str[0].toLowerCase() + str.slice(1);
}

export function upperFirst(str: string) {
	return str[0].toLowerCase() + str.slice(1);
}
