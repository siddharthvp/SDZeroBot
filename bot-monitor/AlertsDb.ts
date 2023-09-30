import {Cassandra} from "../cassandra";
import {MwnDate} from "mwn";
import {getKey, Rule} from "./Rule";
import {bot, toolsdb} from "../botbase";
import * as fs from "fs/promises";
import {getRedisInstance, Redis} from "../redis";
import {createLocalSSHTunnel} from "../utils";
import {TOOLS_DB_HOST} from "../db";

interface AlertsDb {
    connect(): Promise<void>;
    getLastEmailedTime(rule: Rule): Promise<MwnDate>;
    saveLastEmailedTime(rule: Rule): Promise<void>;
}

class MariadbAlertsDb implements AlertsDb {
    db: toolsdb;
    async connect(): Promise<void> {
        await createLocalSSHTunnel(TOOLS_DB_HOST);
        this.db = new toolsdb('botmonitor');
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS alerts(
                name VARCHAR(255) PRIMARY KEY,
                lastEmailed TIMESTAMP
            )
        `);
    }

    async getLastEmailedTime(rule: Rule): Promise<MwnDate> {
        let data = await this.db.query(
            `SELECT lastEmailed FROM alerts WHERE name = ?`,
            [ getKey(rule, 250) ]
        );
        return data[0] ? new bot.Date(data[0].lastEmailed) : new bot.Date(0);
    }

    async saveLastEmailedTime(rule: Rule): Promise<void> {
        await this.db.run(
            `REPLACE INTO alerts (name, lastEmailed) VALUES(?, UTC_TIMESTAMP())`,
            [ getKey(rule, 250) ]
        );
    }
}

class CassandraAlertsDb implements AlertsDb {
    cs: Cassandra = new Cassandra();

    async connect() {
        await this.cs.connect();
    }

    async getLastEmailedTime(rule: Rule): Promise<MwnDate> {
        let data= await this.cs.execute(
            'SELECT lastEmailed FROM botMonitor WHERE name = ?',
            [ getKey(rule) ]
        );
        return new bot.date(data.rows[0].get('lastEmailed'));
    }

    async saveLastEmailedTime(rule: Rule) {
        await this.cs.execute(
            'UPDATE botMonitor SET lastEmailed = toTimestamp(now()) WHERE name = ?',
            [ getKey(rule) ]
        );
    }
}

class FileSystemAlertsDb implements AlertsDb {
    file = 'alerts_db.json';
    data: Record<string, any>;

    async connect() {
        this.data = JSON.parse((await fs.readFile(this.file)).toString());
    }

    async getLastEmailedTime(rule: Rule): Promise<MwnDate> {
        return new bot.date(this.data[getKey(rule)].lastEmailed);
    }
    async saveLastEmailedTime(rule: Rule): Promise<void> {
        if (!this.data[getKey(rule)]) {
            this.data[getKey(rule)] = {};
        }
        this.data[getKey(rule)].lastEmailed = new bot.date().toISOString();

        // only needed on the last save, but done everytime anyway
        await fs.writeFile(this.file, JSON.stringify(this.data));
    }
}

class RedisAlertsDb implements AlertsDb {
    redis: Redis;
    async connect() {
        this.redis = getRedisInstance();
    }

    async getLastEmailedTime(rule: Rule) {
        return new bot.date(await this.redis.hget('botmonitor-last-emailed', getKey(rule)));
    }
    async saveLastEmailedTime(rule: Rule) {
        await this.redis.hset('botmonitor-last-emailed', getKey(rule), new bot.date().toISOString);
    }
}

export const alertsDb: AlertsDb = new MariadbAlertsDb();
