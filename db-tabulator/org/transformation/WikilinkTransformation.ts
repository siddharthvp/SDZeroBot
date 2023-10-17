import {transformColumn} from "../transformers";
import {bot} from "../../../botbase";
import {NS_CATEGORY, NS_FILE, NS_MAIN} from "../../../namespaces";
import {ReportTemplate} from "../ReportTemplate";
import {Transformation} from "./Transformation";

export class WikilinkTransformation extends Transformation {
    conf: Array<{columnIndex: number, namespace: string, showNamespace: boolean}>;

    readConfig(template: ReportTemplate) {
        this.conf = template.getValue('wikilinks')
            ?.split(',')
            .map(e => {
                const [columnIndex, namespace, showHide] = e.trim().split(':');
                return {
                    columnIndex: parseInt(columnIndex),
                    namespace: namespace || '0',
                    showNamespace: showHide === 'show'
                };
            })
            .filter(config => /^c?\d+/i.test(config.namespace) && !isNaN(config.columnIndex)) || [];
    }

    apply(result) {
        this.conf.forEach(({columnIndex, namespace, showNamespace}) => {
            let nsId, nsColNumber;
            if (!isNaN(parseInt(namespace))) {
                nsId = parseInt(namespace);
            } else {
                nsColNumber = parseInt(namespace.slice(1)) - 1;
            }
            result = transformColumn(result, columnIndex, (value, rowIdx) => {
                try {
                    let title = new bot.title(value, nsId ?? Number(Object.values(result[rowIdx])[nsColNumber]));
                    // title.getNamespaceId() need not be same as namespace passed to new bot.title
                    let colon = [NS_CATEGORY, NS_FILE].includes(title.getNamespaceId()) ? ':' : '';
                    let pageName = title.toText();
                    return (showNamespace || title.getNamespaceId() === NS_MAIN) ?
                        `[[${colon}${pageName}]]` : `[[${colon}${pageName}|${value.replace(/_/g, ' ')}]]`;
                } catch (e) {
                    return value.replace(/_/g, ' ');
                }
            });
        });
        return result;
    }
}
