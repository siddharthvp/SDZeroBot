"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnderscoresTransformation = void 0;
const Transformation_1 = require("./Transformation");
const transformers_1 = require("../transformers");
class UnderscoresTransformation extends Transformation_1.Transformation {
    readConfig(template) {
        this.conf = template.getValue('remove_underscores')
            ?.split(',')
            .map(num => parseInt(num.trim()))
            .filter(e => !isNaN(e)) || [];
    }
    apply(result) {
        let numColumns = result[0].length;
        this.conf.forEach(columnIndex => {
            if (columnIndex > numColumns) {
                this.warnings.push(`Found "${columnIndex}" in <code>remove_underscores</code> though the table only has ${numColumns} column{{subst:plural:${numColumns}||s}}. Ignoring.`);
            }
            else {
                result = transformers_1.transformColumn(result, columnIndex, value => value.replace(/_/g, ' '));
            }
        });
    }
}
exports.UnderscoresTransformation = UnderscoresTransformation;
//# sourceMappingURL=UnderscoresTransformation.js.map