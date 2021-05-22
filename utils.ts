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
