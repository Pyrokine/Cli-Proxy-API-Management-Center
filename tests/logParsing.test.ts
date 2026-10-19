import {describe, expect, test} from 'bun:test'

import {parseLogLine} from '@/pages/hooks/logParsing'
import type {HttpMethod, StatusGroup} from '@/pages/hooks/logTypes'
import {buildLogPathOptions, matchesLogFilters, normalizeLogPathFilters} from '@/pages/hooks/useLogFilters'

const prefix = '[2026-09-30 12:34:56] [a1b2c3d4] [info ] [gin_logger.go:110]'

describe('fork request log parsing', () => {
    test('parses a quoted request path with spaces and pipes without losing error details', () => {
        const raw = `${prefix} 429 | 1h2m3s | ::1 | POST "/v1/chat completions?q=a|b" [credits] | exhausted`
        expect(parseLogLine(raw)).toMatchObject({
            timestamp: '2026-09-30 12:34:56',
            requestId: 'a1b2c3d4',
            source: 'gin_logger.go:110',
            statusCode: 429,
            latency: '1h2m3s',
            ip: '::1',
            method: 'POST',
            path: '/v1/chat completions?q=a|b',
            message: '[credits] | exhausted',
        })
    })

    test.each(['12ns', '500µs', '1h0m0s', '2m3s'])(
        'parses Go duration %s',
        (duration) => {
            expect(parseLogLine(`${prefix} 200 | ${duration} | 127.0.0.1 | GET "/healthz"`).latency)
                .toBe(duration)
        },
    )

    test.each(['::', '::1', '2001:db8::1', '2001:db8:0:0:0:0:0:1'])(
        'parses IPv6 address %s',
        (ip) => {
            expect(parseLogLine(`${prefix} 200 | 1ms | ${ip} | GET "/v1/models"`).ip).toBe(ip)
        },
    )

    test('keeps unknown source labels and annotations in the message', () => {
        const raw = `${prefix} [credits] note | elapsed=1h2m3s extra | peer=::1 extra | request_id=abc extra | GET "/v1/models" [credits] custom`
        const parsed = parseLogLine(raw)
        expect(parsed.message).toBe(
            '[credits] note | elapsed=1h2m3s extra | peer=::1 extra | request_id=abc extra | [credits] custom',
        )
        expect(parsed.requestId).toBe('abc')
        expect(parsed.ip).toBe('::1')
        expect(parsed.path).toBe('/v1/models')
    })

    test('preserves a full request_id and treats panic as fatal', () => {
        expect(parseLogLine('request_id=12345678-1234-4321-abcd-123456789abc').requestId)
            .toBe('12345678-1234-4321-abcd-123456789abc')
        const panic = parseLogLine('[2026-09-30 12:34:56] [--------] [panic] stopped')
        expect(panic.level).toBe('fatal')
        expect(panic.requestId).toBeUndefined()
        expect(panic.message).toBe('stopped')
    })

    test('does not mistake a time or unrelated method name for a request', () => {
        expect(parseLogLine('task ran at 12:34:56').ip).toBeUndefined()
        expect(parseLogLine(`${prefix} operation GET failed | detail`).message)
            .toBe('operation GET failed | detail')
    })
})

describe('log level selection', () => {
    test('filters parsed levels and composes with method, status, and path', () => {
        const info = parseLogLine(`${prefix} 200 | 1ms | ::1 | GET "/v1/models"`)
        const warn = parseLogLine('[2026-09-30 12:34:56] [abcd1234] [warning] GET "/v1/models"')
        const unknown = parseLogLine('unclassified message')
        const filters = {
            methodFilterSet: new Set<HttpMethod>(['GET']),
            statusFilterSet: new Set<StatusGroup>(['2xx']),
            pathFilterSet: new Set(['/v1/models']),
        }

        expect(matchesLogFilters(info, 'info', filters)).toBe(true)
        expect(matchesLogFilters(info, 'warn', filters)).toBe(false)
        expect(matchesLogFilters(warn, 'warn', filters)).toBe(false)
        expect(matchesLogFilters(unknown, 'info', filters)).toBe(false)
        expect(matchesLogFilters(unknown, '', {
            methodFilterSet: new Set<HttpMethod>(),
            statusFilterSet: new Set<StatusGroup>(),
            pathFilterSet: new Set<string>(),
        })).toBe(true)
    })

    test('matches normalized panic and warning levels', () => {
        const noFilters = {
            methodFilterSet: new Set<HttpMethod>(),
            statusFilterSet: new Set<StatusGroup>(),
            pathFilterSet: new Set<string>(),
        }
        expect(matchesLogFilters(parseLogLine('[panic] stopped'), 'fatal', noFilters)).toBe(true)
        expect(matchesLogFilters(parseLogLine('[warning] delayed'), 'warn', noFilters)).toBe(true)
        expect(matchesLogFilters(parseLogLine('[warning] delayed'), 'error', noFilters)).toBe(false)
    })
})

describe('log path filter selection', () => {
    test('normalizes quoted persisted paths and deduplicates them', () => {
        expect(normalizeLogPathFilters(['"/v1/models"', '/v1/models', '/rare']))
            .toEqual(['/v1/models', '/rare'])
    })

    test('keeps selected paths outside the top 12 and after the log window empties', () => {
        const parsedLines = Array.from({length: 14}, (_, index) =>
            parseLogLine(`${prefix} 200 | 1ms | ::1 | GET "/path/${String(index).padStart(2, '0')}"`),
        )
        const selected = ['/path/13', '/missing', '/path/00']
        const options  = buildLogPathOptions(parsedLines, selected)
        expect(options).toHaveLength(14)
        expect(options).toContainEqual({path: '/path/13', count: 1})
        expect(options).toContainEqual({path: '/missing', count: 0})
        expect(options.filter(({path}) => path === '/path/00')).toHaveLength(1)
        expect(buildLogPathOptions([], ['/v1/models']))
            .toEqual([{path: '/v1/models', count: 0}])
    })
})
