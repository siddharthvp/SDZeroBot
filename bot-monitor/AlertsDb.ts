import {Cassandra} from "../cassandra";
import {MwnDate} from "mwn";
import {getKey, Rule} from "./Rule";
import {bot, toolsdb} from "../botbase";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import {getRedisInstance, Redis} from "../redis";
import {ResultSetHeader} from "mysql2";
import {CustomError} from "../utils";

interface AlertsDb {
    connect(): Promise<void>;
    getLastEmailedTime(rule: Rule): Promise<MwnDate>;
    saveLastEmailedTime(rule: Rule): Promise<void>;
    getPausedTillTime(bot: string, webKey: string): Promise<MwnDate>;
    setPausedTillTime(bot: string, webKey: string, pauseTill?: Date): Promise<number>;
}

// To allow user to disable checks for some time period:
// Generate a secret for each email sent and persist in db
// Provide a disable link with secret as query string in the email
// When clicked, check if secret is valid and disable notifications.

class MariadbAlertsDb implements AlertsDb {
    db: toolsdb;
    async connect(): Promise<void> {
        this.db = new toolsdb('botmonitor');
    }

    async getLastEmailedTime(rule: Rule): Promise<MwnDate> {
        let data = await this.db.query(`
            SELECT lastEmailed, paused FROM alerts 
            WHERE name = ?
        `, [ getKey(rule, 250) ]
        );
        if (data[0]) {
            if (data[0].paused && new bot.Date(data[0].paused).isAfter(new Date())) {
                return new bot.Date(data[0].paused);
            }
            return new bot.Date(data[0].lastEmailed);
        } else {
            return new bot.Date(0);
        }
    }

    async saveLastEmailedTime(rule: Rule): Promise<void> {
        await this.db.run(
            `REPLACE INTO alerts (name, lastEmailed, webKey) VALUES(?, UTC_TIMESTAMP(), ?)`,
            [ getKey(rule, 250), crypto.randomBytes(32).toString('hex') ]
        );
    }

    async getPausedTillTime(name: string, webKey: string) {
        let data = await this.db.query(`
            SELECT webKey, paused FROM alerts
            WHERE name = ?
        `, [name]);
        if (!data[0]) {
            throw new CustomError(404, 'No such bot task is configured.');
        }
        if (data[0].webKey !== webKey) {
            throw new CustomError(403, `Invalid or expired webKey. Please use the link from the latest SDZeroBot email.`);
        }
        if (data[0].paused) {
            return new bot.Date(data[0].paused);
        }
    }

    async setPausedTillTime(name: string, webKey: string, pauseTill?: MwnDate): Promise<number> {
        const result = await this.db.run(`
            UPDATE alerts
            SET paused = ?
            WHERE name = ?
            AND webKey = ?
        `, [pauseTill ? pauseTill.format('YYYY-MM-DD') : null, name, webKey]);
        return (result?.[0] as ResultSetHeader)?.affectedRows;
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
    async getPausedTillTime(name: string, webKey: string) { return new bot.Date(0); }
    async setPausedTillTime(bot: string, webKey: string, pauseTill: MwnDate) { return -1; }
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
    async getPausedTillTime(name: string, webKey: string) { return new bot.Date(0); }
    async setPausedTillTime(bot: string, webKey: string, pauseTill: MwnDate) { return -1; }
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
    async getPausedTillTime(name: string, webKey: string) { return new bot.Date(0); }
    async setPausedTillTime(bot: string, webKey: string, pauseTill: MwnDate) { return -1; }
}

export const alertsDb: AlertsDb = new MariadbAlertsDb();
