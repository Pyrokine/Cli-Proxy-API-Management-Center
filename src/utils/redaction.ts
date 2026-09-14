const REDACTED = '[REDACTED]'

const SENSITIVE_FIELD_PATTERN = [
    'authorization',
    'x-goog-api-key',
    'x-api-key',
    'api[-_ ]?key',
    'raw[-_ ]?api[-_ ]?key',
    'access[-_ ]?token',
    'refresh[-_ ]?token',
    'id[-_ ]?token',
    'token',
    'cookie',
    'set-cookie',
    'password',
    'passwd',
    'secret',
    'client[-_ ]?secret',
    'proxy[-_ ]?url',
    '(?:[a-z0-9]+[-_])+(?:authorization|cookie|token|key|secret|password|passwd)(?:[-_][a-z0-9]+)*',
    'key',
].join('|')

const FIELD_PREFIX                    = `(?<![\\w-])["']?(?<field>${SENSITIVE_FIELD_PATTERN})["']?\\s*[:=]\\s*`
const DOUBLE_QUOTED_FIELD_VALUE_REGEX = new RegExp(
    `(?<prefix>${FIELD_PREFIX}")(?<value>(?:\\\\.|[^"\\\\])*)"`,
    'gi',
)
const SINGLE_QUOTED_FIELD_VALUE_REGEX = new RegExp(
    `(?<prefix>${FIELD_PREFIX}')(?<value>(?:\\\\.|[^'\\\\])*)'`,
    'gi',
)
const BARE_FIELD_VALUE_REGEX          = new RegExp(
    `(?<prefix>${FIELD_PREFIX})(?!\\[REDACTED])[^\\s,;}\\x5D&#"']+`,
    'gi',
)
// noinspection RegExpUnnecessaryNonCapturingGroup
const URL_QUERY_VALUE_REGEX           = new RegExp(
    `(?<prefix>[?&](?:${SENSITIVE_FIELD_PATTERN})=)[^&#\\s"']+`,
    'gi',
)
const AUTHORIZATION_VALUE_REGEX       = new RegExp(
    `(?<prefix>(?<![\\w-])["']?(?:proxy[-_ ]?)?authorization["']?\\s*[:=]\\s*)` +
    `(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\],;}&#\\n\\r]+)`,
    'gi',
)
const BEARER_VALUE_REGEX              = /(?<prefix>\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi
const COOKIE_VALUE_REGEX              = new RegExp(
    `(?<prefix>(?<![\\w-])["']?(?:set[-_ ]?)?cookie["']?\\s*[:=]\\s*)` +
    `(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\]}&#\\n\\r]+)`,
    'gi',
)

export function redactSensitiveText(text: string): string {
    if (!text) {
        return text
    }

    return text
        .replace(COOKIE_VALUE_REGEX, `$<prefix>${REDACTED}`)
        .replace(AUTHORIZATION_VALUE_REGEX, `$<prefix>${REDACTED}`)
        .replace(BEARER_VALUE_REGEX, `$<prefix>${REDACTED}`)
        .replace(DOUBLE_QUOTED_FIELD_VALUE_REGEX, `$<prefix>${REDACTED}"`)
        .replace(SINGLE_QUOTED_FIELD_VALUE_REGEX, `$<prefix>${REDACTED}'`)
        .replace(BARE_FIELD_VALUE_REGEX, `$<prefix>${REDACTED}`)
        .replace(URL_QUERY_VALUE_REGEX, `$<prefix>${REDACTED}`)
}
