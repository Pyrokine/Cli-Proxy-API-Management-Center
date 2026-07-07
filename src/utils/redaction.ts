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
    'key',
].join('|')

const QUOTED_FIELD_VALUE_REGEX         = new RegExp(
    `(["'](?:${SENSITIVE_FIELD_PATTERN})["']\\s*[:=]\\s*["'])([^"']*)(["'])`,
    'gi',
)
const BARE_FIELD_VALUE_REGEX           = new RegExp(
    `(\\b(?:${SENSITIVE_FIELD_PATTERN})\\b\\s*[:=]\\s*)([^\\s,;}]+)`,
    'gi',
)
const URL_QUERY_VALUE_REGEX            = new RegExp(
    `([?&](?:${SENSITIVE_FIELD_PATTERN})=)([^&#\\s"']+)`,
    'gi',
)
const AUTHORIZATION_HEADER_VALUE_REGEX = /\b(Authorization\s*[:=]\s*)(?:Bearer\s+)?[A-Za-z0-9._~+/=-]+/gi
const BEARER_VALUE_REGEX               = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi
const COOKIE_HEADER_VALUE_REGEX        = /\b((?:Cookie|Set-Cookie)\s*[:=]\s*)([^\]}\n\r]+)/gi

export function redactSensitiveText(text: string): string {
    if (!text) {
        return text
    }

    return text
        .replace(COOKIE_HEADER_VALUE_REGEX, `$1${REDACTED}`)
        .replace(AUTHORIZATION_HEADER_VALUE_REGEX, `$1${REDACTED}`)
        .replace(BEARER_VALUE_REGEX, `$1${REDACTED}`)
        .replace(QUOTED_FIELD_VALUE_REGEX, `$1${REDACTED}$3`)
        .replace(BARE_FIELD_VALUE_REGEX, `$1${REDACTED}`)
        .replace(URL_QUERY_VALUE_REGEX, `$1${REDACTED}`)
}
