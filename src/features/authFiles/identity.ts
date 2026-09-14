import type {AuthFileItem} from '@/types/authFile'

type AuthFileIdentityKind = 'email' | 'projectId' | 'fileName'

interface AuthFileIdentity {
    primary: string
    kind: AuthFileIdentityKind
    secondary: string | null
    fullName: string
}

const readIdentityText = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : ''

const unsafeFileNameCharacters = '<>:"|?*'

const replaceUnsafeFileNameCharacters = (name: string): string =>
    Array.from(name, (character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint <= 31 || codePoint === 127 || unsafeFileNameCharacters.includes(character)
               ? '_'
               : character
    }).join('')

export const sanitizeAuthFileName = (name: string): string => {
    const baseName = name.trim().split(/[\\/]/).pop()?.trim() ?? ''
    return replaceUnsafeFileNameCharacters(baseName).replace(/[. ]+$/g, '')
}

const stripJsonExtension = (name: string): string => {
    const sanitized = sanitizeAuthFileName(name)
    if (sanitized.length <= 5) {
        return sanitized
    }
    return sanitized.toLowerCase().endsWith('.json') ? sanitized.slice(0, -5) : sanitized
}

export const deriveAuthFileIdentity = (file: AuthFileItem): AuthFileIdentity => {
    const fullName                   = sanitizeAuthFileName(readIdentityText(file.name))
    const base                       = stripJsonExtension(fullName)
    const email                      = readIdentityText(file.email)
    const projectId                  = readIdentityText(file.projectId)
    const kind: AuthFileIdentityKind = email ? 'email' : projectId ? 'projectId' : 'fileName'
    const primary                    = email || projectId || base
    const secondary                  =
              kind === 'fileName' || !base || base.toLowerCase() === primary.toLowerCase() ? null : base

    return { primary, kind, secondary, fullName }
}

export const authFileIdentitySearchTokens = (file: AuthFileItem): string[] =>
    [sanitizeAuthFileName(file.name), file.type, file.provider, file.email, file.projectId, file.note]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)

const SAFE_DISPLAY_FIELDS: Array<keyof AuthFileItem> = [
    'name',
    'type',
    'provider',
    'email',
    'projectId',
    'size',
    'runtimeOnly',
    'disabled',
    'unavailable',
    'status',
    'statusMessage',
    'modified',
    'priority',
    'weight',
    'note',
    'usingApi',
    'disableCooling',
    'excludedModels',
]

export const buildSafeAuthFileDisplayInfo = (file: AuthFileItem): Record<string, unknown> =>
    Object.fromEntries(
        SAFE_DISPLAY_FIELDS.flatMap((key) => {
            const value = key === 'name' ? sanitizeAuthFileName(file.name) : file[key]
            return value === undefined ? [] : [[key, Array.isArray(value) ? [...value] : value]]
        }),
    )
