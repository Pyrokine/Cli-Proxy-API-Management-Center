import {afterEach, describe, expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {parse} from 'yaml'
import {apiClient} from '@/services/api/client'
import {buildClaudeConfigPatchPayload, providersApi} from '@/services/api/providers'
import {normalizeClaudeFingerprintProfile, normalizeConfigResponse, normalizeProviderKeyConfig} from '@/services/api/transformers'
import {parseTextList} from '@/components/providers/utils'
import {normalizeHeaderEntries} from '@/utils/headers'
import {normalizeModelEntriesForSignature} from '@/hooks/useProviderEditForm'
import type {ProviderFormState} from '@/components/providers/types'
import {useClaudeEditDraftStore} from '@/stores/useClaudeEditDraftStore'
import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import type {ProviderKeyConfig} from '@/types'

const original: ProviderKeyConfig = {
    apiKey: 'synthetic...masked',
    authIndex: 'claude:synthetic',
    priority: 3,
    weight: 2,
    baseUrl: 'https://gateway.example',
    headers: { Authorization: 'Bearer synthetic...masked' },
    models: [{ name: 'model-a', alias: 'model-a' }],
    cloak: { mode: 'never' },
    fingerprintProfile: 'claude-code-cli',
}

describe('Claude fingerprint profile transport', () => {
    afterEach(() => { spyOn(apiClient, 'post').mockRestore(); spyOn(apiClient, 'patch').mockRestore() })

    test.each([
        ['', ''],
        [' CLAUDE-CODE-CLI ', 'claude-code-cli'],
        [' OAuth-CLI ', 'claude-code-cli'],
        ['future-profile', 'future-profile'],
    ])('normalizes %j without discarding unknown values', (wire, expected) => {
        const raw = { 'api-key': 'synthetic', 'fingerprint-profile': wire }
        expect(normalizeProviderKeyConfig(raw)?.fingerprintProfile).toBe(expected)
        expect(normalizeConfigResponse({ 'claude-api-key': [raw] }).claudeApiKeys?.[0]?.fingerprintProfile).toBe(expected)
    })

    test('keeps missing fields absent and rejects non-string wire values', () => {
        expect(normalizeProviderKeyConfig({ 'api-key': 'synthetic' })).not.toHaveProperty('fingerprintProfile')
        for (const value of [null, true, 7, [], {}]) {
            expect(() => normalizeProviderKeyConfig({ 'api-key': 'synthetic', 'fingerprint-profile': value })).toThrow()
        }
    })

    test('creates one Claude credential with a canonical profile', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({})
        await providersApi.createClaudeConfig({ ...original, fingerprintProfile: ' OAuth-CLI ' })
        expect(post).toHaveBeenCalledWith('/claude-api-key', expect.objectContaining({ 'fingerprint-profile': 'claude-code-cli' }))
        await providersApi.createClaudeConfig({ ...original, fingerprintProfile: '' })
        expect(post.mock.calls[1]?.[1]).toHaveProperty('fingerprint-profile', '')
    })

    test('patches only the profile with stable identity and preserves masked credentials', async () => {
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
        await providersApi.patchClaudeConfig(2, { ...original, fingerprintProfile: '' }, original)
        expect(patch).toHaveBeenCalledWith('/claude-api-key', {
            index: 2,
            'auth-index': 'claude:synthetic',
            value: { 'fingerprint-profile': '' },
        })
        expect(original.fingerprintProfile).toBe('claude-code-cli')
        expect(original.headers).toEqual({ Authorization: 'Bearer synthetic...masked' })
    })

    test('omits unchanged, missing and equivalent legacy profiles', () => {
        expect(buildClaudeConfigPatchPayload(original, original)).toEqual({})
        expect(buildClaudeConfigPatchPayload({ ...original, fingerprintProfile: undefined }, original)).toEqual({})
        expect(buildClaudeConfigPatchPayload({ ...original, fingerprintProfile: ' OAuth-CLI ' }, original)).toEqual({})
    })

    test('preserves unknown profiles on unrelated edits and sends deliberate replacements', () => {
        const unknown = { ...original, fingerprintProfile: 'future-profile' }
        expect(buildClaudeConfigPatchPayload({ ...unknown, prefix: 'edited' }, unknown)).toEqual({ prefix: 'edited' })
        expect(buildClaudeConfigPatchPayload({ ...unknown, fingerprintProfile: '' }, unknown)).toEqual({ 'fingerprint-profile': '' })
    })

    test('propagates backend validation errors without reporting success', async () => {
        spyOn(apiClient, 'patch').mockRejectedValue(new Error('Unsupported fingerprint-profile'))
        await expect(providersApi.patchClaudeConfig(0, { ...original, fingerprintProfile: 'unknown' }, original))
            .rejects.toThrow('Unsupported fingerprint-profile')
    })
})

describe('Claude fingerprint profile drafts and YAML', () => {
    test('shares the profile across edit/model route layers and clears it after both leave', () => {
        const key = 'claude:synthetic-fingerprint-navigation'
        const store = useClaudeEditDraftStore.getState()
        store.acquireDraft(key)
        expect(useClaudeEditDraftStore.getState().drafts[key].form.fingerprintProfile).toBe('')
        store.setDraftForm(key, (form) => ({ ...form, authIndex: original.authIndex, fingerprintProfile: 'claude-code-cli' }))
        store.acquireDraft(key)
        store.setDraftForm(key, (form) => ({ ...form, modelEntries: [{ name: 'discovered', alias: '' }] }))
        store.releaseDraft(key)
        expect(useClaudeEditDraftStore.getState().drafts[key].form).toMatchObject({
            fingerprintProfile: 'claude-code-cli', authIndex: original.authIndex,
            modelEntries: [{ name: 'discovered', alias: '' }],
        })
        store.setDraftForm(key, (form) => ({ ...form, fingerprintProfile: '' }))
        expect(useClaudeEditDraftStore.getState().drafts[key].form.fingerprintProfile).toBe('')
        store.releaseDraft(key)
        expect(useClaudeEditDraftStore.getState().drafts[key]).toBeUndefined()
    })

    test.each(['', 'claude-code-cli', 'oauth-cli', 'future-profile'])('preserves %j through visual YAML edits', (profile) => {
        const source = `claude-api-key:\n  - api-key: synthetic\n    fingerprint-profile: ${JSON.stringify(profile)}\n    hidden-field: keep\n`
        const decoded = decodeVisualConfigYaml(source)
        const output = encodeVisualConfigYaml(source, { ...decoded.values, debug: true }, decoded.values, decoded.apiKeysStorage)
        expect(parse(output)['claude-api-key'][0]).toEqual({
            'api-key': 'synthetic', 'fingerprint-profile': profile, 'hidden-field': 'keep',
        })
    })

    test('marks profile-only edits dirty and treats legacy spellings as equivalent', () => {
        const source = readFileSync(new URL('../src/pages/AiProvidersClaudeEditLayout.tsx', import.meta.url), 'utf8')
        const helpers = source.slice(source.indexOf('const normalizeCloakConfig'), source.indexOf('const buildEmptyForm'))
        const compiled = new Bun.Transpiler({ loader: 'tsx' }).transformSync(helpers)
        const signature = new Function(
            'normalizeClaudeFingerprintProfile', 'normalizeHeaderEntries', 'normalizeModelEntriesForSignature', 'parseTextList',
            `${compiled}; return buildClaudeSignature`,
        )(normalizeClaudeFingerprintProfile, normalizeHeaderEntries, normalizeModelEntriesForSignature, parseTextList) as (form: ProviderFormState, model: string) => string
        const form: ProviderFormState = { apiKey: 'synthetic', headers: [], modelEntries: [], excludedText: '' }
        const baseline = signature(form, '')
        expect(signature({ ...form, fingerprintProfile: '' }, '')).toBe(baseline)
        expect(signature({ ...form, fingerprintProfile: 'claude-code-cli' }, '')).not.toBe(baseline)
        expect(signature({ ...form, fingerprintProfile: ' OAuth-CLI ' }, '')).toBe(signature({ ...form, fingerprintProfile: 'claude-code-cli' }, ''))
        expect(signature({ ...form, fingerprintProfile: 'future-profile' }, '')).not.toBe(baseline)
    })

    test('wires profile into dirty signatures, save payloads and unknown-value feedback', () => {
        const layout = readFileSync(new URL('../src/pages/AiProvidersClaudeEditLayout.tsx', import.meta.url), 'utf8')
        const page = readFileSync(new URL('../src/pages/AiProvidersClaudeEditPage.tsx', import.meta.url), 'utf8')
        expect(layout).toContain('fingerprintProfile: normalizeClaudeFingerprintProfile(form.fingerprintProfile)')
        expect(layout).toContain('fingerprintProfile: normalizeClaudeFingerprintProfile(data.fingerprintProfile)')
        expect(page).toContain('claude_fingerprint_profile_unknown')
        expect(page).toContain('ariaDescribedBy=')
        expect(layout).toContain('claude_fingerprint_profile_unknown')
    })

    test('provides matching profile messages in all four languages', () => {
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const strings = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')).ai_providers
            for (const key of ['label', 'default', 'cli', 'hint', 'unknown']) {
                expect(strings[`claude_fingerprint_profile_${key}`]).toBeString()
            }
            expect(strings.claude_fingerprint_profile_hint).toContain('OAuth')
        }
    })
})
