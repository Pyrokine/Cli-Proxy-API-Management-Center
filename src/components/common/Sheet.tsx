import {Input} from '@/components/ui/Input'
import {LoadingSpinner} from '@/components/ui/LoadingSpinner'
import {Pagination} from '@/components/ui/Pagination'
import {type ReactNode, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {DataStatusCard, type DataStatusValue} from './DataStatusCard'
import styles from './Sheet.module.scss'

export interface SheetColumn<T> {
    key: string
    header: ReactNode
    sortable?: boolean
    sortValue?: (row: T) => string | number
    cell: (row: T) => ReactNode
    className?: string
    headerClassName?: string
}

interface SheetProps<T> {
    rows: T[]
    columns: SheetColumn<T>[]
    rowKey: (row: T, index: number) => string
    status: DataStatusValue
    errorMessage?: string
    onRetry?: () => void
    retrying?: boolean
    emptyText?: string
    emptyHint?: string
    loadingText?: string
    loadingFallback?: ReactNode
    skeletonVariant?: 'rows' | 'chart' | 'grid'
    skeletonRowCount?: number
    searchable?: boolean
    searchPlaceholder?: string
    searchPredicate?: (row: T, keyword: string) => boolean
    defaultSortKey?: string
    defaultSortDir?: 'asc' | 'desc'
    pagination?: boolean
    defaultPageSize?: number
    pageSizeOptions?: number[]
    toolbarContent?: ReactNode
    summaryContent?: ReactNode
    className?: string
    refreshing?: boolean
    refreshingText?: string
}

function compareSortValue(left: string | number, right: string | number): number {
    if (typeof left === 'number' && typeof right === 'number') {
        return left - right
    }
    return String(left ?? '').localeCompare(String(right ?? ''))
}

export function Sheet<T>({
                             rows,
                             columns,
                             rowKey,
                             status,
                             errorMessage,
                             onRetry,
                             retrying,
                             emptyText,
                             emptyHint,
                             loadingText,
                             loadingFallback,
                             skeletonVariant = 'rows',
                             skeletonRowCount = 3,
                             searchable = false,
                             searchPlaceholder,
                             searchPredicate,
                             defaultSortKey,
                             defaultSortDir = 'desc',
                             pagination = false,
                             defaultPageSize = 25,
                             pageSizeOptions = [10, 25, 50, 100],
                             toolbarContent,
                             summaryContent,
                             className,
                             refreshing = false,
                             refreshingText,
                         }: SheetProps<T>) {
    const { t }                         = useTranslation()
    const [searchValue, setSearchValue] = useState('')
    const [sortKey, setSortKey]         = useState<string | null>(defaultSortKey ?? null)
    const [sortDir, setSortDir]         = useState<'asc' | 'desc'>(defaultSortDir)
    const [page, setPage]               = useState(1)
    const [pageSize, setPageSize]       = useState(defaultPageSize)

    const filteredRows = useMemo(() => {
        if (!searchable || !searchValue.trim()) {
            return rows
        }
        const keyword = searchValue.trim().toLowerCase()
        if (searchPredicate) {
            return rows.filter((row) => searchPredicate(row, keyword))
        }
        return rows.filter((row) =>
                               columns.some((column) => {
                                   const value = column.sortValue ? column.sortValue(row) : ''
                                   return String(value ?? '')
                                       .toLowerCase()
                                       .includes(keyword)
                               }),
        )
    }, [columns, rows, searchPredicate, searchValue, searchable])

    const sortedRows = useMemo(() => {
        if (!sortKey) {
            return filteredRows
        }
        const column = columns.find((item) => item.key === sortKey)
        if (!column?.sortValue) {
            return filteredRows
        }
        const direction = sortDir === 'asc' ? 1 : -1
        return [...filteredRows].sort(
            (left, right) => direction * compareSortValue(column.sortValue!(left), column.sortValue!(right)),
        )
    }, [columns, filteredRows, sortDir, sortKey])

    const totalPages  = pagination ? Math.max(1, Math.ceil(sortedRows.length / pageSize)) : 1
    const currentPage = pagination ? Math.min(page, totalPages) : page

    const pagedRows = useMemo(() => {
        if (!pagination) {
            return sortedRows
        }
        const start = (currentPage - 1) * pageSize
        return sortedRows.slice(start, start + pageSize)
    }, [currentPage, pageSize, pagination, sortedRows])

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
            return
        }
        const column = columns.find((item) => item.key === key)
        if (!column?.sortable) {
            return
        }
        setSortKey(key)
        setSortDir('asc')
        setPage(1)
    }

    const renderHeader = (column: SheetColumn<T>) => {
        const headerClassName                               = column.headerClassName
                                                              ? `${styles.sortableHeader} ${column.headerClassName}`
                                                              : styles.sortableHeader
        const ariaSort: 'none' | 'ascending' | 'descending' =
                  sortKey === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'

        if (!column.sortable) {
            return (
                <th key={column.key} className={column.headerClassName}>
                    {column.header}
                </th>
            )
        }

        return (
            <th key={column.key} className={headerClassName} aria-sort={ariaSort}>
                <button type='button' className={styles.sortHeaderButton} onClick={() => handleSort(column.key)}>
                    {column.header}
                    {sortKey === column.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
            </th>
        )
    }

    const rootClassName = className ? `${styles.sheetRoot} ${className}` : styles.sheetRoot

    return (
        <div className={rootClassName}>
            {(searchable || toolbarContent || summaryContent) && (
                <div className={styles.sheetToolbar}>
                    <div className={styles.sheetMeta}>{summaryContent}</div>
                    <div className={styles.sheetMeta}>
                        {toolbarContent}
                        {searchable && (
                            <Input
                                value={searchValue}
                                onChange={(event) => {
                                    setSearchValue(event.target.value)
                                    setPage(1)
                                }}
                                placeholder={searchPlaceholder || t('common.search', { defaultValue: '搜索...' })}
                                style={{ maxWidth: 240 }}
                            />
                        )}
                        {searchable && (
                            <span className={styles.sheetCount}>
                                ({filteredRows.length}/{rows.length})
                            </span>
                        )}
                    </div>
                </div>
            )}

            <DataStatusCard
                status={status}
                errorMessage={errorMessage}
                onRetry={onRetry}
                retrying={retrying}
                emptyText={emptyText}
                emptyHint={emptyHint}
                loadingText={loadingText}
                loadingFallback={loadingFallback}
                skeletonVariant={skeletonVariant}
                skeletonRowCount={skeletonRowCount}
            >
                <div className={styles.busyShell}>
                    {refreshing && (
                        <div className={styles.busyOverlay} aria-busy='true'>
                            <div className={styles.busyPill}>
                                <LoadingSpinner size={16} className={styles.busySpinner} />
                                <span>{refreshingText || t('common.loading')}</span>
                            </div>
                        </div>
                    )}
                    <div className={styles.sheetScroll}>
                        <div className={styles.sheetTableWrap}>
                            <table className={styles.sheetTable}>
                                <thead>
                                <tr>{columns.map((column) => renderHeader(column))}</tr>
                                </thead>
                                <tbody>
                                {pagedRows.map((row, index) => (
                                    <tr key={rowKey(row, index)}>
                                        {columns.map((column) => (
                                            <td key={column.key} className={column.className}>
                                                {column.cell(row)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    {pagination && sortedRows.length > 0 && (
                        <div className={styles.paginationWrap}>
                            <Pagination
                                total={sortedRows.length}
                                page={currentPage}
                                pageSize={pageSize}
                                pageSizeOptions={pageSizeOptions}
                                onPageChange={setPage}
                                onPageSizeChange={(size) => {
                                    setPageSize(size)
                                    setPage(1)
                                }}
                            />
                        </div>
                    )}
                </div>
            </DataStatusCard>
        </div>
    )
}
