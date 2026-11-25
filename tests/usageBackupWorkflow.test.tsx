import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {parseVisualConfigInteger, VISUAL_INTEGER_FIELDS} from '@/hooks/visualConfigCodec'
import {apiClient, MANAGEMENT_SESSION_HEADER} from '@/services/api/client'
import {usageApi} from '@/services/api/usage'
import {AxiosError, type AxiosInstance} from 'axios'
import {expect, mock, test} from 'bun:test'
import * as React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const usageHook        = 'components/usage/hooks/useUsageData.ts'
const passwordDialog   = 'components/usage/UsageBackupPasswordDialog.tsx'
const retentionCard    = 'components/usage/UsageRetentionCard.tsx'
const t                = (key: string, params?: object) => params ? `${key} ${JSON.stringify(params)}` : key
const noop             = () => undefined
const fixturePassword  = 'test-backup-password'
const syntheticSession = 'a'.repeat(64)
const instance         = (apiClient as unknown as { instance: AxiosInstance }).instance
const emptyPage        = { events: [], total: 0, page: 1, page_size: 50, total_pages: 0 }

function last<T>(items: readonly T[]): T | undefined {
    return items[items.length - 1]
}

test('backup credentials stay operation-local; business 401s preserve the browser session', async () => {
    const previousAdapter = instance.defaults.adapter
    const previousWindow  = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const events          = new EventTarget()
    const unauthorized    = mock()
    events.addEventListener('unauthorized', unauthorized)
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events })
    apiClient.setConfig({ apiBase: 'https://fixture.invalid', sessionToken: syntheticSession })
    const generation          = apiClient.getAuthGeneration()
    const reads: string[]     = []
    let expired               = false
    instance.defaults.adapter = async (config) => {
        const url  = new URL(config.url!, 'https://fixture.invalid')
        const path = url.pathname
        reads.push(`${path}${url.search}`)
        expect(config.headers.get(MANAGEMENT_SESSION_HEADER)).toBe(syntheticSession)
        expect(config.headers.get('Authorization')).toBeUndefined()
        expect(config.headers.get('X-Management-Key')).toBeUndefined()
        const plain       = config.headers.get('X-Usage-Backup-Key')
        const encoded     = config.headers.get('X-Usage-Backup-Key-Base64')
        const isBackup    = path ===
                            '/usage/export' ||
                            path ===
                            '/usage/import' ||
                            url.searchParams.get('export') ===
                            'true'
        let data: unknown = emptyPage
        let status        = 200
        if (expired) {
            data   = { error: 'invalid management key' }
            status = 401
        } else if (isBackup && !plain && !encoded) {
            data   = path === '/usage/export'
                     ?
                     new Blob([
                                  JSON.stringify({
                                                     error: 'usage backup encryption key unavailable',
                                                     code: 'usage_backup_password_required',
                                                 }),
                              ])
                     :
                     path === '/usage/import'
                     ? { error: 'usage backup decryption key unavailable', code: 'usage_backup_password_required' }
                     : { error: 'usage event export key unavailable' }
            status = 401
        } else if (path === '/usage/import') {
            expect(plain).toBeUndefined()
            expect(encoded).toBe(Buffer.from('备份 пароль', 'utf8').toString('base64'))
            data = { added: 0, skipped: 1 }
        } else if (isBackup) {
            expect(plain).toBe(fixturePassword)
            expect(encoded).toBeUndefined()
            if (path === '/usage/export') {
                data = new Blob(['{"format":"cliproxy-usage-backup"}'])
            }
        } else {
            expect(plain).toBeUndefined()
            expect(encoded).toBeUndefined()
        }
        const response = { data, status, statusText: String(status), headers: {}, config }
        if (status >= 400) {
            throw new AxiosError('request rejected', undefined, config, undefined, response)
        }
        return response
    }
    try {
        await expect(usageApi.exportUsage()).rejects.toMatchObject({
                                                                       status: 401,
                                                                       backendCode: 'usage_backup_password_required',
                                                                       message: 'usage backup encryption key unavailable',
                                                                   })
        await expect(usageApi.getEvents({ export: true })).rejects.toMatchObject({ status: 401 })
        await expect(usageApi.importUsage({ format: 'cliproxy-usage-backup' })).rejects.toMatchObject({ status: 401 })
        await expect(usageApi.exportUsage(undefined, { backupPassword: '  ' })).rejects.toThrow()
        await usageApi.exportUsage(
            { from: '2026-11-22T13:08:00Z', to: '2026-11-23T13:08:00Z' },
            { backupPassword: ` ${fixturePassword} ` },
        )
        expect(reads.some((url) => url.includes('to=2026-11-23T13%3A08%3A00Z'))).toBe(true)
        await usageApi.getEvents({ export: true }, { backupPassword: fixturePassword })
        await usageApi.importUsage({ format: 'cliproxy-usage-backup' }, { backupPassword: '备份 пароль' })
        await usageApi.getEvents({ request_id: 'Req exact +case' }, { backupPassword: fixturePassword })
        expect(last(reads)).toContain('request_id=Req+exact+%2Bcase')
        expect(unauthorized).not.toHaveBeenCalled()
        expect(apiClient.getAuthGeneration()).toBe(generation)
        expired = true
        await expect(usageApi.exportUsage(undefined, { backupPassword: fixturePassword }))
            .rejects
            .toMatchObject({ status: 401 })
        expect(unauthorized).toHaveBeenCalledTimes(1)
        expect(apiClient.getAuthGeneration()).not.toBe(generation)
    } finally {
        instance.defaults.adapter = previousAdapter
        apiClient.setConfig({ apiBase: '', sessionToken: '' })
        if (previousWindow) {
            Object.defineProperty(globalThis, 'window', previousWindow)
        } else {
            Reflect.deleteProperty(globalThis, 'window')
        }
    }
})

test('backup prompt masks both export entries and submits only a matching nonempty password', async () => {
    const action   = { title: 'Export', confirmText: 'Export', generation: 3, onConfirm: mock(async () => undefined) }
    const form     = { values: {} as Record<string, string>, reset: mock() }
    const setError = mock()
    const close    = mock()
    const dialog   = sourceCallback<(props: object) => React.ReactElement>(
        passwordDialog,
        'UsageBackupPasswordDialog',
        {
            React,
            Button,
            Input,
            Modal,
            useId: () => 'backup-password',
            useState: (value: unknown) => [
                value,
                noop,
            ],
            useTranslation: () => ({ t }),
        },
    )
    const markup   = renderToStaticMarkup(dialog({ action, onClose: close }))
    expect(markup.match(/type="password"/g)).toHaveLength(2)
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('type="submit"')
    const submit = sourceInitializer<(event: object) => Promise<void>>(passwordDialog, 'submit', {
        action, t, exporting: true, submitting: false, setError, setSubmitting: noop, onClose: close,
        apiClient: { getAuthGeneration: () => 3 },
        FormData: class {
            constructor(private readonly target: typeof form) {
            }

            get(key: string) {
                return this.target.values[key]
            }
        },
    })
    const event  = { preventDefault: noop, currentTarget: form }
    await submit(event)
    expect(setError).toHaveBeenLastCalledWith('usage_stats.backup_password_required')
    form.values = { 'backup-password': fixturePassword, 'backup-password-repeat': 'different' }
    await submit(event)
    expect(setError).toHaveBeenLastCalledWith('usage_stats.backup_password_mismatch')
    expect(action.onConfirm).not.toHaveBeenCalled()
    form.values['backup-password-repeat'] = fixturePassword
    await submit(event)
    expect(action.onConfirm).toHaveBeenCalledWith(fixturePassword)
    expect(form.reset).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
})

test('sealed imports prompt before sending; unknown totals and server warnings remain visible', async () => {
    const describeUsageImport = sourceCallback<(payload: unknown) => object>(usageHook, 'describeUsageImport', {})
    expect(describeUsageImport('timestamp,model,import_data\r\n2026-01-01,"with, comma",usage-event-v1:x:y'))
        .toEqual({ count: 1, needsPassword: true })
    expect(describeUsageImport('timestamp,model,import_data\n2026-01-01,"with,\nnewline",')).toEqual({
                                                                                                         count: 1,
                                                                                                         needsPassword: false,
                                                                                                     })
    expect(describeUsageImport([{ import_data: 'usage-event-v1:x:y' }])).toEqual({ count: 1, needsPassword: true })
    expect(describeUsageImport({ usage: { apis: { client: { models: { m: { details: [{}] } } } } } }))
        .toEqual({ count: 1, needsPassword: false })
    const portable     = { format: 'cliproxy-usage-backup', version: 4, ciphertext: 'test-fixture' }
    const password     = mock<(options: { message: string; onConfirm: (password: string) => Promise<void> }) => void>()
    const confirmation = mock()
    const notify       = mock()
    const persistent   = mock()
    const after        = mock(async () => undefined)
    const importUsage  = mock(async (_: unknown, options: { backupPassword?: string }) => {
        if (options.backupPassword !== fixturePassword) {
            throw new Error('use the password that created the backup')
        }
        return { added: 2, skipped: 0, warning: 'usage imported, but totals could not be queried' }
    })
    const importChange = sourceInitializer<(event: unknown) => Promise<void>>(usageHook, 'handleImportChange', {
        apiClient: { getAuthGeneration: () => 3 }, describeUsageImport,
        requestBackupPassword: password, showConfirmation: confirmation, showNotification: notify,
        addPersistentNotification: persistent, loadUsageStats: after, onAfterImport: noop,
        usageApi: { importUsage }, t, setImporting: noop, USAGE_STATS_STALE_TIME_MS: 0,
    })
    await importChange({ target: { files: [new File([JSON.stringify(portable)], 'backup.json')], value: '' } })
    expect(confirmation).not.toHaveBeenCalled()
    expect(importUsage).not.toHaveBeenCalled()
    const prompt = password.mock.calls[0][0]
    expect(prompt.message).toBe('usage_stats.import_confirm_unknown')
    await expect(prompt.onConfirm('incorrect')).rejects.toThrow('use the password')
    expect(notify).not.toHaveBeenCalled()
    await prompt.onConfirm(fixturePassword)
    expect(importUsage).toHaveBeenLastCalledWith(portable, { backupPassword: fixturePassword })
    const warning = 'usage_stats.import_success_counts {"added":2,"skipped":0} — usage imported, but totals could not be queried'
    expect(notify).toHaveBeenCalledWith(warning, 'warning')
    expect(persistent).toHaveBeenCalledWith(warning, 'warning', 'import')
    expect(after).toHaveBeenCalledTimes(1)
})

test(
    'trim preview failures stop before confirmation; successful trim exposes the real size and removed count',
    async () => {
        const backupAdapter = instance.defaults.adapter
        apiClient.setConfig({ apiBase: 'https://fixture.invalid', sessionToken: syntheticSession })
        let mode                  = ''
        const requests: string[]  = []
        instance.defaults.adapter = async (config) => {
            const url = config.url ?? ''
            requests.push(url)
            const isPreview = url === '/usage-retention/trim-preview'
            const isTrim    = url === '/usage-retention/trim'
            const isSize    = url === '/usage/db-size'
            const failed    = (isPreview && mode === 'preview') ||
                              (isTrim && mode === 'trim') ||
                              (isSize && mode === 'size')
            const response  = {
                data: failed ? { error: `${mode} failure` } : isPreview ? { files_count: 1, total_size_bytes: 200 } :
                                                              isTrim ?
                                                                  { status: 'ok', deleted: 2 } :
                                                                  {
                                                                      size_bytes: 50,
                                                                      max_size_bytes: 100,
                                                                      warning: false,
                                                                      capped: false,
                                                                  },
                status: failed ? 500 : 200, statusText: failed ? '500' : '200', headers: {}, config,
            }
            if (failed) {
                throw new AxiosError('request rejected', undefined, config, undefined, response)
            }
            return response
        }
        try {
            const showConfirmation = mock<(options: { onConfirm: () => Promise<void> }) => void>()
            const showNotification = mock()
            const setDbSize        = mock()
            const setDbMaxSize     = mock()
            const setDbSizeCapped  = mock()
            const setLoadError     = mock()
            const trim             = sourceInitializer<() => Promise<void>>(retentionCard, 'handleTrim', {
                apiClient, usageApi, t, setDbSize, setDbMaxSize, setDbSizeCapped, setLoadError,
                setDbSizeWarning: noop, setTrimming: noop, showConfirmation, showNotification, formatFileSize: String,
            })
            mode                   = 'preview'
            await trim()
            expect(showConfirmation).not.toHaveBeenCalled()
            expect(requests).not.toContain('/usage-retention/trim')
            expect(showNotification).toHaveBeenLastCalledWith(
                'usage_stats.trim_preview_failed: preview failure',
                'error',
            )
            mode = 'trim'
            await trim()
            await expect(last(showConfirmation.mock.calls)![0].onConfirm()).rejects.toThrow('trim failure')
            expect(last(showNotification.mock.calls)?.[0]).toContain('usage_stats.trim_failed: trim failure')
            expect(setDbSize).not.toHaveBeenCalled()
            mode = 'size'
            await last(showConfirmation.mock.calls)![0].onConfirm()
            expect(setDbSize).toHaveBeenLastCalledWith(null)
            expect(last(setLoadError.mock.calls)?.[0]).toContain('usage_stats.trim_size_failed')
            expect(showNotification).toHaveBeenLastCalledWith(
                'usage_stats.trim_success_deleted {"count":2}',
                'success',
            )
            mode = 'ok'
            await trim()
            await last(showConfirmation.mock.calls)![0].onConfirm()
            expect(setDbSize).toHaveBeenLastCalledWith(50)
            expect(setDbMaxSize).toHaveBeenLastCalledWith(100)
            expect(setDbSizeCapped).toHaveBeenLastCalledWith(false)
            expect(setLoadError).toHaveBeenLastCalledWith(null)
        } finally {
            instance.defaults.adapter = backupAdapter
            apiClient.setConfig({ apiBase: '', sessionToken: '' })
        }
    },
)

test('the retention form rejects 0% and allows effective threshold values 1–100%', () => {
    const toPayload = sourceCallback<(draft: object) => object | null>(retentionCard, 'toPayload', {
        parseVisualConfigInteger, VISUAL_INTEGER_FIELDS,
    })
    const draft     = { daysEnabled: false, days: '30', maxDbSizeMb: '0' }
    expect(toPayload({ ...draft, warningThresholdPct: '0' })).toBeNull()
    expect(toPayload({ ...draft, warningThresholdPct: '101' })).toBeNull()
    for (const value of [1, 80, 100]) {
        expect(toPayload({ ...draft, warningThresholdPct: String(value) })).toEqual({
                                                                                        days: -1,
                                                                                        max_db_size_mb: 0,
                                                                                        warning_threshold_pct: value,
                                                                                    })
    }
})
