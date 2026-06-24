export type ModelTreeNode = {
    id: string
    label: string
    provider: string
    kind: 'provider' | 'group' | 'model'
    children?: ModelTreeNode[]
}

export type ModelMetadata = {
    provider: string
    generation: string
    family: string
}

const modelProviderOrder = ['GPT', 'Claude', 'Gemini', 'Kimi', 'Qwen', 'GLM', 'Grok', 'DeepSeek', 'MiniMax', 'Other']

const providerChannels: Record<string, string[]> = {
    GPT: ['codex', 'openai'],
    Claude: ['claude'],
    Gemini: ['gemini-cli', 'vertex', 'aistudio', 'antigravity'],
    Kimi: ['kimi'],
    Qwen: ['qwen', 'iflow'],
    GLM: ['glm'],
    Grok: ['xai'],
    DeepSeek: ['deepseek', 'iflow'],
    MiniMax: ['minimax'],
    Other: [],
}

function titleCase(value: string): string {
    return value
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ')
}

export function getModelProvider(model: string): string {
    const lower = model.toLowerCase()
    if (
        lower.includes('gpt') ||
        lower.startsWith('codex-') ||
        lower.includes('openai') ||
        /\bo\d\b/i.test(lower) ||
        /\bo\d+\.?/i.test(lower) ||
        lower.includes('chatgpt')
    ) {
        return 'GPT'
    }
    if (lower.includes('claude')) {
        return 'Claude'
    }
    if (lower.includes('gemini') || lower.startsWith('imagen-') || /\bgai\b/i.test(lower)) {
        return 'Gemini'
    }
    if (lower.includes('kimi')) {
        return 'Kimi'
    }
    if (lower.includes('qwen') || lower === 'coder-model' || lower === 'vision-model') {
        return 'Qwen'
    }
    if (lower.includes('glm') || lower.includes('chatglm')) {
        return 'GLM'
    }
    if (lower.includes('grok')) {
        return 'Grok'
    }
    if (lower.includes('deepseek')) {
        return 'DeepSeek'
    }
    if (lower.includes('minimax') || lower.includes('abab')) {
        return 'MiniMax'
    }
    return 'Other'
}

function claudeGeneration(lower: string): string | null {
    const direct = lower.match(/^claude-(?:opus|sonnet|haiku|fable)-(.+)$/)
    if (direct) {
        const parts = direct[1].split('-').filter((part) => /^\d+$/.test(part))
        if (parts.length > 0) {
            const version = parts.length > 1 && parts[1].length <= 2 ? `${parts[0]}.${parts[1]}` : parts[0]
            return `Claude ${version}`
        }
    }
    const legacy = lower.match(/^claude-(\d+)-(\d+)-(?:opus|sonnet|haiku|fable)/)
    if (legacy) {
        return `Claude ${legacy[1]}.${legacy[2]}`
    }
    return null
}

function claudeFamily(lower: string): string | null {
    if (lower.includes('opus')) {
        return 'Opus'
    }
    if (lower.includes('sonnet')) {
        return 'Sonnet'
    }
    if (lower.includes('haiku')) {
        return 'Haiku'
    }
    if (lower.includes('fable')) {
        return 'Fable'
    }
    return null
}

function gptGeneration(lower: string): string | null {
    if (lower.startsWith('gpt-image-')) {
        return 'GPT Image'
    }
    if (lower.startsWith('gpt-oss-')) {
        return 'GPT OSS'
    }
    if (lower.startsWith('codex-')) {
        return 'Codex Tools'
    }
    const gpt = lower.match(/^gpt-(\d+(?:\.\d+)?)/)
    if (gpt) {
        return `GPT-${gpt[1]}`
    }
    if (/^o\d/.test(lower)) {
        return 'OpenAI o-series'
    }
    return null
}

function gptFamily(lower: string): string | null {
    const gpt = lower.match(/^gpt-(\d+(?:\.\d+)?)/)
    if (lower.startsWith('gpt-image-')) {
        return 'GPT Image'
    }
    if (lower.startsWith('gpt-oss-')) {
        return 'GPT OSS'
    }
    if (gpt) {
        return lower.includes('mini') ? `GPT-${gpt[1]} Mini` : `GPT-${gpt[1]}`
    }
    if (lower.startsWith('codex-')) {
        return 'Codex Tools'
    }
    if (/^o\d/.test(lower)) {
        return 'Reasoning'
    }
    return null
}

function geminiGeneration(lower: string): string | null {
    const gemini = lower.match(/^gemini-(\d+(?:\.\d+)?)/)
    if (gemini) {
        return `Gemini ${gemini[1]}`
    }
    const imagen = lower.match(/^imagen-(\d+(?:\.\d+)?)/)
    if (imagen) {
        return `Imagen ${imagen[1]}`
    }
    if (lower.includes('latest')) {
        return 'Gemini latest'
    }
    if (lower.startsWith('gemini-')) {
        return 'Gemini Other'
    }
    return null
}

function geminiFamily(lower: string): string | null {
    if (lower.includes('flash')) {
        return 'Flash'
    }
    if (lower.includes('pro')) {
        return 'Pro'
    }
    if (lower.startsWith('imagen-')) {
        return 'Image'
    }
    return null
}

function qwenGeneration(lower: string): string | null {
    const qwen = lower.match(/^qwen(\d+)/)
    if (qwen) {
        return `Qwen ${qwen[1]}`
    }
    if (lower === 'coder-model') {
        return 'Qwen Coder'
    }
    if (lower === 'vision-model') {
        return 'Qwen Vision'
    }
    return null
}

function qwenFamily(lower: string): string | null {
    if (lower.includes('coder') || lower === 'coder-model') {
        return 'Coder'
    }
    if (lower.includes('vl') || lower === 'vision-model') {
        return 'Vision'
    }
    if (lower.includes('max')) {
        return 'Max'
    }
    return null
}

export function getModelMetadata(model: string): ModelMetadata {
    const lower    = model.toLowerCase()
    const provider = getModelProvider(model)

    if (provider === 'Claude') {
        return {
            provider,
            generation: claudeGeneration(lower) ?? 'Claude',
            family: claudeFamily(lower) ?? 'Claude',
        }
    }
    if (provider === 'GPT') {
        return {
            provider,
            generation: gptGeneration(lower) ?? 'GPT',
            family: gptFamily(lower) ?? 'GPT',
        }
    }
    if (provider === 'Gemini') {
        return {
            provider,
            generation: geminiGeneration(lower) ?? 'Gemini',
            family: geminiFamily(lower) ?? 'Gemini',
        }
    }
    if (provider === 'Qwen') {
        return {
            provider,
            generation: qwenGeneration(lower) ?? 'Qwen',
            family: qwenFamily(lower) ?? 'Qwen',
        }
    }
    if (provider === 'DeepSeek') {
        return {
            provider,
            generation: lower.startsWith('deepseek-r1') ?
                        'DeepSeek R1' :
                        lower.startsWith('deepseek-v3') ? 'DeepSeek V3' : 'DeepSeek',
            family: lower.startsWith('deepseek-r1') ? 'R1' : lower.startsWith('deepseek-v3') ? 'V3' : 'DeepSeek',
        }
    }
    if (provider === 'Grok') {
        const generation = lower.match(/^grok-(\d+(?:\.\d+)?)/)?.[1]
        return {
            provider,
            generation: generation ? `Grok ${generation}` : 'Grok',
            family: generation ? `Grok ${generation}` : 'Grok',
        }
    }
    if (provider === 'Kimi') {
        return {
            provider,
            generation: lower.startsWith('kimi-k2') ? 'Kimi K2' : 'Kimi',
            family: lower.startsWith('kimi-k2') ? 'K2' : 'Kimi',
        }
    }

    return { provider, generation: provider, family: provider === 'Other' ? titleCase(model) || 'Other' : provider }
}

export function getModelProviderChannels(provider: string): string[] {
    return providerChannels[provider] ?? []
}

export function sortModelProviders(left: string, right: string): number {
    const leftIndex  = modelProviderOrder.indexOf(left)
    const rightIndex = modelProviderOrder.indexOf(right)
    if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
               (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
    }
    return left.localeCompare(right)
}

const modelLabelCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function generationGroupLabel(provider: string, generation: string, family: string): string {
    const candidates = [generation, family]
    for (const candidate of candidates) {
        const label = candidate.trim()
        if (label && label.toLowerCase() !== provider.toLowerCase()) {
            return label
        }
    }
    return `${provider} Other`
}

function compareModelLabels(left: string, right: string): number {
    return modelLabelCollator.compare(left, right)
}

export function buildModelTree(models: Array<string | {
    model: string;
    group?: string;
    provider?: string
}>): ModelTreeNode[] {
    const providers = new Map<string, Map<string, string[]>>()
    for (const item of models) {
        const trimmed        = (typeof item === 'string' ? item : item.model).trim()
        const customGroup    = typeof item === 'string' ? '' : item.group?.trim() ?? ''
        const customProvider = typeof item === 'string' ? '' : item.provider?.trim() ?? ''
        if (!trimmed) {
            continue
        }
        const metadata = getModelMetadata(trimmed)
        const provider = customProvider || metadata.provider
        if (!providers.has(provider)) {
            providers.set(provider, new Map())
        }
        const groups = providers.get(provider)!
        const group  = customGroup || generationGroupLabel(provider, metadata.generation, metadata.family)
        if (!groups.has(group)) {
            groups.set(group, [])
        }
        groups.get(group)!.push(trimmed)
    }

    return Array.from(providers.entries())
                .sort(([left], [right]) => sortModelProviders(left, right))
                .map(([provider, groups]) => ({
                    id: `provider:${provider}`,
                    label: provider,
                    provider,
                    kind: 'provider' as const,
                    children: Array.from(groups.entries())
                                   .sort(([left], [right]) => compareModelLabels(left, right))
                                   .map(([group, groupModels]) => ({
                                       id: `group:${provider}:${group}`,
                                       label: group,
                                       provider,
                                       kind: 'group' as const,
                                       children: groupModels.sort(compareModelLabels).map((model) => ({
                                           id: model,
                                           label: model,
                                           provider,
                                           kind: 'model' as const,
                                       })),
                                   })),
                }))
}

export function modelLeaves(node: ModelTreeNode): string[] {
    if (node.kind === 'model') {
        return [node.id]
    }
    return (node.children ?? []).flatMap(modelLeaves)
}

export function countModelLeaves(nodes: ModelTreeNode[]): number {
    return nodes.reduce((count, node) => count + modelLeaves(node).length, 0)
}

export function filterModelTree(nodes: ModelTreeNode[], query: string): ModelTreeNode[] {
    const q = query.trim().toLowerCase()
    if (!q) {
        return nodes
    }
    const filtered: ModelTreeNode[] = []
    for (const node of nodes) {
        const selfMatches = node.label.toLowerCase().includes(q) || node.provider.toLowerCase().includes(q)
        if (selfMatches) {
            filtered.push(node)
            continue
        }
        const children = node.children ? filterModelTree(node.children, q) : []
        if (children.length > 0) {
            filtered.push({ ...node, children })
        }
    }
    return filtered
}

export function selectionState(node: ModelTreeNode, selected: Set<string>): 'none' | 'partial' | 'all' {
    const leaves = modelLeaves(node)
    if (leaves.length === 0) {
        return 'none'
    }
    const selectedCount = leaves.filter((model) => selected.has(model)).length
    if (selectedCount === 0) {
        return 'none'
    }
    return selectedCount === leaves.length ? 'all' : 'partial'
}

function modelKeyCandidates(model: string): string[] {
    const key = model.trim().toLowerCase()
    if (!key) {
        return []
    }
    const withoutModels = key.startsWith('models/') ? key.slice('models/'.length) : key
    return Array.from(new Set([key, withoutModels, `models/${withoutModels}`]))
}

export function getGloballyExcludedModelKeys(excludedModels?: Record<string, string[]> | null): Set<string> {
    const keys = new Set<string>()
    Object.values(excludedModels ?? {}).forEach((models) => {
        models.forEach((model) => {
            modelKeyCandidates(model).forEach((candidate) => keys.add(candidate))
        })
    })
    return keys
}

function matchWildcard(pattern: string, value: string): boolean {
    if (!pattern) {
        return false
    }
    if (!pattern.includes('*')) {
        return pattern === value
    }
    const parts  = pattern.split('*')
    const prefix = parts[0]
    let rest     = value
    if (prefix) {
        if (!rest.startsWith(prefix)) {
            return false
        }
        rest = rest.slice(prefix.length)
    }
    const suffix = parts[parts.length - 1]
    if (suffix) {
        if (!rest.endsWith(suffix)) {
            return false
        }
        rest = rest.slice(0, rest.length - suffix.length)
    }
    for (let i = 1; i < parts.length - 1; i++) {
        const segment = parts[i]
        if (!segment) {
            continue
        }
        const index = rest.indexOf(segment)
        if (index < 0) {
            return false
        }
        rest = rest.slice(index + segment.length)
    }
    return true
}

export function isModelGloballyExcluded(model: string, excludedKeys: Set<string>): boolean {
    const excludedPatterns = Array.from(excludedKeys)
    return modelKeyCandidates(model).some((candidate) =>
                                              excludedPatterns.some((pattern) => matchWildcard(pattern, candidate)),
    )
}
