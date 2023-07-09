import {Client, DseClientOptions} from 'cassandra-driver';
import {AuthManager} from "./botbase";
import {mapPath} from "./utils";

export class Cassandra extends Client {
    constructor(keyspace: string = 'toolforge', conf: DseClientOptions = {}) {
        super({
            cloud: {
                secureConnectBundle: mapPath('~/secure-connect-astra-db-1001.zip')
            },
            credentials: AuthManager.get('cassandra-astra-db-1001'),
            keyspace: keyspace,
            ...conf
        });
    }
}
