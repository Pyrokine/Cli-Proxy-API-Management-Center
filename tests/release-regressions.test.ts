import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'
import {hasImageArtifactCacheChanges} from '../src/hooks/useVisualConfig.ts'
import {applyProviderQuickFill} from '../src/pages/providerQuickFill.ts'
import {normalizePluginReleaseVersions} from '../src/pages/pluginReleaseVersions.ts'
import {modelsApi} from '../src/services/api/models.ts'
import {buildPluginStoreReleasesPath} from '../src/services/api/plugins.ts'
import {useModelsStore} from '../src/stores/useModelsStore.ts'
import {summaryToCredentialEntries} from '../src/utils/usage/summaryHelpers.ts'

const systemPagePath   = fileURLToPath(new URL('../src/pages/SystemPage.tsx', import.meta.url))
const systemPageSource = readFileSync(systemPagePath, 'utf8')
const authStorePath    = fileURLToPath(new URL('../src/stores/useAuthStore.ts', import.meta.url))
const authStoreSource  = readFileSync(authStorePath, 'utf8')
const filterBarPath    = fileURLToPath(new URL('../src/components/usage/FilterBar.tsx', import.meta.url))
const filterBarSource  = readFileSync(filterBarPath, 'utf8')

describe('system runtime models', () => {
    test('loads models through the authenticated management endpoint', () => {
        expect(systemPageSource).toContain('state.runtimeModels')
        expect(systemPageSource).toContain('state.fetchRuntimeModels')
        expect(systemPageSource).toContain('state.runtimeCache')
        expect(systemPageSource).toContain('state.runtimeLoading')
        expect(systemPageSource).toContain('state.runtimeError')
        expect(systemPageSource).not.toContain("@/hooks/useApiKeysResolver")
        expect(systemPageSource).not.toContain('state.fetchModels)')
        expect(authStoreSource.match(/useModelsStore\.getState\(\)\.clearCache\(\)/g)).toHaveLength(3)
    })

    test('aborts an active runtime request when the cache clears', async () => {
        const originalFetchRuntimeModels = modelsApi.fetchRuntimeModels
        let signal: AbortSignal | undefined
        modelsApi.fetchRuntimeModels = (config) => new Promise((_, reject) => {
            signal = config?.signal
            signal?.addEventListener('abort', () => reject(new Error('runtime aborted')), {once: true})
        })
        useModelsStore.getState().clearCache()

        try {
            const request = useModelsStore.getState().fetchRuntimeModels('http://localhost:8317')
            await Promise.resolve()
            useModelsStore.getState().clearCache()

            expect(signal?.aborted).toBe(true)
            await expect(request).rejects.toThrow('runtime aborted')
            expect(useModelsStore.getState().runtimeModels).toEqual([])
            expect(useModelsStore.getState().runtimeError).toBeNull()
        } finally {
            modelsApi.fetchRuntimeModels = originalFetchRuntimeModels
            useModelsStore.getState().clearCache()
        }
    })

    test('keeps public and runtime request errors isolated', async () => {
        const originalFetchModels        = modelsApi.fetchModels
        const originalFetchRuntimeModels = modelsApi.fetchRuntimeModels
        modelsApi.fetchModels = async () => [{name: 'public-model'}]
        modelsApi.fetchRuntimeModels = async () => {
            throw new Error('runtime failed')
        }
        useModelsStore.getState().clearCache()

        try {
            await useModelsStore.getState().fetchModels('http://localhost:8317', 'client-key')
            await expect(
                useModelsStore.getState().fetchRuntimeModels('http://localhost:8317'),
            ).rejects.toThrow('runtime failed')

            const state = useModelsStore.getState()
            expect(state.models).toEqual([{name: 'public-model'}])
            expect(state.error).toBeNull()
            expect(state.runtimeModels).toEqual([])
            expect(state.runtimeError).toBe('runtime failed')
        } finally {
            modelsApi.fetchModels        = originalFetchModels
            modelsApi.fetchRuntimeModels = originalFetchRuntimeModels
            useModelsStore.getState().clearCache()
        }
    })
})

describe('usage credential filters', () => {
    test('keeps colliding source kinds as separate filter options', () => {
        expect(summaryToCredentialEntries({
            'test:abcd...wxyz [api_key]': {
                success: 1,
                failure: 0,
                provider: 'test',
                source: 'abcd...wxyz',
                source_kind: 'api_key',
                filter_key: 'test:~cpa-credential-v1:api_key:YWJjZA',
            },
            'test:abcd...wxyz [identity]': {
                success: 2,
                failure: 0,
                provider: 'test',
                source: 'abcd...wxyz',
                source_kind: 'identity',
                filter_key: 'test:~cpa-credential-v1:identity:YWJjZA',
            },
        })).toEqual([
            {
                key: 'test:abcd...wxyz [api_key]',
                filterKey: 'test:~cpa-credential-v1:api_key:YWJjZA',
                provider: 'test',
                source: 'abcd...wxyz',
                sourceKind: 'api_key',
                normalizedSourceId: 'm:ab****yz',
                success: 1,
                failure: 0,
            },
            {
                key: 'test:abcd...wxyz [identity]',
                filterKey: 'test:~cpa-credential-v1:identity:YWJjZA',
                provider: 'test',
                source: 'abcd...wxyz',
                sourceKind: 'identity',
                normalizedSourceId: 'm:ab****yz',
                success: 2,
                failure: 0,
            },
        ])
        expect(filterBarSource).toContain('const dedupeKey = entry.filterKey')
    })
})

describe('provider quick fill', () => {
    test('updates only the Base URL', () => {
        const form = {name: 'Existing Provider', baseUrl: 'https://old.example/v1', priority: 10}
        const next = applyProviderQuickFill(form, {baseUrl: 'https://new.example/v1'})

        expect(next).toEqual({
            name: 'Existing Provider',
            baseUrl: 'https://new.example/v1',
            priority: 10,
        })
    })
})

describe('visual config concurrent edits', () => {
    test('preserves a newer image artifact cache config when the user did not edit it', () => {
        const baseline = {
            imageArtifactCacheRetentionDays: '7',
            imageArtifactCacheMaxTotalSizeMb: '1024',
        }

        expect(hasImageArtifactCacheChanges({...baseline}, baseline)).toBe(false)
        expect(hasImageArtifactCacheChanges({
            ...baseline,
            imageArtifactCacheRetentionDays: '14',
        }, baseline)).toBe(true)
    })
})

describe('plugin release versions', () => {
    test('uses the authenticated plugin-store endpoint and normalizes its response', () => {
        expect(buildPluginStoreReleasesPath('sample-provider', 'private-source')).toBe(
            '/plugin-store/sample-provider/releases?source=private-source',
        )
        expect(normalizePluginReleaseVersions([
            {
                tag_name: 'v1.2.3',
                name: 'Version 1.2.3',
                published_at: '2026-07-31T00:00:00Z',
                prerelease: false,
                html_url: 'https://github.com/example/sample/releases/tag/v1.2.3',
                asset_names: ['sample_1.2.3_linux_amd64.zip'],
            },
        ])).toEqual([
            {
                tagName: 'v1.2.3',
                name: 'Version 1.2.3',
                publishedAt: '2026-07-31T00:00:00Z',
                prerelease: false,
                htmlUrl: 'https://github.com/example/sample/releases/tag/v1.2.3',
                assetNames: ['sample_1.2.3_linux_amd64.zip'],
            },
        ])
    })
})
