import type {OAuthProvider} from '@/services/api/oauth'
import type {Config, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {ComponentType} from 'react'
import {buildManualKeyCardItems} from '../apiKeyStatus'

export type AnyKeyConfig = GeminiKeyConfig | ProviderKeyConfig | OpenAIProviderConfig

const manualKeyExtractors: Record<string, (config: Config) => AnyKeyConfig[]> = {
    gemini: (config) => config.geminiApiKeys ?? [],
    interactions: (config) => config.interactionsApiKeys ?? [],
    claude: (config) => config.claudeApiKeys ?? [],
    codex: (config) => config.codexApiKeys ?? [],
    meta: (config) => config.metaApiKeys ?? [],
    vertex: (config) => config.vertexApiKeys ?? [],
    openai: (config) => config.openaiCompatibility ?? [],
    xai: (config) => config.xaiApiKeys ?? [],
}

export function countCredentialCards(config: Config | null, authFilesCount: number | null): number | null {
    if (config === null || authFilesCount === null) {
        return null
    }
    return authFilesCount + Object.entries(manualKeyExtractors).reduce(
        (count, [vendorId, extract]) => count + buildManualKeyCardItems(vendorId, extract(config)).length,
        0,
    )
}

export interface QuotaConfig {
    provider: string
    label: string
}

export interface VendorDefinition {
    id: string
    label: string
    labelKey: string
    icon: ComponentType<{ size?: number }>
    /** Extract API key configs from server config */
    configExtractor?: (config: Config) => AnyKeyConfig[]
    /** Auth file types that belong to this vendor */
    authFileTypes: string[]
    /** Supported OAuth providers */
    oauthProviders: OAuthProvider[]
    /** Route prefix for manual key editing */
    editRoute?: string
    createRoute?: string
    /** Supports auth file upload */
    supportsFileUpload: boolean
    /** Supports Vertex JSON import */
    supportsJsonImport: boolean
    /** Supports iFlow cookie auth */
    supportsCookieAuth: boolean
    /** Quota settings */
    quotaConfig?: QuotaConfig
}

/**
 * Returns the static vendor registry.
 *
 * Avoids top-level icon imports by accepting an icon map, so the registry can
 * be created lazily in a component that already imports icons.
 */
export function createVendorRegistry(icons: {
    Gemini: ComponentType<{ size?: number }>
    Claude: ComponentType<{ size?: number }>
    Codex: ComponentType<{ size?: number }>
    Meta: ComponentType<{ size?: number }>
    Vertex: ComponentType<{ size?: number }>
    OpenAI: ComponentType<{ size?: number }>
    Kimi: ComponentType<{ size?: number }>
    Qwen: ComponentType<{ size?: number }>
    IFlow: ComponentType<{ size?: number }>
    Grok: ComponentType<{ size?: number }>
    Devin: ComponentType<{ size?: number }>
    Generic: ComponentType<{ size?: number }>
}): VendorDefinition[] {
    return [
        {
            id: 'gemini',
            label: 'Gemini',
            labelKey: 'credentials.vendor_gemini',
            icon: icons.Gemini,
            configExtractor: manualKeyExtractors.gemini,
            authFileTypes: ['gemini', 'gemini-cli', 'aistudio'],
            oauthProviders: ['gemini-cli'],
            editRoute: '/credentials/gemini',
            createRoute: '/credentials/gemini/new',
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
        {
            id: 'interactions',
            label: 'Interactions',
            labelKey: 'credentials.vendor_interactions',
            icon: icons.Gemini,
            configExtractor: manualKeyExtractors.interactions,
            authFileTypes: [],
            oauthProviders: [],
            editRoute: '/credentials/interactions',
            createRoute: '/credentials/interactions/new',
            supportsFileUpload: false,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
        {
            id: 'claude',
            label: 'Claude Compatible',
            labelKey: 'credentials.vendor_claude_compatible',
            icon: icons.Claude,
            configExtractor: manualKeyExtractors.claude,
            authFileTypes: ['claude', 'antigravity'],
            oauthProviders: ['anthropic', 'antigravity'],
            editRoute: '/credentials/claude',
            createRoute: '/credentials/claude/new',
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
            quotaConfig: { provider: 'antigravity', label: 'Antigravity' },
        },
        {
            id: 'codex',
            label: 'Codex',
            labelKey: 'credentials.vendor_codex',
            icon: icons.Codex,
            configExtractor: manualKeyExtractors.codex,
            authFileTypes: ['codex'],
            oauthProviders: ['codex'],
            editRoute: '/credentials/codex',
            createRoute: '/credentials/codex/new',
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
            quotaConfig: { provider: 'codex', label: 'Codex' },
        },
        {
            id: 'meta',
            label: 'Muse (Meta)',
            labelKey: 'credentials.vendor_meta',
            icon: icons.Meta,
            configExtractor: manualKeyExtractors.meta,
            authFileTypes: ['meta', 'muse'],
            oauthProviders: ['meta'],
            editRoute: '/credentials/meta',
            createRoute: '/credentials/meta/new',
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
        {
            id: 'devin',
            label: 'Devin',
            labelKey: 'credentials.vendor_devin',
            icon: icons.Devin,
            authFileTypes: ['devin', 'cognition'],
            oauthProviders: ['devin'],
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
            quotaConfig: { provider: 'devin', label: 'Devin' },
        },
        {
            id: 'vertex',
            label: 'Vertex',
            labelKey: 'credentials.vendor_vertex',
            icon: icons.Vertex,
            configExtractor: manualKeyExtractors.vertex,
            authFileTypes: ['vertex'],
            oauthProviders: [],
            editRoute: '/credentials/vertex',
            createRoute: '/credentials/vertex/new',
            supportsFileUpload: true,
            supportsJsonImport: true,
            supportsCookieAuth: false,
        },
        {
            id: 'openai',
            label: 'OpenAI Compatible',
            labelKey: 'credentials.vendor_openai_compatible',
            icon: icons.OpenAI,
            configExtractor: manualKeyExtractors.openai,
            authFileTypes: [],
            oauthProviders: [],
            editRoute: '/credentials/openai',
            createRoute: '/credentials/openai/new',
            supportsFileUpload: false,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
        {
            id: 'kimi',
            label: 'Kimi',
            labelKey: 'credentials.vendor_kimi',
            icon: icons.Kimi,
            authFileTypes: ['kimi', 'kimi-ai'],
            oauthProviders: ['kimi', 'kimi-ai'],
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
            quotaConfig: { provider: 'kimi', label: 'Kimi' },
        },
        {
            id: 'qwen',
            label: 'Qwen',
            labelKey: 'credentials.vendor_qwen',
            icon: icons.Qwen,
            authFileTypes: ['qwen'],
            oauthProviders: ['qwen'],
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
        {
            id: 'iflow',
            label: 'iFlow',
            labelKey: 'credentials.vendor_iflow',
            icon: icons.IFlow,
            authFileTypes: ['iflow'],
            oauthProviders: [],
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: true,
        },
        {
            id: 'xai',
            label: 'xAI',
            labelKey: 'credentials.vendor_xai',
            icon: icons.Grok,
            configExtractor: manualKeyExtractors.xai,
            authFileTypes: ['xai', 'x-ai', 'grok'],
            oauthProviders: ['xai'],
            editRoute: '/credentials/xai',
            createRoute: '/credentials/xai/new',
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
        {
            id: 'other',
            label: 'Other credentials',
            labelKey: 'credentials.vendor_other',
            icon: icons.Generic,
            authFileTypes: [],
            oauthProviders: [],
            supportsFileUpload: false,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
    ]
}
