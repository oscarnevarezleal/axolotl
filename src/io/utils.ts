/**
 * Removes ANSI escape sequences from a string
 * @param str string to be cleaned
 * @returns 
 */
export function removeUnicode(str: string) {
    return str.replace(/\x1B[[(?);]{0,2}(;?\d)*./g, '')
        .replace(/[\x00-\x08\x0E-\x1F\x7F-\uFFFF]/g, '')
}