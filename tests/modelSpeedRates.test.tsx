import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import {
    parsePriceRules,
    priceBoundary,
    type PriceRulesDraft,
    priceRulesSignature,
    priceRulesToInputs,
    withPriceRules,
} from '@/pages/modelPriceRules'
import {apiClient} from '@/services/api/client'
import {type ModelCatalogPrice, type ModelCatalogSpeedRate, modelsApi} from '@/services/api/models'
import {REQUEST_SPEEDS} from '@/services/api/usage'
import {expect, spyOn, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import React, {type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file   = 'pages/ModelManagementPage.tsx'
const noop   = () => {
}
const t      = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
const styles = new Proxy<Record<string, string>>({}, { get: (_target, name) => String(name) })
type RateDraft = Omit<ModelCatalogSpeedRate, 'multiplier' | 'multipliers'> & {
    multiplier: string
    multipliers: Partial<Record<keyof NonNullable<ModelCatalogSpeedRate['multipliers']>, string>>
}
type Draft = {
    originalModel: string;
    model: string;
    displayName: string;
    provider: string;
    channel: string;
    group: string;
    aliasesText: string;
    prompt: string;
    completion: string;
    cacheRead: string;
    cacheWrite: string;
    cacheWrite5m: string;
    cacheWrite1h: string;
    cacheWrite30m: string;
    cacheWrite12h: string;
    originalPrice: ModelCatalogPrice | null;
    priceRules: PriceRulesDraft;
    speedRates: RateDraft[];
    enabled: boolean;
    originalEnabled: boolean;
}
const scope: Record<string, unknown> = {
    REQUEST_SPEEDS, SPEED_RATE_BUCKETS: sourceInitializer(file, 'SPEED_RATE_BUCKETS', {}),
    parsePriceRules, priceBoundary, priceRulesSignature, priceRulesToInputs, withPriceRules,
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
const toInputs                                                             = scope.speedRatesToInputs as (rules?: ModelCatalogSpeedRate[]) => RateDraft[]
const parse                                                                = scope.parseSpeedRates as (rules: RateDraft[]) => ModelCatalogSpeedRate[] | null
const original: ModelCatalogPrice & { future_metadata: { keep: boolean } } = {
    prompt: 1, completion: 2, cache: 0.1, cache_read: 0.1, cache_write: 0.2, cache_write_5m: 0.3, cache_write_1h: 0.4,
    status: 'partial', auto_apply: false, currency: 'USD', source: 'synthetic-base-source',
    checked_at: '2026-11-01', effective_from: '2026-01-01', effective_until: '2026-12-31', region: 'synthetic-region',
    service_tier: 'synthetic-metadata-tier', unpriced_reason: 'synthetic-limit', limitations: ['synthetic-limit'],
    future_metadata: { keep: true },
    utc_rate_bands: [{ weekdays: ['mon'], start: '01:00', end: '02:00', prompt: 0.5 }],
    speed_rates: [
        {
            speed: 'fast', provider: 'codex', multiplier: 2.5,
            multipliers: {
                prompt: 2,
                completion: 0,
                cache_read: 0.5,
                cache_write: 1.5,
                cache_write_5m: 1.7,
                cache_write_1h: 1.8,
            },
            effective_from: '2026-11-01', effective_until: '2026-11-30', source: 'synthetic-speed-source',
        },
    ],
}
const defaultRule: RateDraft                                               = {
    speed: 'fast',
    multiplier: '2',
    multipliers: {},
}
const draft                                                                = (price: ModelCatalogPrice | null = original): Draft => ({
    originalModel: 'fixture-model',
    model: 'fixture-model',
    displayName: 'Fixture',
    provider: 'openai',
    channel: 'codex',
    group: '',
    aliasesText: 'alias-a', ...((scope.priceToInputs as (price: ModelCatalogPrice | null) => Pick<Draft,
        'prompt' | 'completion' | 'cacheRead' | 'cacheWrite' | 'cacheWrite5m' | 'cacheWrite1h' | 'cacheWrite30m' | 'cacheWrite12h'>)(
        price)),
    originalPrice: price,
    priceRules: priceRulesToInputs(price, !price),
    speedRates: toInputs(price?.speed_rates),
    enabled: true,
    originalEnabled: true,
})

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) {
        return node.flatMap(elements)
    }
    if (!React.isValidElement<Record<string, unknown>>(node)) {
        return []
    }
    return [node, ...elements(node.props.children as ReactNode)]
}

function editor(rules: RateDraft[], onChange: (rules: RateDraft[]) => void, translate: unknown = t, disabled = false) {
    return sourceCallback<(props: object) => ReactElement>(file, 'SpeedRateEditor', {
        React, styles, Button, Input, Select, REQUEST_SPEEDS, SPEED_RATE_BUCKETS: scope.SPEED_RATE_BUCKETS,
    })({ rules, onChange, disabled, t: translate })
}

async function save(input: Draft, error?: Error, readbackPrice?: ModelCatalogPrice | null) {
    const patches: { name: string; price?: ModelCatalogPrice; clear_price?: boolean }[]                       = []
    const readbacks: unknown[]                                                                                = []
    const notices: { message: string; kind: string }[]                                                        = []
    const busy: Array<string | null>                                                                          = []
    let closed                                                                                                = false
    const response: { models: { name: string; price?: ModelCatalogPrice }[]; recalculation_pending: boolean } = {
        models: [{ name: 'fixture-model' }], recalculation_pending: true,
    }
    let recalculations                                                                                        = 0
    const action                                                                                              = sourceCallback<() => Promise<void>>(
        file,
        'saveEdit',
        {
            ...scope, editDraft: input, t,
            showNotification: (message: string, kind: string) => notices.push({ message, kind }),
            setSavingModel: (value: string | null) => busy.push(value),
            modelsApi: {
                patchModelCatalogModel: async (patch: typeof patches[number]) => {
                    patches.push(patch)
                    if (error) {
                        throw error
                    }
                    response.models[0].price = readbackPrice === undefined ? patch.price : readbackPrice ?? undefined
                    return response
                },
            },
            applyCatalogResponse: (value: unknown) => readbacks.push(value),
            setEditDraft: (value: null) => {
                closed = value === null
            },
            observePriceRecalculation: () => {
                recalculations += 1
            },
        },
    )
    await action()
    return { patches, readbacks, notices, busy, closed, response, recalculations }
}

test('old base-price edits preserve the entire current price, metadata and speed rules', async () => {
    const input  = draft()
    input.prompt = '4'
    const saved  = await save(input)
    expect(saved.patches).toHaveLength(1)
    const price = JSON.parse(JSON.stringify(saved.patches[0].price))
    expect(price).toMatchObject({ ...original, prompt: 4 })
    expect(price.speed_rates).toEqual(original.speed_rates)
    expect(original.prompt).toBe(1)
    expect(saved.readbacks).toEqual([saved.response])
    expect(saved.busy).toEqual(['fixture-model', null])
    expect(saved.closed).toBe(true)
    expect(saved.recalculations).toBe(1)
})

test(
    'editing the actual price rules can add every speed, modify overrides and explicitly remove all rules',
    async () => {
        const input      = draft()
        input.speedRates = REQUEST_SPEEDS.filter((speed) => speed !== 'unknown').map((speed) => ({
            speed, multiplier: '1.75', multipliers: { completion: '0' }, provider: ' codex ',
            effective_from: '2026-11-19', effective_until: '2026-11-19', source: ' synthetic-source ',
        }))
        const saved      = await save(input)
        expect(saved.patches[0].price?.speed_rates).toHaveLength(5)
        expect(saved.patches[0].price?.speed_rates?.[2]).toMatchObject({
                                                                           speed: 'ultrafast',
                                                                           multiplier: 1.75,
                                                                           provider: 'codex',
                                                                           multipliers: { completion: 0 },
                                                                           source: 'synthetic-source',
                                                                       })
        const cleared = await save({ ...draft(), speedRates: [] })
        expect(cleared.patches[0].price?.speed_rates).toEqual([])
        expect(cleared.patches[0].clear_price).toBeUndefined()
        expect(cleared.patches[0].price).toMatchObject({
                                                           prompt: original.prompt,
                                                           source: original.source,
                                                           future_metadata: { keep: true },
                                                       })
    },
)

test('the actual model editor initializes rules and both existing price dialogs consume the same editor', () => {
    let input: Draft | undefined
    sourceCallback<(row: object) => void>(file, 'openEditModal', {
        ...scope, setEditDraft: (value: Draft) => {
            input = value
        }, aliasesToText: (values: string[]) => values.join('\n'),
    })({ model: 'fixture-model', displayName: 'Fixture', aliases: [], price: original, enabled: true })
    expect(input?.speedRates).toEqual(toInputs(original.speed_rates))
    const change = (update: (value: Draft) => Draft) => {
        input = update(input!)
    }
    for (const name of ['editDraft', 'addDraft']) {
        const view = sourceExpression<ReactElement<Record<string, unknown>>>(file, (node, tree) =>
            ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'SpeedRateEditor' &&
            node.getText(tree).includes(`rules={${name}.speedRates}`), {
                                                                                 React,
                                                                                 SpeedRateEditor: noop,
                                                                                 [name]: input,
                                                                                 [name === 'editDraft' ?
                                                                                  'setEditDraft' :
                                                                                  'setAddDraft']: change,
                                                                                 savingModel: null,
                                                                                 t,
                                                                             })
        expect(view.props.rules).toEqual(input?.speedRates)
        ;(view.props.onChange as (rules: RateDraft[]) => void)([])
        expect(input?.speedRates).toEqual([])
    }
})

test('invalid coefficients and date ranges prevent persistence and keep the editor open', async () => {
    const invalid: RateDraft[] = [
        ...['', '0', '-1', 'NaN', 'Infinity'].map((multiplier) => ({ ...defaultRule, multiplier })),
        { ...defaultRule, multipliers: { prompt: '-1' } },
        { ...defaultRule, multipliers: { completion: 'NaN' } },
        { ...defaultRule, multipliers: { cache_read: 'Infinity' } },
        ...[
            '2026-02-30',
            '2026-13-01',
            'tomorrow',
            '2026-11-19T25:00:00Z',
            '2026-11-19T12:00',
        ].map((effective_from) => ({ ...defaultRule, effective_from })),
        { ...defaultRule, effective_from: '2026-11-20', effective_until: '2026-11-19' },
        { ...defaultRule, effective_from: '2026-11-19T12:00:00Z', effective_until: '2026-11-19T12:00:00Z' },
        { ...defaultRule, effective_until: 'not-a-date' },
    ]
    for (const rule of invalid) {
        expect(parse([rule])).toBeNull()
        const result = await save({ ...draft(), speedRates: [rule] })
        expect(result.patches).toEqual([])
        expect(result.closed).toBe(false)
        expect(result.notices).toEqual([{ message: 'model_management.speed_rates_invalid', kind: 'error' }])
    }
    for (const [from, until] of [
        ['2026-11-19', '2026-11-19'],
        ['2026-11-19T23:59:59Z', '2026-11-19'],
        ['2026-11-19T00:00:00.000000001Z', '2026-11-19T00:00:00.000000002Z'],
        ['2026-11-19T09:00:00+08:00', '2026-11-19T02:00:00Z'],
        ['', '2026-11-19'], ['2026-11-19', ''], ['', ''],
    ]) {
        expect(parse([{ ...defaultRule, effective_from: from, effective_until: until }])).not.toBeNull()
    }
    expect(parse([{ ...defaultRule, multipliers: { prompt: '0', cache_write_1h: '1.2' } }])?.[0].multipliers)
        .toEqual({ prompt: 0, cache_write_1h: 1.2 })
})

test('server overlap rejection keeps the full draft and reports the actual error', async () => {
    const result = await save(draft(), new Error('overlapping speed rate rules'))
    expect(result.readbacks).toEqual([])
    expect(result.closed).toBe(false)
    expect(result.notices).toEqual([
                                       {
                                           message: 'notification.update_failed: overlapping speed rate rules',
                                           kind: 'error',
                                       },
                                   ])
    expect(result.busy).toEqual(['fixture-model', null])
})

test(
    'only changed speed rules require matching server readback, including deletion and legal normalization',
    async () => {
        const input      = draft()
        input.speedRates = [
            {
                ...defaultRule,
                multiplier: '3',
                provider: ' MixedCaseProvider ',
                effective_from: '2026-11-19',
                effective_until: '2026-11-19',
                source: ' source ',
                multipliers: { completion: '0' },
            },
        ]
        for (const readback of [null, original]) {
            const result = await save(input, undefined, readback)
            expect(result.closed).toBe(false)
            expect(result.readbacks).toEqual([])
            expect(result.notices)
                .toEqual([
                             {
                                 message: 'notification.update_failed: model_management.speed_rates_not_saved',
                                 kind: 'error',
                             },
                         ])
        }
        const unchangedDeletion = await save({ ...draft(), speedRates: [] }, undefined, original)
        expect(unchangedDeletion.closed).toBe(false)
        expect(unchangedDeletion.notices[0].message).toContain('speed_rates_not_saved')
        const normalized: ModelCatalogPrice = {
            ...original, speed_rates: [
                {
                    speed: ' FAST ' as ModelCatalogSpeedRate['speed'],
                    multiplier: 3,
                    provider: 'MixedCaseProvider',
                    source: 'source',
                    effective_from: '2026-11-18T16:00:00-08:00',
                    effective_until: '2026-11-20T00:00:00.000Z',
                    multipliers: { completion: 0 },
                },
            ],
        }
        const accepted                      = await save(input, undefined, normalized)
        expect(accepted.closed).toBe(true)
        expect(accepted.notices[0].kind).toBe('success')
        const originalWithoutRules = { ...original }
        delete originalWithoutRules.speed_rates
        expect((await save({ ...draft(), speedRates: [] }, undefined, originalWithoutRules)).closed).toBe(true)
        const baseOnly  = draft()
        baseOnly.prompt = '4'
        expect((await save(baseOnly, undefined, { ...originalWithoutRules, prompt: 4 })).closed).toBe(true)
        const signature                      = scope.speedRatesSignature as (rules: ModelCatalogSpeedRate[]) => string
        const rules: ModelCatalogSpeedRate[] = [{ speed: 'fast', multiplier: 2 }, { speed: 'batch', multiplier: 0.5 }]
        expect(signature(rules)).toBe(signature([...rules].reverse()))
        expect(signature([{ speed: 'fast', multiplier: 2, multipliers: { prompt: 0 } }]))
            .not.toBe(signature([{ speed: 'fast', multiplier: 2 }]))
    },
)

test(
    'clearing base prices while retaining speed rules keeps the draft and never creates a free price implicitly',
    async () => {
        const input = draft()
        for (const field of
            [
                'prompt',
                'completion',
                'cacheRead',
                'cacheWrite',
                'cacheWrite5m',
                'cacheWrite1h',
                'cacheWrite30m',
                'cacheWrite12h',
            ] as const) {
            input[field] = ''
        }
        const result = await save(input)
        expect(result.patches).toEqual([])
        expect(result.closed).toBe(false)
        expect(result.notices).toEqual([{ message: 'model_management.speed_rates_require_price', kind: 'error' }])
        input.prompt       = '0'
        input.completion   = '0'
        const explicitZero = await save(input)
        expect(explicitZero.patches[0].price).toMatchObject({
                                                                prompt: 0,
                                                                completion: 0,
                                                                speed_rates: original.speed_rates,
                                                            })
        const cleared = await save({ ...input, prompt: '', completion: '', speedRates: [] })
        expect(cleared.patches[0].clear_price).toBe(true)
    },
)

test('the actual rule controls add, edit and remove rules without mutating the original price', () => {
    let rules      = toInputs(original.speed_rates)
    const onChange = (value: RateDraft[]) => {
        rules = value
    }
    const find     = (type: unknown, label: string) => elements(editor(rules, onChange)).find((element) =>
                                                                                                  element.type ===
                                                                                                  type &&
                                                                                                  (element.props.label ===
                                                                                                   label ||
                                                                                                   element.props.children ===
                                                                                                   label))!
    ;(find(Button, 'model_management.speed_rate_add').props.onClick as () => void)()
    expect(rules).toHaveLength(2)
    expect(rules[1]).toMatchObject({ speed: 'fast', multiplier: '' })
    const selects = elements(editor(rules, onChange)).filter((element) => element.type === Select)
    expect((selects[1].props.options as { value: string }[]).map((option) => option.value))
        .toEqual(['standard', 'fast', 'ultrafast', 'flex', 'batch'])
    ;(selects[1].props.onChange as (value: string) => void)('ultrafast')
    expect(rules[1].speed).toBe('ultrafast')
    const multipliers = elements(editor(rules, onChange)).filter((element) =>
                                                                     element.type ===
                                                                     Input &&
                                                                     element.props.label ===
                                                                     'model_management.speed_rate_multiplier')
    ;(multipliers[1].props.onChange as (event: object) => void)({ target: { value: '2.5' } })
    expect(rules[1].multiplier).toBe('2.5')
    ;(find(
        Input,
        'model_management.completion_price',
    ).props.onChange as (event: object) => void)({ target: { value: '0' } })
    expect(rules[0].multipliers.completion).toBe('0')
    ;(find(
        Input,
        'model_management.cache_write_30m_price',
    ).props.onChange as (event: object) => void)({ target: { value: '0' } })
    ;(find(
        Input,
        'model_management.cache_write_12h_price',
    ).props.onChange as (event: object) => void)({ target: { value: '2.5' } })
    expect(rules[0].multipliers).toMatchObject({ cache_write_30m: '0', cache_write_12h: '2.5' })
    expect(parse(rules)?.[0].multipliers).toMatchObject({ cache_write_30m: 0, cache_write_12h: 2.5 })
    ;(find(Button, 'model_management.speed_rate_remove').props.onClick as () => void)()
    expect(rules).toHaveLength(1)
    expect(rules[0].speed).toBe('ultrafast')
    expect(original.speed_rates?.[0].speed).toBe('fast')
    const disabled = elements(editor(rules, onChange, t, true))
    expect(disabled.filter((element) => element.type === 'fieldset').every((element) => element.props.disabled)).toBe(
        true)
    expect(disabled.filter((element) => element.type === Select).every((element) => element.props.disabled)).toBe(true)
})

test('new models persist rules through the existing catalog creation action', async () => {
    let patch: { price?: ModelCatalogPrice } | undefined
    const input      = draft(null)
    input.prompt     = '1'
    input.completion = '2'
    input.speedRates = [{ ...defaultRule, multiplier: '2.5' }]
    const add        = sourceCallback<() => Promise<void>>(file, 'handleAddModel', {
        ...scope, addDraft: input, allModelNames: [], t, showNotification: noop, setSavingModel: noop,
        modelsApi: {
            patchModelCatalogModel: async (value: typeof patch) => {
                patch = value
                return { models: [{ name: 'fixture-model', price: value?.price }] }
            },
        },
        applyCatalogResponse: noop, setAddDraft: noop, observePriceRecalculation: noop,
    })
    await add()
    expect(patch?.price).toMatchObject({ prompt: 1, completion: 2, speed_rates: [{ speed: 'fast', multiplier: 2.5 }] })
    patch            = undefined
    input.prompt     = ''
    input.completion = ''
    await add()
    expect(patch).toBeUndefined()
})

test('new-model creation keeps the draft open when an older server ignores speed rules', async () => {
    const input             = draft(null)
    input.prompt            = '1'
    input.speedRates        = [{ ...defaultRule }]
    const notices: string[] = []
    let closed              = false
    let applied             = false
    const add               = sourceCallback<() => Promise<void>>(file, 'handleAddModel', {
        ...scope, addDraft: input, allModelNames: [], t, setSavingModel: noop,
        showNotification: (message: string) => notices.push(message),
        modelsApi: {
            patchModelCatalogModel: async () => ({
                models: [
                    {
                        name: 'fixture-model',
                        price: { prompt: 1 },
                    },
                ],
            }),
        },
        applyCatalogResponse: () => {
            applied = true
        }, setAddDraft: () => {
            closed = true
        }, observePriceRecalculation: noop,
    })
    await add()
    expect(closed).toBe(false)
    expect(applied).toBe(false)
    expect(notices).toEqual(['notification.update_failed: model_management.speed_rates_not_saved'])
})

test('actual catalog and legacy price APIs preserve typed speed rules and complete metadata on the wire', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ models: [] })
    try {
        await modelsApi.patchModelCatalogModel({ name: 'fixture-model', price: original })
        expect(patch.mock.calls[0][0]).toBe('/model-catalog')
        expect(patch.mock.calls[0][1]).toEqual({ name: 'fixture-model', price: original })
    } finally {
        patch.mockRestore()
    }
    const { modelPricesApi } = await import('@/services/api/modelPrices')
    const put                = spyOn(apiClient, 'put').mockResolvedValue({ status: 'ok' })
    try {
        const price = { ...original, prompt: 3, completion: 2, cache: 0.1 }
        await modelPricesApi.put({ 'fixture-model': price })
        expect(put.mock.calls[0][0]).toBe('/model-prices')
        expect(put.mock.calls[0][1]).toEqual({ prices: { 'fixture-model': price } })
    } finally {
        put.mockRestore()
    }
})

test('four languages render the rule editor, price summary and responsive styles offline', async () => {
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
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
        const translate = instance.t.bind(instance)
        const html      = renderToStaticMarkup(editor(toInputs(original.speed_rates), noop, translate))
        for (const key of [
            'speed_rates', 'speed_rate_multiplier', 'speed_rate_provider', 'speed_rate_from', 'speed_rate_until',
            'speed_rate_source', 'speed_rate_bucket_multipliers', 'speed_rate_remove', 'speed_rate_add',
        ]) {
            expect(html).toContain(translate(`model_management.${key}`))
        }
        expect(html).toContain('synthetic-speed-source')
        expect(html).toContain('codex')
        const tooltip = sourceCallback<(price: ModelCatalogPrice, t: unknown) => string>(
            file, 'priceTooltip', {},
        )(original, translate)
        expect(tooltip).toContain('×2.5')
        expect(tooltip).toContain('codex')
        expect(tooltip).toContain('synthetic-speed-source')
    }
    const css = compile(new URL('../src/pages/ModelManagementPage.module.scss', import.meta.url).pathname).css
    expect(css).toContain('.speedRateEditor')
    expect(css).toContain('.speedRateRule')
    expect(css).toContain('.priceRulesDisclosure')
    expect(css).toContain('.priceBucketChoices')
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)')
})
