import {Transformation} from "./Transformation";
import {ReportTemplate} from "../ReportTemplate";
import {transformColumn} from "../transformers";
import { formatSummary } from "../../../reports/commons";

export class CommentTransformation extends Transformation {
    conf: number[];

    readConfig(template: ReportTemplate) {
        this.conf = template.getValue('comments')
            ?.split(',')
            .map(e => parseInt(e.trim()))
            .filter(e => !isNaN(e)) || []
    }

    apply(result) {
        this.conf.forEach(columnIndex => {
            result = transformColumn(result, columnIndex, (value) => {
                return formatSummary(value);
            });
        });
    }
}
