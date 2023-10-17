"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WikilinkTransformation = void 0;
const transformers_1 = require("../transformers");
const botbase_1 = require("../../../botbase");
const namespaces_1 = require("../../../namespaces");
const Transformation_1 = require("./Transformation");
class WikilinkTransformation extends Transformation_1.Transformation {
    readConfig(template) {
        this.conf = template.getValue('wikilinks')
            ?.split(',')
            .map(e => {
            const [columnIndex, namespace, showHide] = e.trim().split(':');
            return {
                columnIndex: parseInt(columnIndex),
                namespace: namespace || '0',
                showNamespace: showHide === 'show'
            };
        })
            .filter(config => /^c?\d+/i.test(config.namespace) && !isNaN(config.columnIndex)) || [];
    }
    apply(result) {
        this.conf.forEach(({ columnIndex, namespace, showNamespace }) => {
            let nsId, nsColNumber;
            if (!isNaN(parseInt(namespace))) {
                nsId = parseInt(namespace);
            }
            else {
                nsColNumber = parseInt(namespace.slice(1)) - 1;
            }
            result = transformers_1.transformColumn(result, columnIndex, (value, rowIdx) => {
                try {
                    let title = new botbase_1.bot.title(value, nsId ?? Number(Object.values(result[rowIdx])[nsColNumber]));
                    // title.getNamespaceId() need not be same as namespace passed to new bot.title
                    let colon = [namespaces_1.NS_CATEGORY, namespaces_1.NS_FILE].includes(title.getNamespaceId()) ? ':' : '';
                    let pageName = title.toText();
                    return (showNamespace || title.getNamespaceId() === namespaces_1.NS_MAIN) ?
                        `[[${colon}${pageName}]]` : `[[${colon}${pageName}|${value.replace(/_/g, ' ')}]]`;
                }
                catch (e) {
                    return value.replace(/_/g, ' ');
                }
            });
        });
        return result;
    }
}
exports.WikilinkTransformation = WikilinkTransformation;
//# sourceMappingURL=WikilinkTransformation.js.map