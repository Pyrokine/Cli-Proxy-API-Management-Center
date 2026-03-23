import {useMemo, useState} from 'react'

/**
 * 通用列表搜索过滤 hook
 * @param items 原始列表
 * @param predicate 匹配函数，query 已转小写
 * @param threshold 列表项数 ≥ threshold 时才显示搜索框
 */
export function useListFilter<T>(items: T[], predicate: (item: T, query: string) => boolean, threshold = 6) {
    const [query, setQuery] = useState('')
    const showSearch        = items.length >= threshold

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return q ? items.filter((item) => predicate(item, q)) : items
    }, [items, query, predicate])

    return { query, setQuery, filtered, showSearch, total: items.length }
}
