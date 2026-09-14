import {formatInstantShort} from './relativeTime'
import {parseIsoToMs} from './resetInstants'

export function formatQuotaResetTime(value?: string): string {
    if (!value) {
        return '-'
    }
    const resetAtMs = parseIsoToMs(value)
    return resetAtMs === null ? '-' : formatInstantShort(resetAtMs)
}
