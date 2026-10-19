import {describe, expect, spyOn, test} from 'bun:test'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {providersApi} from '@/services/api/providers'

describe('provider edits with concurrent changes', () => {
    const original = {
        'api-key': 'synthetic-xai-key', 'auth-index': 'xai-auth', priority: 1,
        models: [{name: 'grok-4', alias: 'grok'}], headers: {'X-Test': 'before'},
    }

    test('refuses a stale provider without sending a PATCH', async () => {
        const get = spyOn(apiClient, 'get')
            .mockResolvedValueOnce({'xai-api-key': [original]})
            .mockResolvedValueOnce({'xai-api-key': [{...original, headers: {'X-Test': 'updated'}}]})
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        try {
            const [loaded] = await providersApi.getXAIConfigs()
            await expect(providersApi.patchXAIConfig(0, {...loaded, priority: 2}, loaded))
                .rejects.toThrow(i18n.t('ai_providers.provider_changed'))
            expect(patch).not.toHaveBeenCalled()
        } finally {
            get.mockRestore()
            patch.mockRestore()
        }
    })

    test('sends only edited fields after refetching an unchanged credential', async () => {
        const get = spyOn(apiClient, 'get').mockResolvedValue({'xai-api-key': [original]})
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        try {
            const [loaded] = await providersApi.getXAIConfigs()
            await providersApi.patchXAIConfig(0, {...loaded, priority: 2}, loaded)
            expect(get).toHaveBeenCalledTimes(2)
            expect(patch).toHaveBeenCalledWith('/xai-api-key', {
                index: 0, 'auth-index': 'xai-auth', value: {priority: 2},
            }, {__authGeneration: apiClient.getAuthGeneration()})
        } finally {
            get.mockRestore()
            patch.mockRestore()
        }
    })
})
