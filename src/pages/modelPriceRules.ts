import type {
    ModelCatalogChargeRate,
    ModelCatalogConditionalRate,
    ModelCatalogCoverageGap,
    ModelCatalogModalityRate,
    ModelCatalogPrice,
} from '@/services/api/models'
import {REQUEST_SPEEDS} from '@/services/api/usage'

export const TOKEN_RATE_FIELDS = [
    ['prompt', 'prompt_price', '输入'],
    ['completion', 'completion_price', '输出'],
    ['cache_read', 'cache_read_price', '缓存读取'],
    ['cache_write', 'cache_write_price', '缓存写入'],
    ['cache_write_5m', 'cache_write_5m_price', '5 分钟缓存写入'],
    ['cache_write_1h', 'cache_write_1h_price', '1 小时缓存写入'],
    ['cache_write_30m', 'cache_write_30m_price', '30 分钟缓存写入'],
    ['cache_write_12h', 'cache_write_12h_price', '12 小时缓存写入'],
] as const

type TokenBucket = typeof TOKEN_RATE_FIELDS[number][0]
export type TokenInputs = Partial<Record<TokenBucket, string>>
export type ConditionalRateDraft =
    Omit<ModelCatalogConditionalRate, TokenBucket | 'min_input_tokens' | 'max_input_tokens' | 'multiplier'>
    & TokenInputs
    & {
        min_input_tokens: string
        max_input_tokens: string
        multiplier: string
    }
export type ModalityRateDraft = Omit<ModelCatalogModalityRate, TokenBucket> & TokenInputs
export type ChargeRateDraft = Omit<ModelCatalogChargeRate, 'price' | 'per_units' | 'speed'> & {
    price: string;
    per_units: string;
    speed?: string
}
export type PriceRulesDraft = {
    conditionalRates: ConditionalRateDraft[]
    modalityRates: ModalityRateDraft[]
    chargeRates: ChargeRateDraft[]
    requestScoped: '' | 'true' | 'false'
    coverageGaps: ModelCatalogCoverageGap[]
}
type PriceRules = Pick<ModelCatalogPrice, 'conditional_rates' | 'modality_rates' | 'charge_rates' | 'request_scoped' | 'coverage_gaps'>
export const MODALITIES          = ['text', 'image', 'audio', 'video'] as const
export const COVERAGE_DIMENSIONS = [
    'input_length',
    'cache_write_ttl',
    'region',
    'modality',
    'tools',
    'unconditional',
    'calendar',
] as const

function tokenRatesToInputs(rates: Partial<Record<TokenBucket, number>>): Record<TokenBucket, string> {
    const inputs = {
        prompt: '', completion: '', cache_read: '', cache_write: '',
        cache_write_5m: '', cache_write_1h: '', cache_write_30m: '', cache_write_12h: '',
    }
    for (const [bucket] of TOKEN_RATE_FIELDS) {
        const value    = rates[bucket]
        inputs[bucket] = typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
    }
    return inputs
}

export function priceRulesToInputs(price: ModelCatalogPrice | null, newPrice = false): PriceRulesDraft {
    return {
        conditionalRates: (price?.conditional_rates ?? []).map((rule) => ({
            ...rule, ...tokenRatesToInputs(rule),
            min_input_tokens: rule.min_input_tokens == null ? '' : String(rule.min_input_tokens),
            max_input_tokens: rule.max_input_tokens == null ? '' : String(rule.max_input_tokens),
            multiplier: rule.multiplier == null ? '' : String(rule.multiplier),
        })),
        modalityRates: (price?.modality_rates ?? []).map((rule) => ({ ...rule, ...tokenRatesToInputs(rule) })),
        chargeRates: (price?.charge_rates ?? []).map((rule) => ({
            ...rule,
            speed: rule.speed ?? '',
            price: String(rule.price),
            per_units: String(rule.per_units),
        })),
        requestScoped: typeof price?.request_scoped === 'boolean' ?
                       String(price.request_scoped) as 'true' | 'false' :
                       newPrice ? 'true' : '',
        coverageGaps: (price?.coverage_gaps ?? []).map((gap) => ({ ...gap })),
    }
}

export function priceBoundary(value: string, until: boolean): bigint | null | undefined {
    if (!value) {
        return undefined
    }
    const match  = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(
        value)
    const parsed = Date.parse(value)
    if (!match || !Number.isFinite(parsed)) {
        return null
    }
    const calendarDate = new Date(`${match[1]}T00:00:00Z`)
    if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== match[1]) {
        return null
    }
    const milliseconds = parsed + (until && value.length === 10 ? 24 * 60 * 60 * 1000 : 0)
    const fraction     = (value.match(/\.(\d+)/)?.[1] ?? '').slice(0, 9)
    return BigInt(milliseconds) * 1_000_000n + BigInt(fraction.padEnd(9, '0').slice(3))
}

function parseTokenRates(inputs: TokenInputs) {
    const rates: Record<TokenBucket, number | undefined> = {
        prompt: undefined, completion: undefined, cache_read: undefined, cache_write: undefined,
        cache_write_5m: undefined, cache_write_1h: undefined, cache_write_30m: undefined, cache_write_12h: undefined,
    }
    for (const [bucket] of TOKEN_RATE_FIELDS) {
        const text  = inputs[bucket]?.trim() ?? ''
        const value = text ? Number(text) : undefined
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            return null
        }
        rates[bucket] = value
    }
    return rates
}

export function parsePriceRules(draft: PriceRulesDraft):
    { ok: true; price: PriceRules } | {
    ok: false;
    section: 'conditional_rates' | 'modality_rates' | 'charge_rates' | 'coverage_gaps'
} {
    const conditional: ModelCatalogConditionalRate[] = []
    const ids                                        = new Set<string>()
    for (const rule of draft.conditionalRates) {
        const rates      = parseTokenRates(rule)
        const min        = rule.min_input_tokens.trim() ? Number(rule.min_input_tokens) : undefined
        const max        = rule.max_input_tokens.trim() ? Number(rule.max_input_tokens) : undefined
        const multiplier = rule.multiplier.trim() ? Number(rule.multiplier) : undefined
        const fromText   = rule.effective_from?.trim() || ''
        const untilText  = rule.effective_until?.trim() || ''
        const from       = priceBoundary(fromText, false)
        const until      = priceBoundary(untilText, true)
        const unpriced   = [
            ...new Set((rule.unpriced_buckets ?? []).map((bucket) => bucket.trim())
                                                    .filter(Boolean)),
        ].sort()
        const hasRate    = rates && Object.values(rates).some((value) => value !== undefined)
        const id         = rule.id?.trim() || ''
        if (!rates || [min, max].some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 0)) ||
            (min !== undefined && max !== undefined && min > max) ||
            (rule.speed && !REQUEST_SPEEDS.some((speed) => speed !== 'unknown' && speed === rule.speed)) ||
            from === null || until === null || (from !== undefined && until !== undefined && from >= until) ||
            (id && ids.has(id)) ||
            unpriced.some((bucket) => !TOKEN_RATE_FIELDS.some(([known]) => known === bucket) ||
            rates[bucket as TokenBucket] !==
            undefined) ||
            (multiplier !==
             undefined &&
             (!Number.isFinite(multiplier) ||
              multiplier <=
              0 ||
              !rule.region?.trim() ||
              hasRate ||
              unpriced.length >
              0)) ||
            (!hasRate && multiplier === undefined && unpriced.length === 0)) {
            return { ok: false, section: 'conditional_rates' }
        }
        if (id) {
            ids.add(id)
        }
        conditional.push({
                             ...rule, ...rates,
                             id: id || undefined,
                             provider: rule.provider?.trim() || undefined,
                             region: rule.region?.trim() || undefined,
                             speed: rule.speed || undefined,
                             min_input_tokens: min,
                             max_input_tokens: max,
                             multiplier,
                             effective_from: fromText || undefined,
                             effective_until: untilText || undefined,
                             unpriced_buckets: unpriced.length ? unpriced : undefined,
                             source: rule.source?.trim() || undefined,
                         })
    }
    const modalities: ModelCatalogModalityRate[] = []
    const seenModalities                         = new Set<string>()
    for (const rule of draft.modalityRates) {
        const rates = parseTokenRates(rule)
        if (!MODALITIES.includes(rule.modality) || seenModalities.has(rule.modality) || !rates ||
            !Object.values(rates).some((value) => value !== undefined)) {
            return { ok: false, section: 'modality_rates' }
        }
        seenModalities.add(rule.modality)
        modalities.push({ ...rule, ...rates })
    }
    const charges: ModelCatalogChargeRate[] = []
    const seenCharges                       = new Set<string>()
    for (const rule of draft.chargeRates) {
        const price     = Number(rule.price)
        const perUnits  = Number(rule.per_units)
        const speedText = rule.speed?.trim().toLowerCase() || ''
        const speed     = REQUEST_SPEEDS.find((known) => known === speedText)
        if (speed === 'unknown' || (speedText && speed === undefined)) {
            return { ok: false, section: 'charge_rates' }
        }
        const normalized = {
            ...rule, kind: rule.kind.trim(), unit: rule.unit.trim(), price, per_units: perUnits,
            provider: rule.provider?.trim() || undefined, region: rule.region?.trim() || undefined, speed,
            resolution: rule.resolution?.trim() || undefined, source: rule.source?.trim() || undefined,
        }
        const key        = JSON.stringify([
                                              normalized.kind,
                                              normalized.unit,
                                              normalized.provider,
                                              normalized.region,
                                              normalized.speed,
                                              normalized.resolution,
                                          ])
        if (!normalized.kind || !normalized.unit || !rule.price.trim() || !Number.isFinite(price) || price < 0 ||
            !rule.per_units.trim() || !Number.isFinite(perUnits) || perUnits <= 0 || seenCharges.has(key)) {
            return { ok: false, section: 'charge_rates' }
        }
        seenCharges.add(key)
        charges.push(normalized)
    }
    if (draft.coverageGaps.some((gap) => !COVERAGE_DIMENSIONS.includes(gap.dimension) || !gap.reason.trim())) {
        return { ok: false, section: 'coverage_gaps' }
    }
    return {
        ok: true, price: {
            conditional_rates: conditional, modality_rates: modalities, charge_rates: charges,
            request_scoped: draft.requestScoped === '' ? undefined : draft.requestScoped === 'true',
            coverage_gaps: draft.coverageGaps.map((gap) => ({ ...gap, reason: gap.reason.trim() })),
        },
    }
}

export function withPriceRules(
    base: ModelCatalogPrice | null,
    rules: PriceRules,
    original: ModelCatalogPrice | null = null,
): ModelCatalogPrice | null {
    if (!base &&
        !rules.conditional_rates?.length &&
        !rules.modality_rates?.length &&
        !rules.charge_rates?.length &&
        !rules.coverage_gaps?.length) {
        return null
    }
    const metadata = { ...original }
    if (!base) {
        for (const [bucket] of TOKEN_RATE_FIELDS) {
            delete metadata[bucket]
        }
        delete metadata.cache
    }
    return {
        ...(!original && { status: 'complete', currency: 'USD' }),
        ...(base ?? metadata), ...rules,
        auto_apply: original ? original.auto_apply ?? (original.status === 'partial' ? false : undefined) :
                    base?.auto_apply ?? true,
    }
}

export function priceRulesSignature(price: ModelCatalogPrice | null | undefined): string {
    const rates = (value: Partial<Record<TokenBucket, number>>) => TOKEN_RATE_FIELDS.map(([bucket]) => value[bucket] ??
                                                                                                       null)
    const text  = (value: string | undefined) => value?.trim() || ''
    const date  = (value: string | undefined, until: boolean) => {
        const parsed = priceBoundary(text(value), until)
        return parsed === null ? `invalid:${value}` : parsed?.toString() ?? ''
    }
    return JSON.stringify([
                              rates({ ...price, cache_read: price?.cache_read ?? price?.cache }),
                              (price?.conditional_rates ?? []).map((rule) => [
                                  text(rule.id),
                                  text(rule.provider),
                                  text(rule.region),
                                  text(rule.speed).toLowerCase(),
                                  rule.min_input_tokens ?? null,
                                  rule.max_input_tokens ?? null,
                                  date(rule.effective_from, false),
                                  date(rule.effective_until, true),
                                  rates(rule),
                                  rule.multiplier ?? null,
                                  [...new Set((rule.unpriced_buckets ?? []).map(text))].sort(),
                                  text(rule.source),
                              ]),
                              (price?.modality_rates ?? []).map((rule) => [
                                  rule.modality.trim().toLowerCase(),
                                  rates(rule),
                              ]),
                              (price?.charge_rates ?? []).map((rule) => [
                                  text(rule.kind),
                                  text(rule.unit),
                                  rule.price,
                                  rule.per_units,
                                  text(rule.provider),
                                  text(rule.region),
                                  text(rule.speed).toLowerCase(),
                                  text(rule.resolution),
                                  text(rule.source),
                              ]),
                              price?.request_scoped ?? null,
                              (price?.coverage_gaps ?? []).map((gap) => [gap.dimension.trim(), gap.reason.trim()]),
                          ])
}
