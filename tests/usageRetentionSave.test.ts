import i18n from '@/i18n'
import type {UsageRetention} from '@/services/api/usage'
import {expect, test} from 'bun:test'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'components/usage/UsageRetentionCard.tsx'
type Draft = { daysEnabled: boolean; days: string; maxDbSizeMb: string; warningThresholdPct: string }

test('saving retention refreshes server size and flags without losing saved settings or newer input', async () => {
    for (const mode of ['refreshed', 'size-failed', 'edit-during-put', 'edit-during-size']) {
        const draft: Draft                     = {
            daysEnabled: true,
            days: '30',
            maxDbSizeMb: '12288',
            warningThresholdPct: '80',
        }
        const saved                            = { days: 30, max_db_size_mb: 12288, warning_threshold_pct: 80 }
        const state                            = {
            retention: { ...saved, max_db_size_mb: 10240 }, draft,
            size: 10 as number | null, max: 10240 * 1024 ** 2 as number | null,
            warning: true, capped: true, saving: false, error: null as string | null,
        }
        const notices: Array<[string, string]> = []
        let sizeReads                          = 0
        const handleSave                       = sourceInitializer<() => Promise<void>>(file, 'handleSave', {
            draft, retention: state.retention, validPayload: saved,
            toDraft: sourceCallback(file, 'toDraft', {}),
            t: i18n.t.bind(i18n),
            usageApi: {
                putRetention: async (payload: UsageRetention) => {
                    expect(payload).toEqual(saved)
                    if (mode === 'edit-during-put') {
                        state.draft = { ...draft, maxDbSizeMb: '16384' }
                    }
                    return saved
                },
                getDBSize: async () => {
                    ++sizeReads
                    if (mode === 'edit-during-size') {
                        state.draft = { ...draft, maxDbSizeMb: '16384' }
                    }
                    if (mode === 'size-failed') {
                        throw new Error('synthetic size read failure')
                    }
                    return {
                        size_bytes: 10_329_494_118, max_size_bytes: 12288 * 1024 ** 2,
                        warning: true, capped: false,
                    }
                },
            },
            setRetention: (value: typeof saved) => {
                state.retention = value
            },
            setDraft: (value: Draft | ((current: Draft) => Draft)) => {
                state.draft = typeof value === 'function' ? value(state.draft) : value
            },
            setSaving: (value: boolean) => {
                state.saving = value
            },
            setDbSize: (value: number | null) => {
                state.size = value
            },
            setDbMaxSize: (value: number | null) => {
                state.max = value
            },
            setDbSizeWarning: (value: boolean) => {
                state.warning = value
            },
            setDbSizeCapped: (value: boolean) => {
                state.capped = value
            },
            setLoadError: (value: string | null) => {
                state.error = value
            },
            showNotification: (message: string, type: string) => {
                notices.push([message, type])
            },
        })
        await handleSave()
        expect(sizeReads).toBe(1)
        expect(state.retention).toEqual(saved)
        expect(state.saving).toBe(false)
        expect(state.draft.maxDbSizeMb).toBe(mode.startsWith('edit-') ? '16384' : '12288')
        expect(notices).toContainEqual([i18n.t('usage_stats.retention_saved'), 'success'])
        expect(notices.some(([message]) => message.includes(i18n.t('usage_stats.retention_save_failed')))).toBe(false)
        if (mode === 'size-failed') {
            expect(state.error).toBe(i18n.t('usage_stats.retention_saved_size_failed', {
                error: 'synthetic size read failure',
            }))
            expect(state.size).toBeNull()
            expect(state.max).toBeNull()
            expect(state.warning).toBe(false)
            expect(state.capped).toBe(false)
        } else {
            expect(state.size).toBe(10_329_494_118)
            expect(state.max).toBe(12288 * 1024 ** 2)
            expect(state.warning).toBe(true)
            expect(state.capped).toBe(false)
            expect(state.error).toBeNull()
        }
    }
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        expect(i18n.getResource(language, 'translation', 'usage_stats.retention_saved_size_failed')).toBeTruthy()
    }
})
