import type {ModelAlias} from '@/types'
import {normalizeModelMetadata, normalizeModelThinking} from '@/utils/modelMetadata'

export interface ModelEntry extends ModelAlias {
    alias: string
    maxContextLengthDraft?: string
    thinkingMinDraft?: string
    thinkingMaxDraft?: string
    preserveImportedThinkingRange?: boolean
}

export const updateModelNumericField = (
    entry: ModelEntry,
    field: 'maxContextLength' | 'min' | 'max',
    value: string,
): ModelEntry => {
    const draftKey = field === 'maxContextLength' ? 'maxContextLengthDraft' :
                     field === 'min' ? 'thinkingMinDraft' : 'thinkingMaxDraft'
    const trimmed  = value.trim()
    const parsed   = Number(trimmed)
    const updated  = {...entry}
    if (trimmed && (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(parsed) ||
                    (field === 'maxContextLength' && parsed === 0))) {
        updated[draftKey] = value
        return updated
    }

    delete updated[draftKey]
    if (field === 'maxContextLength') {
        if (trimmed) {
            updated.maxContextLength = parsed
        } else {
            delete updated.maxContextLength
        }
    } else {
        delete updated.preserveImportedThinkingRange
        const thinking = normalizeModelThinking({...updated.thinking, [field]: trimmed ? parsed : undefined})
        if (thinking) {
            updated.thinking = thinking
        } else {
            delete updated.thinking
        }
    }
    return updated
}

export const getModelEntriesValidationKey = (entries: ModelEntry[]): string | undefined => {
    for (const entry of entries) {
        if (!entry.name.trim()) {
            continue
        }
        if (entry.maxContextLengthDraft !== undefined ||
            (entry.maxContextLength !== undefined &&
             (!Number.isSafeInteger(entry.maxContextLength) || entry.maxContextLength < 1))) {
            return 'ai_providers.model_context_invalid'
        }
        const min = entry.thinking?.min
        const max = entry.thinking?.max
        if (entry.thinkingMinDraft !== undefined || entry.thinkingMaxDraft !== undefined ||
            [min, max].some((bound) => bound !== undefined &&
                (!Number.isSafeInteger(bound) || bound < 0))) {
            return 'ai_providers.model_thinking_budget_invalid'
        }
        if ((min ?? 0) > (max ?? 0) && !entry.preserveImportedThinkingRange) {
            return 'ai_providers.model_thinking_budget_range'
        }
    }
    return undefined
}

export const parseThinkingLevelsInput = (value: string): string[] =>
    value.split(',').map((level) => level.trim())

export const modelsToEntries = (models?: ModelAlias[]): ModelEntry[] => {
    if (!Array.isArray(models) || models.length === 0) {
        return [{ name: '', alias: '' }]
    }
    return models.map((model) => ({
        ...model,
        name: model.name || '',
        alias: model.alias || '',
        ...normalizeModelMetadata(model),
        ...((model.thinking?.min ?? 0) > (model.thinking?.max ?? 0) ?
            {preserveImportedThinkingRange: true} : {}),
    }))
}

export const entriesToModels = (entries: ModelEntry[]): ModelAlias[] => {
    const validationKey = getModelEntriesValidationKey(entries)
    if (validationKey) {
        throw new Error(validationKey)
    }
    return entries
        .filter((entry) => entry.name.trim())
        .map((entry) => {
            const model: ModelAlias = {
                name: entry.name.trim(),
                ...normalizeModelMetadata(entry),
            }
            if (entry.priority !== undefined) {
                model.priority = entry.priority
            }
            if (entry.testModel !== undefined) {
                model.testModel = entry.testModel
            }
            const normalizedAlias = entry.alias.trim()
            if (normalizedAlias && normalizedAlias !== model.name) {
                model.alias = normalizedAlias
            }
            return model
        })
}
