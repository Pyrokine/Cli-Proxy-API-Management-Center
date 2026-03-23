import {toLocalDateTimeString} from '@/utils/format'
import {type ChangeEvent, useCallback, useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './DateRangePicker.module.scss'

interface DateRangePreset {
    key: string;
    label: string;
    from: Date;
    to: Date;
}

interface DateRangePickerProps {
    from: string;
    to: string;
    onChange: (from: string, to: string, presetKey?: string) => void;
    presets?: DateRangePreset[];
    activePreset?: string;
}

function buildDefaultPresets(t: (key: string) => string): DateRangePreset[] {
    const now = new Date()
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
        { key: 'all', label: t('usage_stats.range_all'), from: new Date(2020, 0, 1), to: now },
    ]
}

export function DateRangePicker({ from, to, onChange, presets, activePreset }: DateRangePickerProps) {
    const { t } = useTranslation()

    const defaultPresets   = useMemo(() => buildDefaultPresets(t), [t])
    const effectivePresets = presets ?? defaultPresets

    const handleFromChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            onChange(e.target.value, to)
        },
        [onChange, to],
    )

    const handleToChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            onChange(from, e.target.value)
        },
        [onChange, from],
    )

    const handlePreset = useCallback(
        (preset: DateRangePreset) => {
            onChange(toLocalDateTimeString(preset.from), toLocalDateTimeString(preset.to), preset.key)
        },
        [onChange],
    )

    return (
        <div className={styles.container}>
            <input
                type='datetime-local'
                className={styles.dateInput}
                value={from}
                onChange={handleFromChange}
                aria-label={t('usage_stats.range_from')}
            />
            <span className={styles.separator}>–</span>
            <input
                type='datetime-local'
                className={styles.dateInput}
                value={to}
                onChange={handleToChange}
                aria-label={t('usage_stats.range_to')}
            />
            <div className={styles.presets}>
                {effectivePresets.map((preset) => (
                    <button
                        key={preset.key}
                        type='button'
                        className={activePreset === preset.key ? styles.presetActive : styles.preset}
                        onClick={() => handlePreset(preset)}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
        </div>
    )
}
