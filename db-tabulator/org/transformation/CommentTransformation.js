"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommentTransformation = void 0;
const Transformation_1 = require("./Transformation");
const transformers_1 = require("../transformers");
const commons_1 = require("../../../reports/commons");
class CommentTransformation extends Transformation_1.Transformation {
    readConfig(template) {
        this.conf = template.getValue('comments')
            ?.split(',')
            .map(e => parseInt(e.trim()))
            .filter(e => !isNaN(e)) || [];
    }
    apply(result) {
        this.conf.forEach(columnIndex => {
            result = transformers_1.transformColumn(result, columnIndex, (value) => {
                return commons_1.formatSummary(value);
            });
        });
    }
}
exports.CommentTransformation = CommentTransformation;
//# sourceMappingURL=CommentTransformation.js.map