import {API_KEY_STRENGTH_SEGMENTS, type ApiKeyStrengthLevel, evaluateApiKeyStrength} from '@/utils/apiKeyStrength'
import {type CSSProperties, memo, useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './ApiKeyStrengthMeter.module.scss'

const LEVEL_COLORS: Record<ApiKeyStrengthLevel, string> = {
    empty: 'var(--text-quaternary)',
    masked: 'var(--text-tertiary)',
    weak: 'var(--error-color)',
    fair: 'var(--warning-color)',
    good: 'var(--primary-color)',
    strong: 'var(--success-color)',
}

const SEGMENT_INDEXES = Array.from({ length: API_KEY_STRENGTH_SEGMENTS }, (_, index) => index)

export const ApiKeyStrengthMeter = memo(function ApiKeyStrengthMeter({
                                                                         id,
                                                                         value,
                                                                     }: {
    id?: string
    value: string
}) {
    const { t }                                      = useTranslation()
    const evaluation                                 = useMemo(() => evaluateApiKeyStrength(value), [value])
    const { level, segments, patterns, suggestions } = evaluation
    const levelLabel                                 = t(`config_management.visual.api_keys.strength.levels.${level}`)

    return (
        <div
            id={id}
            className={styles.meter}
            style={{ '--api-key-strength-color': LEVEL_COLORS[level] } as CSSProperties}
        >
            <div className={styles.summary}>
                <span className={styles.title}>{t('config_management.visual.api_keys.strength.label')}</span>
                <span className={styles.level}>{levelLabel}</span>
            </div>
            <div
                className={styles.track}
                role='progressbar'
                aria-label={t('config_management.visual.api_keys.strength.label')}
                aria-valuemin={0}
                aria-valuemax={API_KEY_STRENGTH_SEGMENTS}
                aria-valuenow={segments}
                aria-valuetext={levelLabel}
            >
                {SEGMENT_INDEXES.map((index) => (
                    <span
                        key={index}
                        className={`${styles.segment} ${index < segments ? styles.segmentFilled : ''}`}
                        aria-hidden='true'
                    />
                ))}
            </div>
            {patterns.length > 0 ? (
                <div className={styles.detail}>
                    <span className={styles.detailLabel}>
                        {t('config_management.visual.api_keys.strength.patterns_title')}
                    </span>
                    <span>
                        {patterns.map((pattern) => (
                            t(`config_management.visual.api_keys.strength.patterns.${pattern}`)
                        )).join(' · ')}
                    </span>
                </div>
            ) : null}
            {suggestions.length > 0 ? (
                <div className={styles.detail}>
                    <span className={styles.detailLabel}>
                        {t('config_management.visual.api_keys.strength.suggestions_title')}
                    </span>
                    <ul className={styles.suggestions}>
                        {suggestions.map((suggestion) => (
                            <li key={suggestion}>
                                {t(`config_management.visual.api_keys.strength.suggestions.${suggestion}`)}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    )
})
