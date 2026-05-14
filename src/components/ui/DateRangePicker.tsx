import { toLocalDateTimeString } from '@/utils/format'
import { type ChangeEvent, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './DateRangePicker.module.scss'

interface DateRangePreset {
    key: string
    label: string
    from: Date
    to: Date
}

interface DateRangePickerProps {
    from: string
    to: string
    onChange: (from: string, to: string, presetKey?: string) => void
    presets?: DateRangePreset[]
    activePreset?: string
    earliestDate?: Date
}

const ALL_PRESET_PLACEHOLDER_FROM = '2020-01-01T00:00'

function buildDefaultPresets(t: (key: string) => string, earliestDate?: Date): DateRangePreset[] {
    const now = new Date()
    const allFrom = earliestDate ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    return [
        {
            key: '24h',
            label: t('usage_stats.range_24h'),
            from: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            to: now,
        },
        {
            key: '7d',
            label: t('usage_stats.range_7d'),
            from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            to: now,
        },
        {
            key: '30d',
            label: t('usage_stats.range_30d'),
            from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
            to: now,
        },
        {
            key: 'all',
            label: t('usage_stats.range_all'),
            from: allFrom,
            to: now,
        },
    ]
}

export function DateRangePicker({ from, to, onChange, presets, activePreset, earliestDate }: DateRangePickerProps) {
    const { t } = useTranslation()

    const defaultPresets = useMemo(() => buildDefaultPresets(t, earliestDate), [t, earliestDate])
    const effectivePresets = presets ?? defaultPresets

    const handleFromChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            onChange(e.target.value, to)
        },
        [onChange, to]
    )

    const handleToChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            onChange(from, e.target.value)
        },
        [onChange, from]
    )

    const handlePreset = useCallback(
        (preset: DateRangePreset) => {
            onChange(toLocalDateTimeString(preset.from), toLocalDateTimeString(preset.to), preset.key)
        },
        [onChange]
    )

    // R-027:preset==='all' 时把 input 的展示值替换成 summary 真实最早时间,
    // 内部 from 仍保留 epoch 占位给后端 API 用,但 UI 不再把这个占位值直接暴露
    // 给用户,summary 尚未返回真实最早时间时显示空串,避免把 2020-01-01 误展示
    // 成业务数据
    const isAllPreset = activePreset === 'all'
    const resolvedAllFrom = useMemo(() => (earliestDate ? toLocalDateTimeString(earliestDate) : ''), [earliestDate])

    const displayFrom = isAllPreset ? resolvedAllFrom || (from === ALL_PRESET_PLACEHOLDER_FROM ? '' : from) : from

    return (
        <div className={styles.container}>
            <div className={styles.dateInputs}>
                <input
                    type="datetime-local"
                    className={styles.dateInput}
                    value={displayFrom}
                    onChange={handleFromChange}
                    aria-label={t('usage_stats.range_from')}
                />
                <span className={styles.separator}>–</span>
                <input
                    type="datetime-local"
                    className={styles.dateInput}
                    value={to}
                    onChange={handleToChange}
                    aria-label={t('usage_stats.range_to')}
                />
            </div>
            <div className={styles.presets}>
                {effectivePresets.map((preset) => (
                    <button
                        key={preset.key}
                        type="button"
                        className={activePreset === preset.key ? styles.presetActive : styles.preset}
                        onClick={() => handlePreset(preset)}
                        title={`${toLocalDateTimeString(preset.from)} ~ ${toLocalDateTimeString(preset.to)}`}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
        </div>
    )
}
