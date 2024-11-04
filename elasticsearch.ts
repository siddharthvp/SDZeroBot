import {Client} from "@elastic/elasticsearch";
import {onToolforge} from "./utils";
import {AuthManager} from "./botbase";
import * as RequestParams from "@elastic/elasticsearch/api/requestParams";

export const elastic = new Client({
    node: onToolforge() ? 'http://elasticsearch.svc.tools.eqiad1.wikimedia.cloud:80' : 'http://localhost:9200/',
    auth: onToolforge() ? AuthManager.get('elasticsearch') : {},
});

export const cirrus = new Client({
    node: onToolforge() ? 'https://cloudelastic.wikimedia.org:8243/': 'http://localhost:4719',
});

export class ElasticDataStore {
    private readonly index: string;
    constructor(index: string) {
        this.index = index;
    }
    async get(id: string, field?: string) {
        const query: RequestParams.Get = {
            index: this.index,
            id: id
        }
        if (field) {
            query._source = [field];
        }
        return elastic.get(query).then(result => result.body._source);
    }
    async create(id: string, body: any) {
        await elastic.index({
            index: this.index,
            id: id,
            body: body
        });
    }
    async exists(id: string) {
        return elastic.exists({
            index: this.index,
            id: id,
        }).then(result => result.body);
    }
    async update(id: string, body: any) {
        await elastic.update({
            index: this.index,
            id: id,
            body: {
                doc: body
            }
        });
    }
    async append(id: string, body: any) {
        if (!await this.exists(id)) {
            await this.create(id, body);
        } else {
            await this.update(id, body);
        }
    }
    async delete(id: string) {
        await elastic.delete({
            index: this.index,
            id: id
        });
    }
}
