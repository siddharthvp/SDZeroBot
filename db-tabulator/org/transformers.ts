export function transformColumn(result: Array<Record<string, string>>, columnIdx: number, transformer: (cell: string, rowIdx: number) => string): Array<Record<string, string>> {
    return result.map((row, rowIdx) => {
        return Object.fromEntries(Object.entries(row).map(([key, value], colIdx) => {
            if (columnIdx === colIdx + 1) {
                return [key, transformer(value, rowIdx)];
            } else {
                return [key, value];
            }
        }));
    });
}

/**
 * Add column at given `columnIdx`. Move existing columns at columnIdx and later one place rightwards.
 */
export function addColumn(result: Array<Record<string, string>>, columnIdx: number, contents: string[]): Array<Record<string, string>> {
    return result.map((row, idx) => {
        let newRow = Object.entries(row);
        newRow.splice(columnIdx - 1, 0, ['Excerpt', contents[idx]]);
        return Object.fromEntries(newRow);
    });
}

export function removeColumn(result: Array<Record<string, string>>, columnIdx: number): Array<Record<string, string>> {
    return result.map((row) => {
        let newRow = Object.entries(row);
        newRow.splice(columnIdx - 1, 1);
        return Object.fromEntries(newRow);
    });
}
