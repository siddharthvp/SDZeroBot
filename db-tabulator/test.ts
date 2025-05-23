import {Query} from "./app";
import {bot} from "../botbase";
import assert = require("assert");
import {NoMetadataStore} from "./NoMetadataStore";
import {Template} from "../../mwn/build/wikitext";
import {MwnDate} from "../../mwn";
import {applyJsPostProcessing} from "./postprocess";

describe('db-tabulator', () => {

	const noMetadataStore = new NoMetadataStore();

	const isUpdateDue = (lastUpdate: MwnDate, interval: number) => {
		const query = new Query(new Template(""), "", 1);
		query.config.interval = interval;
		return noMetadataStore.checkIfUpdateDue(lastUpdate, query);
	}

	it('checkIfUpdateDue', () => {
		assert.strictEqual(isUpdateDue(new bot.Date().subtract(1, 'day'), 1), true);
		assert.strictEqual(isUpdateDue(new bot.Date().subtract(2, 'day'), 1), true);
		assert.strictEqual(isUpdateDue(new bot.Date().subtract(1, 'hour'), 1), false);
		assert.strictEqual(isUpdateDue(new bot.Date().subtract(11, 'hour'), 1), false);
		assert.strictEqual(isUpdateDue(new bot.Date().subtract(13, 'hour'), 1), true);

		assert.strictEqual(isUpdateDue(new bot.Date().subtract(30, 'hour'), 2), false);
		assert.strictEqual(isUpdateDue(new bot.Date().subtract(36, 'hour'), 2), true);
		assert.strictEqual(isUpdateDue(new bot.Date().subtract(40, 'hour'), 2), true);
	});

	it('applyJsPostProcessing', async () => {
		console.log(await applyJsPostProcessing(
			[{id: '1', name: 'Main Page'}, {id: '2', name: "Talk:Main Page"}],
			`function postprocess(rows) {
				rows.forEach(row => {
					row.id = parseInt(row.id) + 100;
				})
				return rows;    
			}`, new Query(new Template('{{}}'), '', 1)));
	})

});
