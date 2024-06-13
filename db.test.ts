import {enwikidb} from "./db";
import {sleep} from "mwn/build/utils";
import * as assert from "assert";

const testDb = new enwikidb({
    host: '127.0.0.1',
    port: 3312,
    database: 'my_wiki',
    user: 'wikiuser',
    password: 'wikipassword',
    connectionLimit: 5
});

it('destroy pooled connections on inactivity', async function () {
    this.timeout(10000);
    let conn1, conn2;

    conn1 = await testDb.getConnection()
    conn1.release();
    await sleep(1000);
    conn2 = await testDb.getConnection();
    conn2.release()
    assert(conn1.threadId === conn2.threadId)

    conn1 = await testDb.getConnection()
    conn1.release();
    await sleep(5100);
    conn2 = await testDb.getConnection();
    conn2.release()
    assert(conn1.threadId !== conn2.threadId)
});
