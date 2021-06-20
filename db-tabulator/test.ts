import { Query } from "./app";
import { bot } from "../botbase";
import assert = require("assert");

describe('db-tabulator', () => {

	it('checkIfUpdateDue', () => {
		assert.strictEqual(Query.checkIfUpdateDue(new bot.date().subtract(1, 'day'), 1), true);
		assert.strictEqual(Query.checkIfUpdateDue(new bot.date().subtract(2, 'day'), 1), true);
		assert.strictEqual(Query.checkIfUpdateDue(new bot.date().subtract(1, 'hour'), 1), false);
		assert.strictEqual(Query.checkIfUpdateDue(new bot.date().subtract(11, 'hour'), 1), false);
		assert.strictEqual(Query.checkIfUpdateDue(new bot.date().subtract(13, 'hour'), 1), true);

		assert.strictEqual(Query.checkIfUpdateDue(new bot.date().subtract(30, 'hour'), 2), false);
		assert.strictEqual(Query.checkIfUpdateDue(new bot.date().subtract(36, 'hour'), 2), true);
		assert.strictEqual(Query.checkIfUpdateDue(new bot.date().subtract(40, 'hour'), 2), true);
	});

});