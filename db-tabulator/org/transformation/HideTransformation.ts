import {Transformation} from "./Transformation";
import {ReportTemplate} from "../ReportTemplate";
import {removeColumn} from "../transformers";

export class HideTransformation extends Transformation {
    conf: number[];
    readConfig(template: ReportTemplate) {
        this.conf =  template.getValue('hide')
            ?.split(',')
            .map(e => parseInt(e.trim()))
            .filter(e => !isNaN(e)) || [];
    }

    apply(result) {
        this.conf.sort().forEach((columnIdx, idx) => {
            // columnIdx - idx because column numbering changes when one is removed
            result = removeColumn(result, columnIdx - idx);
        });
    }

}
