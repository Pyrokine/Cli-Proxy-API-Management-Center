import {describe, expect, test} from 'bun:test'
import {resolveProviderDraftInitAction} from '../src/hooks/providerEditLayoutState.ts'
import {buildClaudeConfigPatchPayload, buildClaudeConfigPatchRequest} from '../src/services/api/providers.ts'

describe('resolveProviderDraftInitAction', () => {
    test('waits for edit data before seeding a draft', () => {
        expect(
            resolveProviderDraftInitAction({
                loading: false,
                initialized: false,
                hasIndexParam: true,
                invalidIndexParam: false,
            }),
        ).toBe('wait')
    })

    test('seeds edit data and only builds empty drafts for new routes', () => {
        expect(
            resolveProviderDraftInitAction({
                loading: false,
                initialized: false,
                hasIndexParam: true,
                invalidIndexParam: false,
                initialData: {apiKey: 'masked'},
            }),
        ).toBe('seed')
        expect(
            resolveProviderDraftInitAction({
                loading: false,
                initialized: false,
                hasIndexParam: false,
                invalidIndexParam: false,
            }),
        ).toBe('empty')
    })
})

describe('buildClaudeConfigPatchRequest', () => {
    test('includes the stable auth index when it is available', () => {
        const request = buildClaudeConfigPatchRequest(
            0,
            {apiKey: 'sk-m...sked', prefix: 'updated'},
            {apiKey: 'sk-m...sked', authIndex: 'claude:stable-index', prefix: 'original'},
        )

        expect(request.index).toBe(0)
        expect(request['auth-index']).toBe('claude:stable-index')
        expect(request.value.prefix).toBe('updated')
    })
})

describe('buildClaudeConfigPatchPayload', () => {
    test('omits an unchanged or empty API key and sends explicit clears', () => {
        const payload = buildClaudeConfigPatchPayload(
            {
                apiKey: '',
                models: [],
                headers: {},
                excludedModels: [],
            },
            {apiKey: 'sk-m...sked'},
        )

        expect(payload['api-key']).toBeUndefined()
        expect(payload).toEqual({
            priority: 0,
            prefix: '',
            'base-url': '',
            'proxy-url': '',
            headers: {},
            models: [],
            'excluded-models': [],
        })
    })

    test('includes a replacement API key and complete model/cloak values', () => {
        const payload = buildClaudeConfigPatchPayload(
            {
                apiKey: 'new-secret',
                priority: 100,
                baseUrl: ' https://example.com/anthropic ',
                models: [{name: 'deepseek-v4-pro', alias: ''}],
                cloak: {mode: 'always', strictMode: true, sensitiveWords: ['secret']},
            },
            {apiKey: 'sk-m...sked'},
        )

        expect(payload['api-key']).toBe('new-secret')
        expect(payload.models).toEqual([{name: 'deepseek-v4-pro', alias: 'deepseek-v4-pro'}])
        expect(payload.cloak).toEqual({
            mode: 'always',
            'strict-mode': true,
            'sensitive-words': ['secret'],
        })
    })

    test('preserves unchanged cloak values and explicitly clears visible cloak settings', () => {
        const cloak = {mode: 'auto', strictMode: false, sensitiveWords: ['secret']}

        const unchanged = buildClaudeConfigPatchPayload(
            {apiKey: 'sk-m...sked', cloak},
            {apiKey: 'sk-m...sked', cloak},
        )
        expect(unchanged.cloak).toBeUndefined()

        const cleared = buildClaudeConfigPatchPayload(
            {apiKey: 'sk-m...sked'},
            {apiKey: 'sk-m...sked', cloak},
        )
        expect(cleared.cloak).toBeNull()
    })
})
