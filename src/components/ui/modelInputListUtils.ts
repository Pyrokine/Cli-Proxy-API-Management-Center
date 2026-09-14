import type {ModelAlias, ModelThinking} from '@/types'
import {normalizeModelMetadata} from '@/utils/modelMetadata'

export interface ModelEntry {
    name: string
    alias: string
    maxContextLength?: number
    thinking?: ModelThinking
}

export const parseThinkingLevelsInput = (value: string): string[] =>
    value.split(',').map((level) => level.trim())

export const modelsToEntries = (models?: ModelAlias[]): ModelEntry[] => {
    if (!Array.isArray(models) || models.length === 0) {
        return [{ name: '', alias: '' }]
    }
    return models.map((model) => ({
        name: model.name || '',
        alias: model.alias || '',
        ...normalizeModelMetadata(model),
    }))
}

export const entriesToModels = (entries: ModelEntry[]): ModelAlias[] => {
    return entries
        .filter((entry) => entry.name.trim())
        .map((entry) => {
            const model: ModelAlias = {
                name: entry.name.trim(),
                ...normalizeModelMetadata(entry),
            }
            const alias             = entry.alias.trim()
            if (alias && alias !== model.name) {
                model.alias = alias
            }
            return model
        })
}
