import {AiProvidersClaudeEditLayout} from '@/pages/AiProvidersClaudeEditLayout'
import {AiProvidersClaudeEditPage} from '@/pages/AiProvidersClaudeEditPage'
import {AiProvidersClaudeModelsPage} from '@/pages/AiProvidersClaudeModelsPage'
import {AiProvidersCodexEditPage} from '@/pages/AiProvidersCodexEditPage'
import {AiProvidersGeminiEditPage} from '@/pages/AiProvidersGeminiEditPage'
import {AiProvidersInteractionsEditPage} from '@/pages/AiProvidersInteractionsEditPage'
import {AiProvidersMetaEditPage} from '@/pages/AiProvidersMetaEditPage'
import {AiProvidersOpenAIEditLayout} from '@/pages/AiProvidersOpenAIEditLayout'
import {AiProvidersOpenAIEditPage} from '@/pages/AiProvidersOpenAIEditPage'
import {AiProvidersOpenAIModelsPage} from '@/pages/AiProvidersOpenAIModelsPage'
import {AiProvidersVertexEditPage} from '@/pages/AiProvidersVertexEditPage'
import {AiProvidersXAIEditPage} from '@/pages/AiProvidersXAIEditPage'
import {ConfigPage} from '@/pages/ConfigPage'
import CredentialsPage from '@/pages/CredentialsPage'
import {DashboardPage} from '@/pages/DashboardPage'
import {LogsPage} from '@/pages/LogsPage'
import {ModelManagementPage} from '@/pages/ModelManagementPage'
import {NotFoundPage} from '@/pages/NotFoundPage'
import {PluginManagementPage} from '@/pages/PluginManagementPage'
import {PluginResourcePage} from '@/pages/PluginResourcePage'
import {PluginStorePage} from '@/pages/PluginStorePage'
import {SystemPage} from '@/pages/SystemPage'
import {UsagePage} from '@/pages/UsagePage'
import {type Location, useRoutes} from 'react-router'

const buildMainRoutes = (pluginsFeatureEnabled: boolean) => [
    { path: '/', element: <DashboardPage /> },
    { path: '/dashboard', element: <DashboardPage /> },

    // Unified credentials page
    { path: '/credentials', element: <CredentialsPage /> },
    { path: '/credentials/oauth-config', element: <ConfigPage key='oauth-config' scope='oauth' /> },

    // Credential edit sub-routes
    { path: '/credentials/gemini/new', element: <AiProvidersGeminiEditPage /> },
    { path: '/credentials/gemini/:index', element: <AiProvidersGeminiEditPage /> },
    { path: '/credentials/interactions/new', element: <AiProvidersInteractionsEditPage /> },
    { path: '/credentials/interactions/:index', element: <AiProvidersInteractionsEditPage /> },
    { path: '/credentials/codex/new', element: <AiProvidersCodexEditPage /> },
    { path: '/credentials/codex/:index', element: <AiProvidersCodexEditPage /> },
    { path: '/credentials/meta/new', element: <AiProvidersMetaEditPage /> },
    { path: '/credentials/meta/:index', element: <AiProvidersMetaEditPage /> },
    { path: '/credentials/xai/new', element: <AiProvidersXAIEditPage /> },
    { path: '/credentials/xai/:index', element: <AiProvidersXAIEditPage /> },
    {
        path: '/credentials/claude/new',
        element: <AiProvidersClaudeEditLayout />,
        children: [
            { index: true, element: <AiProvidersClaudeEditPage /> },
            { path: 'models', element: <AiProvidersClaudeModelsPage /> },
        ],
    },
    {
        path: '/credentials/claude/:index',
        element: <AiProvidersClaudeEditLayout />,
        children: [
            { index: true, element: <AiProvidersClaudeEditPage /> },
            { path: 'models', element: <AiProvidersClaudeModelsPage /> },
        ],
    },
    { path: '/credentials/vertex/new', element: <AiProvidersVertexEditPage /> },
    { path: '/credentials/vertex/:index', element: <AiProvidersVertexEditPage /> },
    {
        path: '/credentials/openai/new',
        element: <AiProvidersOpenAIEditLayout />,
        children: [
            { index: true, element: <AiProvidersOpenAIEditPage /> },
            { path: 'models', element: <AiProvidersOpenAIModelsPage /> },
        ],
    },
    {
        path: '/credentials/openai/:index',
        element: <AiProvidersOpenAIEditLayout />,
        children: [
            { index: true, element: <AiProvidersOpenAIEditPage /> },
            { path: 'models', element: <AiProvidersOpenAIModelsPage /> },
        ],
    },

    { path: '/models', element: <ModelManagementPage /> },
    { path: '/models/oauth-aliases', element: <ConfigPage key='oauth-aliases' scope='model-aliases' /> },
    ...(pluginsFeatureEnabled ? [
        { path: '/plugin-store', element: <PluginStorePage /> },
        { path: '/plugins', element: <PluginManagementPage /> },
        { path: '/plugin-pages/:pluginId/:resourceKey', element: <PluginResourcePage /> },
    ] : []),
    { path: '/usage', element: <UsagePage /> },
    { path: '/config', element: <ConfigPage /> },
    { path: '/logs', element: <LogsPage /> },
    { path: '/system', element: <SystemPage /> },
    { path: '*', element: <NotFoundPage /> },
]

export function MainRoutes({ location, pluginsFeatureEnabled }: {
    location?: Location;
    pluginsFeatureEnabled: boolean
}) {
    return useRoutes(buildMainRoutes(pluginsFeatureEnabled), location)
}
