export type ApiKeyStrengthLevel = 'empty' | 'masked' | 'weak' | 'fair' | 'good' | 'strong'

export type ApiKeyWeakPattern =
    | 'short'
    | 'limited_character_classes'
    | 'low_unique_characters'
    | 'repeated_characters'
    | 'repeated_pattern'
    | 'sequential_characters'
    | 'common_term'

export type ApiKeyStrengthSuggestion =
    | 'use_longer_key'
    | 'mix_character_classes'
    | 'increase_character_variety'
    | 'avoid_repeated_characters'
    | 'avoid_repeated_patterns'
    | 'avoid_sequences'
    | 'avoid_common_terms'
    | 'use_generator'
    | 'replace_masked_value'

export interface ApiKeyStrengthEvaluation {
    level: ApiKeyStrengthLevel
    segments: number
    bits: number
    patterns: ApiKeyWeakPattern[]
    suggestions: ApiKeyStrengthSuggestion[]
}

const EVALUATED_LEVELS = ['weak', 'fair', 'good', 'strong'] as const

export const API_KEY_STRENGTH_SEGMENTS = EVALUATED_LEVELS.length

const CHARSET_CLASSES = [
    { pattern: /[a-z]/, size: 26 },
    { pattern: /[A-Z]/, size: 26 },
    { pattern: /[0-9]/, size: 10 },
    { pattern: /[^a-zA-Z0-9]/, size: 32 },
] as const

// noinspection SpellCheckingInspection
const COMMON_WEAK_TERMS = [
    'password',
    'passwd',
    '123456',
    'qwerty',
    'admin',
    'secret',
    'apikey',
    'api-key',
    'letmein',
    'changeme',
    'iloveyou',
    'default',
    'test',
    'demo',
] as const

const REPEAT_WEIGHT         = 0.25
const SEQUENCE_WEIGHT       = 0.35
const COMMON_TERM_FACTOR    = 0.4
const BITS_FOR_FAIR         = 40
const BITS_FOR_GOOD         = 64
const BITS_FOR_STRONG       = 96
const RECOMMENDED_LENGTH    = 24
const MIN_UNIQUE_CHARACTERS = 5

const LENGTH_CAPS: ReadonlyArray<{ below: number; level: Exclude<ApiKeyStrengthLevel, 'empty' | 'masked'> }> = [
    { below: 8, level: 'weak' },
    { below: 16, level: 'fair' },
    { below: 24, level: 'good' },
]

function isMaskedValue(value: string): boolean {
    if (/^(?:\*{3,}|[•●]{3,}|\[?redacted]?|<?masked>?)$/i.test(value)) {
        return true
    }

    const maskCharacters = value.match(/[*•●]/g)?.length ?? 0
    if (maskCharacters < 3) {
        return false
    }

    const visibleCharacters = value.replace(/[*•●]/g, '').length
    return visibleCharacters <= 16
}

function characterClassCount(key: string): number {
    return CHARSET_CLASSES.reduce((count, characterClass) => (
        characterClass.pattern.test(key) ? count + 1 : count
    ), 0)
}

function charsetSize(key: string): number {
    return CHARSET_CLASSES.reduce((size, characterClass) => (
        characterClass.pattern.test(key) ? size + characterClass.size : size
    ), 0)
}

function isSequentialPair(previous: string, current: string): boolean {
    const previousLower = previous.toLowerCase()
    const currentLower  = current.toLowerCase()
    const sameClass     =
              (/[a-z]/.test(previousLower) && /[a-z]/.test(currentLower)) ||
              (/[0-9]/.test(previous) && /[0-9]/.test(current))

    if (!sameClass) {
        return false
    }

    const delta = currentLower.charCodeAt(0) - previousLower.charCodeAt(0)
    return delta === 1 || delta === -1
}

function hasSequentialRun(key: string): boolean {
    let runLength = 1
    let direction = 0

    for (let index = 1; index < key.length; ++index) {
        const previous = key[index - 1]
        const current  = key[index]
        if (!isSequentialPair(previous, current)) {
            runLength = 1
            direction = 0
            continue
        }

        const delta = current.toLowerCase().charCodeAt(0) - previous.toLowerCase().charCodeAt(0)
        if (direction === 0 || direction === delta) {
            ++runLength
        } else {
            runLength = 2
        }
        direction = delta

        if (runLength >= 4) {
            return true
        }
    }

    return false
}

function effectiveLength(key: string): number {
    let total       = 0
    let sequenceRun = 1

    for (let index = 0; index < key.length; ++index) {
        const current  = key[index]
        const previous = index > 0 ? key[index - 1] : ''

        if (current === previous) {
            total += REPEAT_WEIGHT
            sequenceRun = 1
            continue
        }

        if (previous && isSequentialPair(previous, current)) {
            ++sequenceRun
            total += sequenceRun >= 3 ? SEQUENCE_WEIGHT : 1
            continue
        }

        sequenceRun = 1
        total += 1
    }

    return total
}

function smallestPeriod(key: string): number {
    const period = `${key}${key}`.indexOf(key, 1)
    return period > 0 && period < key.length ? period : key.length
}

function levelForBits(bits: number): Exclude<ApiKeyStrengthLevel, 'empty' | 'masked'> {
    if (bits >= BITS_FOR_STRONG) {
        return 'strong'
    }
    if (bits >= BITS_FOR_GOOD) {
        return 'good'
    }
    if (bits >= BITS_FOR_FAIR) {
        return 'fair'
    }
    return 'weak'
}

function capLevel(
    level: Exclude<ApiKeyStrengthLevel, 'empty' | 'masked'>,
    cap: Exclude<ApiKeyStrengthLevel, 'empty' | 'masked'>,
): Exclude<ApiKeyStrengthLevel, 'empty' | 'masked'> {
    return EVALUATED_LEVELS.indexOf(level) <= EVALUATED_LEVELS.indexOf(cap) ? level : cap
}

function collectPatterns(key: string): ApiKeyWeakPattern[] {
    const patterns: ApiKeyWeakPattern[] = []
    const period                        = smallestPeriod(key)

    if (key.length < RECOMMENDED_LENGTH) {
        patterns.push('short')
    }
    if (characterClassCount(key) < 2) {
        patterns.push('limited_character_classes')
    }
    if (new Set(key).size < MIN_UNIQUE_CHARACTERS) {
        patterns.push('low_unique_characters')
    }
    if (/(?<character>.)\k<character>{3,}/.test(key)) {
        patterns.push('repeated_characters')
    }
    if (period < key.length && period <= key.length / 2) {
        patterns.push('repeated_pattern')
    }
    if (hasSequentialRun(key)) {
        patterns.push('sequential_characters')
    }
    if (COMMON_WEAK_TERMS.some((term) => key.toLowerCase().includes(term))) {
        patterns.push('common_term')
    }

    return patterns
}

function collectSuggestions(
    level: Exclude<ApiKeyStrengthLevel, 'empty' | 'masked'>,
    patterns: ApiKeyWeakPattern[],
): ApiKeyStrengthSuggestion[] {
    const suggestions: ApiKeyStrengthSuggestion[] = []
    const add                                     = (suggestion: ApiKeyStrengthSuggestion) => {
        if (!suggestions.includes(suggestion)) {
            suggestions.push(suggestion)
        }
    }

    for (const pattern of patterns) {
        switch (pattern) {
            case 'short':
                add('use_longer_key')
                break
            case 'limited_character_classes':
                add('mix_character_classes')
                break
            case 'low_unique_characters':
                add('increase_character_variety')
                break
            case 'repeated_characters':
                add('avoid_repeated_characters')
                break
            case 'repeated_pattern':
                add('avoid_repeated_patterns')
                break
            case 'sequential_characters':
                add('avoid_sequences')
                break
            case 'common_term':
                add('avoid_common_terms')
                break
        }
    }

    if (level !== 'strong') {
        add('use_generator')
    }

    return suggestions
}

export function evaluateApiKeyStrength(rawKey: string): ApiKeyStrengthEvaluation {
    const key = rawKey.trim()
    if (!key) {
        return { level: 'empty', segments: 0, bits: 0, patterns: [], suggestions: [] }
    }
    if (isMaskedValue(key)) {
        return {
            level: 'masked',
            segments: 0,
            bits: 0,
            patterns: [],
            suggestions: ['replace_masked_value'],
        }
    }

    const patterns   = collectPatterns(key)
    const period     = smallestPeriod(key)
    const baseLength = effectiveLength(key.slice(0, period))
    const tailLength = (key.length - period) * REPEAT_WEIGHT
    const factor     = patterns.includes('common_term') ? COMMON_TERM_FACTOR : 1
    const bits       = Math.floor((baseLength + tailLength) * Math.log2(charsetSize(key)) * factor)

    let level = levelForBits(bits)
    for (const { below, level: cap } of LENGTH_CAPS) {
        if (key.length < below) {
            level = capLevel(level, cap)
        }
    }
    if (patterns.includes('low_unique_characters')) {
        level = capLevel(level, 'weak')
    }
    if (patterns.includes('sequential_characters')) {
        level = capLevel(level, 'fair')
    }

    return {
        level,
        segments: EVALUATED_LEVELS.indexOf(level) + 1,
        bits,
        patterns,
        suggestions: collectSuggestions(level, patterns),
    }
}
