import {describe, expect, test} from 'bun:test'
import {validateDevinCallback} from '@/components/credentials/devinOAuth'
import {shouldFinalizeOAuthAttempt} from '@/components/credentials/oauthAttempts'

describe('Devin OAuth callback validation', () => {
    test('accepts only the complete callback for the current attempt', () => {
        expect(validateDevinCallback(
            ' http://127.0.0.1:1455/callback?code=fixture&state=current ',
            'current',
        )).toBeUndefined()
        expect(validateDevinCallback(
            'https://proxy.example/callback?error=access_denied&state=current',
            'current',
        )).toBeUndefined()
    })

    test('rejects callbacks with a different or missing state', () => {
        const callback = 'http://127.0.0.1:1455/callback?code=fixture&state=other'
        expect(validateDevinCallback(callback, 'current')).toBe('state_mismatch')
        expect(validateDevinCallback(callback)).toBe('state_mismatch')
        expect(validateDevinCallback('http://127.0.0.1:1455/callback?code=fixture', 'current')).toBe('invalid')
    })

    test('rejects partial, duplicated, and non-http callbacks', () => {
        for (const callback of [
            'fixture-code',
            'javascript:alert(1)?code=fixture&state=current',
            'http://127.0.0.1:1455/callback?state=current',
            'http://127.0.0.1:1455/callback?code=fixture&state=current&state=other',
        ]) {
            expect(validateDevinCallback(callback, 'current')).toBe('invalid')
        }
    })

    test('keeps retryable errors active and only releases explicit terminal states', () => {
        expect(shouldFinalizeOAuthAttempt({status: 'wait', phase: 'saving'})).toBe(false)
        expect(shouldFinalizeOAuthAttempt({status: 'error', phase: 'error', error: 'save failed'})).toBe(false)
        expect(shouldFinalizeOAuthAttempt({status: 'error', phase: 'expired', error: 'expired'})).toBe(true)
        expect(shouldFinalizeOAuthAttempt({status: 'ok', phase: 'success'})).toBe(true)
    })
})
