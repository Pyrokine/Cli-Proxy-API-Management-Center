import type {LogState} from './logTypes'

export const MAX_LOG_TEXT_UNITS = 8 * 1024 * 1024

export const emptyLogBuffer = (): LogState => ({buffer: [], bufferStart: 0, nextId: 0})

export function replaceLogBuffer(previous: LogState, lines: string[], maxLines: number): LogState {
    const buffer = trimLogBuffer(lines, maxLines)
    const nextId = previous.nextId + lines.length
    return {buffer, bufferStart: nextId - buffer.length, nextId}
}

export function appendLogBuffer(previous: LogState, lines: string[], maxLines: number): LogState {
    const buffer = trimLogBuffer([...previous.buffer, ...lines], maxLines)
    const nextId = previous.nextId + lines.length
    return {buffer, bufferStart: nextId - buffer.length, nextId}
}

export function shouldCatchUpLogPage(
    page: { lines: string[]; nextCursor?: string; cursorReset?: boolean },
    requestedCursor: string | undefined,
    pageSize: number,
): boolean {
    return Boolean(requestedCursor && page.nextCursor && page.nextCursor !== requestedCursor &&
                   !page.cursorReset && page.lines.length >= pageSize)
}

export function trimLogBuffer(lines: string[], maxLines: number, maxTextUnits = MAX_LOG_TEXT_UNITS): string[] {
    let textUnits = lines.reduce((total, line) => total + line.length + 1, 0)
    let first     = 0
    while (lines.length - first > 1 && (lines.length - first > maxLines || textUnits > maxTextUnits)) {
        textUnits -= lines[first].length + 1
        ++first
    }
    return first > 0 ? lines.slice(first) : lines
}
