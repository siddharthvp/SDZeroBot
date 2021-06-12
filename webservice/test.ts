import {JSDOM} from 'jsdom';
import {stringToId} from './routes/articlesearch'

const window = new JSDOM('').window;

function assertValidId(str) {
	// this throws if not a valid id
	window.document.querySelector('#' + str);
}

describe('articlesearch', () => {
	it('stringToId', () => {
		assertValidId(stringToId('wjsdf'));
		assertValidId(stringToId('1wjsdf'));
		assertValidId(stringToId('lorem ipsum'));
		assertValidId(stringToId('lorem ipsum (Example)'));
		assertValidId(stringToId('lor\'m'));
		assertValidId(stringToId('lor"m'));
		assertValidId(stringToId('lor%$2&()@!m'));
		assertValidId(stringToId('lo*^r"m-'));
		assertValidId(stringToId('H. P. Lovecraft'));
	});
});