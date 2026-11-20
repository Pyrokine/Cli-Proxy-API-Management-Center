import {
    createUsageEventExport,
    USAGE_EVENT_EXPORT_PAGE_SIZE,
    UsageEventExportLimitError,
} from '@/components/usage/usageEventExport'
import type {EventsResponse} from '@/services/api/usage'
import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const eventFile = 'components/usage/RequestEventsDetailsCard.tsx'

async function importExportFile(text: string, format: string, expectedCount: number): Promise<string> {
    let onConfirm: (() => Promise<void>) | undefined
    let imported: unknown
    const handleImportChange = sourceInitializer<(event: unknown) => Promise<void>>(
        'components/usage/hooks/useUsageData.ts',
        'handleImportChange',
        {
            showNotification: (message: string, kind: string) => {
                if (kind === 'error') {
                    throw new Error(message)
                }
            },
            t: (key: string, options?: { count?: number }) => key === 'usage_stats.import_confirm_message' ?
                                                              String(options?.count) :
                                                              key,
            showConfirmation: (options: { message: string; onConfirm: () => Promise<void> }) => {
                if (options.message !== String(expectedCount)) {
                    throw new Error(`Wrong import count ${options.message}, expected ${expectedCount}`)
                }
                onConfirm = options.onConfirm
            },
            // noinspection JSUnusedGlobalSymbols
            'setImporting': () => {
            }, usageApi: {
                importUsage: async (payload: unknown) => {
                    imported = payload;
                    return { added: 0 }
                },
            },
            addPersistentNotification: () => {
            }, loadUsageStats: async () => {
            }, USAGE_STATS_STALE_TIME_MS: 0, onAfterImport: undefined,
        },
    )
    await handleImportChange({
                                 target: {
                                     files: [{ name: `synthetic.${format}`, text: async () => text }],
                                     value: '',
                                 },
                             })
    if (!onConfirm) {
        throw new Error('File import did not reach confirmation')
    }
    await onConfirm()
    return typeof imported === 'string' ? imported : JSON.stringify(imported)
}

async function exportResponses(pages: EventsResponse[]) {
    const exports: Record<string, string> = {}
    for (const format of ['json', 'csv'] as const) {
        const exportEvents = sourceCallback<(format: string) => Promise<void>>(eventFile, 'exportEvents', {
            exportControllerRef: { current: null }, setExportingFormat: () => {
            }, sourceInfoMap: {},
            authFileMap: new Map(), i18n: { language: 'en' }, noApiKeyLabel: '', notRecordedLabel: '',
            modelAliasLookup: {}, t: (key: string) => key, aliases: {},
            eventToRow: (event: EventsResponse['events'][number]) => ({
                user: 'Display alias',
                requestId: event.request_id ?? '',
                completed: event.completed,
                latencyMs: event.latency_ms,
                timeToFirstByteMs: event.time_to_first_byte_ms,
                totalDurationMs: event.total_duration_ms,
                thinking: event.thinking,
                inputTokens: event.tokens.input_tokens,
                outputTokens: event.tokens.output_tokens,
                reasoningTokens: event.tokens.reasoning_tokens,
                cachedTokens: event.tokens.cached_tokens,
                totalTokens: event.tokens.total_tokens,
                cost: event.cost,
                clientModel: event.client_model,
                upstreamUrl: event.upstream_url,
                upstreamModel: event.upstream_model,
                responseModel: event.response_model,
                responseProvider: event.response_provider,
                responseProviderSource: event.response_provider_source,
                requestServiceTier: event.request_service_tier ?? event.service_tier,
                responseServiceTier: event.response_service_tier,
                requestSpeed: event.request_speed,
                responseSpeed: event.response_speed,
            }),
            createUsageEventExport, UsageEventExportLimitError, USAGE_EVENT_EXPORT_PAGE_SIZE,
            USAGE_EVENT_CSV_HEADER: sourceInitializer(eventFile, 'USAGE_EVENT_CSV_HEADER', {}),
            usageApi: {
                getEvents: async (params: { page: number; export?: boolean }) => {
                    if (!params.export) {
                        throw new Error('Export did not request canonical data')
                    }
                    return pages[params.page - 1]
                },
            },
            buildExportParams: (page: number) => ({ page }), normalizeUsageThinking: (thinking: unknown) => thinking,
            sanitizeUpstreamUrl: sourceCallback(eventFile, 'sanitizeUpstreamUrl', {}),
            observedRequestSpeed: sourceCallback(eventFile, 'observedRequestSpeed', {}),
            encodeCsv: sourceInitializer(eventFile, 'encodeCsv', {}),
            downloadBlob: async ({ blob }: { blob: Blob }) => {
                exports[format] = await blob.text()
            },
            showNotification: (message: string, kind: string) => {
                if (kind === 'error') {
                    throw new Error(message)
                }
            },
        })
        await exportEvents(format)
        // downloadBlob is synchronous in the app; let the test's Blob.text finish.
        await Promise.resolve()
        if (!exports[format]) {
            throw new Error(`Missing ${format} export`)
        }
        exports[format] = await importExportFile(exports[format], format, pages[0].total)
    }
    return exports
}

async function sizeConsumerStates(responses: { status: number; body: { error?: string; size_bytes?: number } }[]) {
    let current = responses[0]

    const usageApi = {
        getRetention: async () => ({ days: -1, max_db_size_mb: 1 }), getDBSize: async () => {
            if (current.status !== 200) {
                throw new Error(current.body.error ?? 'Size unavailable')
            }
            return current.body
        },
    }

    let loadError: string | null = null

    let size: number | null = null

    let runtime: { usageDbSize?: { status: string; sizeBytes?: number } } = {}

    const loadRetention = sourceCallback<() => Promise<void>>(
        'components/usage/UsageRetentionCard.tsx',
        'loadRetention',
        {
            usageApi, setLoading: () => {
            }, setLoadError: (value: string | null) => {
                loadError = value
            },
            setRetention: () => {
            }, setDraft: () => {
            }, toDraft: () => ({}),
            setDbSize: (value: number | null) => {
                size = value
            }, setDbMaxSize: () => {
            },
            setDbSizeWarning: () => {
            }, setDbSizeCapped: () => {
            }, t: (key: string) => key,
        },
    )

    const loadRuntimeInfo = sourceCallback<() => Promise<void>>(
        'pages/ConfigPage.tsx',
        'loadRuntimeInfo',
        {
            isCurrentConnection: () => true, runtimeRequestSequenceRef: { current: 0 },
            apiClient: { getAuthGeneration: () => 1 }, usageApi,
            logsApi: { fetchLogSize: async () => ({ total_bytes: 0 }) },
            artifactsApi: { fetchImageArtifactCacheSize: async () => ({ total_bytes: 0 }) },
            setRuntimeInfo: (value: typeof runtime) => {
                runtime = value
            },
        },
    )

    const states: { loadError: string | null; size: number | null; runtime: typeof runtime }[] = []
    for (const response of responses) {
        current = response
        await loadRetention()
        await loadRuntimeInfo()
        states.push({ loadError, size, runtime })
    }
    return states
}

if (process.argv.includes('--size-fixture')) {
    process.stdout.write(JSON.stringify(await sizeConsumerStates(JSON.parse(readFileSync(0, 'utf8')))))
} else if (process.argv.includes('--export-fixture')) {
    const pages = JSON.parse(readFileSync(0, 'utf8')) as EventsResponse[]
    process.stdout.write(JSON.stringify(await exportResponses(pages)))
} else {
    describe('usage export/import consumers', () => {
        test('shows size failures in both existing pages and restores measured bytes', async () => {
            const states = await sizeConsumerStates([
                                                        {
                                                            status: 500,
                                                            body: { error: 'failed to read usage database size' },
                                                        }, { status: 200, body: { size_bytes: 7 } },
                                                    ])
            expect(states[0]).toMatchObject({ size: null, runtime: { usageDbSize: { status: 'error' } } })
            expect(states[0].loadError).toContain('failed to read usage database size')
            expect(states[1]).toMatchObject({
                                                size: 7,
                                                loadError: null,
                                                runtime: { usageDbSize: { status: 'ready', sizeBytes: 7 } },
                                            })
        })
        test('retains authenticated canonical data, request ID and auth index in both formats', async () => {
            // cspell:ignoreRegExp /disp\.\.\.ayed/g
            // noinspection SpellCheckingInspection
            const events = [
                {
                    timestamp: '2026-11-09T01:02:03.123456789Z', model: 'fixture', source: 'display',
                    auth_index: 'fixture-auth', api_key: 'disp...ayed', request_id: 'fixture-request',
                    import_data: 'fixture-sealed-canonical-data', raw_api_key: 'sha256:fixture',
                    tokens: {
                        input_tokens: 2,
                        output_tokens: 3,
                        cached_tokens: 0,
                        reasoning_tokens: 0,
                        total_tokens: 5,
                    }, failed: false,
                },
            ]
            const result = await exportResponses([{ events, total: 1, page: 1, page_size: 500, total_pages: 1 }])
            for (const text of Object.values(result)) {
                expect(text).toContain('fixture-sealed-canonical-data')
                expect(text).toContain('fixture-request')
                expect(text).toContain('fixture-auth')
            }
        })
    })
}
