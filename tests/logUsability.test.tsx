import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {IconChevronDown, IconChevronUp, IconCopy} from '@/components/ui/icons'
import '@/i18n'
import {parseLogLine} from '@/pages/hooks/logParsing'
import type {ParsedLogLine} from '@/pages/hooks/logTypes'
import {isTraceableRequestPath} from '@/pages/hooks/useTraceResolver'
import type {ErrorLogFile} from '@/services/api/logs'
import {formatFileSize, formatLogTimestamp, formatUnixTimestamp} from '@/utils/format'
import {redactSensitiveText} from '@/utils/redaction'
import {describe, expect, mock, test} from 'bun:test'
import React, {type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file   = 'pages/LogsPage.tsx'
const styles = new Proxy<Record<string, string>>({}, { get: (_target, key) => String(key) })
const t      = (key: string) => key
const noop   = () => {
}
type LogEntry = ParsedLogLine & { id: number }
type Element = ReactElement<Record<string, unknown>>

function elements(node: ReactNode): Element[] {
    if (Array.isArray(node)) {
        return node.flatMap(elements)
    }
    if (!React.isValidElement<Record<string, unknown>>(node)) {
        return []
    }
    return [node, ...elements(node.props.children as ReactNode)]
}

function rowFixture() {
    let expandedLogId: number | null = null
    const copy                       = mock(async (_raw: string) => {
    })
    const openTraceModal             = mock()
    const startLongPress             = mock()
    const columns                    = sourceCallback<() => SheetColumn<LogEntry>[]>(
        file,
        'logColumns',
        { React, styles, t },
    )()
    const render                     = (line: LogEntry) => sourceInitializer<(line: LogEntry) => ReactElement>(
        file,
        'renderLogRow',
        {
            React,
            styles,
            t,
            Button,
            IconChevronDown,
            IconChevronUp,
            IconCopy,
            isTraceableRequestPath,
            formatLogTimestamp,
            redactSensitiveText,
            expandedLogId,
            logColumns: columns,
            setExpandedLogId: (next: (value: number | null) => number | null) => {
                expandedLogId =
                    next(expandedLogId)
            },
            copyLogLine: copy,
            trace: { openTraceModal },
            startLongPress,
            cancelLongPress: noop,
            handleLongPressMove: noop,
            requestLogHomeIpByIdRef: {
                current: {
                    [line.requestId ??
                     '']: '192.0.2.10',
                },
            },
        },
    )(
        line)
    return { render, copy, openTraceModal, startLongPress, columns }
}

const requestId      = '0123456789abcdef0123456789abcdef'
const raw            = `[2026-11-20T05:58:43.89411996Z] [${requestId}] [info] [gin_logger.go:91] ` +
                       '429 | 6.847s | 2001:db8::1234 | POST "/v1/messages?api_key=synthetic-secret" | exhausted\nsecond <line>'
const line: LogEntry = { ...parseLogLine(raw), id: 73 }

function detailsButton(tree: ReactNode) {
    return elements(tree).find((node) => node.type === Button && 'aria-expanded' in node.props)!
}

describe('log row summaries and complete details', () => {
    test('contains IDs and IPs in separate blocks and keeps raw headers out of the summary', () => {
        const view  = rowFixture()
        const tree  = view.render(line)
        const html  = renderToStaticMarkup(<table>
            <tbody>{tree}</tbody>
        </table>)
        const cells = elements(tree).filter((node) => node.type === 'td')
        expect(cells).toHaveLength(5)
        const identity         = cells.find((node) => node.props.className === 'requestIdCell')!
        const identityChildren = elements(identity).filter((node) => node.type === 'span')
        expect(identityChildren[0].props.className).toBe('requestIdText')
        expect(identityChildren[0].props.children).toBe(requestId)
        expect(identityChildren[1].props.className).toBe('ipText')
        expect(html).toContain('2001:db8::1234')
        expect(html).toContain('gin_logger.go:91')
        expect(html).toContain('exhausted')
        expect(html).not.toContain('synthetic-secret')
        expect(html).not.toContain('2026-11-20T05:58:43.89411996Z')
        expect(html).not.toContain('logDetailRaw')
        expect(detailsButton(tree).props['aria-expanded']).toBe(false)
    })

    test(
        'opens the selected row only, exposes complete redacted fields, and collapses by keyboard button action',
        () => {
            const view = rowFixture()
            ;(detailsButton(view.render(line)).props.onClick as () => void)()
            const expanded = view.render(line)
            const button   = detailsButton(expanded)
            expect(button.props['aria-expanded']).toBe(true)
            expect(button.props['aria-controls']).toBe('log-line-detail-73')
            const html = renderToStaticMarkup(<table>
                <tbody>{expanded}</tbody>
            </table>)
            expect(html).toContain('id="log-line-detail-73"')
            expect(html).toContain('colSpan="5"')
            expect(html).toContain('2026-11-20T05:58:43.89411996Z')
            expect(html).toContain('second &lt;line&gt;')
            expect(html).not.toContain('synthetic-secret')
            const pre = elements(expanded).find((node) => node.type === 'pre')!
            expect(pre.props.children).toBe(redactSensitiveText(raw))
            const other = { ...line, id: 74 }
            ;(detailsButton(view.render(other)).props.onClick as () => void)()
            expect(detailsButton(view.render(line)).props['aria-expanded']).toBe(false)
            expect(detailsButton(view.render(other)).props['aria-expanded']).toBe(true)
            ;(detailsButton(view.render(other)).props.onClick as () => void)()
            expect(detailsButton(view.render(other)).props['aria-expanded']).toBe(false)
        },
    )

    test('retains explicit copy, double-click, trace routing and long-press actions', async () => {
        const view    = rowFixture()
        const tree    = view.render(line)
        const summary = elements(tree).find((node) => node.type === 'tr')!
        const copy    = elements(tree).find((node) => node.type ===
                                                      Button &&
                                                      node.props['aria-label'] ===
                                                      'common.copy')!
        await (copy.props.onClick as () => void)()
        await (summary.props.onDoubleClick as () => void)()
        expect(view.copy).toHaveBeenCalledTimes(2)
        expect(view.copy).toHaveBeenCalledWith(raw)
        ;(summary.props.onPointerDown as (event: object) => void)({})
        expect(view.startLongPress).toHaveBeenCalledWith({}, requestId)
        const trace = elements(tree).find((node) => node.type === 'button' && node.props.className === 'traceButton')!
        ;(trace.props.onClick as () => void)()
        expect(view.openTraceModal).toHaveBeenCalledWith(line, '192.0.2.10')
        const actions         = elements(tree).find((node) => node.props.className === 'rowActions')!
        const stopPropagation = mock()
        ;(actions.props.onPointerDown as (event: object) => void)({ stopPropagation })
        ;(actions.props.onDoubleClick as (event: object) => void)({ stopPropagation })
        expect(stopPropagation).toHaveBeenCalledTimes(2)
        const copied: string[] = []
        const copyLogLine      = sourceInitializer<(raw: string) => Promise<void>>(file, 'copyLogLine', {
            isCurrentConnection: () => true, redactSensitiveText, t,
            copyToClipboard: async (text: string) => {
                copied.push(text);
                return true
            }, showNotification: noop,
        })
        await copyLogLine(raw)
        expect(copied).toEqual([redactSensitiveText(raw)])
    })

    test('preserves the viewport while reading the expanded part of a row', () => {
        let summaryTop       = -20
        const summary        = {
            dataset: { logId: '73' },
            getBoundingClientRect: () => ({ top: summaryTop, bottom: summaryTop + 50 }),
        }
        const detail         = { dataset: { logId: '73' }, getBoundingClientRect: () => ({ top: 30, bottom: 500 }) }
        const scrollTo       = mock()
        const logScrollerRef = {
            current: {
                scrollTop: 250, clientTop: 0, getBoundingClientRect: () => ({ top: 100 }),
                querySelectorAll: () => [summary, detail], querySelector: () => summary, scrollTo,
            },
        }
        const logViewportRef = {
            current: {
                page: 1,
                pageStart: 0,
                scrollTop: 250,
                anchorId: null as number | null,
                anchorOffset: null as number | null,
            },
        }
        sourceCallback<() => void>(file, 'captureLogViewport', {
            logScrollerRef, logViewportRef, logPage: 1, pageStart: 0, reversedParsedLines: [line],
        })()
        expect(logViewportRef.current.anchorId).toBe(73)
        expect(logViewportRef.current.anchorOffset).toBe(-120)
        const pendingViewportRestoreRef = { current: null as unknown }
        sourceInitializer<() => void>(file, 'preserveLogViewport', { logViewportRef, pendingViewportRestoreRef })()
        summaryTop = 80
        sourceCallback<() => void>(file, 'useEffect', {
            pendingViewportRestoreRef, reversedParsedLines: [line], logState: { bufferStart: 0 },
            logPage: 1, logPageSize: 50, logScrollerRef, setLogPage: noop, setHistoryEvicted: noop,
            window: { requestAnimationFrame: (callback: () => void) => callback() },
        }, 'const anchorIndex =')()
        expect(scrollTo).toHaveBeenCalledWith({ top: 350 })
        expect(pendingViewportRestoreRef.current).toBeNull()
    })
})

describe('compact error request logs', () => {
    test('mounts a paginated table with preview and download actions wired to the selected file', () => {
        const preview              = mock()
        const download             = mock()
        const columns              = sourceInitializer<SheetColumn<ErrorLogFile>[]>(file, 'errorLogColumns', {
            React, styles, t, Button, formatFileSize, formatUnixTimestamp,
            previewErrorLog: preview, downloadErrorLog: download, disableControls: false, errorLogDownloading: null,
        })
        const rows: ErrorLogFile[] = Array.from({ length: 3000 }, (_, index) => ({
            name: `synthetic-error-${index}.log`, size: index === 0 ? 0 : 4096, modified: 1795154323,
        }))
        const sheet                = sourceExpression<ReactElement>(
            file,
            (node, tree) => ts.isJsxSelfClosingElement(node) &&
                            node.tagName.getText(tree) ===
                            'Sheet' &&
                            node.getText(tree).includes('columns={errorLogColumns}'),
            {
                React,
                Sheet,
                styles,
                t,
                errorLogs: rows,
                errorLogColumns: columns,
                loadingErrors: false,
            },
        )
        const html                 = renderToStaticMarkup(sheet)
        expect(html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr\b/g)).toHaveLength(25)
        expect(html).toContain('synthetic-error-24.log')
        expect(html).not.toContain('synthetic-error-25.log')
        expect(columns.find((column) => column.key === 'size')!.cell(rows[0])).toBe(formatFileSize(0))
        const actions = elements(columns.find((column) => column.key === 'actions')!.cell(rows[0]))
            .filter((node) => node.type === Button)
        ;(actions[0].props.onClick as () => void)()
        ;(actions[1].props.onClick as () => void)()
        expect(preview).toHaveBeenCalledWith(rows[0])
        expect(download).toHaveBeenCalledWith(rows[0].name)
        const props = sheet.props as { pagination: boolean; defaultPageSize: number; pageSizeOptions: number[] }
        expect(props.pagination).toBe(true)
        expect(props.defaultPageSize).toBe(25)
        expect(Math.max(...props.pageSizeOptions)).toBe(100)
    })

    test('uses compact cells, bounded scroll areas and contained identity text in compiled CSS', () => {
        const css = compile(new URL('../src/pages/LogsPage.module.scss', import.meta.url).pathname).css
        expect(css).toMatch(/\.requestIdColumn\s*\{[^}]*width: 304px/)
        expect(css).toMatch(/\.requestIdText\s*\{[^}]*display: block[^}]*overflow: hidden[^}]*text-overflow: ellipsis/s)
        expect(css).toMatch(/\.ipText\s*\{[^}]*display: block/)
        expect(css).toMatch(/\.errorPanel\s*\{[^}]*max-height: 480px[^}]*overflow: auto/s)
        expect(css).toMatch(/\.errorLogTable th,\s*\.errorLogTable td\s*\{[^}]*padding: 8px 12px/s)
        expect(css).toMatch(/\.logDetailRaw\s*\{[^}]*white-space: pre-wrap[^}]*overflow-wrap: anywhere/s)
        expect(css).toMatch(/\.logTable th\s*\{[^}]*white-space: normal/s)
        expect(css).toMatch(/\.errorLogTable th\s*\{[^}]*white-space: normal/s)
        expect(css).not.toContain('1800px')
    })
})
