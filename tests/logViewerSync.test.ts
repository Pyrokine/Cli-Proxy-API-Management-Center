import {describe, expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'

import {apiClient} from '@/services/api/client'
import {logsApi} from '@/services/api/logs'

const pageSource = readFileSync(new URL('../src/pages/LogsPage.tsx', import.meta.url), 'utf8')
const pageStyles = readFileSync(new URL('../src/pages/LogsPage.module.scss', import.meta.url), 'utf8')
const selectSource = readFileSync(new URL('../src/components/ui/Select.tsx', import.meta.url), 'utf8')

describe('log cursor and display contract', () => {
    test('preserves an explicit empty cursor from the fork backend', async () => {
        const get = spyOn(apiClient, 'get').mockResolvedValue({
            lines: [],
            'line-count': 0,
            'latest-timestamp': 0,
            'next-cursor': '',
            'cursor-reset': true,
        })
        try {
            const result = await logsApi.fetchLogs({cursor: 'previous'})
            expect(result).toMatchObject({nextCursor: '', cursorReset: true, logBackendKind: 'file'})
            expect(get).toHaveBeenCalledTimes(1)
            expect(pageSource).toContain('if (data.nextCursor) {')
            expect(pageSource).toContain('delete nextPosition.cursor')
        } finally {
            get.mockRestore()
        }
    })

    test('drains advancing cursor pages and pauses automatic reads while hidden', () => {
        expect(pageSource).toContain('for (let page = 0; page < MAX_LOG_PAGES_PER_READ; ++page)')
        expect(pageSource).toContain('shouldCatchUpLogPage(data, position.cursor, MAX_BUFFER_LINES)')
        expect(pageSource).toContain("document.visibilityState === 'hidden'")
        expect(pageSource).toContain('Date.now() < nextReadAtRef.current')
        expect(pageSource).toContain('retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_RETRY_MS)')
        expect(pageSource).toContain("activeTab !== 'logs'")
        expect(pageSource).toContain("data.logBackendKind === 'home-db' ? data.total ?? null : null")
        expect(pageSource).toContain('{totalLogLines !== null && (')
        expect(pageSource).toContain('pending.anchorId < logState.bufferStart')
        expect(pageSource).toContain('if (!retainedIds.has(requestId)) {')
    })

    test('provides continuous-read and eviction messages in all locales', () => {
        const keys = [
            'reading_continuously', 'reading_paused', 'catching_up', 'more_logs',
            'read_failed', 'last_read', 'history_evicted',
        ]
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
            for (const key of keys) {
                expect(messages.logs[key]).toBeTruthy()
            }
            expect(messages.logs.last_read).toContain('{{time}}')
        }
    })

    test('filters management requests by parsed path, not unrelated message text', () => {
        expect(pageSource).toContain("const path = line.path?.split('?')[0]")
        expect(pageSource).toContain('path !== MANAGEMENT_API_PREFIX')
        expect(pageSource).toContain('path?.startsWith(`${MANAGEMENT_API_PREFIX}/`)')
        expect(pageSource).not.toContain('line.includes(MANAGEMENT_API_PREFIX)')
    })

    test('connects the log level selector to filtering and page reset', () => {
        expect(pageSource).toContain('onChange={setLevelFilter}')
        expect(pageSource).toContain("ariaLabel={t('logs.level_filter')}")
        expect(pageSource).toContain('matchesLogFilters(line, levelFilter, activeFilters)')
        expect(pageSource).toMatch(/trimmedSearchQuery,\s*levelFilter,\s*filters\.methodFilters/)
        expect(pageStyles).toContain('.levelSelect {\n        width: 100%;')
    })

    test('restores focus after selecting a log filter or dismissing its dropdown', () => {
        expect(pageSource).toContain('onChange={setLevelFilter}')
        expect(selectSource).toContain('ref={triggerRef}')
        expect(selectSource).toContain('onKeyDown={closeOnEscape}')
        expect(selectSource).toContain("event.key === 'Escape'")
        expect(selectSource).toContain('event.stopPropagation()')
        expect(selectSource).toContain('triggerRef.current?.focus({ preventScroll: true })')
        expect(selectSource).toMatch(/onClick=\{\(\) => \{\s*onChange\(opt\.value\)\s*close\(\)\s*triggerRef\.current\?\.focus/)
    })

    test('offers keyboard-accessible copying for rows and error previews', () => {
        expect(pageSource).toContain("key: 'copy'")
        expect(pageSource).toContain('aria-label={t(\'common.copy\')}')
        expect(pageSource).toContain('onClick={() => void copyLogLine(line.raw)}')
        expect(pageSource).toContain('void copyLogLine(errorLogViewer.text)')
        expect(pageSource).toContain("disabled={errorLogViewer.status !== 'ready' || !errorLogViewer.text}")
        expect(pageSource).toContain('copyToClipboard(redactSensitiveText(raw))')
    })

    test('applies the buffer limit and optional line wrapping to both viewing modes', () => {
        expect(pageSource).toContain('replaceLogBuffer(previous, newLines, MAX_BUFFER_LINES)')
        expect(pageSource).toContain('appendLogBuffer(prev, linesToAppend, MAX_BUFFER_LINES)')
        expect(pageSource).toContain('line.id === pending.anchorId')
        expect(pageSource).toContain("useLocalStorage('logsPage.wrapLogs', false)")
        expect(pageSource).toContain("label={t('logs.wrap_lines')}")
        expect(pageSource).toContain('wrapLogs ? styles.logPanelWrapped : \'\'')
        expect(pageStyles).toContain('.logPanelWrapped {')
        expect(pageStyles).toContain('.rawLog {\n        white-space: pre-wrap;')
        expect(pageStyles).toContain('overflow-wrap: anywhere;')
        expect(pageSource).toContain('data-log-id={line.id}')
        expect(pageSource).toContain('pagedParsed.map((line) => (')
        expect(pageSource).toContain('captureLogViewport()')
        expect(pageSource).toContain('preserveLogViewport()')
        expect(pageSource).toContain("role='region'")
        expect(pageSource).toContain("aria-label={t('logs.log_content')}")
        expect(pageSource).toContain("key: 'message'")
        expect(pageSource).toContain('redactSensitiveText(line.message || line.raw)')
        expect(pageStyles).toContain('.messageText,')
    })
})
