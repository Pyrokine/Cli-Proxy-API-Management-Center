import { CardSkeleton, type CardSkeletonProps } from '@/components/common/CardSkeleton'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './DataStatusCard.module.scss'

/**
 * DataStatusCard 是 aview dataStatusUI 模式的 CPA 适配版:把散落在每张卡片内的
 * `loading && !data` / `error && retry` / `没数据` 三段写法收拢成一个状态机,
 * 让 ServiceHealthCard / CredentialStatsCard / ModelStatsCard / 价格表都用同
 * 一套 UI 语言展示等待 / 失败 / 空 三个非业务状态.
 *
 * 状态机:
 *   - loading: 用 CardSkeleton 占位; 第一次拉数据,或正在重新拉
 *   - error:   红色文案 + 重试按钮
 *   - empty:   中性文案,告诉用户筛选条件下无数据
 *   - ready:   渲染 children — 业务真正的内容
 *
 * 使用模式:
 *   <DataStatusCard status={status} errorMessage={err} onRetry={refresh}
 *                   emptyText={t('usage_stats.no_data')} skeletonVariant='chart'>
 *     {chartJSX}
 *   </DataStatusCard>
 */
export type DataStatusValue = 'checking' | 'missing' | 'loading' | 'loaded' | 'empty' | 'error' | 'refreshing' | 'ready'

export interface DataStatusCardProps {
    status: DataStatusValue
    children?: ReactNode
    loadingText?: string
    emptyText?: string
    emptyHint?: string
    errorMessage?: string
    onRetry?: () => void
    retrying?: boolean
    /** Skeleton 占位形态:'rows' / 'chart' / 'grid'.默认 'rows'. */
    skeletonVariant?: CardSkeletonProps['variant']
    skeletonRowCount?: number
    /** loading 时要不要显示卡片标题骨架.默认 false (父级 Card 通常已有 title). */
    skeletonShowTitle?: boolean
    /** 自定义 loading 节点,优先级高于 CardSkeleton — 用于按钮内 spinner 这类细粒度场景. */
    loadingFallback?: ReactNode
    className?: string
}

export function DataStatusCard({
    status,
    children,
    loadingText,
    emptyText,
    emptyHint,
    errorMessage,
    onRetry,
    retrying,
    skeletonVariant = 'rows',
    skeletonRowCount = 3,
    skeletonShowTitle = false,
    loadingFallback,
    className,
}: DataStatusCardProps) {
    const { t } = useTranslation()
    const rootCls = className ? `${styles.statusRoot} ${className}` : styles.statusRoot

    if (status === 'ready' || status === 'loaded') {
        return <>{children}</>
    }

    if (status === 'checking' || status === 'loading' || status === 'refreshing') {
        if (loadingFallback !== undefined) {
            return <>{loadingFallback}</>
        }
        return (
            <div className={rootCls} role="status" aria-busy="true">
                <CardSkeleton variant={skeletonVariant} rowCount={skeletonRowCount} showTitle={skeletonShowTitle} />
                {loadingText && <div className={styles.statusHint}>{loadingText}</div>}
            </div>
        )
    }

    if (status === 'error') {
        return (
            <div className={rootCls} role="alert">
                <div className={`${styles.statusText} ${styles.statusError}`}>{t('common.error', '出错了')}</div>
                {errorMessage && <div className={styles.statusHint}>{errorMessage}</div>}
                {onRetry && (
                    <div className={styles.statusActions}>
                        <button type="button" className={styles.retryButton} onClick={onRetry} disabled={retrying}>
                            {retrying ? t('common.loading', '加载中...') : t('common.retry', '重试')}
                        </button>
                    </div>
                )}
            </div>
        )
    }

    if (status === 'missing') {
        return (
            <div className={rootCls} role="status">
                <div className={styles.statusText}>{emptyText || t('usage_stats.no_data', '暂无数据')}</div>
                {emptyHint && <div className={styles.statusHint}>{emptyHint}</div>}
            </div>
        )
    }

    // status === 'empty'
    return (
        <div className={rootCls} role="status">
            <div className={styles.statusText}>{emptyText || t('usage_stats.no_data', '暂无数据')}</div>
            {emptyHint && <div className={styles.statusHint}>{emptyHint}</div>}
            {onRetry && (
                <div className={styles.statusActions}>
                    <button type="button" className={styles.retryButton} onClick={onRetry} disabled={retrying}>
                        {retrying ? t('common.loading', '加载中...') : t('common.refresh', '刷新')}
                    </button>
                </div>
            )}
        </div>
    )
}
