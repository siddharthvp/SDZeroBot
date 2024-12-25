import {commonswikidb} from "./db";
import {expect} from "chai";
import * as sinon from 'sinon';

const testDb = new commonswikidb({
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
    let clock = sinon.useFakeTimers();

    conn1 = await testDb.getConnection()
    conn1.release();
    clock.tick(1000)
    conn2 = await testDb.getConnection();
    conn2.release();
    expect(conn1.threadId).to.eq(conn2.threadId)

    conn1 = await testDb.getConnection()
    conn1.release();
    clock.tick(5100);
    conn2 = await testDb.getConnection();
    conn2.release();
    expect(conn1.threadId).to.not.eq(conn2.threadId)

    clock.restore();
});
