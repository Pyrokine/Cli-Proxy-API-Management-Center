import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'
import {hasImageArtifactCacheChanges} from '@/hooks/useVisualConfig'
import {normalizePluginReleaseVersions} from '@/pages/pluginReleaseVersions'
import {getPluginLogo} from '@/pages/pluginResources'
import {applyProviderQuickFill} from '@/pages/providerQuickFill'
import {modelsApi} from '@/services/api/models'
import {buildPluginStoreReleasesPath, type PluginEntry, type PluginStoreEntry} from '@/services/api/plugins'
import {useModelsStore} from '@/stores/useModelsStore'
import {summaryToCredentialEntries} from '@/utils/usage/summaryHelpers'

const systemPagePath        = fileURLToPath(new URL('../src/pages/SystemPage.tsx', import.meta.url))
const systemPageSource      = readFileSync(systemPagePath, 'utf8')
const authStorePath         = fileURLToPath(new URL('../src/stores/useAuthStore.ts', import.meta.url))
const authStoreSource       = readFileSync(authStorePath, 'utf8')
const protectedRoutePath    = fileURLToPath(new URL('../src/router/ProtectedRoute.tsx', import.meta.url))
const protectedRouteSource  = readFileSync(protectedRoutePath, 'utf8')
const loginPagePath         = fileURLToPath(new URL('../src/pages/LoginPage.tsx', import.meta.url))
const loginPageSource       = readFileSync(loginPagePath, 'utf8')
const mainLayoutPath        = fileURLToPath(new URL('../src/components/layout/MainLayout.tsx', import.meta.url))
const mainLayoutSource      = readFileSync(mainLayoutPath, 'utf8')
const credentialsPageSource = readFileSync(
    fileURLToPath(new URL('../src/pages/CredentialsPage.tsx', import.meta.url)),
    'utf8',
)
const vendorSectionSource   = readFileSync(
    fileURLToPath(new URL('../src/components/credentials/VendorSection.tsx', import.meta.url)),
    'utf8',
)
const filterBarPath         = fileURLToPath(new URL('../src/components/usage/FilterBar.tsx', import.meta.url))
const filterBarSource       = readFileSync(filterBarPath, 'utf8')
const packageJson           = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { packageManager?: string }
const releaseWorkflowSource = readFileSync(
    fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url)),
    'utf8',
)

describe('release toolchain', () => {
    test('uses the packageManager Bun version in the release workflow', () => {
        const packageManager = packageJson.packageManager ?? ''
        expect(packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/)
        const bunVersion = packageManager.slice('bun@'.length)
        expect(releaseWorkflowSource).toContain(`bun-version: '${bunVersion}'`)
    })
})

describe('system runtime models', () => {
    test('loads models through the authenticated management endpoint', () => {
        expect(systemPageSource).toContain('state.runtimeModels')
        expect(systemPageSource).toContain('state.fetchRuntimeModels')
        expect(systemPageSource).toContain('state.runtimeCache')
        expect(systemPageSource).toContain('state.runtimeLoading')
        expect(systemPageSource).toContain('state.runtimeError')
        expect(systemPageSource).not.toContain('@/hooks/useApiKeysResolver')
        expect(systemPageSource).not.toContain('state.fetchModels)')
        expect(authStoreSource.match(/useModelsStore\.getState\(\)\.clearCache\(\)/g)).toHaveLength(3)
    })

    test('aborts an active runtime request when the cache clears', async () => {
        const originalFetchRuntimeModels = modelsApi.fetchRuntimeModels
        let signal: AbortSignal | undefined
        modelsApi.fetchRuntimeModels     = (config) => new Promise((_, reject) => {
            signal = config?.signal as AbortSignal | undefined
            signal?.addEventListener('abort', () => reject(new Error('runtime aborted')), { once: true })
        })
        useModelsStore.getState().clearCache()

        try {
            const request = useModelsStore.getState().fetchRuntimeModels('http://localhost:8317')
            await Promise.resolve()
            useModelsStore.getState().clearCache()

            expect(signal?.aborted).toBe(true)
            // noinspection ES6RedundantAwait
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
        modelsApi.fetchModels            = async () => [{ name: 'public-model' }]
        modelsApi.fetchRuntimeModels     = async () => {
            throw new Error('runtime failed')
        }
        useModelsStore.getState().clearCache()

        try {
            await useModelsStore.getState().fetchModels('http://localhost:8317', 'client-key')
            // noinspection ES6RedundantAwait
            await expect(
                useModelsStore.getState().fetchRuntimeModels('http://localhost:8317'),
            ).rejects.toThrow('runtime failed')

            const state = useModelsStore.getState()
            expect(state.models).toEqual([{ name: 'public-model' }])
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

describe('system version checks', () => {
    test('avoids transition duplicates and reuses the release cache for silent checks', () => {
        expect(systemPageSource).toContain(`useEffect(() => {
        let cancelled = false
        queueMicrotask(() => {
            if (!cancelled && pageLayerStatus === 'current') {
                void handleVersionCheck({ silent: true })`)
        expect(systemPageSource).toContain('releasesApi.list(1, 1, \'panel\', !silent)')
    })
})

describe('management authentication lifecycle', () => {
    test('deduplicates automatic restore and handles rate limits explicitly', () => {
        expect(authStoreSource).toContain('sessionRestoreStatus: \'restoring\'')
        expect(authStoreSource).toContain('currentStatus === \'failed\' || currentStatus === \'skipped\'')
        expect(protectedRouteSource).not.toContain('checkAuth')
        expect(loginPageSource).toContain('rateLimitDeadlineFromError')
        expect(loginPageSource).toContain('disabled={rateLimitRemaining > 0}')
    })

    test('keeps unavailable secret storage in memory and prevents repeated 401 restore', () => {
        expect(authStoreSource).toContain('storagePersistenceFailed')
        expect(authStoreSource).toContain('storageClearFailed')
        expect(authStoreSource).toContain('STORAGE_KEY_AUTH_INVALIDATED')
        expect(authStoreSource).toContain('STORAGE_KEY_AUTH_CREDENTIALS')
        expect(authStoreSource).toContain('STORAGE_KEY_AUTH_INTENT')
        expect(authStoreSource).toContain('STORAGE_KEY_AUTH_TRANSACTION')
        expect(authStoreSource).toContain('AUTH_STORAGE_LOCK_NAME')
        expect(authStoreSource).toContain('withAuthStorageLock')
        expect(authStoreSource).toContain('await storeAuthentication(')
        expect(authStoreSource).toContain('await invalidateAuthenticationForActiveTransaction()')
        expect(authStoreSource).toContain('EXPECTED_AUTH_STORAGE_TRANSACTION')
        expect(authStoreSource).toContain('transactionId: transaction.id')
        expect(authStoreSource).toContain('matchAuthStorageTransaction')
        expect(authStoreSource).toContain('onUnreadableValue: markPersistedAuthUnreadable')
        expect(authStoreSource).toContain('(error as Partial<ApiError>).status === 401')
        expect(authStoreSource).toContain('invalidateStoredAuthentication()')
        expect(loginPageSource).toContain('disabled={insecureStorage}')
        expect(loginPageSource).toContain('t(\'login.storage_clear_failed\')')
        expect(loginPageSource).toContain('(error as Partial<ApiError>).status === 401')
        expect(loginPageSource.indexOf('rateLimitsApi.getStatus')).toBeLessThan(
            loginPageSource.lastIndexOf('showNotification(t(\'common.connected_status\'), \'success\')'),
        )
    })

    test('groups the sidebar and shows the live credential summary badge', () => {
        expect(mainLayoutSource).toContain('const navSections')
        expect(mainLayoutSource).toContain('navSections.flatMap((section) => section.items)')
        expect(mainLayoutSource).toContain('key: \'configuration\'')
        expect(mainLayoutSource).toContain('key: \'extensions\'')
        expect(mainLayoutSource).toContain('key: \'observability\'')
        expect(mainLayoutSource).toContain('useAuthFilesSummaryStore')
        expect(mainLayoutSource).toContain('badge: credentialsCount')
        expect(mainLayoutSource).toContain('countCredentialCards(config, authFilesCount)')
        expect(mainLayoutSource).toContain('[config, authFilesCount]')
        expect(mainLayoutSource).toContain('title={item.label}')
        expect(authStoreSource).toContain('useAuthFilesSummaryStore.getState().clear()')
        expect(authStoreSource).toContain('clearAuthFileModelsCache()')
    })

    test('connects lifecycle helpers to the current unified Credentials UI', () => {
        expect(credentialsPageSource).toContain('completeMutation')
        expect(credentialsPageSource).toContain('downloadAuthFilesBatch')
        expect(credentialsPageSource).toContain('onAuthFileMutation={completeMutation}')
        expect(vendorSectionSource).toContain('useAuthFilesPrefixProxyEditor')
        expect(vendorSectionSource).toContain('deriveAuthFileIdentity')
        expect(vendorSectionSource).toContain('uploadInFlight')
        expect(vendorSectionSource).not.toContain('AuthFileModelsModal')
    })
})

describe('usage credential filters', () => {
    test('keeps colliding source kinds as separate filter options', () => {
        expect(summaryToCredentialEntries({
                                              'test:abcd...tail [api_key]': {
                                                  success: 1,
                                                  failure: 0,
                                                  provider: 'test',
                                                  source: 'abcd...tail',
                                                  source_kind: 'api_key',
                                                  filter_key: 'test:~cpa-credential-v1:api_key:YWJjZA',
                                              },
                                              'test:abcd...tail [identity]': {
                                                  success: 2,
                                                  failure: 0,
                                                  provider: 'test',
                                                  source: 'abcd...tail',
                                                  source_kind: 'identity',
                                                  filter_key: 'test:~cpa-credential-v1:identity:YWJjZA',
                                              },
                                          })).toEqual([
                                                          {
                                                              key: 'test:abcd...tail [api_key]',
                                                              filterKey: 'test:~cpa-credential-v1:api_key:YWJjZA',
                                                              provider: 'test',
                                                              source: 'abcd...tail',
                                                              sourceKind: 'api_key',
                                                              normalizedSourceId: 'm:ab****il',
                                                              success: 1,
                                                              failure: 0,
                                                          },
                                                          {
                                                              key: 'test:abcd...tail [identity]',
                                                              filterKey: 'test:~cpa-credential-v1:identity:YWJjZA',
                                                              provider: 'test',
                                                              source: 'abcd...tail',
                                                              sourceKind: 'identity',
                                                              normalizedSourceId: 'm:ab****il',
                                                              success: 2,
                                                              failure: 0,
                                                          },
                                                      ])
        expect(filterBarSource).toContain('const dedupeKey = entry.filterKey')
    })
})

describe('provider quick fill', () => {
    test('updates only the Base URL', () => {
        const form = { name: 'Existing Provider', baseUrl: 'https://old.example/v1', priority: 10 }
        const next = applyProviderQuickFill(form, { baseUrl: 'https://new.example/v1' })

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

        expect(hasImageArtifactCacheChanges({ ...baseline }, baseline)).toBe(false)
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

    test('fills installed plugin logos only from an unambiguous matching store entry', () => {
        const plugin = {
            id: 'sample', logo: '', metadata: {logo: '', github_repository: 'Example/Sample.git'},
        } as PluginEntry
        const first = {id: 'sample', repository: 'https://github.com/example/sample', logo: '/sample.svg'} as PluginStoreEntry
        const other = {id: 'sample', repository: 'https://github.com/other/sample', logo: '/other.svg'} as PluginStoreEntry
        expect(getPluginLogo(plugin, [first, other])).toBe('/sample.svg')
        expect(getPluginLogo({...plugin, metadata: {...plugin.metadata!, github_repository: ''}}, [first, other])).toBe('')
        expect(getPluginLogo({...plugin, logo: '/installed.svg'}, [first])).toBe('/installed.svg')
        expect(getPluginLogo({...plugin, metadata: null}, [first])).toBe('/sample.svg')
        const page = readFileSync(new URL('../src/pages/PluginManagementPage.tsx', import.meta.url), 'utf8')
        expect(page).toContain('pluginStoreApi.list({signal: controller.signal, timeout: 15_000})')
        expect(page).toContain('resolvePluginAssetURL(getPluginLogo(plugin, logoEntries), apiBase)')
        expect(page).toContain('currentStoreLogos?.error')
    })
})
