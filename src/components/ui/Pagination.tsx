import {useCallback, useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './Pagination.module.scss'
import {Select} from './Select'

interface PaginationProps {
    total: number
    page: number
    pageSize: number
    pageSizeOptions?: number[]
    onPageChange: (page: number) => void
    onPageSizeChange?: (size: number) => void
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100]

function buildPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1)
    }
    const pages: (number | 'ellipsis')[] = [1]
    if (current > 3) {
        pages.push('ellipsis')
    }
    const start = Math.max(2, current - 1)
    const end   = Math.min(total - 1, current + 1)
    for (let i = start; i <= end; i++) {
        pages.push(i)
    }
    if (current < total - 2) {
        pages.push('ellipsis')
    }
    pages.push(total)
    return pages
}

export function Pagination({
                               total,
                               page,
                               pageSize,
                               pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
                               onPageChange,
                               onPageSizeChange,
                           }: PaginationProps) {
    const { t } = useTranslation()

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const safePage   = Math.max(1, Math.min(page, totalPages))
    const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1
    const rangeEnd   = Math.min(safePage * pageSize, total)

    const pages = useMemo(() => buildPageNumbers(safePage, totalPages), [safePage, totalPages])

    const handlePageSizeChange = useCallback(
        (value: string) => {
            const newSize = Number(value)
            if (Number.isFinite(newSize) && newSize > 0) {
                onPageSizeChange?.(newSize)
                const newTotalPages = Math.ceil(total / newSize)
                if (safePage > newTotalPages) {
                    onPageChange(newTotalPages)
                }
            }
        },
        [onPageSizeChange, onPageChange, total, safePage],
    )

    if (total === 0) {
        return null
    }

    return (
        <div className={styles.pagination}>
            <span className={styles.info}>{t('pagination.range', { start: rangeStart, end: rangeEnd, total })}</span>

            <div className={styles.controls}>
                <button
                    className={styles.pageBtn}
                    disabled={safePage <= 1}
                    onClick={() => onPageChange(1)}
                    aria-label={t('pagination.first')}
                >
                    {t('pagination.first')}
                </button>
                <button
                    className={styles.pageBtn}
                    disabled={safePage <= 1}
                    onClick={() => onPageChange(safePage - 1)}
                    aria-label={t('pagination.prev')}
                >
                    {t('pagination.prev')}
                </button>

                {pages.map((p, idx) =>
                               p === 'ellipsis' ? (
                                   <span key={`e${idx}`} className={styles.ellipsis}>
                            &hellip;
                        </span>
                               ) : (
                                   <button
                                       key={p}
                                       className={`${styles.pageBtn} ${p === safePage ? styles.pageBtnActive : ''}`}
                                       onClick={() => onPageChange(p)}
                                       aria-current={p === safePage ? 'page' : undefined}
                                   >
                                       {p}
                                   </button>
                               ),
                )}

                <button
                    className={styles.pageBtn}
                    disabled={safePage >= totalPages}
                    onClick={() => onPageChange(safePage + 1)}
                    aria-label={t('pagination.next')}
                >
                    {t('pagination.next')}
                </button>
                <button
                    className={styles.pageBtn}
                    disabled={safePage >= totalPages}
                    onClick={() => onPageChange(totalPages)}
                    aria-label={t('pagination.last')}
                >
                    {t('pagination.last')}
                </button>

                {onPageSizeChange && (
                    <div className={styles.pageSizeSelect}>
                        <Select
                            value={String(pageSize)}
                            onChange={handlePageSizeChange}
                            options={pageSizeOptions.map((n) => ({
                                value: String(n),
                                label: t('pagination.per_page', { count: n }),
                            }))}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
