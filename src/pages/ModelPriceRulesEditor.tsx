import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import type {ModelCatalogCoverageGap} from '@/services/api/models'
import {REQUEST_SPEEDS} from '@/services/api/usage'
import type {useTranslation} from 'react-i18next'
import styles from './ModelManagementPage.module.scss'
import {
    type ChargeRateDraft,
    type ConditionalRateDraft,
    COVERAGE_DIMENSIONS,
    MODALITIES,
    type ModalityRateDraft,
    type PriceRulesDraft,
    TOKEN_RATE_FIELDS,
    type TokenInputs,
} from './modelPriceRules'

type Translate = ReturnType<typeof useTranslation>['t']
const CHARGE_PRESETS = [
    { kind: 'web_search', unit: 'request' },
    { kind: 'web_fetch', unit: 'request' },
    { kind: 'generated_image', unit: 'image' },
] as const

function TokenRateFields({ value, onChange, t }: {
    value: TokenInputs;
    onChange: (patch: TokenInputs) => void;
    t: Translate
}) {
    return <div className={styles.formGrid}>
        {TOKEN_RATE_FIELDS.map(([bucket, key, fallback]) => <Input
            key={bucket} label={`${t(`model_management.${key}`, { defaultValue: fallback })} ($/1M)`}
            value={value[bucket] ?? ''} type='number' min='0' step='any'
            placeholder={t('model_management.rule_rate_empty', { defaultValue: '留空不设置覆盖单价' })}
            onChange={(event) => onChange({ [bucket]: event.target.value })}
        />)}
    </div>
}

export function ModelPriceRulesEditor({ value, onChange, disabled, t }: {
    value: PriceRulesDraft; onChange: (value: PriceRulesDraft) => void; disabled: boolean; t: Translate
}) {
    const updateConditional = (index: number, patch: Partial<ConditionalRateDraft>) =>
        onChange({
                     ...value,
                     conditionalRates: value.conditionalRates.map((rule, position) => position === index ?
                         { ...rule, ...patch } :
                                                                                      rule),
                 })
    const updateModality    = (index: number, patch: Partial<ModalityRateDraft>) =>
        onChange({
                     ...value,
                     modalityRates: value.modalityRates.map((rule, position) => position === index ?
                         { ...rule, ...patch } :
                                                                                rule),
                 })
    const updateCharge      = (index: number, patch: Partial<ChargeRateDraft>) =>
        onChange({
                     ...value,
                     chargeRates: value.chargeRates.map((rule, position) => position === index ?
                         { ...rule, ...patch } :
                                                                            rule),
                 })
    return <section className={styles.speedRateEditor}>
        <p className={styles.muted}>{t(
            'model_management.price_values_hint',
            { defaultValue: '留空表示未配置，0 表示免费；token 单价按每百万 token 计' },
        )}</p>
        <details className={styles.priceRulesDisclosure}>
            <summary>{t(
                'model_management.conditional_rates',
                { defaultValue: '输入长度、处理模式和地区条件价' },
            )} ({value.conditionalRates.length})
            </summary>
            <div className={styles.speedRateEditor}>
                <p className={styles.muted}>{t(
                    'model_management.conditional_rates_hint',
                    { defaultValue: '输入长度包含上下边界，留空表示不限；处理模式留空时调整基础价，指定后覆盖该模式最终单价' },
                )}</p>
                {value.conditionalRates.map((rule, index) => <fieldset className={styles.speedRateRule} key={index}
                                                                       disabled={disabled}>
                    <legend>{t(
                        'model_management.price_rule_number',
                        { defaultValue: '规则 {{number}}', number: index + 1 },
                    )}</legend>
                    <div className={styles.formGrid}>
                        <Input label={t('model_management.price_rule_id', { defaultValue: '规则名称（可留空）' })}
                               value={rule.id ?? ''}
                               onChange={(event) => updateConditional(index, { id: event.target.value })} />
                        <Input label={t('model_management.speed_rate_provider')} value={rule.provider ?? ''}
                               placeholder={t('model_management.speed_rate_provider_placeholder')}
                               onChange={(event) => updateConditional(index, { provider: event.target.value })} />
                        <Input label={t('model_management.price_region')} value={rule.region ?? ''}
                               placeholder={t(
                                   'model_management.rule_any_region',
                                   { defaultValue: '留空适用于所有地区' },
                               )}
                               onChange={(event) => updateConditional(index, { region: event.target.value })} />
                        <Input label={t('model_management.rule_min_input', { defaultValue: '输入 token 数下限（含）' })}
                               value={rule.min_input_tokens}
                               type='number' min='0' step='1' onChange={(event) => updateConditional(
                            index,
                            { min_input_tokens: event.target.value },
                        )} />
                        <Input label={t('model_management.rule_max_input', { defaultValue: '输入 token 数上限（含）' })}
                               value={rule.max_input_tokens}
                               type='number' min='0' step='1' onChange={(event) => updateConditional(
                            index,
                            { max_input_tokens: event.target.value },
                        )} />
                        <div>
                            <span className={styles.muted}>{t(
                                'model_management.rule_actual_speed',
                                { defaultValue: '实际处理模式' },
                            )}</span>
                            <Select value={rule.speed ?? ''} disabled={disabled}
                                    ariaLabel={t(
                                        'model_management.rule_actual_speed',
                                        { defaultValue: '实际处理模式' },
                                    )}
                                    options={[
                                        {
                                            value: '',
                                            label: t(
                                                'model_management.rule_base_rates',
                                                { defaultValue: '基础单价（所有处理模式）' },
                                            ),
                                        },
                                        ...REQUEST_SPEEDS.filter((speed) => speed !== 'unknown')
                                                         .map((speed) => ({
                                                             value: speed,
                                                             label: t(`usage_stats.request_events_speed_${speed}`),
                                                         })),
                                    ]}
                                    onChange={(speed) => updateConditional(
                                        index,
                                        { speed: speed as ConditionalRateDraft['speed'] },
                                    )} />
                        </div>
                        <Input label={t('model_management.speed_rate_from')} value={rule.effective_from ?? ''}
                               placeholder={t('model_management.speed_rate_date_placeholder')}
                               onChange={(event) => updateConditional(index, { effective_from: event.target.value })} />
                        <Input label={t('model_management.speed_rate_until')} value={rule.effective_until ?? ''}
                               placeholder={t('model_management.speed_rate_date_placeholder')}
                               onChange={(event) => updateConditional(
                                   index,
                                   { effective_until: event.target.value },
                               )} />
                        <Input label={t('model_management.speed_rate_source')} value={rule.source ?? ''}
                               onChange={(event) => updateConditional(index, { source: event.target.value })} />
                    </div>
                    <TokenRateFields value={rule} onChange={(patch) => updateConditional(index, patch)} t={t} />
                    <Input label={t('model_management.rule_region_multiplier', { defaultValue: '地区 token 费率倍率' })}
                           value={rule.multiplier}
                           type='number' min='0' step='any'
                           hint={t(
                               'model_management.rule_region_multiplier_hint',
                               { defaultValue: '倍率须大于 0，仅用于已指定地区的独立规则；该规则中的各类 Token 单价与未计价项目留空，附加费保持原值' },
                           )}
                           onChange={(event) => updateConditional(index, { multiplier: event.target.value })} />
                    <details>
                        <summary>{t(
                            'model_management.rule_unpriced_buckets',
                            { defaultValue: '标记缺少单价的项目' },
                        )}</summary>
                        <div className={styles.priceBucketChoices}>
                            {TOKEN_RATE_FIELDS.map(([bucket, key, fallback]) => <label key={bucket}>
                                <input type='checkbox' checked={rule.unpriced_buckets?.includes(bucket) ?? false}
                                       onChange={(event) => updateConditional(index, {
                                           unpriced_buckets: event.target.checked
                                                             ?
                                               [...(rule.unpriced_buckets ?? []), bucket] :
                                                             (rule.unpriced_buckets ?? []).filter((entry) => entry !==
                                                                                                             bucket),
                                       })} />
                                {t(`model_management.${key}`, { defaultValue: fallback })}
                            </label>)}
                        </div>
                    </details>
                    <Button variant='ghost' size='sm' disabled={disabled} onClick={() => onChange({
                                                                                                      ...value,
                                                                                                      conditionalRates: value.conditionalRates.filter(
                                                                                                          (
                                                                                                              _,
                                                                                                              position,
                                                                                                          ) => position !==
                                                                                                               index),
                                                                                                  })}>
                        {t('model_management.price_rule_remove', { defaultValue: '删除规则' })}
                    </Button>
                </fieldset>)}
                <Button variant='secondary' size='sm' disabled={disabled} onClick={() => onChange({
                                                                                                      ...value,
                                                                                                      conditionalRates: [
                                                                                                          ...value.conditionalRates,
                                                                                                          {
                                                                                                              min_input_tokens: '',
                                                                                                              max_input_tokens: '',
                                                                                                              multiplier: '',
                                                                                                          },
                                                                                                      ],
                                                                                                  })}>
                    {t('model_management.conditional_rate_add', { defaultValue: '添加条件价' })}
                </Button>
            </div>
        </details>
        <details className={styles.priceRulesDisclosure}>
            <summary>{t(
                'model_management.modality_rates',
                { defaultValue: '文字、图片、音频和视频 token 单价' },
            )} ({value.modalityRates.length})
            </summary>
            <div className={styles.speedRateEditor}>
                <p className={styles.muted}>{t(
                    'model_management.modality_rates_hint',
                    { defaultValue: '按请求实际记录的模态 token 用量计费；按张、秒或次计费的项目在附加费中配置' },
                )}</p>
                {value.modalityRates.map((rule, index) => <fieldset className={styles.speedRateRule} key={index}
                                                                    disabled={disabled}>
                    <legend>{t(
                        'model_management.price_rule_number',
                        { defaultValue: '规则 {{number}}', number: index + 1 },
                    )}</legend>
                    <span className={styles.muted}>{t(
                        'model_management.rule_modality',
                        { defaultValue: '内容类型' },
                    )}</span>
                    <Select value={rule.modality} disabled={disabled}
                            ariaLabel={t('model_management.rule_modality', { defaultValue: '内容类型' })}
                            options={MODALITIES.map((modality) => ({
                                value: modality,
                                label: t(`model_management.rule_modality_${modality}`),
                            }))}
                            onChange={(modality) => updateModality(
                                index,
                                { modality: modality as ModalityRateDraft['modality'] },
                            )} />
                    <TokenRateFields value={rule} onChange={(patch) => updateModality(index, patch)} t={t} />
                    <Button variant='ghost' size='sm' disabled={disabled} onClick={() => onChange({
                                                                                                      ...value,
                                                                                                      modalityRates: value.modalityRates.filter(
                                                                                                          (
                                                                                                              _,
                                                                                                              position,
                                                                                                          ) => position !==
                                                                                                               index),
                                                                                                  })}>
                        {t('model_management.price_rule_remove', { defaultValue: '删除规则' })}
                    </Button>
                </fieldset>)}
                <Button variant='secondary' size='sm' disabled={disabled} onClick={() => onChange({
                                                                                                      ...value,
                                                                                                      modalityRates: [
                                                                                                          ...value.modalityRates,
                                                                                                          {
                                                                                                              modality: MODALITIES.find(
                                                                                                                            (modality) => !value.modalityRates.some(
                                                                                                                                (rule) => rule.modality ===
                                                                                                                                          modality)) ??
                                                                                                                        'text',
                                                                                                          },
                                                                                                      ],
                                                                                                  })}>
                    {t('model_management.modality_rate_add', { defaultValue: '添加模态单价' })}
                </Button>
            </div>
        </details>
        <details className={styles.priceRulesDisclosure}>
            <summary>{t(
                'model_management.charge_rates',
                { defaultValue: '工具调用及其他按量附加费' },
            )} ({value.chargeRates.length})
            </summary>
            <div className={styles.speedRateEditor}>
                <p className={styles.muted}>{t(
                    'model_management.charge_rates_hint',
                    { defaultValue: '项目、单位、供应商、地区和分辨率须与请求记录一致；单价表示每个计价数量的美元费用，例如每 1000 次的费用；指定处理模式时使用该模式的最终单价，附加费不乘 token 费率倍率' },
                )}</p>
                <Select value='' disabled={disabled}
                        ariaLabel={t('model_management.charge_preset_add', { defaultValue: '按常见计费项目添加' })}
                        options={[
                            {
                                value: '',
                                label: t('model_management.charge_preset_add', { defaultValue: '按常见计费项目添加' }),
                            },
                            ...CHARGE_PRESETS.map(({ kind }) => ({
                                value: kind,
                                label: t(`model_management.charge_preset_${kind}`),
                            })),
                        ]}
                        onChange={(kind) => {
                            const preset = CHARGE_PRESETS.find((entry) => entry.kind === kind)
                            if (preset) {
                                onChange({
                                             ...value,
                                             chargeRates: [
                                                 ...value.chargeRates,
                                                 { ...preset, price: '', per_units: '' },
                                             ],
                                         })
                            }
                        }} />
                {value.chargeRates.map((rule, index) => <fieldset className={styles.speedRateRule} key={index}
                                                                  disabled={disabled}>
                    <legend>{t(
                        'model_management.price_rule_number',
                        { defaultValue: '规则 {{number}}', number: index + 1 },
                    )}</legend>
                    <div className={styles.formGrid}>
                        <Input label={t('model_management.charge_kind', { defaultValue: '计费项目' })} value={rule.kind}
                               onChange={(event) => updateCharge(index, { kind: event.target.value })} />
                        <Input label={t('model_management.charge_unit', { defaultValue: '用量单位' })} value={rule.unit}
                               onChange={(event) => updateCharge(index, { unit: event.target.value })} />
                        <Input label={t('model_management.charge_price', { defaultValue: '单价（美元）' })}
                               value={rule.price} type='number' min='0' step='any'
                               onChange={(event) => updateCharge(index, { price: event.target.value })} />
                        <Input label={t('model_management.charge_per_units', { defaultValue: '计价数量' })}
                               value={rule.per_units} type='number' min='0' step='any'
                               onChange={(event) => updateCharge(index, { per_units: event.target.value })} />
                        <div>
                            <span className={styles.muted}>{t(
                                'model_management.rule_actual_speed',
                                { defaultValue: '实际处理模式' },
                            )}</span>
                            <Select value={rule.speed ?? ''} disabled={disabled}
                                    ariaLabel={t(
                                        'model_management.rule_actual_speed',
                                        { defaultValue: '实际处理模式' },
                                    )}
                                    options={[
                                        {
                                            value: '',
                                            label: t(
                                                'model_management.rule_any_speed',
                                                { defaultValue: '所有处理模式' },
                                            ),
                                        },
                                        ...REQUEST_SPEEDS.filter((speed) => speed !== 'unknown')
                                                         .map((speed) => ({
                                                             value: speed,
                                                             label: t(`usage_stats.request_events_speed_${speed}`),
                                                         })),
                                    ]}
                                    onChange={(speed) => updateCharge(index, { speed })} />
                        </div>
                        <Input label={t('model_management.speed_rate_provider')} value={rule.provider ?? ''}
                               placeholder={t('model_management.speed_rate_provider_placeholder')}
                               onChange={(event) => updateCharge(index, { provider: event.target.value })} />
                        <Input label={t('model_management.price_region')} value={rule.region ?? ''} placeholder={t(
                            'model_management.rule_any_region',
                            { defaultValue: '留空适用于所有地区' },
                        )} onChange={(event) => updateCharge(index, { region: event.target.value })} />
                        <Input label={t('model_management.charge_resolution', { defaultValue: '分辨率（可留空）' })}
                               value={rule.resolution ?? ''}
                               onChange={(event) => updateCharge(index, { resolution: event.target.value })} />
                        <Input label={t('model_management.speed_rate_source')} value={rule.source ?? ''}
                               onChange={(event) => updateCharge(index, { source: event.target.value })} />
                    </div>
                    <Button variant='ghost' size='sm' disabled={disabled} onClick={() => onChange({
                                                                                                      ...value,
                                                                                                      chargeRates: value.chargeRates.filter(
                                                                                                          (
                                                                                                              _,
                                                                                                              position,
                                                                                                          ) => position !==
                                                                                                               index),
                                                                                                  })}>
                        {t('model_management.price_rule_remove', { defaultValue: '删除规则' })}
                    </Button>
                </fieldset>)}
                <Button variant='secondary' size='sm' disabled={disabled} onClick={() => onChange({
                                                                                                      ...value,
                                                                                                      chargeRates: [
                                                                                                          ...value.chargeRates,
                                                                                                          {
                                                                                                              kind: '',
                                                                                                              unit: '',
                                                                                                              price: '',
                                                                                                              per_units: '',
                                                                                                          },
                                                                                                      ],
                                                                                                  })}>
                    {t('model_management.charge_rate_add', { defaultValue: '添加自定义附加费' })}
                </Button>
            </div>
        </details>
        <details className={styles.priceRulesDisclosure}>
            <summary>{t(
                'model_management.coverage_gaps',
                { defaultValue: '尚未覆盖的计价条件' },
            )} ({value.coverageGaps.length})
            </summary>
            <div className={styles.speedRateEditor}>
                <p className={styles.muted}>{t('model_management.coverage_gaps_hint', {
                    defaultValue: '记录影响费用计算的缺失信息，涉及这些条件的请求会在详情中显示原因',
                })}</p>
                {value.coverageGaps.map((gap, index) => <fieldset className={styles.speedRateRule} key={index}
                                                                  disabled={disabled}>
                    <legend>{t(
                        'model_management.price_rule_number',
                        { defaultValue: '规则 {{number}}', number: index + 1 },
                    )}</legend>
                    <Select value={gap.dimension} disabled={disabled}
                            ariaLabel={t('model_management.coverage_dimension', { defaultValue: '缺少价格的条件' })}
                            options={COVERAGE_DIMENSIONS.map((dimension) => ({
                                value: dimension,
                                label: t(`model_management.coverage_dimension_${dimension}`),
                            }))}
                            onChange={(dimension) => onChange({
                                                                  ...value,
                                                                  coverageGaps: value.coverageGaps.map((
                                                                                                           entry,
                                                                                                           position,
                                                                                                       ) => position ===
                                                                                                            index ?
                                                                      {
                                                                          ...entry,
                                                                          dimension: dimension as ModelCatalogCoverageGap['dimension'],
                                                                      } :
                                                                                                            entry),
                                                              })} />
                    <Input label={t('model_management.coverage_reason', { defaultValue: '原因' })} value={gap.reason}
                           onChange={(event) => onChange({
                                                             ...value,
                                                             coverageGaps: value.coverageGaps.map((
                                                                                                      entry,
                                                                                                      position,
                                                                                                  ) => position ===
                                                                                                       index ?
                                                                 { ...entry, reason: event.target.value } :
                                                                                                       entry),
                                                         })} />
                    <Button variant='ghost' size='sm' disabled={disabled} onClick={() => onChange({
                                                                                                      ...value,
                                                                                                      coverageGaps: value.coverageGaps.filter(
                                                                                                          (
                                                                                                              _,
                                                                                                              position,
                                                                                                          ) => position !==
                                                                                                               index),
                                                                                                  })}>
                        {t('model_management.price_rule_remove', { defaultValue: '删除规则' })}
                    </Button>
                </fieldset>)}
                <Button variant='secondary' size='sm' disabled={disabled} onClick={() => onChange({
                                                                                                      ...value,
                                                                                                      coverageGaps: [
                                                                                                          ...value.coverageGaps,
                                                                                                          {
                                                                                                              dimension: 'unconditional',
                                                                                                              reason: '',
                                                                                                          },
                                                                                                      ],
                                                                                                  })}>
                    {t('model_management.coverage_gap_add', { defaultValue: '添加未覆盖条件' })}
                </Button>
            </div>
        </details>
    </section>
}
