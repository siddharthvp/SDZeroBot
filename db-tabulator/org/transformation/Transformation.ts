import {ReportTemplate} from "../ReportTemplate";

export abstract class Transformation {
    warnings: string[] = [];

    abstract readConfig(template: ReportTemplate);
    abstract apply(result);
}
