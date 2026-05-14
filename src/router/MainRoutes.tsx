import { AiProvidersAmpcodeEditPage } from '@/pages/AiProvidersAmpcodeEditPage'
import { AiProvidersClaudeEditLayout } from '@/pages/AiProvidersClaudeEditLayout'
import { AiProvidersClaudeEditPage } from '@/pages/AiProvidersClaudeEditPage'
import { AiProvidersClaudeModelsPage } from '@/pages/AiProvidersClaudeModelsPage'
import { AiProvidersCodexEditPage } from '@/pages/AiProvidersCodexEditPage'
import { AiProvidersGeminiEditPage } from '@/pages/AiProvidersGeminiEditPage'
import { AiProvidersOpenAIEditLayout } from '@/pages/AiProvidersOpenAIEditLayout'
import { AiProvidersOpenAIEditPage } from '@/pages/AiProvidersOpenAIEditPage'
import { AiProvidersOpenAIModelsPage } from '@/pages/AiProvidersOpenAIModelsPage'
import { AiProvidersVertexEditPage } from '@/pages/AiProvidersVertexEditPage'
import { AuthFilesOAuthExcludedEditPage } from '@/pages/AuthFilesOAuthExcludedEditPage'
import { AuthFilesOAuthModelAliasEditPage } from '@/pages/AuthFilesOAuthModelAliasEditPage'
import { ConfigPage } from '@/pages/ConfigPage'
import CredentialsPage from '@/pages/CredentialsPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LogsPage } from '@/pages/LogsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SystemPage } from '@/pages/SystemPage'
import { UsagePage } from '@/pages/UsagePage'
import { type Location, useRoutes } from 'react-router-dom'

const mainRoutes = [
    { path: '/', element: <DashboardPage /> },
    { path: '/dashboard', element: <DashboardPage /> },

    // Unified credentials page
    { path: '/credentials', element: <CredentialsPage /> },

    // Credential edit sub-routes
    { path: '/credentials/gemini/new', element: <AiProvidersGeminiEditPage /> },
    { path: '/credentials/gemini/:index', element: <AiProvidersGeminiEditPage /> },
    { path: '/credentials/codex/new', element: <AiProvidersCodexEditPage /> },
    { path: '/credentials/codex/:index', element: <AiProvidersCodexEditPage /> },
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
    { path: '/credentials/ampcode', element: <AiProvidersAmpcodeEditPage /> },
    { path: '/credentials/oauth-excluded', element: <AuthFilesOAuthExcludedEditPage /> },
    { path: '/credentials/oauth-model-alias', element: <AuthFilesOAuthModelAliasEditPage /> },

    { path: '/usage', element: <UsagePage /> },
    { path: '/config', element: <ConfigPage /> },
    { path: '/logs', element: <LogsPage /> },
    { path: '/system', element: <SystemPage /> },
    { path: '*', element: <NotFoundPage /> },
]

export function MainRoutes({ location }: { location?: Location }) {
    return useRoutes(mainRoutes, location)
}
