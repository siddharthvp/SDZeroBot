import {Template} from "mwn/build/wikitext";

export class ReportTemplate extends Template {
    constructor(template: Template) { // XXX
        super(template.wikitext);
        this.name = template.name;
        this.parameters = template.parameters;
    }
    getValue(param: string) {
        return super.getValue(param)?.replace(/<!--.*?-->/g, '').trim();
    }
}
