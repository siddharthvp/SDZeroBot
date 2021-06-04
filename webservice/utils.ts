export function numericArg(arg: string, defaultValue: number, maxValue?: number) {
	let num = parseInt(arg);
	if (isNaN(num)) {
		return defaultValue;
	}
	if (maxValue && num > maxValue) {
		return maxValue;
	}
	return num;
}
