"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultFormatter = void 0;
const utils_1 = require("../../utils");
const botbase_1 = require("../../botbase");
const utils_2 = require("./utils");
const transformers_1 = require("./transformers");
class ResultFormatter {
    constructor(config, transformations, template) {
        this.config = config;
        this.transformations = transformations;
        this.template = template;
    }
    async formatResults(result) {
        if (result.length === 0) {
            return 'No items retrieved.'; // XXX
        }
        if (result.length > this.config.pagination) {
            const resultSets = utils_1.arrayChunk(result, this.config.pagination).slice(0, this.config.maxPages);
            this.numPages = resultSets.length;
            const resultTexts = [];
            let pageNumber = 1;
            for (let resultSet of resultSets) {
                resultTexts.push(await this.formatResultSet(resultSet, pageNumber++));
            }
            return resultTexts;
        }
        else {
            this.numPages = 1;
            return this.formatResultSet(result, 0);
        }
    }
    async formatResultSet(result, pageNumber) {
        let numColumns = Object.keys(result[0]).length;
        for (let i = 1; i <= numColumns; i++) {
            // Stringify everything
            result = transformers_1.transformColumn(result, i, (value) => {
                if (value === null)
                    return '';
                if (value instanceof Date)
                    return value.toISOString();
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
        let table;
        let tableText = '';
        if (!skip_table) {
            table = new botbase_1.Mwn.table({
                style: this.template.getValue('table_style') || 'overflow-wrap: anywhere'
            });
            if (header_template) {
                tableText = table.text + '{{' + header_template + '}}\n';
            }
            else {
                table.addHeaders(Object.keys(result[0]).map((columnName, columnIndex) => {
                    let columnConfig = {
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
        }
        else {
            if (skip_table) {
                // Using skip_table without row_template
                throw new utils_2.HandledError(); // module shows the error on page
            }
            for (let row of result) {
                table.addRow(Object.values(row));
            }
            tableText = botbase_1.TextExtractor.finalSanitise(table.getText());
            // XXX: header gets skipped if header_template is used without row_template,
            // but module does show a warning
        }
        // Get DB replag, but no need to do this any more than once in 6 hours (when triggered via
        // webservice or eventstream-router).
        if (utils_2.db.replagHours === undefined ||
            utils_2.db.replagHoursCalculatedTime.isBefore(new botbase_1.bot.date().subtract(6, 'hours'))) {
            await utils_2.db.getReplagHours();
        }
        let warningsText = this.warnings.map(text => `[WARN: ${text}]\n\n`).join('');
        return (pageNumber <= 1 ? warningsText : '') +
            utils_2.db.makeReplagMessage(2) +
            tableText + '\n' +
            '----\n' +
            botbase_1.Mwn.template('Database report/footer', {
                count: result.length,
                page: pageNumber && String(pageNumber),
                num_pages: pageNumber && String(this.numPages)
            });
    }
}
exports.ResultFormatter = ResultFormatter;
//# sourceMappingURL=ResultFormatter.js.map