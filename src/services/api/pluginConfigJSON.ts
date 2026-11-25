type ExactJSON = null | boolean | string | ExactJSON[] | { [key: string]: ExactJSON }

export type PluginConfigJSON = Record<string, string>

const jsonString         = /"(?:[^"\\]|\\[\s\S])*"/g
const jsonStringOrNumber = /"(?:[^"\\]|\\[\s\S])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
const redactedString     = /^s__CLI_PROXY_CONFIG_SECRET_[0-9a-f]{32}__$/

function parseExactJSON(text: string): ExactJSON {
    JSON.parse(text)
    // Keep number tokens as text and mark strings separately so they cannot be mistaken for numbers.
    return JSON.parse(text.replace(jsonStringOrNumber, (token) =>
        token.startsWith('"') ? `"s${token.slice(1)}` : `"n${token}"`,
    )) as ExactJSON
}

export function parsePluginConfigJSON(text: string): PluginConfigJSON {
    const parsed = parseExactJSON(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a JSON object')
    }
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [
        key.slice(1),
        JSON.stringify(value, null, 2).replace(jsonString, (token) =>
            token[1] === 'n' ? token.slice(2, -1) : `"${token.slice(2)}`,
        ),
    ]))
}

export function encodePluginConfigPatch(fields: PluginConfigJSON): string {
    return `{${Object.entries(fields).map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}}`
}

export function pluginConfigFieldMatches(
    expected: string | undefined,
    actual: string | undefined,
    allowRedactions = false,
): boolean {
    const matches = (left: ExactJSON, right: ExactJSON): boolean => {
        if (left === right) {
            return true
        }
        if (allowRedactions && typeof right === 'string' && redactedString.test(right)) {
            return left !== null && typeof left !== 'object'
        }
        if (Array.isArray(left) || Array.isArray(right)) {
            return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
                   left.every((entry, index) => matches(entry, right[index]))
        }
        if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
            return false
        }
        const keys = Object.keys(right)
        return keys.length === Object.keys(left).length && keys.every((key) =>
                                                                          Object.prototype.hasOwnProperty.call(
                                                                              left,
                                                                              key,
                                                                          ) ?
                                                                          matches(left[key], right[key]) :
               allowRedactions && redactedString.test(key),
        )
    }
    return expected === actual || (expected !== undefined && actual !== undefined &&
                                   matches(parseExactJSON(expected), parseExactJSON(actual)))
}
