export const CPA_API_KEY_PLACEHOLDER = '<CPA_API_KEY>'

interface ClaudeCodeClientConfig {
    model: string
    env: {
        ANTHROPIC_BASE_URL: string
        ANTHROPIC_API_KEY: string
        ANTHROPIC_DEFAULT_OPUS_MODEL: string
        ANTHROPIC_DEFAULT_SONNET_MODEL: string
        ANTHROPIC_DEFAULT_HAIKU_MODEL: string
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: string
    }
}

export function selectClaudeCodeClientModel(models: string[], currentSelection: string): string {
    const available = models.map((model) => model.trim()).filter(Boolean)
    const selected  = currentSelection.trim().toLowerCase()
    if (selected) {
        const current = available.find((model) => model.toLowerCase() === selected)
        if (current) {
            return current
        }
    }
    return available.find((model) => model.toLowerCase() === 'deepseek-flash') ??
           available.find((model) => model.toLowerCase() === 'deepseek-v4-pro') ??
           available[0] ?? ''
}

export function buildClaudeCodeClientConfig(baseUrl: string, model: string): ClaudeCodeClientConfig | null {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/g, '')
    const normalizedModel   = model.trim()
    if (!normalizedBaseUrl || !normalizedModel) {
        return null
    }

    return {
        model: normalizedModel,
        env: {
            ANTHROPIC_BASE_URL: normalizedBaseUrl,
            ANTHROPIC_API_KEY: CPA_API_KEY_PLACEHOLDER,
            ANTHROPIC_DEFAULT_OPUS_MODEL: normalizedModel,
            ANTHROPIC_DEFAULT_SONNET_MODEL: normalizedModel,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: normalizedModel,
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
    }
}

export function serializeClaudeCodeClientConfig(baseUrl: string, model: string): string {
    const config = buildClaudeCodeClientConfig(baseUrl, model)
    return config ? JSON.stringify(config, null, 2) : ''
}
