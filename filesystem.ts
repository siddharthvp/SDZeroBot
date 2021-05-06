import * as fs from 'fs';

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
