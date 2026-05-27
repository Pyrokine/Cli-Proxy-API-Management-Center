import {useEffect, useMemo, useState} from 'react'
import type {HttpMethod, ParsedLogLine, PersistedLogFilters, StatusGroup} from './logTypes'
import {resolveStatusGroup} from './logTypes'

const PATH_FILTER_LIMIT = 12

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

export function useLogFilters(options: UseLogFiltersOptions): UseLogFiltersReturn {
    const { parsedLines, initialFilters, onFiltersChange } = options

    const [methodFilters, setMethodFilters] = useState<HttpMethod[]>(() => initialFilters?.methodFilters ?? [])
    const [statusFilters, setStatusFilters] = useState<StatusGroup[]>(() => initialFilters?.statusFilters ?? [])
    const [pathFilters, setPathFilters]     = useState<string[]>(() => initialFilters?.pathFilters ?? [])

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

    const pathOptions = useMemo(() => {
        const counts = new Map<string, number>()
        parsedLines.forEach((line) => {
            if (!line.path) {
                return
            }
            counts.set(line.path, (counts.get(line.path) ?? 0) + 1)
        })
        return Array.from(counts.entries())
                    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                    .slice(0, PATH_FILTER_LIMIT)
                    .map(([path, count]) => ({ path, count }))
    }, [parsedLines])

    const validPathSet         = useMemo(() => new Set(pathOptions.map((item) => item.path)), [pathOptions])
    const validPathFilters     = useMemo(
        () => pathFilters.filter((path) => validPathSet.has(path)),
        [pathFilters, validPathSet],
    )
    const methodFilterSet      = useMemo(() => new Set(methodFilters), [methodFilters])
    const statusFilterSet      = useMemo(() => new Set(statusFilters), [statusFilters])
    const pathFilterSet        = useMemo(() => new Set(validPathFilters), [validPathFilters])
    const hasStructuredFilters = methodFilters.length > 0 || statusFilters.length > 0 || validPathFilters.length > 0

    useEffect(() => {
        if (!onFiltersChange) {
            return
        }
        if (
            initialFilters &&
            areArraysEqual(initialFilters.methodFilters, methodFilters) &&
            areArraysEqual(initialFilters.statusFilters, statusFilters) &&
            areArraysEqual(initialFilters.pathFilters, validPathFilters)
        ) {
            return
        }
        onFiltersChange({
                            methodFilters,
                            statusFilters,
                            pathFilters: validPathFilters,
                        })
    }, [initialFilters, methodFilters, onFiltersChange, statusFilters, validPathFilters])

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
        pathFilters: validPathFilters,
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
