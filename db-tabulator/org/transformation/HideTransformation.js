"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HideTransformation = void 0;
const Transformation_1 = require("./Transformation");
const transformers_1 = require("../transformers");
class HideTransformation extends Transformation_1.Transformation {
    readConfig(template) {
        this.conf = template.getValue('hide')
            ?.split(',')
            .map(e => parseInt(e.trim()))
            .filter(e => !isNaN(e)) || [];
    }
    apply(result) {
        this.conf.sort().forEach((columnIdx, idx) => {
            // columnIdx - idx because column numbering changes when one is removed
            result = transformers_1.removeColumn(result, columnIdx - idx);
        });
    }
}
exports.HideTransformation = HideTransformation;
//# sourceMappingURL=HideTransformation.js.map