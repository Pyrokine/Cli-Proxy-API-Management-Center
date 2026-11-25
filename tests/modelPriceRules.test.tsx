import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import {
    parsePriceRules,
    priceBoundary,
    type PriceRulesDraft,
    priceRulesSignature,
    priceRulesToInputs,
    TOKEN_RATE_FIELDS,
    withPriceRules,
} from '@/pages/modelPriceRules'
import {ModelPriceRulesEditor} from '@/pages/ModelPriceRulesEditor'
import {apiClient} from '@/services/api/client'
import {type ModelCatalogPatchRequest, type ModelCatalogPrice, modelsApi} from '@/services/api/models'
import {REQUEST_SPEEDS} from '@/services/api/usage'
import {expect, spyOn, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import React, {type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file                           = 'pages/ModelManagementPage.tsx'
const noop                           = () => {
}
const t                              = ((key: string) => key) as Parameters<typeof ModelPriceRulesEditor>[0]['t']
const scope: Record<string, unknown> = {
    REQUEST_SPEEDS, parsePriceRules, priceBoundary, priceRulesSignature, priceRulesToInputs, withPriceRules,
    SPEED_RATE_BUCKETS: sourceInitializer(file, 'SPEED_RATE_BUCKETS', {}),
}
for (const name of
    [
        'priceInput',
        'priceToInputs',
        'parseOptionalPrice',
        'speedRatesToInputs',
        'speedRatesSignature',
        'parseSpeedRates',
        'modelKey',
        'uniqueSorted',
        'parseAliases',
    ]) {
    scope[name] = sourceCallback(file, name, scope)
}
type BaseInputs = {
    prompt: string;
    completion: string;
    cacheRead: string;
    cacheWrite: string;
    cacheWrite5m: string;
    cacheWrite1h: string;
    cacheWrite30m: string;
    cacheWrite12h: string
}
type Draft = BaseInputs & {
    originalModel: string; model: string; displayName: string; provider: string; channel: string; group: string;
    aliasesText: string; originalPrice: ModelCatalogPrice | null; priceRules: PriceRulesDraft;
    speedRates: unknown[]; enabled: boolean;
    original: Pick<Draft, 'displayName' | 'provider' | 'channel' | 'group' | 'enabled'>;
}
const baseInputs                                                               = scope.priceToInputs as (price: ModelCatalogPrice | null) => BaseInputs
const parseBase                                                                = scope.parseOptionalPrice as (
    prompt: string,
    completion: string,
    cacheRead: string,
    cacheWrite: string,
    cacheWrite5m: string,
    cacheWrite1h: string,
    original?: ModelCatalogPrice | null,
    cacheWrite30m?: string,
    cacheWrite12h?: string,
) => { ok: boolean; price?: ModelCatalogPrice | null }
const original: ModelCatalogPrice & { future_metadata: { retained: boolean } } = {
    prompt: 1, completion: 2, cache_write_30m: 0, cache_write_12h: 4,
    status: 'partial', auto_apply: false, currency: 'USD', source: 'synthetic-source', checked_at: '2026-11-01',
    limitations: ['synthetic-limit'], effective_from: '2026-01-01', effective_until: '2026-12-31',
    region: 'synthetic-region', service_tier: 'synthetic-tier', future_metadata: { retained: true },
    utc_rate_bands: [{ weekdays: ['mon'], start: '01:00', end: '02:00', prompt: 0.5 }],
    speed_rates: [
        {
            speed: 'fast',
            multiplier: 2,
            multipliers: { cache_write_30m: 0, cache_write_12h: 3 },
            source: 'synthetic-speed',
        },
    ],
    conditional_rates: [
        {
            id: 'long-input', provider: 'synthetic-provider', min_input_tokens: 200001, max_input_tokens: 300000,
            speed: 'fast', effective_from: '2026-11-01', effective_until: '2026-11-30',
            prompt: 3, completion: 4, cache_read: 0, cache_write_30m: 0.2, cache_write_12h: 0,
            unpriced_buckets: ['cache_write_5m'], source: 'synthetic-condition',
        },
    ],
    modality_rates: [{ modality: 'audio', prompt: 5, completion: 0, cache_write_30m: 0, cache_write_12h: 6 }],
    charge_rates: [
        {
            kind: 'web_search',
            unit: 'request',
            price: 0,
            per_units: 1000,
            provider: 'synthetic-provider',
            region: 'synthetic-region',
            resolution: 'synthetic-resolution',
            source: 'synthetic-charge',
        },
    ],
    request_scoped: false, coverage_gaps: [{ dimension: 'modality', reason: 'synthetic-gap' }],
}
const imageCharge: NonNullable<ModelCatalogPrice['charge_rates']>[number]      = {
    kind: 'generated_image',
    unit: 'image',
    price: 0.039,
    per_units: 1,
    provider: 'synthetic-provider',
    region: 'synthetic-region',
    resolution: 'synthetic-resolution',
    source: 'synthetic-charge',
}
const imageCharges: NonNullable<ModelCatalogPrice['charge_rates']>             = [
    imageCharge, { ...imageCharge, speed: 'batch', price: 0.0195 }, { ...imageCharge, speed: 'fast', price: 0.0702 },
]
const originalFields                                                           = {
    displayName: 'Fixture',
    provider: 'synthetic-provider',
    channel: 'synthetic-channel',
    group: '',
    enabled: true,
}
const draft                                                                    = (price: ModelCatalogPrice | null = original): Draft => ({
    ...baseInputs(price), ...originalFields,
    original: originalFields,
    originalModel: 'fixture-model',
    model: 'fixture-model',
    aliasesText: '',
    originalPrice: price,
    priceRules: priceRulesToInputs(price, !price),
    speedRates: (scope.speedRatesToInputs as (rules: ModelCatalogPrice['speed_rates']) => unknown[])(price?.speed_rates),
})
const wire                                                                     = <T, >(value: T): T => value ===
                                                                                                       undefined ?
                                                                                                       value :
                                                                                                       JSON.parse(JSON.stringify(
                                                                                                           value))

async function save(
    input: Draft,
    readback?: (price: ModelCatalogPrice | undefined) => ModelCatalogPrice | undefined,
    error?: Error,
) {
    const patches: ModelCatalogPatchRequest[]          = []
    const notices: { message: string; kind: string }[] = []
    const busy: Array<string | null>                   = []
    let closed                                         = false
    let applied                                        = false
    let recalculated                                   = false
    const action                                       = sourceCallback<() => Promise<void>>(file, 'saveEdit', {
        ...scope, editDraft: input, t,
        showNotification: (message: string, kind: string) => notices.push({ message, kind }),
        setSavingModel: (value: string | null) => busy.push(value),
        modelsApi: {
            patchModelCatalogModel: async (patch: ModelCatalogPatchRequest) => {
                patches.push(wire(patch))
                if (error) {
                    throw error
                }
                return {
                    models: [
                        {
                            name: 'fixture-model',
                            price: readback ? readback(wire(patch.price)) : wire(patch.price),
                        },
                    ], recalculation_pending: Boolean(patch.price || patch.clear_price),
                }
            },
        },
        applyCatalogResponse: () => {
            applied = true
        }, setEditDraft: () => {
            closed = true
        },
        observePriceRecalculation: () => {
            recalculated = true
        },
    })
    await action()
    return { patches, notices, busy, closed, applied, recalculated }
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) {
        return node.flatMap(elements)
    }
    if (!React.isValidElement<Record<string, unknown>>(node)) {
        return []
    }
    if (typeof node.type === 'function' && node.type.name === 'TokenRateFields') {
        return elements((node.type as (props: Record<string, unknown>) => ReactNode)(node.props))
    }
    return [node, ...elements(node.props.children as ReactNode)]
}

function controls(value: PriceRulesDraft, onChange: (value: PriceRulesDraft) => void, disabled = false) {
    return elements(ModelPriceRulesEditor({ value, onChange, disabled, t }))
}

function control(nodes: ReturnType<typeof controls>, type: unknown, key: string, index = 0) {
    const matches = nodes.filter((element) => element.type === type &&
                                              (element.props.label ===
                                               key ||
                                               element.props.ariaLabel ===
                                               key ||
                                               element.props.children ===
                                               key))
    expect(matches[index]).toBeDefined()
    return matches[index].props
}

test('base-price parser keeps its legacy six/seven-argument calls and separates empty values from free rates', () => {
    expect(parseBase('1', '', '', '', '', '').price).toEqual({
                                                                 prompt: 1,
                                                                 status: 'complete',
                                                                 auto_apply: true,
                                                                 currency: 'USD',
                                                             })
    expect(parseBase('0', '', '', '', '', '').price).toMatchObject({ prompt: 0 })
    expect(parseBase('', '0', '0', '', '', '').price).toMatchObject({ completion: 0, cache: 0, cache_read: 0 })
    expect(parseBase('', '', '', '', '', '')).toEqual({ ok: true, price: null })
    const values = baseInputs(original)
    expect(values.cacheRead).toBe('')
    expect(values.cacheWrite30m).toBe('0')
    const unchanged = parseBase(
        values.prompt,
        values.completion,
        values.cacheRead,
        values.cacheWrite,
        values.cacheWrite5m,
        values.cacheWrite1h,
        original,
    )
    expect(unchanged.price).toBe(original)
    const changed = parseBase('7', values.completion, '', '', '', '', original)
    expect(changed.price).toMatchObject({ ...original, prompt: 7 })
    expect(changed.price).not.toHaveProperty('cache_read')
    expect(changed.price).not.toHaveProperty('cache')
    for (const field of ['-1', 'NaN', 'Infinity']) {
        expect(parseBase('1', '', '', '', '', '', null, field, '').ok).toBe(false)
    }
    expect(parseBase('', '', '', '', '', '', null, '0', '').price).toMatchObject({ cache_write_30m: 0 })
    expect(parseBase('', '', '', '', '', '', null, '', '0').price).toMatchObject({ cache_write_12h: 0 })
})

test(
    'structured rules preserve all metadata, null/empty values and explicit zero without mutating loaded prices',
    () => {
        const inputs = priceRulesToInputs(original)
        expect(inputs.requestScoped).toBe('false')
        expect(inputs.conditionalRates[0]).toMatchObject({
                                                             prompt: '3',
                                                             cache_read: '0',
                                                             cache_write: '',
                                                             min_input_tokens: '200001',
                                                         })
        const parsed = parsePriceRules(inputs)
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) {
            throw new Error('expected valid fixture')
        }
        expect(wire(withPriceRules(original, parsed.price, original))).toEqual(original)
        const nullable = priceRulesToInputs({
                                                conditional_rates: [
                                                    {
                                                        prompt: null,
                                                        completion: 0,
                                                    } as unknown as NonNullable<ModelCatalogPrice['conditional_rates']>[number],
                                                ],
                                            })
        expect(nullable.conditionalRates[0].prompt).toBe('')
        expect(nullable.conditionalRates[0].completion).toBe('0')
        const nullableParsed = parsePriceRules(nullable)
        expect(nullableParsed.ok && wire(nullableParsed.price.conditional_rates?.[0])).toEqual({ completion: 0 })
        inputs.conditionalRates[0].prompt = '8'
        inputs.coverageGaps[0].reason     = 'edited'
        expect(original.conditional_rates?.[0].prompt).toBe(3)
        expect(original.coverage_gaps?.[0].reason).toBe('synthetic-gap')
        expect(priceRulesToInputs(null).requestScoped).toBe('')
        expect(priceRulesToInputs(null, true).requestScoped).toBe('true')
        expect(priceRulesToInputs({ status: 'partial' }).requestScoped).toBe('')
    },
)

test('price edits preserve saved classification metadata without exposing a completeness selector', async () => {
    for (const requestScoped of [false, true, undefined]) {
        const loaded = { ...original, request_scoped: requestScoped }
        let value    = priceRulesToInputs(loaded)
        const nodes  = controls(value, (next) => {
            value = next
        })
        expect(nodes.some((element) => element.props.ariaLabel === 'model_management.price_coverage_mode')).toBe(false)
        const input = control(nodes, Input, 'model_management.prompt_price ($/1M)')
        ;(input.onChange as (event: object) => void)({ target: { value: '6' } })
        const saved = await save({ ...draft(loaded), priceRules: value })
        expect(saved.closed).toBe(true)
        expect(saved.patches[0].price?.request_scoped).toBe(requestScoped)
        expect(saved.patches[0].price?.conditional_rates?.[0].prompt).toBe(6)
        expect(saved.patches[0].price).toMatchObject({ future_metadata: original.future_metadata })
    }
})

test(
    'conditional validation accepts inclusive single-token ranges and preserves nanosecond effective boundaries',
    () => {
        for (const [min, max] of [['0', '0'], ['200000', '200000'], ['', '0'], ['9007199254740991', '']]) {
            const value            = priceRulesToInputs(null)
            value.conditionalRates = [{ min_input_tokens: min, max_input_tokens: max, multiplier: '', prompt: '0' }]
            expect(parsePriceRules(value).ok).toBe(true)
        }
        for (const [from, until] of [
            ['2026-11-19', '2026-11-19'], ['2026-11-19T23:59:59Z', '2026-11-19'],
            ['2026-11-19T00:00:00.000000001Z', '2026-11-19T00:00:00.000000002Z'],
        ]) {
            const value            = priceRulesToInputs(null)
            value.conditionalRates =
                [
                    {
                        min_input_tokens: '',
                        max_input_tokens: '',
                        multiplier: '',
                        prompt: '0',
                        effective_from: from,
                        effective_until: until,
                    },
                ]
            expect(parsePriceRules(value).ok).toBe(true)
        }
        const cases = [
            { min_input_tokens: '-1' },
            { min_input_tokens: '1.5' },
            { min_input_tokens: '9007199254740992' },
            { min_input_tokens: '2', max_input_tokens: '1' },
            { speed: 'unknown' },
            { prompt: '-1' },
            { completion: 'NaN' },
            { effective_from: '2026-02-30' },
            { effective_until: 'bad' },
            { effective_from: '2026-11-19T00:00:00Z', effective_until: '2026-11-19T00:00:00Z' },
            { unpriced_buckets: ['prompt'] },
            { unpriced_buckets: ['uncached_input'] },
            { multiplier: '2' },
            { multiplier: '0', region: 'region' },
            { multiplier: '2', region: 'region' },
        ]
        for (const patch of cases) {
            const value            = priceRulesToInputs(null)
            value.conditionalRates =
                [
                    {
                        min_input_tokens: '',
                        max_input_tokens: '',
                        multiplier: '',
                        prompt: '0', ...patch,
                    } as PriceRulesDraft['conditionalRates'][number],
                ]
            expect(parsePriceRules(value)).toEqual({ ok: false, section: 'conditional_rates' })
        }
        const value            = priceRulesToInputs(null)
        value.conditionalRates =
            [
                {
                    min_input_tokens: '',
                    max_input_tokens: '',
                    multiplier: '',
                    unpriced_buckets: ['cache_write_12h', 'cache_write_30m', 'cache_write_12h'],
                },
            ]
        expect(parsePriceRules(value)).toMatchObject({
                                                         ok: true,
                                                         price: {
                                                             conditional_rates: [
                                                                 {
                                                                     unpriced_buckets: [
                                                                         'cache_write_12h',
                                                                         'cache_write_30m',
                                                                     ],
                                                                 },
                                                             ],
                                                         },
                                                     })
        value.conditionalRates =
            [{ min_input_tokens: '', max_input_tokens: '', region: ' region ', multiplier: '1.2' }]
        expect(parsePriceRules(value)).toMatchObject({
                                                         ok: true,
                                                         price: {
                                                             conditional_rates: [
                                                                 {
                                                                     region: 'region',
                                                                     multiplier: 1.2,
                                                                 },
                                                             ],
                                                         },
                                                     })
        value.conditionalRates = [{ min_input_tokens: '', max_input_tokens: '', multiplier: '' }]
        expect(parsePriceRules(value).ok).toBe(false)
        value.conditionalRates =
            Array.from(
                { length: 2 },
                () => ({ id: ' same ', min_input_tokens: '', max_input_tokens: '', multiplier: '', prompt: '0' }),
            )
        expect(parsePriceRules(value).ok).toBe(false)
    },
)

test('modality, charge and coverage consumers reject invalid/duplicate rows and accept explicit free charges', () => {
    const value         = priceRulesToInputs(null)
    value.modalityRates = [{ modality: 'image', prompt: '0' }]
    value.chargeRates   =
        [{ kind: ' custom-kind ', unit: ' custom-unit ', price: '0', per_units: '1000', resolution: ' custom ' }]
    value.coverageGaps  = [{ dimension: 'cache_write_ttl', reason: ' missing details ' }]
    expect(parsePriceRules(value)).toMatchObject({
                                                     ok: true, price: {
            modality_rates: [{ modality: 'image', prompt: 0 }],
            charge_rates: [
                {
                    kind: 'custom-kind',
                    unit: 'custom-unit',
                    price: 0,
                    per_units: 1000,
                    resolution: 'custom',
                },
            ],
            coverage_gaps: [{ dimension: 'cache_write_ttl', reason: 'missing details' }],
        },
                                                 })
    for (const patch of
        [
            { price: '' },
            { price: '-1' },
            { price: 'Infinity' },
            { per_units: '' },
            { per_units: '0' },
            { per_units: '-1' },
            { kind: '' },
            { unit: '' },
        ]) {
        const invalid = { ...value, chargeRates: [{ ...value.chargeRates[0], ...patch }] }
        expect(parsePriceRules(invalid)).toEqual({ ok: false, section: 'charge_rates' })
    }
    expect(parsePriceRules({ ...value, chargeRates: [...value.chargeRates, { ...value.chargeRates[0] }] }).ok).toBe(
        false)
    expect(parsePriceRules({ ...value, modalityRates: [{ modality: 'image' }] })).toEqual({
                                                                                              ok: false,
                                                                                              section: 'modality_rates',
                                                                                          })
    expect(parsePriceRules({
                               ...value,
                               modalityRates: [
                                   { modality: 'image', prompt: '0' },
                                   { modality: 'image', completion: '1' },
                               ],
                           }).ok).toBe(false)
    expect(parsePriceRules({ ...value, coverageGaps: [{ dimension: 'region', reason: '' }] })).toEqual({
                                                                                                           ok: false,
                                                                                                           section: 'coverage_gaps',
                                                                                                       })
    expect(parsePriceRules({ ...value, coverageGaps: [{ dimension: 'calendar', reason: 'missing holiday calendar' }] }))
        .toMatchObject({
                           ok: true,
                           price: { coverage_gaps: [{ dimension: 'calendar', reason: 'missing holiday calendar' }] },
                       })
})

test('charges preserve processing modes and allow generic plus distinct mode prices for the same billed item', () => {
    const inputs = priceRulesToInputs({ ...original, charge_rates: imageCharges })
    expect(inputs.chargeRates.map((rule) => rule.speed)).toEqual(['', 'batch', 'fast'])
    const parsed = parsePriceRules(inputs)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && wire(parsed.price.charge_rates)).toEqual(imageCharges)
    const allModes = priceRulesToInputs({ charge_rates: [imageCharge] })
    for (const speed of REQUEST_SPEEDS.filter((entry) => entry !== 'unknown')) {
        allModes.chargeRates.push({ ...allModes.chargeRates[0], speed, price: '0' })
    }
    const allParsed = parsePriceRules(allModes)
    expect(allParsed.ok).toBe(true)
    expect(allParsed.ok && allParsed.price.charge_rates?.map((rule) => rule.speed))
        .toEqual([undefined, 'standard', 'fast', 'ultrafast', 'flex', 'batch'])
    expect(parsePriceRules({
                               ...inputs,
                               chargeRates: [...inputs.chargeRates, { ...inputs.chargeRates[1], speed: ' BATCH ' }],
                           }))
        .toEqual({ ok: false, section: 'charge_rates' })
    expect(parsePriceRules({
                               ...inputs,
                               chargeRates: [
                                   { ...inputs.chargeRates[0], speed: undefined },
                                   { ...inputs.chargeRates[0], speed: '' },
                               ],
                           }))
        .toEqual({ ok: false, section: 'charge_rates' })
    for (const speed of ['unknown', 'priority', 'custom-mode']) {
        expect(parsePriceRules({ ...inputs, chargeRates: [{ ...inputs.chargeRates[0], speed }] }))
            .toEqual({ ok: false, section: 'charge_rates' })
    }
    const normalized = parsePriceRules({
                                           ...inputs,
                                           chargeRates: [{ ...inputs.chargeRates[0], speed: ' FAST ', price: '0' }],
                                       })
    expect(normalized.ok && wire(normalized.price.charge_rates)).toEqual([{ ...imageCharge, speed: 'fast', price: 0 }])
    expect(priceRulesSignature({ charge_rates: [imageCharge] }))
        .not.toBe(priceRulesSignature({ charge_rates: [{ ...imageCharge, speed: 'standard' }] }))
})

test(
    'actual charge mode edits persist final prices and detect dropped, changed or uncleared modes on readback',
    async () => {
        const loaded   = { ...original, charge_rates: imageCharges }
        const metadata = await save({ ...draft(loaded), displayName: 'Updated' })
        expect(metadata.patches).toEqual([{ name: 'fixture-model', display_name: 'Updated' }])
        const input                           = draft(loaded)
        input.priceRules.chargeRates[1].speed = 'flex'
        const saved                           = await save(input)
        expect(saved.closed).toBe(true)
        expect(saved.patches[0].price?.charge_rates).toEqual([
                                                                 imageCharge,
                                                                 { ...imageCharge, speed: 'flex', price: 0.0195 },
                                                                 { ...imageCharge, speed: 'fast', price: 0.0702 },
                                                             ])
        for (const speed of [undefined, 'standard'] as const) {
            const mismatched = await save(input, (price) => {
                if (speed === undefined) {
                    delete price!.charge_rates![1].speed
                } else {
                    price!.charge_rates![1].speed = speed
                }
                return price
            })
            expect(mismatched.closed || mismatched.applied).toBe(false)
            expect(mismatched.notices)
                .toEqual([
                             {
                                 message: 'notification.update_failed: model_management.price_rules_not_saved',
                                 kind: 'error',
                             },
                         ])
        }
        const cleared                           = draft({
                                                            ...original,
                                                            charge_rates: [
                                                                {
                                                                    ...imageCharge,
                                                                    speed: 'batch',
                                                                    price: 0,
                                                                },
                                                            ],
                                                        })
        cleared.priceRules.chargeRates[0].speed = ''
        const removed                           = await save(cleared)
        expect(removed.closed).toBe(true)
        expect(removed.patches[0].clear_price).toBeUndefined()
        expect(removed.patches[0].price?.charge_rates).toEqual([{ ...imageCharge, price: 0 }])
        expect(removed.patches[0].price?.charge_rates?.[0]).not.toHaveProperty('speed')
        const retained = await save(cleared, (price) => {
            price!.charge_rates![0].speed = 'batch'
            return price
        })
        expect(retained.closed).toBe(false)
        expect(retained.notices)
            .toEqual([
                         {
                             message: 'notification.update_failed: model_management.price_rules_not_saved',
                             kind: 'error',
                         },
                     ])
        expect(imageCharges[1].speed).toBe('batch')
    },
)

test('actual charge mode selector uses the supported modes and clears back to a generic price', () => {
    let value    = priceRulesToInputs({ charge_rates: [imageCharge] })
    const change = (next: PriceRulesDraft) => {
        value = next
    }
    const select = () => control(controls(value, change), Select, 'model_management.rule_actual_speed')
    expect((select().options as { value: string }[]).map((option) => option.value))
        .toEqual(['', 'standard', 'fast', 'ultrafast', 'flex', 'batch'])
    ;(select().onChange as (speed: string) => void)('batch')
    expect(value.chargeRates[0]).toMatchObject({ speed: 'batch', price: '0.039', per_units: '1' })
    ;(select().onChange as (speed: string) => void)('')
    expect(value.chargeRates[0].speed).toBe('')
    const parsed = parsePriceRules(value)
    expect(parsed.ok && wire(parsed.price.charge_rates)).toEqual([imageCharge])
    expect(control(controls(value, change, true), Select, 'model_management.rule_actual_speed').disabled).toBe(true)
})

test(
    'actual edit entry preserves original rules on unrelated edits and saves all new rate buckets and rule groups',
    async () => {
        const untouched = await save({ ...draft(), displayName: 'Renamed' })
        expect(untouched.patches).toEqual([{ name: 'fixture-model', display_name: 'Renamed' }])
        expect(untouched.closed && untouched.applied).toBe(true)
        expect(untouched.recalculated).toBe(false)
        const edited                                           = draft()
        edited.cacheWrite30m                                   = '1.25'
        edited.cacheWrite12h                                   = ''
        edited.priceRules.requestScoped                        = 'true'
        edited.priceRules.conditionalRates[0].max_input_tokens = '400000'
        edited.priceRules.modalityRates[0].completion          = '2.5'
        edited.priceRules.chargeRates[0].per_units             = '1'
        const saved                                            = await save(edited)
        expect(saved.patches[0].price).toMatchObject({
                                                         source: original.source,
                                                         future_metadata: original.future_metadata,
                                                         cache_write_30m: 1.25,
                                                         request_scoped: true,
                                                         conditional_rates: [{ max_input_tokens: 400000 }],
                                                         modality_rates: [{ completion: 2.5 }],
                                                         charge_rates: [{ price: 0, per_units: 1 }],
                                                         speed_rates: original.speed_rates,
                                                         utc_rate_bands: original.utc_rate_bands,
                                                     })
        expect(saved.patches[0].price).not.toHaveProperty('cache_write_12h')
        expect(saved.patches[0].price).not.toHaveProperty('cache_read')
        expect(saved.notices).toEqual([{ message: 'model_management.save_success', kind: 'success' }])
        expect(saved.busy).toEqual(['fixture-model', null])
    },
)

test(
    'each changed structured field requires matching readback; omitted empty arrays and equivalent UTC dates are accepted',
    async () => {
        const input                    = draft()
        input.priceRules.requestScoped = 'true'
        input.cacheRead                = '0'
        for (const key of
            [
                'conditional_rates',
                'modality_rates',
                'charge_rates',
                'request_scoped',
                'coverage_gaps',
                'prompt',
                'completion',
                'cache_read',
                'cache_write_30m',
                'cache_write_12h',
            ] as const) {
            const saved = await save(input, (price) => {
                delete price![key]
                if (key === 'cache_read') {
                    delete price!.cache
                }
                return price
            })
            expect(saved.closed || saved.applied || saved.recalculated).toBe(false)
            expect(saved.notices)
                .toEqual([
                             {
                                 message: 'notification.update_failed: model_management.price_rules_not_saved',
                                 kind: 'error',
                             },
                         ])
        }
        const normalized = await save(input, (price) => {
            price!.conditional_rates![0].effective_from  = '2026-10-31T17:00:00-07:00'
            price!.conditional_rates![0].effective_until = '2026-12-01T00:00:00Z'
            return price
        })
        expect(normalized.closed).toBe(true)
        const cleared      = draft()
        cleared.priceRules =
            {
                ...priceRulesToInputs(original),
                conditionalRates: [],
                modalityRates: [],
                chargeRates: [],
                coverageGaps: [],
            }
        expect((await save(cleared, () => original)).closed).toBe(false)
        const deleted = await save(cleared, (price) => {
            for (const key of ['conditional_rates', 'modality_rates', 'charge_rates', 'coverage_gaps'] as const) {
                delete price![key]
            }
            return price
        })
        expect(deleted.closed).toBe(true)
        expect(deleted.patches[0].clear_price).toBeUndefined()
        const unchanged = { ...draft(), displayName: 'Updated display name' }
        expect((await save(unchanged, () => ({ prompt: 1, completion: 2 }))).closed).toBe(true)
    },
)

test(
    'rule-only pricing and clearing base values preserve metadata while removing all substantive prices clears the price record',
    async () => {
        const input = draft()
        for (const field of Object.keys(baseInputs(null)) as (keyof BaseInputs)[]) {
            input[field] = ''
        }
        const saved = await save(input)
        expect(saved.closed).toBe(true)
        expect(saved.patches[0].price).toMatchObject({
                                                         source: original.source,
                                                         conditional_rates: original.conditional_rates,
                                                         charge_rates: original.charge_rates,
                                                     })
        for (const [bucket] of TOKEN_RATE_FIELDS) {
            expect(saved.patches[0].price).not.toHaveProperty(bucket)
        }
        const unknownToFree = await save(input, (price) => ({ ...price, prompt: 0, completion: 0, cache_read: 0 }))
        expect(unknownToFree.closed).toBe(false)
        expect(unknownToFree.notices[unknownToFree.notices.length - 1]?.message).toBe(
            'notification.update_failed: model_management.price_rules_not_saved')
        input.priceRules = priceRulesToInputs(null)
        input.speedRates = []
        const cleared    = await save(input)
        expect(cleared.patches[0].clear_price).toBe(true)
        expect(cleared.patches[0].price).toBeUndefined()
        expect((await save(
            { ...draft(), prompt: '8' },
            undefined,
            new Error('overlapping conditional rate rules'),
        )).notices)
            .toEqual([{ message: 'notification.update_failed: overlapping conditional rate rules', kind: 'error' }])
    },
)

test('actual controls add, edit and remove conditional, modality, preset/custom charges and coverage gaps', () => {
    let value    = priceRulesToInputs(null, true)
    const change = (next: PriceRulesDraft) => {
        value = next
    }
    const nodes  = () => controls(value, change)
    ;(control(nodes(), Button, 'model_management.conditional_rate_add').onClick as () => void)()
    ;(control(
        nodes(),
        Input,
        'model_management.rule_min_input',
    ).onChange as (event: object) => void)({ target: { value: '200001' } })
    ;(control(nodes(), Select, 'model_management.rule_actual_speed').onChange as (speed: string) => void)('ultrafast')
    ;(control(
        nodes(),
        Input,
        'model_management.prompt_price ($/1M)',
    ).onChange as (event: object) => void)({ target: { value: '0' } })
    expect(value.conditionalRates[0]).toMatchObject({ min_input_tokens: '200001', speed: 'ultrafast', prompt: '0' })
    const choices = nodes().filter((element) => element.type === 'input' && element.props.type === 'checkbox')
    ;(choices.find((element) => (element.props.onChange as unknown) &&
                                element.props.checked ===
                                false)!.props.onChange as (event: object) => void)({ target: { checked: true } })
    expect(value.conditionalRates[0].unpriced_buckets).toEqual(['prompt'])
    ;(control(nodes(), Button, 'model_management.price_rule_remove').onClick as () => void)()
    expect(value.conditionalRates).toEqual([])
    ;(control(nodes(), Button, 'model_management.modality_rate_add').onClick as () => void)()
    ;(control(nodes(), Select, 'model_management.rule_modality').onChange as (modality: string) => void)('audio')
    ;(control(
        nodes(),
        Input,
        'model_management.cache_write_12h_price ($/1M)',
    ).onChange as (event: object) => void)({ target: { value: '0' } })
    expect(value.modalityRates[0]).toMatchObject({ modality: 'audio', cache_write_12h: '0' })
    ;(control(nodes(), Button, 'model_management.price_rule_remove').onClick as () => void)()
    for (const [kind, unit] of [['web_search', 'request'], ['web_fetch', 'request'], ['generated_image', 'image']]) {
        ;(control(nodes(), Select, 'model_management.charge_preset_add').onChange as (kind: string) => void)(kind)
        expect(value.chargeRates[value.chargeRates.length - 1]).toEqual({ kind, unit, price: '', per_units: '' })
    }
    ;(control(nodes(), Button, 'model_management.charge_rate_add').onClick as () => void)()
    ;(control(
        nodes(),
        Input,
        'model_management.charge_kind',
        3,
    ).onChange as (event: object) => void)({ target: { value: 'custom-charge' } })
    ;(control(
        nodes(),
        Input,
        'model_management.charge_price',
        3,
    ).onChange as (event: object) => void)({ target: { value: '0' } })
    expect(value.chargeRates[3]).toMatchObject({ kind: 'custom-charge', price: '0', per_units: '' })
    ;(control(nodes(), Button, 'model_management.coverage_gap_add').onClick as () => void)()
    expect((control(nodes(), Select, 'model_management.coverage_dimension').options as {
        value: string
    }[]).map((option) => option.value)).toContain('calendar')
    ;(control(nodes(), Select, 'model_management.coverage_dimension').onChange as (dimension: string) => void)('tools')
    ;(control(
        nodes(),
        Input,
        'model_management.coverage_reason',
    ).onChange as (event: object) => void)({ target: { value: 'missing charge' } })
    expect(value.coverageGaps).toEqual([{ dimension: 'tools', reason: 'missing charge' }])
    expect(nodes().some((element) => element.props.ariaLabel === 'model_management.price_coverage_mode')).toBe(false)
    expect(value.requestScoped).toBe('true')
    ;(control(nodes(), Button, 'model_management.price_rule_remove', 4).onClick as () => void)()
    expect(value.coverageGaps).toEqual([])
    ;(control(nodes(), Button, 'model_management.price_rule_remove', 3).onClick as () => void)()
    expect(value.chargeRates).toHaveLength(3)
    for (let index = 0; index < 3; index += 1) {
        ;(control(nodes(), Button, 'model_management.price_rule_remove').onClick as () => void)()
    }
    expect(value.chargeRates).toEqual([])
    value          = priceRulesToInputs(original)
    const disabled = controls(value, change, true)
    expect(disabled.filter((element) => element.type === 'fieldset').every((element) => element.props.disabled)).toBe(
        true)
    expect(disabled.filter((element) => element.type === Button || element.type === Select)
                   .every((element) => element.props.disabled)).toBe(true)
})

test('both actual dialogs initialize and consume the shared structured editor and both TTL controls', () => {
    let input: Draft = draft()
    sourceCallback<(row: object) => void>(file, 'openEditModal', {
        ...scope, setEditDraft: (value: Draft) => {
            input = value
        }, aliasesToText: (aliases: string[]) => aliases.join('\n'),
    })({ model: 'fixture-model', displayName: 'Fixture', aliases: [], price: original, enabled: true })
    expect(input.priceRules).toEqual(priceRulesToInputs(original))
    expect(input.cacheWrite30m).toBe('0')
    for (const name of ['editDraft', 'addDraft']) {
        const change = (update: (value: Draft) => Draft) => {
            input = update(input)
        }
        const view   = sourceExpression<ReactElement<Record<string, unknown>>>(file, (node, tree) =>
            ts.isJsxSelfClosingElement(node) &&
            node.tagName.getText(tree) ===
            'ModelPriceRulesEditor' &&
            node.getText(tree).includes(`value={${name}.priceRules}`), {
                                                                                   React,
                                                                                   ModelPriceRulesEditor,
                                                                                   [name]: input,
                                                                                   [name === 'editDraft' ?
                                                                                    'setEditDraft' :
                                                                                    'setAddDraft']: change,
                                                                                   savingModel: null,
                                                                                   t,
                                                                               })
        expect(view.props.value).toEqual(input.priceRules)
        const rules = priceRulesToInputs(null, true)
        ;(view.props.onChange as (value: PriceRulesDraft) => void)(rules)
        expect(input.priceRules).toEqual(rules)
        for (const field of ['cacheWrite30m', 'cacheWrite12h']) {
            const control = sourceExpression<ReactElement<Record<string, unknown>>>(file, (node, tree) =>
                ts.isJsxSelfClosingElement(node) &&
                node.tagName.getText(tree) ===
                'Input' &&
                node.getText(tree).includes(`value={${name}.${field}}`), {
                                                                                        React,
                                                                                        Input,
                                                                                        [name]: input,
                                                                                        [name === 'editDraft' ?
                                                                                         'setEditDraft' :
                                                                                         'setAddDraft']: change,
                                                                                        t,
                                                                                    })
            ;(control.props.onChange as (event: object) => void)({ target: { value: '0' } })
            expect(input[field as keyof Draft]).toBe('0')
        }
    }
    const openAdd = sourceExpression<() => void>(file, (node, tree) => ts.isArrowFunction(node) &&
                                                                       node.getText(tree).startsWith(
                                                                           '() => setAddDraft({') &&
                                                                       node.getText(tree).includes(
                                                                           'priceRulesToInputs(null, true)'), {
                                                     ...scope, setAddDraft: (value: Draft) => {
            input = value
        },
                                                 })
    openAdd()
    expect(input.priceRules.requestScoped).toBe('true')
    expect(input.cacheWrite30m).toBe('')
    expect(input.cacheWrite12h).toBe('')
})

test(
    'actual creation supports conditional-only prices and rejects server rule loss without closing the draft',
    async () => {
        const input                       = draft(null)
        input.priceRules.conditionalRates =
            [{ min_input_tokens: '0', max_input_tokens: '0', multiplier: '', prompt: '0' }]
        input.priceRules.modalityRates    = [{ modality: 'video', completion: '0' }]
        input.priceRules.chargeRates      =
            [{ kind: 'custom-tool', unit: 'request', price: '0', per_units: '1', speed: 'ultrafast' }]
        let patch: ModelCatalogPatchRequest | undefined
        let closed                        = false
        let applied                       = false
        let dropRules                     = false
        let dropSpeed                     = false
        const notices: string[]           = []
        const add                         = sourceCallback<() => Promise<void>>(file, 'handleAddModel', {
            ...scope, addDraft: input, allModelNames: [], t, setSavingModel: noop,
            showNotification: (message: string) => notices.push(message),
            modelsApi: {
                patchModelCatalogModel: async (request: ModelCatalogPatchRequest) => {
                    patch       = wire(request)
                    const price = wire(request.price)
                    if (dropSpeed) {
                        delete price!.charge_rates![0].speed
                    }
                    return { models: [{ name: 'fixture-model', price: dropRules ? { request_scoped: true } : price }] }
                },
            },
            applyCatalogResponse: () => {
                applied = true
            }, setAddDraft: () => {
                closed = true
            }, observePriceRecalculation: noop,
        })
        await add()
        expect(closed && applied).toBe(true)
        expect(patch?.price).toMatchObject({
                                               request_scoped: true,
                                               conditional_rates: [
                                                   {
                                                       min_input_tokens: 0,
                                                       max_input_tokens: 0,
                                                       prompt: 0,
                                                   },
                                               ],
                                               charge_rates: [{ price: 0, speed: 'ultrafast' }],
                                           })
        expect(patch?.price).not.toHaveProperty('cache_read')
        expect(patch?.price).not.toHaveProperty('completion')
        closed    = false;
        applied   = false;
        dropSpeed = true
        await add()
        expect(closed || applied).toBe(false)
        expect(notices[notices.length - 1]).toBe('notification.update_failed: model_management.price_rules_not_saved')
        dropSpeed = false;
        dropRules = true
        await add()
        expect(closed || applied).toBe(false)
        expect(notices[notices.length - 1]).toBe('notification.update_failed: model_management.price_rules_not_saved')
        patch                                 = undefined
        input.priceRules.chargeRates[0].price = ''
        await add()
        expect(patch).toBeUndefined()
        expect(notices[notices.length - 1]).toBe('model_management.charge_rates_invalid')
    },
)

test('actual catalog wire and mutation readback carry every rule and both added cache TTL buckets', async () => {
    const configured = { ...original, charge_rates: imageCharges }
    const patch      = spyOn(apiClient, 'patch').mockResolvedValue({ models: [] })
    const get        = spyOn(apiClient, 'get').mockResolvedValue({
                                                                     models: [
                                                                         {
                                                                             name: 'fixture-model',
                                                                             price: configured,
                                                                         },
                                                                     ],
                                                                 })
    try {
        await modelsApi.patchModelCatalogModel({ name: 'fixture-model', price: configured })
        expect(patch.mock.calls[0][1]).toEqual({ name: 'fixture-model', price: configured })
        const config = patch.mock.calls[0][2] as { mutationReadback: () => Promise<unknown> }
        expect(await config.mutationReadback()).toEqual({ models: [{ name: 'fixture-model', price: configured }] })
        expect(get.mock.calls[0][0]).toBe('/model-catalog')
    } finally {
        patch.mockRestore();
        get.mockRestore()
    }
})

test(
    'four-language structured controls render the configured applicability, free amounts and fees without raw JSON',
    async () => {
        for (const language of ['zh-CN', 'zh-TW', 'en', 'ru']) {
            const instance = createInstance()
            await instance.init({
                                    lng: language, fallbackLng: false, resources: {
                    [language]: {
                        translation: JSON.parse(readFileSync(new URL(
                            `../src/i18n/locales/${language}.json`,
                            import.meta.url,
                        ), 'utf8')),
                    },
                },
                                })
            const html            = renderToStaticMarkup(<ModelPriceRulesEditor value={priceRulesToInputs(original)}
                                                                                onChange={noop} disabled={false}
                                                                                t={instance.t.bind(instance)} />)
            const requestModeHtml = renderToStaticMarkup(<ModelPriceRulesEditor
                value={{ ...priceRulesToInputs(original), requestScoped: 'true' }} onChange={noop} disabled={false}
                t={instance.t.bind(instance)} />)
            for (const key of [
                'conditional_rates',
                'rule_min_input',
                'rule_max_input',
                'rule_actual_speed',
                'rule_any_speed',
                'modality_rates',
                'charge_rates',
                'charge_price',
                'charge_per_units',
                'coverage_gaps',
                'cache_write_30m_price',
                'cache_write_12h_price',
            ]) {
                const translated = instance.t(`model_management.${key}`)
                expect(translated).not.toBe(`model_management.${key}`)
                expect(html).toContain(translated)
            }
            expect(requestModeHtml).toBe(html)
            expect(html).toContain('synthetic-region')
            expect(html).toContain('value="200001"')
            expect(html).toContain('value="0"')
            expect(html).toContain('value="1000"')
            expect(html).not.toContain('{&quot;')
            const chargesHtml = renderToStaticMarkup(<ModelPriceRulesEditor
                value={priceRulesToInputs({ charge_rates: imageCharges })} onChange={noop} disabled={false}
                t={instance.t.bind(instance)} />)
            expect(chargesHtml).toContain(instance.t('model_management.rule_actual_speed'))
            expect(chargesHtml).toContain(instance.t('model_management.rule_any_speed'))
            expect(chargesHtml).toContain(instance.t('usage_stats.request_events_speed_batch'))
            expect(chargesHtml).toContain(instance.t('usage_stats.request_events_speed_fast'))
            for (const amount of ['0.039', '0.0195', '0.0702']) {
                expect(chargesHtml).toContain(`value="${amount}"`)
            }
        }
    },
)
