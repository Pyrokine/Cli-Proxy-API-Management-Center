import {useEffect, useMemo, useState} from 'react'
import type {HttpMethod, ParsedLogLine, PersistedLogFilters, StatusGroup} from './logTypes'
import {resolveStatusGroup} from './logTypes'

const PATH_FILTER_LIMIT = 12

export const normalizeLogPathFilters = (paths: string[]): string[] =>
    [...new Set(paths.map((path) => {
        const trimmed = path.trim()
        return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed
    }).filter(Boolean))]

export const buildLogPathOptions = (
    parsedLines: ParsedLogLine[],
    selectedPaths: string[],
): Array<{ path: string; count: number }> => {
    const counts = new Map<string, number>()
    parsedLines.forEach((line) => {
        if (line.path) {
            counts.set(line.path, (counts.get(line.path) ?? 0) + 1)
        }
    })
    const popular = Array.from(counts.entries())
                         .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                         .slice(0, PATH_FILTER_LIMIT)
                         .map(([path]) => path)
    return [...new Set([...popular, ...selectedPaths])].map((path) => ({
        path,
        count: counts.get(path) ?? 0,
    }))
}

const areArraysEqual = <T, >(left: T[], right: T[]) =>
    left.length === right.length && left.every((item, index) => item === right[index])

interface UseLogFiltersOptions {
    parsedLines: ParsedLogLine[]
    initialFilters?: PersistedLogFilters
    onFiltersChange?: (filters: PersistedLogFilters) => void
}

interface UseLogFiltersReturn {
    methodFilters: HttpMethod[]
    statusFilters: StatusGroup[]
    pathFilters: string[]
    methodFilterSet: Set<HttpMethod>
    statusFilterSet: Set<StatusGroup>
    pathFilterSet: Set<string>
    hasStructuredFilters: boolean
    methodCounts: Partial<Record<HttpMethod, number>>
    statusCounts: Partial<Record<StatusGroup, number>>
    pathOptions: Array<{ path: string; count: number }>
    toggleMethodFilter: (method: HttpMethod) => void
    toggleStatusFilter: (group: StatusGroup) => void
    togglePathFilter: (path: string) => void
    clearStructuredFilters: () => void
}

export const matchesLogFilters = (
    line: ParsedLogLine,
    levelFilter: string,
    filters: Pick<UseLogFiltersReturn, 'methodFilterSet' | 'statusFilterSet' | 'pathFilterSet'>,
): boolean => {
    if (levelFilter && line.level !== levelFilter) {
        return false
    }
    if (filters.methodFilterSet.size > 0 && (!line.method || !filters.methodFilterSet.has(line.method))) {
        return false
    }
    const statusGroup = resolveStatusGroup(line.statusCode)
    if (filters.statusFilterSet.size > 0 && (!statusGroup || !filters.statusFilterSet.has(statusGroup))) {
        return false
    }
    return !(filters.pathFilterSet.size > 0 && (!line.path || !filters.pathFilterSet.has(line.path)))
}

export function useLogFilters(options: UseLogFiltersOptions): UseLogFiltersReturn {
    const { parsedLines, initialFilters, onFiltersChange } = options

    const [methodFilters, setMethodFilters] = useState<HttpMethod[]>(() => initialFilters?.methodFilters ?? [])
    const [statusFilters, setStatusFilters] = useState<StatusGroup[]>(() => initialFilters?.statusFilters ?? [])
    const [pathFilters, setPathFilters]     = useState<string[]>(() =>
        normalizeLogPathFilters(initialFilters?.pathFilters ?? []))

    const methodCounts = useMemo(() => {
        const counts: Partial<Record<HttpMethod, number>> = {}
        parsedLines.forEach((line) => {
            if (!line.method) {
                return
            }
            counts[line.method] = (counts[line.method] ?? 0) + 1
        })
        return counts
    }, [parsedLines])

    const statusCounts = useMemo(() => {
        const counts: Partial<Record<StatusGroup, number>> = {}
        parsedLines.forEach((line) => {
            const statusGroup = resolveStatusGroup(line.statusCode)
            if (!statusGroup) {
                return
            }
            counts[statusGroup] = (counts[statusGroup] ?? 0) + 1
        })
        return counts
    }, [parsedLines])

    const pathOptions          = useMemo(() => buildLogPathOptions(parsedLines, pathFilters), [parsedLines, pathFilters])
    const methodFilterSet      = useMemo(() => new Set(methodFilters), [methodFilters])
    const statusFilterSet      = useMemo(() => new Set(statusFilters), [statusFilters])
    const pathFilterSet        = useMemo(() => new Set(pathFilters), [pathFilters])
    const hasStructuredFilters = methodFilters.length > 0 || statusFilters.length > 0 || pathFilters.length > 0

    useEffect(() => {
        if (!onFiltersChange) {
            return
        }
        if (
            initialFilters &&
            areArraysEqual(initialFilters.methodFilters, methodFilters) &&
            areArraysEqual(initialFilters.statusFilters, statusFilters) &&
            areArraysEqual(initialFilters.pathFilters, pathFilters)
        ) {
            return
        }
        onFiltersChange({
                            methodFilters,
                            statusFilters,
                            pathFilters,
                        })
    }, [initialFilters, methodFilters, onFiltersChange, statusFilters, pathFilters])

    const toggleMethodFilter = (method: HttpMethod) => {
        setMethodFilters((prev) => (prev.includes(method) ? prev.filter((item) => item !== method) : [...prev, method]))
    }

    const toggleStatusFilter = (group: StatusGroup) => {
        setStatusFilters((prev) => (prev.includes(group) ? prev.filter((item) => item !== group) : [...prev, group]))
    }

    const togglePathFilter = (path: string) => {
        setPathFilters((prev) => (prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]))
    }

    const clearStructuredFilters = () => {
        setMethodFilters([])
        setStatusFilters([])
        setPathFilters([])
    }

    return {
        methodFilters,
        statusFilters,
        pathFilters,
        methodFilterSet,
        statusFilterSet,
        pathFilterSet,
        hasStructuredFilters,
        methodCounts,
        statusCounts,
        pathOptions,
        toggleMethodFilter,
        toggleStatusFilter,
        togglePathFilter,
        clearStructuredFilters,
    }
}
