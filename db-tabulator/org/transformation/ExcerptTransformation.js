"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExcerptTransformation = void 0;
const Transformation_1 = require("./Transformation");
const transformers_1 = require("../transformers");
const botbase_1 = require("../../../botbase");
const enrichers_1 = require("../enrichers");
class ExcerptTransformation extends Transformation_1.Transformation {
    readConfig(template) {
        this.conf = template.getValue('excerpts')
            ?.split(',')
            .map(e => {
            const [srcIndex, destIndex, namespace, charLimit, charHardLimit] = e.trim().split(':');
            return {
                srcIndex: parseInt(srcIndex),
                destIndex: destIndex ? parseInt(destIndex) : parseInt(srcIndex) + 1,
                namespace: namespace || '0',
                charLimit: charLimit ? parseInt(charLimit) : 250,
                charHardLimit: charHardLimit ? parseInt(charHardLimit) : 500
            };
        })
            .filter(config => !isNaN(config.srcIndex) && !isNaN(config.destIndex) && /^c?\d+/i.test(config.namespace) &&
            !isNaN(config.charLimit) && !isNaN(config.charHardLimit))
            || [];
    }
    async apply(result) {
        for (let { srcIndex, destIndex, namespace, charLimit, charHardLimit } of this.conf) {
            result = transformers_1.transformColumn(result, srcIndex, pageName => pageName.replace(/_/g, ' '));
            let nsId, nsColNumber;
            if (!isNaN(parseInt(namespace))) {
                nsId = parseInt(namespace);
            }
            else {
                nsColNumber = parseInt(namespace.slice(1)) - 1;
            }
            const listOfPages = result.map((row) => {
                try {
                    let cells = Object.values(row);
                    return new botbase_1.bot.page(cells[srcIndex - 1], nsId ?? Number(cells[nsColNumber])).toText();
                }
                catch (e) {
                    return '::';
                } // new bot.page() failing, use invalid page name so that
                // fetchExcerpts returns empty string extract
            });
            const excerpts = await enrichers_1.fetchExcerpts(listOfPages, charLimit, charHardLimit);
            result = transformers_1.addColumn(result, destIndex, excerpts);
        }
    }
}
exports.ExcerptTransformation = ExcerptTransformation;
//# sourceMappingURL=ExcerptTransformation.js.map