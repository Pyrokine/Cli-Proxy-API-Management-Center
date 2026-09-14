const ruleKey = (value: string): string => value.trim().toLowerCase()

const isExcludedModelWildcardRule = (rule: string): boolean => rule.includes('*')

export function normalizeExcludedModelRules(values: Iterable<unknown>): string[] {
    const seen             = new Set<string>()
    const result: string[] = []

    for (const value of values) {
        if (typeof value !== 'string') {
            continue
        }
        const rule = value.trim()
        const key  = ruleKey(rule)
        if (!key || seen.has(key)) {
            continue
        }
        seen.add(key)
        result.push(rule)
    }

    return result
}

export const normalizeExcludedModelsValue = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return normalizeExcludedModelRules(value)
    }
    if (typeof value === 'string') {
        return parseExcludedModelsText(value)
    }
    return []
}

export const parseExcludedModelsText = (text: string): string[] =>
    normalizeExcludedModelRules(text.split(/[\r\n,]+/))

export const formatExcludedModelsText = (rules: readonly string[]): string =>
    normalizeExcludedModelRules(rules).join('\n')

export function matchesExcludedModelRule(rule: string, modelId: string): boolean {
    const normalizedRule  = ruleKey(rule)
    const normalizedModel = ruleKey(modelId)
    if (!normalizedRule || !normalizedModel) {
        return false
    }
    if (!isExcludedModelWildcardRule(normalizedRule)) {
        return normalizedRule === normalizedModel
    }

    const escaped = normalizedRule
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')
    return new RegExp(`^${escaped}$`, 'i').test(normalizedModel)
}

export const isModelExcludedByRules = (rules: Iterable<string>, modelId: string): boolean =>
    Array.from(rules).some((rule) => matchesExcludedModelRule(rule, modelId))

export const isModelExcludedByWildcardRule = (rules: Iterable<string>, modelId: string): boolean =>
    Array.from(rules).some(
        (rule) => isExcludedModelWildcardRule(rule) && matchesExcludedModelRule(rule, modelId),
    )

export const hasExcludedModelRule = (rules: Iterable<string>, candidate: string): boolean => {
    const candidateKey = ruleKey(candidate)
    return Boolean(candidateKey) && Array.from(rules).some((rule) => ruleKey(rule) === candidateKey)
}

type SplitExcludedModelRules = {
    selectedIds: string[]
    wildcardRules: string[]
    unknownRules: string[]
    customRules: string[]
}

export function splitExcludedModelRules(
    rules: Iterable<string>,
    candidateIds: readonly string[],
): SplitExcludedModelRules {
    const candidateByKey          = new Map(candidateIds.map((id) => [ruleKey(id), id]))
    const selectedIds: string[]   = []
    const wildcardRules: string[] = []
    const unknownRules: string[]  = []
    const customRules: string[]   = []

    normalizeExcludedModelRules(rules).forEach((rule) => {
        if (isExcludedModelWildcardRule(rule)) {
            wildcardRules.push(rule)
            customRules.push(rule)
            return
        }
        const candidate = candidateByKey.get(ruleKey(rule))
        if (candidate) {
            selectedIds.push(candidate)
            return
        }
        unknownRules.push(rule)
        customRules.push(rule)
    })

    return { selectedIds, wildcardRules, unknownRules, customRules }
}

export function toggleExcludedModelRule(
    rules: Iterable<string>,
    candidate: string,
    excluded: boolean,
): string[] {
    const candidateRule = candidate.trim()
    const candidateKey  = ruleKey(candidateRule)
    const next          = normalizeExcludedModelRules(rules).filter((rule) => ruleKey(rule) !== candidateKey)
    if (excluded && candidateKey) {
        next.push(candidateRule)
    }
    return next
}

export function replaceCustomExcludedModelRules(
    rules: Iterable<string>,
    candidateIds: readonly string[],
    text: string,
): string[] {
    const { selectedIds } = splitExcludedModelRules(rules, candidateIds)
    return normalizeExcludedModelRules([...selectedIds, ...parseExcludedModelsText(text)])
}
