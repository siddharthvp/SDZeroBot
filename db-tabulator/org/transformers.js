"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeColumn = exports.addColumn = exports.transformColumn = void 0;
function transformColumn(result, columnIdx, transformer) {
    return result.map((row, rowIdx) => {
        return Object.fromEntries(Object.entries(row).map(([key, value], colIdx) => {
            if (columnIdx === colIdx + 1) {
                return [key, transformer(value, rowIdx)];
            }
            else {
                return [key, value];
            }
        }));
    });
}
exports.transformColumn = transformColumn;
/**
 * Add column at given `columnIdx`. Move existing columns at columnIdx and later one place rightwards.
 */
function addColumn(result, columnIdx, contents) {
    return result.map((row, idx) => {
        let newRow = Object.entries(row);
        newRow.splice(columnIdx - 1, 0, ['Excerpt', contents[idx]]);
        return Object.fromEntries(newRow);
    });
}
exports.addColumn = addColumn;
function removeColumn(result, columnIdx) {
    return result.map((row) => {
        let newRow = Object.entries(row);
        newRow.splice(columnIdx - 1, 1);
        return Object.fromEntries(newRow);
    });
}
exports.removeColumn = removeColumn;
//# sourceMappingURL=transformers.js.map