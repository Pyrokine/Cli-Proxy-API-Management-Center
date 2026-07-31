export interface ProviderQuickFillPreset {
    id: string
    label: string
    baseUrl: string
    name?: string
}

export const applyProviderQuickFill = <T extends {baseUrl: string}>(
    value: T,
    preset: Pick<ProviderQuickFillPreset, 'baseUrl'>,
): T => ({...value, baseUrl: preset.baseUrl})

const FENNO_AI_NAME               = 'FennoAI'
const FENNO_AI_BASE_URL           = 'https://api.fenno.ai'
const QINIU_CLOUD_DOMESTIC_NAME   = '七牛云国内'
const QINIU_CLOUD_OVERSEAS_NAME   = '七牛云海外'
const QINIU_CLOUD_DOMESTIC_URL    = 'https://api.qnaigc.com'
const QINIU_CLOUD_OVERSEAS_URL    = 'https://api.modelink.ai'
const openAICompatibleBaseURL     = (baseUrl: string) => `${baseUrl}/v1`

export const OPENAI_QUICK_FILL_PRESETS: ProviderQuickFillPreset[] = [
    {
        id: 'fenno-ai-openai',
        label: FENNO_AI_NAME,
        name: FENNO_AI_NAME,
        baseUrl: openAICompatibleBaseURL(FENNO_AI_BASE_URL),
    },
    {
        id: 'qiniu-cloud-domestic-openai',
        label: QINIU_CLOUD_DOMESTIC_NAME,
        name: QINIU_CLOUD_DOMESTIC_NAME,
        baseUrl: openAICompatibleBaseURL(QINIU_CLOUD_DOMESTIC_URL),
    },
    {
        id: 'qiniu-cloud-overseas-openai',
        label: QINIU_CLOUD_OVERSEAS_NAME,
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
        label: QINIU_CLOUD_DOMESTIC_NAME,
        baseUrl: openAICompatibleBaseURL(QINIU_CLOUD_DOMESTIC_URL),
    },
    {
        id: 'qiniu-cloud-overseas-codex',
        label: QINIU_CLOUD_OVERSEAS_NAME,
        baseUrl: openAICompatibleBaseURL(QINIU_CLOUD_OVERSEAS_URL),
    },
]

export const CLAUDE_QUICK_FILL_PRESETS: ProviderQuickFillPreset[] = [
    {
        id: 'fenno-ai-claude',
        label: FENNO_AI_NAME,
        baseUrl: FENNO_AI_BASE_URL,
    },
    {
        id: 'qiniu-cloud-domestic-claude',
        label: QINIU_CLOUD_DOMESTIC_NAME,
        baseUrl: QINIU_CLOUD_DOMESTIC_URL,
    },
    {
        id: 'qiniu-cloud-overseas-claude',
        label: QINIU_CLOUD_OVERSEAS_NAME,
        baseUrl: QINIU_CLOUD_OVERSEAS_URL,
    },
]

export const GEMINI_QUICK_FILL_PRESETS: ProviderQuickFillPreset[] = [
    {
        id: 'qiniu-cloud-domestic-gemini',
        label: QINIU_CLOUD_DOMESTIC_NAME,
        baseUrl: QINIU_CLOUD_DOMESTIC_URL,
    },
    {
        id: 'qiniu-cloud-overseas-gemini',
        label: QINIU_CLOUD_OVERSEAS_NAME,
        baseUrl: QINIU_CLOUD_OVERSEAS_URL,
    },
]
