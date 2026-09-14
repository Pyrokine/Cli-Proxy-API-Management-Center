import {describe, expect, test} from 'bun:test'
import {
    applyAuthFileUsingApi,
    readAuthFileUsingApi,
    supportsAuthFileUsingApi,
} from '@/features/authFiles/constants'

describe('xAI auth-file using_api', () => {
    test('is exposed only for xAI aliases', () => {
        expect(supportsAuthFileUsingApi('xai')).toBe(true)
        expect(supportsAuthFileUsingApi('x-ai')).toBe(true)
        expect(supportsAuthFileUsingApi('grok')).toBe(true)
        expect(supportsAuthFileUsingApi('codex')).toBe(false)
    })

    test('reads boolean-compatible values and defaults to false', () => {
        expect(readAuthFileUsingApi({ name: 'a', using_api: true })).toBe(true)
        expect(readAuthFileUsingApi({ name: 'a', using_api: 'true' })).toBe(true)
        expect(readAuthFileUsingApi({ name: 'a', using_api: 0 })).toBe(false)
        expect(readAuthFileUsingApi({ name: 'a' })).toBe(false)
    })

    test('writes an explicit boolean without copying secret fields', () => {
        expect(applyAuthFileUsingApi({ type: 'xai' }, true)).toEqual({ type: 'xai', using_api: true })
    })
})
