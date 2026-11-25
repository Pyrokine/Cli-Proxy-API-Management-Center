import type {ModelCatalogPrice} from '@/services/api/models';
import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath, URL} from 'node:url';
import {sourceCallback} from './sourceCallbacks';

import {expectSourceToContain} from './sourceContractAssertions';

const sourcePath              = fileURLToPath(
    new URL('../src/components/usage/hooks/useUsageData.ts', import.meta.url),
);
const modelManagementPath     = fileURLToPath(new URL('../src/pages/ModelManagementPage.tsx', import.meta.url));
const modelsApiPath           = fileURLToPath(new URL('../src/services/api/models.ts', import.meta.url));
const costRecalculationPath   = fileURLToPath(
    new URL('../src/components/usage/CostRecalculationCard.tsx', import.meta.url),
);
const source                  = readFileSync(sourcePath, 'utf8');
const modelManagementSource   = readFileSync(modelManagementPath, 'utf8');
const modelsApiSource         = readFileSync(modelsApiPath, 'utf8');
const costRecalculationSource = readFileSync(costRecalculationPath, 'utf8');

describe('usage model price loading', () => {
    test('loads the server price table without writing during initialization', () => {
        const effectStart          = source.indexOf('    useEffect(() => {');
        const effectEnd            = source.indexOf('    const handleExport', effectStart);
        const initializationEffect = source.slice(effectStart, effectEnd);

        expect(effectStart).toBeGreaterThan(-1);
        expect(effectEnd).toBeGreaterThan(effectStart);
        expect(initializationEffect).toContain('const loaded = await loadModelPrices()');
        expect(initializationEffect).toContain('setModelPrices(loaded)');
        expect(initializationEffect).not.toContain('saveModelPrices(');
        expect(source).not.toContain('defaultModelPrices');
    });

    test('shows durable repricing progress after model catalog price changes', () => {
        expect(modelManagementSource).toContain('const observePriceRecalculation = useCallback(');
        // noinspection JSUnresolvedReference,JSXUnresolvedComponent
        expectSourceToContain(modelManagementSource, '<CostRecalculationCard refreshKey={recalculationRefresh} />');
        expect(modelManagementSource).toContain('setRecalculationRefresh((value) => value + 1)');
        expectSourceToContain(modelManagementSource, 'const catalog = await modelsApi.patchModelCatalogModel(request)');
        expect(modelManagementSource).toContain('if (catalog.recalculation_pending)');
        expect(modelManagementSource).toContain('if (response.catalog.recalculation_pending)');
        expect(modelManagementSource).toContain('observePriceRecalculation()');
    });

    test('keeps recovered model data visible with typed source metadata', () => {
        expect(modelsApiSource).toContain(
            'export type ModelCatalogLoadSource = \'current\' | \'previous\' | \'initialized\'');
        expect(modelsApiSource).toContain('previous_models_config: string');
        expect(modelsApiSource).toContain('recovered_from_previous: boolean');
        expect(modelsApiSource).toContain('current_error?: string');
        expect(modelManagementSource).toContain('const applyCatalogResponse = useCallback(');
        expect(modelManagementSource).toContain('setCatalogMeta(catalog.meta)');
        expect(modelManagementSource).toContain('applyCatalogResponse(response.catalog)');
        expect(modelManagementSource).toContain('catalogMeta?.recovered_from_previous');
        expect(modelManagementSource).toContain('catalogMeta.current_error');
        expect(modelManagementSource).toContain('role=\'status\'');
    });

    test('polls the durable status endpoint and renders accessible progress', () => {
        expect(costRecalculationSource).toContain(
            'modelPricesApi.getRecalculationStatus({ signal: controller.signal })',
        );
        expect(costRecalculationSource).toContain('modelPricesApi.startRecalculation()');
        expect(costRecalculationSource).toContain('role=\'progressbar\'');
        expect(costRecalculationSource).toContain('aria-valuenow={progress}');
        expect(costRecalculationSource).toContain('processed_events');
        expect(costRecalculationSource).toContain('rollup_done_days');
        expect(costRecalculationSource).toContain('status.status !== \'ok\' && status.error');
        expect(costRecalculationSource).toContain('status.status !== \'ok\' && status.restart_reason');
    });

    test('keeps price writes in the explicit save handler', () => {
        const handlerStart = source.indexOf('    const handleSetModelPrices = useCallback(');
        const handlerEnd   = source.indexOf('    const usage', handlerStart);
        const saveHandler  = source.slice(handlerStart, handlerEnd);

        expect(handlerStart).toBeGreaterThan(-1);
        expect(handlerEnd).toBeGreaterThan(handlerStart);
        expect(saveHandler).toContain('await saveModelPrices(prices)');
        expect(saveHandler).toContain('result.recalculation_pending');
        expect(saveHandler).toContain('await modelPricesApi.waitForRecalculation()');
        expect(saveHandler).toContain('await handleAfterPricesSaved()');
    });

    test('preserves untouched manifest metadata and defaults new price metadata', () => {
        const file                           = 'pages/ModelManagementPage.tsx';
        const scope: Record<string, unknown> = {};
        for (const name of ['priceInput', 'priceToInputs']) {
            scope[name] = sourceCallback(file, name, scope);
        }
        const parsePrice                  = sourceCallback<(
            input: string, output: string, cacheRead: string, cacheWrite: string, cache5m: string, cache1h: string,
            original?: ModelCatalogPrice,
        ) => { ok: boolean; price?: ModelCatalogPrice | null }>(file, 'parseOptionalPrice', scope);
        const original: ModelCatalogPrice = {
            prompt: 1, completion: 2, cache_write_5m: 0, cache_write_1h: 3,
            status: 'partial', auto_apply: false, currency: 'USD', source: 'reference-fixture',
            checked_at: '2026-11-01', limitations: ['reference only'],
        };
        expect(parsePrice('1', '2', '', '', '0', '3', original).price).toBe(original);
        const edited = parsePrice('4', '2', '', '', '', '', original);
        expect(edited.ok).toBe(true);
        expect(edited.price).toMatchObject({
                                               prompt: 4,
                                               completion: 2,
                                               status: 'partial',
                                               auto_apply: false,
                                               currency: 'USD',
                                               source: original.source,
                                               checked_at: original.checked_at,
                                               limitations: original.limitations,
                                           });
        expect(edited.price).not.toHaveProperty('cache_write_5m');
        expect(edited.price).not.toHaveProperty('cache_write_1h');
        expect(parsePrice('4', '', '', '', '', '', { prompt: 1 })).toEqual({ ok: true, price: { prompt: 4 } });
        expect(parsePrice('4', '', '', '', '', '')).toEqual({
                                                                ok: true,
                                                                price: {
                                                                    prompt: 4,
                                                                    status: 'complete',
                                                                    auto_apply: true,
                                                                    currency: 'USD',
                                                                },
                                                            });
        expect(modelManagementSource).toContain('editDraft.originalPrice');
        expect(modelManagementSource).toContain('value={editDraft.cacheWrite5m}');
        expect(modelManagementSource).toContain('value={editDraft.cacheWrite1h}');
        expect(modelManagementSource).toContain('value={addDraft.cacheWrite5m}');
        expect(modelManagementSource).toContain('value={addDraft.cacheWrite1h}');
    });

    test('defines model pricing and request cost states in every supported locale', () => {
        const keys      = [
            'cache_read_price',
            'cache_write_price',
            'cache_write_5m_price',
            'cache_write_1h_price',
            'cache_write_5m_price_short',
            'cache_write_1h_price_short',
            'price_status_unpriced',
            'price_source',
            'runtime_clients_summary',
            'status_runtime_only',
            'not_requestable_quota_cooldown',
            'not_requestable_suspended',
            'recovery_warning_title',
            'recovery_warning_detail',
            'recovery_warning_error',
        ];
        const usageKeys = [
            'request_events_cost',
            'request_events_cache_read_short',
            'request_events_cache_write_short',
            'request_events_pricing_receipt',
            'request_events_pricing_provider',
            'request_events_pricing_model',
            'request_events_pricing_source',
            'request_events_pricing_revision',
            'request_events_pricing_request_cost',
            'request_events_pricing_current_cost',
            'request_events_pricing_effective',
            'request_events_pricing_request_short',
            'request_events_pricing_recalculated',
            'request_events_pricing_unpriced',
            'request_events_pricing_million_tokens',
            'request_events_pricing_category_uncached_input',
            'request_events_pricing_category_cache_read',
            'request_events_pricing_category_cache_write_5m',
            'request_events_pricing_category_cache_write_1h',
            'request_events_pricing_category_cache_write_unknown',
            'request_events_pricing_category_output',
            'request_events_pricing_category_reasoning',
            'request_events_pricing_category_unclassified',
        ];
        for (const localeName of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const locale = JSON.parse(
                readFileSync(new URL(`../src/i18n/locales/${localeName}.json`, import.meta.url), 'utf8'),
            );
            for (const key of keys) {
                expect(locale.model_management[key]).toBeTruthy();
                expect(locale.model_management[key]).not.toBe(key);
            }
            for (const key of usageKeys) {
                expect(locale.usage_stats[key]).toBeTruthy();
                expect(locale.usage_stats[key]).not.toBe(key);
            }
        }
    });
});
