"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigParser = void 0;
const consts_1 = require("./consts");
const WikilinkTransformation_1 = require("./transformation/WikilinkTransformation");
const CommentTransformation_1 = require("./transformation/CommentTransformation");
const ExcerptTransformation_1 = require("./transformation/ExcerptTransformation");
const HideTransformation_1 = require("./transformation/HideTransformation");
const UnderscoresTransformation_1 = require("./transformation/UnderscoresTransformation");
class ConfigParser {
    constructor() {
        this.transformations = [
            new ExcerptTransformation_1.ExcerptTransformation(),
            new WikilinkTransformation_1.WikilinkTransformation(),
            new CommentTransformation_1.CommentTransformation(),
            new UnderscoresTransformation_1.UnderscoresTransformation(),
            new HideTransformation_1.HideTransformation(),
        ];
    }
    parse(template) {
        let config = {};
        // Use of semicolons for multiple statements will be flagged as error at query runtime
        config.sql = template.getValue('sql')
            // Allow pipes to be written as {{!}}
            .replace(/\{\{!\}\}/g, '|');
        this.transformations.forEach(transformation => transformation.readConfig(template));
        config.pagination = parseInt(template.getValue('pagination'));
        if (isNaN(config.pagination)) {
            config.pagination = Infinity;
        }
        config.maxPages = Math.min(consts_1.MAX_SUBPAGES, template.getValue('max_pages') ? parseInt(template.getValue('max_pages')) : 5);
        return config;
    }
}
exports.ConfigParser = ConfigParser;
//# sourceMappingURL=ConfigParser.js.map