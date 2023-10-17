import {arrayChunk} from "../../utils";
import {bot, Mwn, TextExtractor} from "../../botbase";
import {ConfigType} from "./ConfigParser";
import {db, HandledError} from "./utils";
import {transformColumn} from "./transformers";
import {ReportTemplate} from "./ReportTemplate";
import {Transformation} from "./transformation/Transformation";

export class ResultFormatter {
    config: ConfigType;
    transformations: Transformation[];
    template: ReportTemplate
    numPages: number;
    warnings: string[];
    constructor(config: ConfigType, transformations: Transformation[], template: ReportTemplate) {
        this.config = config;
        this.transformations = transformations;
        this.template = template;
    }

    async formatResults(result) {

        if (result.length === 0) {
            return 'No items retrieved.'; // XXX
        }
        if (result.length > this.config.pagination) {
            const resultSets = arrayChunk(result, this.config.pagination).slice(0, this.config.maxPages);
            this.numPages = resultSets.length;
            const resultTexts: string[] = [];
            let pageNumber = 1;
            for (let resultSet of resultSets) {
                resultTexts.push(await this.formatResultSet(resultSet, pageNumber++));
            }
            return resultTexts;
        } else {
            this.numPages = 1;
            return this.formatResultSet(result, 0);
        }
    }

    async formatResultSet(result, pageNumber: number) {

        let numColumns = Object.keys(result[0]).length;
        for (let i = 1; i <= numColumns; i++) {
            // Stringify everything
            result = transformColumn(result, i, (value: string | number | null | Date) => {
                if (value === null) return '';
                if (value instanceof Date) return value.toISOString();
                return String(value);
            });
        }

        this.transformations.forEach(transformation => {
            transformation.apply(result);
            this.warnings.push(...transformation.warnings);
        });

        let widths = this.template.getValue('widths')?.split(',').map(e => {
            let [colIdx, width] = e.split(':');
            return {
                column: parseInt(colIdx),
                width: width
            };
        });

        const row_template = this.template.getValue('row_template');
        const header_template = this.template.getValue('header_template');
        const skip_table = this.template.getValue('skip_table');

        let table: InstanceType<typeof Mwn.table>;
        let tableText = '';
        if (!skip_table) {
            table = new Mwn.table({
                style: this.template.getValue('table_style') || 'overflow-wrap: anywhere'
            });
            if (header_template) {
                tableText = table.text + '{{' + header_template + '}}\n';
            } else {
                table.addHeaders(Object.keys(result[0]).map((columnName, columnIndex) => {
                    let columnConfig: { label: string, style?: string } = {
                        label: columnName,
                    };
                    let width = widths?.find(e => e.column === columnIndex + 1)?.width;
                    if (width) {
                        columnConfig.style = `width: ${width}`;
                    }
                    return columnConfig;
                }));
                tableText = table.text;
            }
        }

        if (row_template) {
            for (let row of result) {
                tableText += '{{' + row_template + Object.values(row).map((val, idx) => `|${idx + 1}=` + val).join('') + '}}\n';
            }
            if (!skip_table) {
                tableText += '|}'; // complete the table syntax
            }
        } else {
            if (skip_table) {
                // Using skip_table without row_template
                throw new HandledError(); // module shows the error on page
            }
            for (let row of result) {
                table.addRow(Object.values(row));
            }
            tableText = TextExtractor.finalSanitise(table.getText());
            // XXX: header gets skipped if header_template is used without row_template,
            // but module does show a warning
        }

        // Get DB replag, but no need to do this any more than once in 6 hours (when triggered via
        // webservice or eventstream-router).
        if (
            db.replagHours === undefined ||
            db.replagHoursCalculatedTime.isBefore(new bot.date().subtract(6, 'hours'))
        ) {
            await db.getReplagHours();
        }

        let warningsText = this.warnings.map(text => `[WARN: ${text}]\n\n`).join('');

        return (pageNumber <= 1 ? warningsText : '') +
            db.makeReplagMessage(2) +
            tableText + '\n' +
            '----\n' +
            Mwn.template('Database report/footer', {
                count: result.length,
                page: pageNumber && String(pageNumber),
                num_pages: pageNumber && String(this.numPages)
            });
    }

}

