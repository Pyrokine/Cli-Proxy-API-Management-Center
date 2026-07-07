import type {OAuthProvider} from '@/services/api/oauth'
import type {Config, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {ComponentType} from 'react'

export type AnyKeyConfig = GeminiKeyConfig | ProviderKeyConfig | OpenAIProviderConfig

export interface QuotaConfig {
    provider: string
    label: string
}

export interface VendorDefinition {
    id: string
    label: string
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
    Vertex: ComponentType<{ size?: number }>
    OpenAI: ComponentType<{ size?: number }>
    Kimi: ComponentType<{ size?: number }>
    Qwen: ComponentType<{ size?: number }>
    IFlow: ComponentType<{ size?: number }>
    Grok: ComponentType<{ size?: number }>
}): VendorDefinition[] {
    return [
        {
            id: 'gemini',
            label: 'Gemini',
            icon: icons.Gemini,
            configExtractor: (c) => c.geminiApiKeys || [],
            authFileTypes: ['gemini', 'gemini-cli', 'aistudio'],
            oauthProviders: ['gemini-cli'],
            editRoute: '/credentials/gemini',
            createRoute: '/credentials/gemini/new',
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
        {
            id: 'claude',
            label: 'Claude',
            icon: icons.Claude,
            configExtractor: (c) => c.claudeApiKeys || [],
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
            icon: icons.Codex,
            configExtractor: (c) => c.codexApiKeys || [],
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
            id: 'vertex',
            label: 'Vertex',
            icon: icons.Vertex,
            configExtractor: (c) => c.vertexApiKeys || [],
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
            icon: icons.OpenAI,
            configExtractor: (c) => c.openaiCompatibility || [],
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
            icon: icons.Kimi,
            authFileTypes: ['kimi'],
            oauthProviders: ['kimi'],
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
            quotaConfig: { provider: 'kimi', label: 'Kimi' },
        },
        {
            id: 'qwen',
            label: 'Qwen',
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
            icon: icons.Grok,
            authFileTypes: ['xai', 'x-ai', 'grok'],
            oauthProviders: ['xai'],
            supportsFileUpload: true,
            supportsJsonImport: false,
            supportsCookieAuth: false,
        },
    ]
}
