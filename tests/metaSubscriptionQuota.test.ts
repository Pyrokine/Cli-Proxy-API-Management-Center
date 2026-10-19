import {describe, expect, test} from 'bun:test'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {parseMetaSubscriptionSnapshot} from '@/utils/quota/metaSubscription'

describe('Meta subscription metadata', () => {
    test('links the backend snapshot to its credential without exporting a file name', () => {
        expect(quotaCredentialKey('meta', '', 'meta-auth-index')).toBe('meta::meta-auth-index')
        expect(quotaCredentialKey('meta', 'different-name.json', 'meta-auth-index')).toBe('meta::meta-auth-index')
    })

    test('keeps subscription fields while discarding secrets and unavailable usage', () => {
        const data = parseMetaSubscriptionSnapshot({
            available: false,
            reason: 'usage_not_provided',
            windows: [],
            planName: 'Muse Pro',
            isSubscriptionActive: true,
            api_key: 'secret',
            email: 'person@example.test',
        })
        expect(data).toEqual({planName: 'Muse Pro', isSubscriptionActive: true})
        expect(JSON.stringify(data)).not.toContain('secret')
        expect(JSON.stringify(data)).not.toContain('person@example.test')
    })

    test('rejects a backend payload claiming usage that the UI does not support', () => {
        expect(parseMetaSubscriptionSnapshot({
            available: true,
            windows: [{id: 'weekly', usedPercent: 0}],
        })).toBeNull()
        expect(parseMetaSubscriptionSnapshot({available: false, reason: 'usage_not_provided'})).toBeNull()
    })
})
