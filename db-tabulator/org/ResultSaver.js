"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultSaver = void 0;
const botbase_1 = require("../../botbase");
const utils_1 = require("../../utils");
const consts_1 = require("./consts");
const utils_2 = require("./utils");
class ResultSaver {
    constructor(template, page, invocationMode, numPages) {
        this.template = template;
        this.page = page;
        this.invocationMode = invocationMode;
        this.numPages = numPages;
    }
    async save(queryResult, isError = false) {
        if (botbase_1.argv.fake) {
            utils_1.writeFile(consts_1.FAKE_OUTPUT_FILE, this.insertResultIntoPageText(utils_1.readFile(consts_1.FAKE_OUTPUT_FILE) || utils_1.readFile(consts_1.FAKE_INPUT_FILE), queryResult));
            return;
        }
        let page = new botbase_1.bot.page(this.page);
        let firstPageResult = Array.isArray(queryResult) ? queryResult[0] : queryResult;
        try {
            await page.edit(rev => {
                let text = rev.content;
                let newText = this.insertResultIntoPageText(text, firstPageResult);
                return {
                    text: newText,
                    summary: (isError ? 'Encountered error in updating database report' : 'Updating database report') + (this.invocationMode === 'web' ? ': web triggered' :
                        this.invocationMode === 'cron' ? ': periodic update' :
                            this.invocationMode === 'eventstream' ? ': new transclusion' :
                                'manual')
                };
            });
        }
        catch (err) {
            if (isError) { // error on an error logging attempt, just throw now
                throw err;
            }
            // In case of errors like `contenttoobig` we can still edit the page
            // to add the error message, but not in case of errors like protectedpage
            botbase_1.log(`[E] Couldn't save to ${this.page} due to error ${err.code}`);
            botbase_1.log(err);
            if (err.code === 'protectedpage') {
                throw err;
            }
            return this.saveWithError(`Error while saving report: ${err.message}`);
        }
        if (Array.isArray(queryResult)) {
            for (let [idx, resultText] of Object.entries(queryResult)) {
                let pageNumber = parseInt(idx) + 1;
                if (pageNumber === 1)
                    continue; // already saved above
                let subpage = new botbase_1.bot.page(this.page + '/' + pageNumber);
                await subpage.save(`{{Database report/subpage|page=${pageNumber}|num_pages=${this.numPages}}}\n` +
                    resultText, 'Updating database report');
            }
            for (let i = this.numPages + 1; i <= consts_1.MAX_SUBPAGES; i++) {
                let subpage = new botbase_1.bot.page(this.page + '/' + i);
                let apiPage = await botbase_1.bot.read(subpage.toText());
                if (apiPage.missing) {
                    break;
                }
                await subpage.save(`{{Database report/subpage|page=${i}|num_pages=${this.numPages}}}\n` +
                    `{{Database report/footer|count=0|page=${i}|num_pages=${this.numPages}}}`, 'Updating database report subpage - empty');
            }
        }
    }
    async saveWithError(message) {
        await this.save(`{{error|1=[${message}]}}`, true);
        throw new utils_2.HandledError();
    }
    insertResultIntoPageText(text, queryResult) {
        // Does not support the case of two template usages with very same wikitext
        let beginTemplateStartIdx = text.indexOf(this.template.wikitext);
        if (beginTemplateStartIdx === -1) {
            throw new Error(`Failed to find template in wikitext on page ${this.page}`);
        }
        let beginTemplateEndIdx = beginTemplateStartIdx + this.template.wikitext.length;
        let endTemplateStartIdx = text.indexOf(`{{${consts_1.TEMPLATE_END}}}`, beginTemplateEndIdx);
        if (endTemplateStartIdx === -1) { // caps, XXX
            endTemplateStartIdx = text.indexOf(`{{${utils_1.lowerFirst(consts_1.TEMPLATE_END)}}}`, beginTemplateEndIdx);
        }
        let textToReplace = text.slice(beginTemplateEndIdx, endTemplateStartIdx === -1 ? undefined : endTemplateStartIdx);
        return text.slice(0, beginTemplateEndIdx) +
            text.slice(beginTemplateEndIdx).replace(textToReplace, '\n' + queryResult.replace(/\$/g, '$$$$') + '\n');
    }
}
exports.ResultSaver = ResultSaver;
//# sourceMappingURL=ResultSaver.js.map