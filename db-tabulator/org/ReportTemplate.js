"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportTemplate = void 0;
const wikitext_1 = require("mwn/build/wikitext");
class ReportTemplate extends wikitext_1.Template {
    constructor(template) {
        super(template.wikitext);
        this.name = template.name;
        this.parameters = template.parameters;
    }
    getValue(param) {
        return super.getValue(param)?.replace(/<!--.*?-->/g, '').trim();
    }
}
exports.ReportTemplate = ReportTemplate;
//# sourceMappingURL=ReportTemplate.js.map