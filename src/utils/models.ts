/**
 * 模型工具函数
 * 迁移自基线 utils/models.js
 */

export interface ModelInfo {
    name: string
    alias?: string
    description?: string
}

const MODEL_CATEGORIES = [
    { id: 'gpt', label: 'GPT', patterns: [/gpt/i, /\bo\d\b/i, /\bo\d+\.?/i, /\bchatgpt/i] },
    { id: 'claude', label: 'Claude', patterns: [/claude/i] },
    { id: 'gemini', label: 'Gemini', patterns: [/gemini/i, /\bgai\b/i] },
    { id: 'kimi', label: 'Kimi', patterns: [/kimi/i] },
    { id: 'qwen', label: 'Qwen', patterns: [/qwen/i] },
    { id: 'glm', label: 'GLM', patterns: [/glm/i, /chatglm/i] },
    { id: 'grok', label: 'Grok', patterns: [/grok/i] },
    { id: 'deepseek', label: 'DeepSeek', patterns: [/deepseek/i] },
    { id: 'minimax', label: 'MiniMax', patterns: [/minimax/i, /abab/i] },
]

type Translator = (key: string, opts?: Record<string, unknown>) => string

/** Returns the localized label for a category id, falling back to the English brand label. */
function localizeCategoryLabel(id: string, fallback: string, t?: Translator): string {
    if (!t) {
        return fallback
    }
    return t(`models.category_${id}`, { defaultValue: fallback })
}

const matchCategory = (text: string) => {
    for (const category of MODEL_CATEGORIES) {
        if (category.patterns.some((pattern) => pattern.test(text))) {
            return category.id
        }
    }
    return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

export function normalizeModelList(payload: unknown, { dedupe = false } = {}): ModelInfo[] {
    const toModel = (entry: unknown): ModelInfo | null => {
        if (typeof entry === 'string') {
            return { name: entry }
        }
        if (!isRecord(entry)) {
            return null
        }
        const name = entry.id || entry.name || entry.model || entry.value
        if (!name) {
            return null
        }

        const alias = entry.alias || entry.display_name || entry.displayName
        const description = entry.description || entry.note || entry.comment
        const model: ModelInfo = { name: String(name) }
        if (alias && alias !== name) {
            model.alias = String(alias)
        }
        if (description) {
            model.description = String(description)
        }
        return model
    }

    let models: (ModelInfo | null)[] = []

    if (Array.isArray(payload)) {
        models = payload.map(toModel)
    } else if (isRecord(payload)) {
        if (Array.isArray(payload.data)) {
            models = payload.data.map(toModel)
        } else if (Array.isArray(payload.models)) {
            models = payload.models.map(toModel)
        }
    }

    const normalized = models.filter(Boolean) as ModelInfo[]
    if (!dedupe) {
        return normalized
    }

    const seen = new Set<string>()
    return normalized.filter((model) => {
        const key = (model?.name || '').toLowerCase()
        if (!key || seen.has(key)) {
            return false
        }
        seen.add(key)
        return true
    })
}

/**
 * Returns the localized label for the "Other" model category.
 * Uses i18n `t()` with key `models.category_other`, falling back to "Other".
 */
export function getLocalizedOtherLabel(t: Translator): string {
    return t('models.category_other', { defaultValue: 'Other' })
}

interface ModelGroup {
    id: string
    label: string
    items: ModelInfo[]
}

export function classifyModels(
    models: ModelInfo[] = [],
    { otherLabel = 'Other', t }: { otherLabel?: string; t?: Translator } = {}
): ModelGroup[] {
    const groups: ModelGroup[] = MODEL_CATEGORIES.map((category) => ({
        id: category.id,
        label: localizeCategoryLabel(category.id, category.label, t),
        items: [],
    }))

    const otherGroup: ModelGroup = { id: 'other', label: otherLabel, items: [] }

    models.forEach((model) => {
        const name = (model?.name || '').toString()
        const alias = (model?.alias || '').toString()
        const haystack = `${name} ${alias}`.toLowerCase()
        const matchedId = matchCategory(haystack)
        const target = matchedId ? groups.find((group) => group.id === matchedId) : null

        if (target) {
            target.items.push(model)
        } else {
            otherGroup.items.push(model)
        }
    })

    const populatedGroups = groups.filter((group) => group.items.length > 0)
    if (otherGroup.items.length) {
        populatedGroups.push(otherGroup)
    }

    for (const group of populatedGroups) {
        group.items.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    }

    return populatedGroups
}
