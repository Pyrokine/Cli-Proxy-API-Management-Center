import {ModelStatsCard} from '@/components/usage/ModelStatsCard'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {usageApi, type UsageSummary} from '@/services/api/usage'
import {type ModelStat, summaryToApiKeyStats, summaryToModelStats} from '@/utils/usage/summaryHelpers'
import {expect, spyOn, test} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback} from './sourceCallbacks'

const tokens = { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 }
const raw    = {
    requests: 3,
    success: 3,
    failure: 0,
    tokens,
    cost: 0,
    average_latency_ms: 100,
    total_latency_ms: 300,
    latency_sample_count: 3,
}

test('model and API Key adapters keep the actual total and zero-millisecond samples', () => {
    expect(summaryToModelStats({ synthetic: raw })[0]).toMatchObject({
                                                                         averageLatencyMs: 100,
                                                                         totalLatencyMs: 300,
                                                                         latencySampleCount: 3,
                                                                     })
    expect(summaryToApiKeyStats(
        { synthetic: { ...raw, average_latency_ms: 0, total_latency_ms: 0 } },
        { synthetic: 'Client name' },
    )[0]).toMatchObject({ model: 'Client name', averageLatencyMs: 0, totalLatencyMs: 0, latencySampleCount: 3 })
})

test('visible latency summary uses the complete sample denominator including a zero-millisecond row', () => {
    const rows = summaryToModelStats({
                                         zero: {
                                             ...raw,
                                             requests: 1,
                                             success: 1,
                                             average_latency_ms: 0,
                                             total_latency_ms: 0,
                                             latency_sample_count: 1,
                                         },
                                         other: {
                                             ...raw,
                                             requests: 2,
                                             success: 2,
                                             average_latency_ms: 150,
                                             total_latency_ms: 300,
                                             latency_sample_count: 2,
                                         },
                                     })
    const html = renderToStaticMarkup(<ModelStatsCard modelStats={rows} loading={false} hasPrices={false} />)
    expect(html).toContain(`${i18n.t('usage_stats.avg_time')}: 100ms`)
    expect(html).toContain(`${i18n.t('usage_stats.total_time')}: 300ms`)
})

test('all-zero samples display a zero mean and total instead of disappearing', () => {
    const rows = summaryToApiKeyStats({
                                          synthetic: {
                                              ...raw,
                                              average_latency_ms: 0,
                                              total_latency_ms: 0,
                                              latency_sample_count: 3,
                                          },
                                      })
    const html = renderToStaticMarkup(<ModelStatsCard modelStats={rows} loading={false} hasPrices={false} />)
    expect(html).toContain(`${i18n.t('usage_stats.avg_time')}: 0ms`)
    expect(html).toContain(`${i18n.t('usage_stats.total_time')}: 0ms`)
    expect(html).not.toContain('NaN')
})

test('legacy mean-only rows remain usable while missing total is explicitly unknown', () => {
    const rows: ModelStat[] = [
        {
            model: 'legacy',
            requests: 1,
            successCount: 1,
            failureCount: 0,
            tokens: 0,
            cost: 0,
            averageLatencyMs: 0,
            latencySampleCount: 1,
        },
    ]
    const html              = renderToStaticMarkup(<ModelStatsCard modelStats={rows} loading={false}
                                                                   hasPrices={false} />)
    expect(html).toContain(`${i18n.t('usage_stats.avg_time')}: 0ms`)
    expect(html).toContain(`${i18n.t('usage_stats.total_time')}: --`)
})

for (const scenario of [
    {
        name: 'zero plus ten plus unknown',
        requests: 3,
        latency: { average_latency_ms: 5, total_latency_ms: 10, latency_sample_count: 2 },
        average: '5ms',
        total: '10ms',
    },
    {
        name: 'zero plus unknown', requests: 2,
        latency: { average_latency_ms: 0, total_latency_ms: 0, latency_sample_count: 1 }, average: '0ms', total: '0ms',
    },
    { name: 'unknown and null', requests: 2, latency: {}, average: null, total: null },
]) {
    test(`filtered summary ${scenario.name} reaches both actual overview latency summaries`, async () => {
        const params                 = sourceCallback<() => Parameters<typeof usageApi.getSummary>[0]>(
            'pages/UsagePage.tsx',
            'summaryParams',
            {
                effectiveDateFrom: '2026-11-06T08:00:00Z',
                effectiveDateTo: '2026-11-06T10:00:00Z',
                selectedModels: ['filtered-model'],
                selectedApiKeys: ['synthetic-client'],
                selectedCredentials: ['synthetic-credential'],
                summaryGranularity: 'hourly',
                chartDimension: 'total',
            },
        )()
        const row                    = {
            requests: scenario.requests,
            success: scenario.requests,
            failure: 0,
            tokens,
            cost: 0, ...scenario.latency,
        }
        const response: UsageSummary = {
            period: { from: params!.from!, to: params!.to! }, totals: row,
            by_model: { 'filtered-model': row }, by_api_key: { 'synthetic-client': row }, by_credential: {},
            time_series: [], time_series_by_model: {}, time_series_by_credential: {}, time_series_by_api_key: {},
        }
        const get                    = spyOn(apiClient, 'get').mockResolvedValue(response)
        try {
            const summary = await usageApi.getSummary(params)
            const query   = new URL(get.mock.calls[0][0], 'https://fixture.invalid').searchParams
            expect(query.get('from')).toBe('2026-11-06T08:00:00Z')
            expect(query.get('to')).toBe('2026-11-06T10:00:00Z')
            expect(query.get('model')).toBe('filtered-model')
            expect(query.getAll('api_key')).toEqual(['synthetic-client'])
            expect(query.get('credential')).toBe('synthetic-credential')
            const hiddenChart = () => null
            const overview    = sourceCallback<(props: {
                summary: UsageSummary;
                loading: boolean;
                aliases: Record<string, string>
            }) => React.ReactElement>(
                'components/usage/OverviewTab.tsx', 'OverviewTab', {
                    React,
                    useTranslation: () => ({ t: i18n.t.bind(i18n) }),
                    useMemo: <T, >(calculate: () => T) => calculate(),
                    // noinspection JSUnusedGlobalSymbols
                    'summaryToModelStats': summaryToModelStats,
                    // noinspection JSUnusedGlobalSymbols
                    'summaryToApiKeyStats': summaryToApiKeyStats,
                    // noinspection JSUnusedGlobalSymbols
                    'ModelStatsCard': ModelStatsCard,
                    styles: {},
                    UnifiedTrendChart: hiddenChart,
                    ServiceHealthCard: hiddenChart,
                    CredentialStatsCard: hiddenChart,
                    TokenBreakdownChart: hiddenChart,
                })
            const html        = renderToStaticMarkup(overview({
                                                                  summary,
                                                                  loading: false,
                                                                  aliases: { 'synthetic-client': 'Visible client' },
                                                              }))
            expect(html).toContain('filtered-model')
            expect(html).toContain('Visible client')
            if (scenario.average === null) {
                expect(html).not.toContain(`${i18n.t('usage_stats.avg_time')}:`)
                expect(html).not.toContain(`${i18n.t('usage_stats.total_time')}:`)
            } else {
                expect(html.split(`${i18n.t('usage_stats.avg_time')}: ${scenario.average}`)).toHaveLength(3)
                expect(html.split(`${i18n.t('usage_stats.total_time')}: ${scenario.total}`)).toHaveLength(3)
            }
        } finally {
            get.mockRestore()
        }
    })
}
