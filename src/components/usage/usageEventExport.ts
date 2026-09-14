import type {EventsResponse, UsageEvent} from '@/services/api/usage'

export const USAGE_EVENT_EXPORT_PAGE_SIZE  = 500
export const MAX_USAGE_EVENT_EXPORT_EVENTS = 10000

export class UsageEventExportLimitError extends Error {
    constructor(readonly limit: number) {
        super(`usage event export exceeds ${limit} events`)
        this.name = 'UsageEventExportLimitError'
    }
}

interface CreateUsageEventExportOptions {
    format: 'csv' | 'json'
    signal: AbortSignal
    csvHeader: string[]
    fetchPage: (page: number, signal: AbortSignal) => Promise<EventsResponse>
    formatCsvRow: (event: UsageEvent, index: number) => string
    formatJsonEvent: (event: UsageEvent, index: number) => unknown
}

export async function createUsageEventExport({
                                                 format,
                                                 signal,
                                                 csvHeader,
                                                 fetchPage,
                                                 formatCsvRow,
                                                 formatJsonEvent,
                                             }: CreateUsageEventExportOptions): Promise<Blob | null> {
    const parts: BlobPart[] = format === 'csv' ? [`${csvHeader.join(',')}\n`] : ['[']
    let currentPage         = 1
    let exportedCount       = 0
    let firstJsonEvent      = true

    while (true) {
        if (signal.aborted) {
            return null
        }
        const data = await fetchPage(currentPage, signal)
        if (data.total > MAX_USAGE_EVENT_EXPORT_EVENTS) {
            throw new UsageEventExportLimitError(MAX_USAGE_EVENT_EXPORT_EVENTS)
        }
        if (!data.events.length) {
            break
        }

        if (format === 'csv') {
            const pageRows = data.events.map((event, index) => formatCsvRow(event, exportedCount + index))
            parts.push(`${pageRows.join('\n')}\n`)
        } else {
            const pageEvents = data.events.map((event, index) =>
                                                   JSON.stringify(formatJsonEvent(event, exportedCount + index)),
            )
            if (pageEvents.length) {
                parts.push(`${firstJsonEvent ? '' : ','}${pageEvents.join(',')}`)
                firstJsonEvent = false
            }
        }

        exportedCount += data.events.length
        if (exportedCount >= data.total || data.events.length < USAGE_EVENT_EXPORT_PAGE_SIZE) {
            break
        }
        ++currentPage
    }

    if (signal.aborted || exportedCount === 0) {
        return null
    }
    if (format === 'json') {
        parts.push(']')
    }
    return new Blob(parts, {
        type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
    })
}
