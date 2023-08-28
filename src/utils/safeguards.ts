export function isString(test: any): test is string {
    return typeof test === "string";
}

export function isStringNotEmpty(test: any): test is string {
    return typeof test === "string" && test.length > 0;
}