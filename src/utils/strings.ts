export function toPascalCase(string: string): string {
    return `${string}`
        .toLowerCase()
        .replace(new RegExp(/[-_]+/, 'g'), ' ')
        .replace(new RegExp(/[^\w\s]/, 'g'), '')
        .replace(
            new RegExp(/\s+(.)(\w*)/, 'g'),
            ($1, $2, $3) => `${$2.toUpperCase() + $3}`
        )
        .replace(new RegExp(/\w/), s => s.toUpperCase());
}

export function toCamelCase(input: string): string {
    const words = input.toLowerCase().split(/[\s_-]+/);
    let result = words[0];

    for (let i = 1; i < words.length; i++) {
        result += words[i].charAt(0).toUpperCase() + words[i].slice(1);
    }

    return result;
}