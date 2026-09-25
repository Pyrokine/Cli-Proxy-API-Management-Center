import {describe, expect, spyOn, test} from 'bun:test'
import {apiClient} from '@/services/api/client'
import {oauthApi} from '@/services/api/oauth'

describe('OAuth API lifecycle contract', () => {
    test('carries Devin nonce and AbortSignal through start, poll, callback, and cancel requests', async () => {
        const get = spyOn(apiClient, 'get').mockResolvedValue({status: 'wait'})
        const post = spyOn(apiClient, 'post').mockResolvedValue({status: 'ok'})
        const remove = spyOn(apiClient, 'delete').mockResolvedValue({status: 'ok', cancelled: true})
        const controller = new AbortController()

        try {
            await oauthApi.startAuth('devin', {nonce: 'nonce-a', signal: controller.signal})
            expect(get).toHaveBeenLastCalledWith('/devin-auth-url', {
                params: {is_webui: true, nonce: 'nonce-a'},
                signal: controller.signal,
            })

            await oauthApi.getAuthStatus('state-a', 'nonce-a', controller.signal)
            expect(get).toHaveBeenLastCalledWith('/get-auth-status', {
                params: {state: 'state-a', nonce: 'nonce-a'},
                signal: controller.signal,
            })

            await oauthApi.submitCallback(
                'devin',
                'http://127.0.0.1:1455/callback?code=fixture&state=state-a',
                controller.signal,
            )
            expect(post).toHaveBeenLastCalledWith('/oauth-callback', {
                provider: 'devin',
                redirect_url: 'http://127.0.0.1:1455/callback?code=fixture&state=state-a',
            }, {signal: controller.signal})

            await oauthApi.cancelSession('state-a', 'nonce-a', controller.signal)
            expect(remove).toHaveBeenLastCalledWith('/oauth-session', {
                params: {state: 'state-a', nonce: 'nonce-a'},
                signal: controller.signal,
            })
        } finally {
            get.mockRestore()
            post.mockRestore()
            remove.mockRestore()
        }
    })
})
