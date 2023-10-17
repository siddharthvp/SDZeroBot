import {MAX_SUBPAGES} from "./consts";
import {ReportTemplate} from "./ReportTemplate";
import {WikilinkTransformation} from "./transformation/WikilinkTransformation";
import {CommentTransformation} from "./transformation/CommentTransformation";
import {ExcerptTransformation} from "./transformation/ExcerptTransformation";
import {HideTransformation} from "./transformation/HideTransformation";
import {UnderscoresTransformation} from "./transformation/UnderscoresTransformation";

export type ConfigType = {
    sql?: string
    wikilinks?: Array<{columnIndex: number, namespace: string, showNamespace: boolean}>;
    excerpts?: Array<{srcIndex: number, destIndex: number, namespace: string, charLimit: number, charHardLimit: number}>;
    comments?: number[];
    pagination?: number;
    maxPages?: number;
    removeUnderscores?: number[];
    hiddenColumns?: number[];
};

export class ConfigParser {
    transformations = [
        new ExcerptTransformation(),
        new WikilinkTransformation(),
        new CommentTransformation(),
        new UnderscoresTransformation(),
        new HideTransformation(),
    ]

    parse(template: ReportTemplate): ConfigType {
        let config: ConfigType = {};

        // Use of semicolons for multiple statements will be flagged as error at query runtime
        config.sql = template.getValue('sql')
            // Allow pipes to be written as {{!}}
            .replace(/\{\{!\}\}/g, '|');

        this.transformations.forEach(transformation => transformation.readConfig(template));

        config.pagination = parseInt(template.getValue('pagination'));
        if (isNaN(config.pagination)) {
            config.pagination = Infinity;
        }
        config.maxPages = Math.min(MAX_SUBPAGES,
            template.getValue('max_pages') ? parseInt(template.getValue('max_pages')) : 5
        );

        return config;
    }
}

