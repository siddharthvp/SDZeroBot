import {argv, bot, log} from "../../botbase";
import {lowerFirst, readFile, writeFile} from "../../utils";
import {FAKE_INPUT_FILE, FAKE_OUTPUT_FILE, MAX_SUBPAGES, TEMPLATE_END} from "./consts";
import {HandledError} from "./utils";
import {ReportTemplate} from "./ReportTemplate";

export class ResultSaver {
    template: ReportTemplate;
    page: string;
    invocationMode: string;
    numPages: number;
    constructor(template: ReportTemplate, page: string, invocationMode: string, numPages: number) {
        this.template = template;
        this.page = page;
        this.invocationMode = invocationMode;
        this.numPages = numPages;
    }

    async save(queryResult: string | string[], isError = false) {
        if (argv.fake) {
            writeFile(
                FAKE_OUTPUT_FILE,
                this.insertResultIntoPageText(
                    readFile(FAKE_OUTPUT_FILE) || readFile(FAKE_INPUT_FILE),
                    queryResult as string
                )
            );
            return;
        }
        let page = new bot.page(this.page);
        let firstPageResult = Array.isArray(queryResult) ? queryResult[0] : queryResult;
        try {
            await page.edit(rev => {
                let text = rev.content;
                let newText = this.insertResultIntoPageText(text, firstPageResult);
                return {
                    text: newText,
                    summary: (isError ? 'Encountered error in updating database report' : 'Updating database report') + (
                        this.invocationMode === 'web' ? ': web triggered' :
                            this.invocationMode === 'cron' ? ': periodic update' :
                                this.invocationMode === 'eventstream' ? ': new transclusion' :
                                    'manual'
                    )
                };
            });
        } catch (err) {
            if (isError) { // error on an error logging attempt, just throw now
                throw err;
            }
            // In case of errors like `contenttoobig` we can still edit the page
            // to add the error message, but not in case of errors like protectedpage
            log(`[E] Couldn't save to ${this.page} due to error ${err.code}`);
            log(err);
            if (err.code === 'protectedpage') {
                throw err;
            }
            return this.saveWithError(`Error while saving report: ${err.message}`);
        }
        if (Array.isArray(queryResult)) {
            for (let [idx, resultText] of Object.entries(queryResult)) {
                let pageNumber = parseInt(idx) + 1;
                if (pageNumber ===  1) continue; // already saved above
                let subpage = new bot.page(this.page + '/' + pageNumber);
                await subpage.save(
                    `{{Database report/subpage|page=${pageNumber}|num_pages=${this.numPages}}}\n` +
                    resultText,
                    'Updating database report'
                );
            }
            for (let i = this.numPages + 1; i <= MAX_SUBPAGES; i++) {
                let subpage = new bot.page(this.page + '/' + i);
                let apiPage = await bot.read(subpage.toText());
                if (apiPage.missing) {
                    break;
                }
                await subpage.save(
                    `{{Database report/subpage|page=${i}|num_pages=${this.numPages}}}\n` +
                    `{{Database report/footer|count=0|page=${i}|num_pages=${this.numPages}}}`,
                    'Updating database report subpage - empty'
                );
            }
        }
    }

    async saveWithError(message: string) {
        await this.save(`{{error|1=[${message}]}}`, true);
        throw new HandledError();
    }

    insertResultIntoPageText(text: string, queryResult: string) {
        // Does not support the case of two template usages with very same wikitext
        let beginTemplateStartIdx = text.indexOf(this.template.wikitext);
        if (beginTemplateStartIdx === -1) {
            throw new Error(`Failed to find template in wikitext on page ${this.page}`);
        }
        let beginTemplateEndIdx = beginTemplateStartIdx + this.template.wikitext.length;
        let endTemplateStartIdx = text.indexOf(`{{${TEMPLATE_END}}}`, beginTemplateEndIdx);
        if (endTemplateStartIdx === -1) { // caps, XXX
            endTemplateStartIdx = text.indexOf(`{{${lowerFirst(TEMPLATE_END)}}}`, beginTemplateEndIdx);
        }
        let textToReplace = text.slice(
            beginTemplateEndIdx,
            endTemplateStartIdx === -1 ? undefined : endTemplateStartIdx
        );
        return text.slice(0, beginTemplateEndIdx) +
            text.slice(beginTemplateEndIdx).replace(textToReplace, '\n' + queryResult.replace(/\$/g, '$$$$') + '\n');
    }

}

