import {Transformation} from "./Transformation";
import {ReportTemplate} from "../ReportTemplate";
import {transformColumn} from "../transformers";

export class UnderscoresTransformation extends Transformation {
    conf: number[];

    readConfig(template: ReportTemplate) {
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
            } else {
                result = transformColumn(result, columnIndex, value => value.replace(/_/g, ' '));
            }
        });
    }

}
