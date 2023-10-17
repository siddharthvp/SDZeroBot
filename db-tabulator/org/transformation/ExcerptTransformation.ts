import {Transformation} from "./Transformation";
import {ReportTemplate} from "../ReportTemplate";
import {addColumn, transformColumn} from "../transformers";
import {bot} from "../../../botbase";
import {fetchExcerpts} from "../enrichers";

export class ExcerptTransformation extends Transformation {
    conf: Array<{srcIndex: number, destIndex: number, namespace: string, charLimit: number, charHardLimit: number}>;

    readConfig(template: ReportTemplate) {
        this.conf = template.getValue('excerpts')
                ?.split(',')
                .map(e => {
                    const [srcIndex, destIndex, namespace, charLimit, charHardLimit] = e.trim().split(':');
                    return {
                        srcIndex: parseInt(srcIndex),
                        destIndex: destIndex ? parseInt(destIndex) : parseInt(srcIndex) + 1,
                        namespace: namespace || '0',
                        charLimit: charLimit ? parseInt(charLimit) : 250,
                        charHardLimit: charHardLimit ? parseInt(charHardLimit) : 500
                    };
                })
                .filter(config => !isNaN(config.srcIndex) && !isNaN(config.destIndex) && /^c?\d+/i.test(config.namespace) &&
                    !isNaN(config.charLimit) && !isNaN(config.charHardLimit))
            || [];
    }

    async apply(result) {
        for (let {srcIndex, destIndex, namespace, charLimit, charHardLimit} of this.conf) {
            result = transformColumn(result, srcIndex, pageName => pageName.replace(/_/g, ' '));
            let nsId, nsColNumber;
            if (!isNaN(parseInt(namespace))) {
                nsId = parseInt(namespace);
            } else {
                nsColNumber = parseInt(namespace.slice(1)) - 1;
            }
            const listOfPages = result.map((row) => {
                try {
                    let cells = Object.values(row);
                    return new bot.page(
                        cells[srcIndex - 1] as string,
                        nsId ?? Number(cells[nsColNumber])
                    ).toText();
                } catch (e) { return '::'; } // new bot.page() failing, use invalid page name so that
                // fetchExcerpts returns empty string extract
            });
            const excerpts = await fetchExcerpts(listOfPages, charLimit, charHardLimit);
            result = addColumn(result, destIndex, excerpts);
        }
    }
}
