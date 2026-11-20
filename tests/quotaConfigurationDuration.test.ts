import type {QuotaConfig} from '@/services/api/quota'
import {expect, test} from 'bun:test'
import {sourceInitializer} from './sourceCallbacks'

function configuration(
    draft: { enabled: boolean; intervalMinutes: string; maxIntervalMinutes: string },
    enabled = true,
) {
    const writes: Partial<QuotaConfig>[]                           = []
    const confirmations: Array<{ onConfirm: () => Promise<void> }> = []
    const errors: string[]                                         = []
    const current                                                  = { enabled, interval: 600, 'max-interval': 1800 }
    const scope                                                    = {
        quotaConfigLoaded: true, dataGeneration: 1, authGeneration: 1, apiClient: { getAuthGeneration: () => 1 },
        quotaDraft: draft, quotaConfig: current, quotaDraftStateRef: { current: { generation: 1, dirty: true } },
        setActionError: (message: string) => errors.push(message), t: (key: string) => key, showNotification: () => {
        },
        quotaApi: {
            setConfig: async (patch: Partial<QuotaConfig>) => {
                writes.push(patch);
                Object.assign(current, patch)
            },
        },
        showConfirmation: (confirmation: { onConfirm: () => Promise<void> }) => confirmations.push(confirmation),
        runAction: async (_name: string, action: (isCurrent: () => boolean) => Promise<void>) => action(() => true),
    }
    const save                                                     = () => sourceInitializer<() => Promise<void>>(
        'components/credentials/AccountInspectionPanel.tsx',
        'handleSaveQuotaConfig',
        scope,
    )()
    return { save, draft, current, writes, confirmations, errors }
}

test('quota interval inputs reject values whose seconds cannot form a positive scheduler duration', async () => {
    const huge = String(9223372037 / 60)
    for (const draft of [
        { enabled: true, intervalMinutes: huge, maxIntervalMinutes: huge },
        { enabled: true, intervalMinutes: '10', maxIntervalMinutes: huge },
    ]) {
        const state = configuration(draft)
        await state.save()
        expect(state.writes).toEqual([])
        expect(state.confirmations).toEqual([])
        expect(state.errors).toEqual(['credentials.quota_config_invalid'])
    }
})

test('zero disables polling and valid minimum and duration-boundary values remain writable', async () => {
    const zero = configuration({ enabled: true, intervalMinutes: '0', maxIntervalMinutes: '30' })
    await zero.save()
    expect(zero.writes).toEqual([{ enabled: false, interval: 0 }])
    expect(zero.confirmations).toEqual([])
    const minimum = configuration({ enabled: true, intervalMinutes: '1', maxIntervalMinutes: '5' })
    await minimum.save()
    expect(minimum.writes).toEqual([{ interval: 60, 'max-interval': 300 }])
    const boundary = configuration({ enabled: true, intervalMinutes: '1', maxIntervalMinutes: String(9223372036 / 60) })
    await boundary.save()
    expect(boundary.writes).toEqual([{ interval: 60, 'max-interval': 9223372036 }])
})

test('cancelling an enable and enabling again after a disable each require a fresh confirmation', async () => {
    const state = configuration({ enabled: true, intervalMinutes: '10', maxIntervalMinutes: '30' }, false)
    await state.save()
    expect(state.confirmations).toHaveLength(1)
    expect(state.writes).toEqual([])
    state.confirmations.pop()
    await state.save()
    expect(state.confirmations).toHaveLength(1)
    await state.confirmations[0].onConfirm()
    expect(state.writes).toEqual([{ enabled: true }])
    state.draft.enabled = false
    await state.save()
    expect(state.writes).toEqual([{ enabled: true }, { enabled: false }])
    state.draft.enabled = true
    await state.save()
    expect(state.confirmations).toHaveLength(2)
    expect(state.writes).toHaveLength(2)
    await state.confirmations[1].onConfirm()
    expect(state.writes).toEqual([{ enabled: true }, { enabled: false }, { enabled: true }])
})
