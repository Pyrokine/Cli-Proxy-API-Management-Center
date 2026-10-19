import {describe, expect, mock, spyOn, test} from 'bun:test'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {readFileSync} from 'node:fs'
import {oauthApi, type OAuthProvider} from '@/services/api/oauth'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'components/credentials/OAuthLoginAction.tsx'
const XAI_CALLBACK_URL = sourceInitializer<string>(file, 'XAI_CALLBACK_URL', {})
const isAbsoluteUrl = sourceCallback<(value: string) => boolean>(file, 'isAbsoluteUrl', {})
const readQueryLikeCallbackInput = sourceCallback<(value: string) => URLSearchParams | null>(
    file, 'readQueryLikeCallbackInput', {},
)
const extractDisplayedXaiCode = sourceCallback<(value: string) => string>(file, 'extractDisplayedXaiCode', {})
const buildXaiCallbackUrl = sourceCallback<(input: string, state?: string) => string | null>(
    file, 'buildXaiCallbackUrl', {XAI_CALLBACK_URL, isAbsoluteUrl, readQueryLikeCallbackInput, extractDisplayedXaiCode},
)
const resolveCallbackUrl = sourceCallback<(provider: OAuthProvider, input: string, state?: string) => string | null>(
    file, 'resolveCallbackUrl', {buildXaiCallbackUrl},
)

describe('OAuth clipboard feedback', () => {
    for (const copied of [true, false]) {
        test(`reports ${copied ? 'success' : 'failure'} without copying values into notifications`, async () => {
            const previous = useNotificationStore.getState().notifications
            useNotificationStore.setState({notifications: []})
            const copy = mock(async (_value: string) => copied)
            const handle = sourceCallback<(value: string) => Promise<void>>(file, 'handleCopy', {
                apiClient: {getAuthGeneration: () => 3}, copyToClipboard: copy,
                showNotification: useNotificationStore.getState().showNotification, t: (key: string) => key,
            })
            try {
                await handle('fixture-auth-code')
                expect(copy).toHaveBeenCalledWith('fixture-auth-code')
                const notifications = useNotificationStore.getState().notifications
                expect(notifications).toHaveLength(1)
                expect(notifications[0]).toMatchObject({
                    message: copied ? 'common.copied' : 'auth_login.copy_failed', type: copied ? 'success' : 'error',
                })
                expect(notifications[0].message).not.toContain('fixture-auth-code')
                const notificationSource = readFileSync(new URL('../src/components/common/NotificationContainer.tsx', import.meta.url), 'utf8')
                expect(notificationSource).toContain("role={type === 'error' ? 'alert' : 'status'}")
            } finally {
                useNotificationStore.setState({notifications: previous})
            }
        })
    }

    test('does not report a clipboard result after the connection changed', async () => {
        let generation = 3
        let complete!: (result: boolean) => void
        const pending = new Promise<boolean>((resolve) => { complete = resolve })
        const showNotification = mock()
        const handle = sourceCallback<(value: string) => Promise<void>>(file, 'handleCopy', {
            apiClient: {getAuthGeneration: () => generation}, copyToClipboard: () => pending,
            showNotification, t: (key: string) => key,
        })
        const request = handle('fixture-auth-code')
        generation = 4
        complete(true)
        await request
        expect(showNotification).not.toHaveBeenCalled()
    })

    test('both copy buttons use the verified result handler', () => {
        const source = readFileSync(new URL('../src/components/credentials/OAuthLoginAction.tsx', import.meta.url), 'utf8')
        expect(source).toContain('onClick={() => handleCopy(url)}')
        expect(source).toContain('onClick={() => handleCopy(userCode)}')
    })
})

describe('xAI OAuth callback assembly', () => {
    const callbackCodes = [
        ['abc', 'abc'], ['code: abc', 'abc'], ['code=abc', 'abc'], ['?code=abc', 'abc'],
        ['code = abc', 'abc'], ['CODE=abc', 'abc'], ['abc==', 'abc=='],
        ['abc=def', 'abc=def'], ['code: abc=def', 'abc=def'],
    ] as const
    for (const [input, code] of callbackCodes) {
        test(`assembles ${input} with the current attempt state`, () => {
            const result = buildXaiCallbackUrl(input, 'fixture-state')
            expect(result).not.toBeNull()
            const url = new URL(result!)
            expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:56121/callback')
            expect(url.searchParams.get('code')).toBe(code)
            expect(url.searchParams.get('state')).toBe('fixture-state')
            expect(buildXaiCallbackUrl(input)).toBeNull()
        })
    }

    test('retains complete HTTP callbacks and explicit callback query fields', () => {
        for (const url of ['http://127.0.0.1:56121/callback?code=abc&state=s',
                           'https://example.test/callback?code=abc&state=s']) {
            expect(buildXaiCallbackUrl(` ${url} `, 'other-state')).toBe(url)
        }
        const error = new URL(buildXaiCallbackUrl('?error=access_denied&error_description=fixture&state=s')!)
        expect(error.searchParams.get('state')).toBe('s')
        expect(error.searchParams.get('error')).toBe('access_denied')
        expect(error.searchParams.get('error_description')).toBe('fixture')
        expect(buildXaiCallbackUrl(' ', 'fixture-state')).toBeNull()
        expect(resolveCallbackUrl('codex', ' http://example.test/callback?code=abc '))
            .toBe('http://example.test/callback?code=abc')
    })

    for (const [input, code] of callbackCodes) {
        for (const state of ['fixture-state', '']) {
            test(`submitCallback ${input} ${state ? 'sends an assembled callback' : 'rejects missing state'}`, async () => {
                const submit = spyOn(oauthApi, 'submitCallback').mockResolvedValue({status: 'ok'})
                const signal = new AbortController().signal
                const attempt = {signal, isCurrent: () => true, isPolling: () => true}
                const setError = mock()
                const setCallbackAccepted = mock()
                const setCallbackSubmitting = mock()
                const handle = sourceCallback<() => Promise<void>>(file, 'submitCallback', {
                    provider: 'xai', plugin: false, callbackUrl: input, oauthState: state, oauthApi, resolveCallbackUrl,
                    attemptsRef: {current: new Map([['xai', attempt]])}, nonceRef: {current: 'fixture-nonce'},
                    setError, setCallbackAccepted, setCallbackSubmitting, startPolling: mock(), setStatus: mock(),
                    t: (key: string) => key,
                })
                try {
                    await handle()
                    if (state) {
                        expect(submit).toHaveBeenCalledTimes(1)
                        expect(submit).toHaveBeenCalledWith('xai', expect.any(String), signal, false)
                        const submitted = new URL(submit.mock.calls[0][1])
                        expect(`${submitted.origin}${submitted.pathname}`).toBe('http://127.0.0.1:56121/callback')
                        expect(submitted.searchParams.get('code')).toBe(code)
                        expect(submitted.searchParams.get('state')).toBe('fixture-state')
                        expect(setCallbackAccepted).toHaveBeenCalledWith(true)
                        expect(setCallbackSubmitting.mock.calls.map((call) => call[0])).toEqual([true, false])
                    } else {
                        expect(submit).not.toHaveBeenCalled()
                        expect(setError).toHaveBeenCalledWith('auth_login.xai_callback_state_missing')
                        expect(setCallbackAccepted).not.toHaveBeenCalled()
                        expect(setCallbackSubmitting).not.toHaveBeenCalled()
                    }
                } finally {
                    submit.mockRestore()
                }
            })
        }
    }
})
