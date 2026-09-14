import type {ClaudeModelDiscoveryOptions} from '@/services/api/models'
import {normalizeApiBase} from '@/utils/connection'

interface ProviderModelDiscovery extends ClaudeModelDiscoveryOptions {
    providerLabel: string
}

interface ProviderQuickFillPreset {
    id: string
    label: string
    labelKey?: string
    baseUrl: string
    name?: string
    discovery?: ProviderModelDiscovery
}

export const applyProviderQuickFill = <T extends { baseUrl: string }>(
    value: T,
    preset: Pick<ProviderQuickFillPreset, 'baseUrl'>,
): T => ({ ...value, baseUrl: preset.baseUrl })

const FENNO_AI_NAME              = 'Fenno'
const FENNO_AI_BASE_URL          = 'https://api.fenno.ai'
const QINIU_CLOUD_DOMESTIC_NAME  = '七牛云国内'
const QINIU_CLOUD_OVERSEAS_NAME  = '七牛云海外'
const QINIU_CLOUD_DOMESTIC_LABEL = 'Qiniu Cloud (China)'
const QINIU_CLOUD_OVERSEAS_LABEL = 'Qiniu Cloud (Global)'
const QINIU_CLOUD_DOMESTIC_URL   = 'https://api.qnaigc.com'
const QINIU_CLOUD_OVERSEAS_URL   = 'https://api.modelink.ai'
const DEEPSEEK_NAME              = 'DeepSeek'
const DEEPSEEK_CLAUDE_BASE_URL   = 'https://api.deepseek.com/anthropic'
const DEEPSEEK_MODELS_URL        = 'https://api.deepseek.com/models'
const openAICompatibleBaseURL    = (baseUrl: string) => `${baseUrl}/v1`

export const OPENAI_QUICK_FILL_PRESETS: ProviderQuickFillPreset[] = [
    {
        id: 'fenno-ai-openai',
        label: FENNO_AI_NAME,
        name: FENNO_AI_NAME,
        baseUrl: openAICompatibleBaseURL(FENNO_AI_BASE_URL),
    },
    {
        id: 'qiniu-cloud-domestic-openai',
        label: QINIU_CLOUD_DOMESTIC_LABEL,
        labelKey: 'ai_providers.quick_fill_qiniu_domestic',
        name: QINIU_CLOUD_DOMESTIC_NAME,
        baseUrl: openAICompatibleBaseURL(QINIU_CLOUD_DOMESTIC_URL),
    },
    {
        id: 'qiniu-cloud-overseas-openai',
        label: QINIU_CLOUD_OVERSEAS_LABEL,
        labelKey: 'ai_providers.quick_fill_qiniu_overseas',
        name: QINIU_CLOUD_OVERSEAS_NAME,
        baseUrl: openAICompatibleBaseURL(QINIU_CLOUD_OVERSEAS_URL),
    },
]

export const CODEX_QUICK_FILL_PRESETS: ProviderQuickFillPreset[] = [
    {
        id: 'fenno-ai-codex',
        label: FENNO_AI_NAME,
        baseUrl: openAICompatibleBaseURL(FENNO_AI_BASE_URL),
    },
    {
        id: 'qiniu-cloud-domestic-codex',
        label: QINIU_CLOUD_DOMESTIC_LABEL,
        labelKey: 'ai_providers.quick_fill_qiniu_domestic',
        baseUrl: openAICompatibleBaseURL(QINIU_CLOUD_DOMESTIC_URL),
    },
    {
        id: 'qiniu-cloud-overseas-codex',
        label: QINIU_CLOUD_OVERSEAS_LABEL,
        labelKey: 'ai_providers.quick_fill_qiniu_overseas',
        baseUrl: openAICompatibleBaseURL(QINIU_CLOUD_OVERSEAS_URL),
    },
]

export const CLAUDE_QUICK_FILL_PRESETS: ProviderQuickFillPreset[] = [
    {
        id: 'deepseek-claude',
        label: DEEPSEEK_NAME,
        baseUrl: DEEPSEEK_CLAUDE_BASE_URL,
        discovery: {
            providerLabel: DEEPSEEK_NAME,
            endpoint: DEEPSEEK_MODELS_URL,
            authMode: 'bearer',
            addAnthropicVersion: false,
        },
    },
    {
        id: 'fenno-ai-claude',
        label: FENNO_AI_NAME,
        baseUrl: FENNO_AI_BASE_URL,
    },
    {
        id: 'qiniu-cloud-domestic-claude',
        label: QINIU_CLOUD_DOMESTIC_LABEL,
        labelKey: 'ai_providers.quick_fill_qiniu_domestic',
        baseUrl: QINIU_CLOUD_DOMESTIC_URL,
    },
    {
        id: 'qiniu-cloud-overseas-claude',
        label: QINIU_CLOUD_OVERSEAS_LABEL,
        labelKey: 'ai_providers.quick_fill_qiniu_overseas',
        baseUrl: QINIU_CLOUD_OVERSEAS_URL,
    },
]

const normalizeQuickFillBaseUrl = (baseUrl: string): string => {
    const normalized = normalizeApiBase(baseUrl)
    if (!normalized) {
        return ''
    }

    try {
        const url    = new URL(normalized)
        url.search   = ''
        url.hash     = ''
        url.pathname = url.pathname
                          .replace(/\/+$/g, '')
                          .replace(/\/v1\/messages$/, '')
                          .replace(/\/v1$/, '')
        return `${url.origin.toLowerCase()}${url.pathname}`
    } catch {
        return ''
    }
}

export const resolveClaudeModelDiscovery = (baseUrl: string): ProviderModelDiscovery | undefined => {
    const normalized = normalizeQuickFillBaseUrl(baseUrl)
    if (!normalized) {
        return undefined
    }
    return CLAUDE_QUICK_FILL_PRESETS.find(
        (preset) => normalizeQuickFillBaseUrl(preset.baseUrl) === normalized,
    )?.discovery
}

export const GEMINI_QUICK_FILL_PRESETS: ProviderQuickFillPreset[] = [
    {
        id: 'qiniu-cloud-domestic-gemini',
        label: QINIU_CLOUD_DOMESTIC_LABEL,
        labelKey: 'ai_providers.quick_fill_qiniu_domestic',
        baseUrl: QINIU_CLOUD_DOMESTIC_URL,
    },
    {
        id: 'qiniu-cloud-overseas-gemini',
        label: QINIU_CLOUD_OVERSEAS_LABEL,
        labelKey: 'ai_providers.quick_fill_qiniu_overseas',
        baseUrl: QINIU_CLOUD_OVERSEAS_URL,
    },
]
