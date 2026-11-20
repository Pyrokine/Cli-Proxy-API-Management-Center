import {buildManualKeyCardItems} from '@/components/credentials/apiKeyStatus'
import {buildApiKeyEntry} from '@/components/providers/utils'
import {modelsToEntries} from '@/components/ui/modelInputListUtils'
import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import {apiClient} from '@/services/api/client'
import {configFileApi} from '@/services/api/configFile'
import {providersApi} from '@/services/api/providers'
import type {OpenAIProviderConfig} from '@/types'
import {buildHeaderObject, headersToEntries} from '@/utils/headers'
import {AxiosHeaders} from 'axios'
import {expect, spyOn, test} from 'bun:test'
import {parse} from 'yaml'
import {sourceInitializer} from './sourceCallbacks'

const layout = 'pages/AiProvidersOpenAIEditLayout.tsx'

test(
    'OpenAI per-key disabled survives management load, draft seeding, edits, signature and serialization',
    async () => {
        const raw  = {
            name: 'synthetic-provider', 'base-url': 'https://provider.synthetic.invalid', disabled: false,
            'api-key-entries': [
                {
                    'api-key': 'synthetic-same-key',
                    'auth-index': 'synthetic-first',
                    'proxy-url': 'http://proxy.synthetic.invalid',
                    weight: 2,
                    disabled: true,
                },
                {
                    'api-key': 'synthetic-same-key',
                    'auth-index': 'synthetic-second',
                    'proxy-url': 'http://proxy.synthetic.invalid',
                    weight: 4,
                    disabled: false,
                },
            ],
        }
        const get  = spyOn(apiClient, 'get').mockResolvedValue({ 'openai-compatibility': [raw] })
        const post = spyOn(apiClient, 'post').mockResolvedValue({ status: 'ok' })
        try {
            const provider = (await providersApi.getOpenAIProviders())[0]
            expect(provider.apiKeyEntries.map((entry) => entry.disabled)).toEqual([true, false])
            expect(buildManualKeyCardItems('openai', [provider]).map((entry) => [entry.authIndex, entry.disabled]))
                .toEqual([['synthetic-first', true], ['synthetic-second', false]])
            const seed            = sourceInitializer<(value: OpenAIProviderConfig) => {
                form: { name: string; baseUrl: string; headers: []; apiKeyEntries: typeof provider.apiKeyEntries }
            }>(layout, 'seedDraftInit', {
                useCallback: <T>(value: T) => value, modelsToEntries, headersToEntries, buildApiKeyEntry,
            })
            const form            = seed(provider).form
            form.name             = 'renamed-provider'
            form.apiKeyEntries[1] = { ...form.apiKeyEntries[1], weight: 7 }
            const payload         = sourceInitializer<OpenAIProviderConfig>(
                layout,
                'payload',
                {
                    form,
                    name: form.name,
                    baseUrl: form.baseUrl,
                    buildHeaderObject,
                },
            )
            await providersApi.createOpenAIProvider(payload)
            expect((post.mock.calls[0][1] as Record<string, unknown>)['api-key-entries']).toEqual(
                [
                    {
                        'api-key': 'synthetic-same-key',
                        'proxy-url': 'http://proxy.synthetic.invalid',
                        weight: 2,
                        disabled: true,
                    },
                    {
                        'api-key': 'synthetic-same-key',
                        'proxy-url': 'http://proxy.synthetic.invalid',
                        weight: 7,
                        disabled: false,
                    },
                ])
            const normalizeKeyHeaders = sourceInitializer<(value: unknown) => unknown>(
                layout,
                'normalizeKeyHeaders',
                {},
            )
            const normalize           = sourceInitializer<(value: typeof provider.apiKeyEntries) => unknown>(
                layout,
                'normalizeApiKeyEntries',
                { normalizeKeyHeaders },
            )
            expect(normalize(provider.apiKeyEntries))
                .not
                .toEqual(normalize(provider.apiKeyEntries.map((entry) => ({ ...entry, disabled: false }))))
            expect(provider.disabled).toBe(false)
        } finally {
            get.mockRestore();
            post.mockRestore()
        }
    },
)

for (const [text, expected] of [['{}', {}], ['null', null], ['', {}]] as const) {
    test(
        `visual alias ${JSON.stringify(text)} is an explicit clear through validation, If-Match and resource readback`,
        async () => {
            const baseline = 'port: 8317\noauth-model-alias:\n  codex: [{name: original, alias: public}]\n'
            const decoded  = decodeVisualConfigYaml(baseline)
            const content  = encodeVisualConfigYaml(
                baseline,
                { ...decoded.values, oauthModelAliasText: text },
                decoded.values,
                decoded.apiKeysStorage,
                baseline,
            )
            expect(parse(content)).toHaveProperty('oauth-model-alias', expected)
            let saved  = baseline
            const post = spyOn(apiClient, 'post').mockResolvedValue({ valid: true, errors: [], warnings: [] })
            const put  = spyOn(apiClient, 'put').mockImplementation(async <T>(
                url: string,
                data?: unknown,
                config?: { headers?: unknown },
            ) => {
                expect(url).toBe('/config.yaml')
                expect(config?.headers).toMatchObject({ 'If-Match': '"synthetic-etag"' })
                saved = String(data)
                return { status: 'ok' } as T
            })
            const get  = spyOn(apiClient, 'getRaw').mockImplementation(async () => ({
                data: saved,
                headers: { etag: '"readback-etag"' },
                status: 200,
                statusText: 'OK',
                config: { headers: new AxiosHeaders() },
            }) as Awaited<ReturnType<typeof apiClient.getRaw>>)
            try {
                expect((await configFileApi.validateConfigYaml(content, baseline)).valid).toBe(true)
                await configFileApi.saveConfigYaml(content, '"synthetic-etag"')
                expect(parse((await configFileApi.fetchConfigYaml()).content)).toHaveProperty(
                    'oauth-model-alias',
                    expected,
                )
                expect(put).toHaveBeenCalledTimes(1)
            } finally {
                post.mockRestore();
                put.mockRestore();
                get.mockRestore()
            }
        },
    )
}

test('unrelated visual edits preserve an omitted alias field and the catalog-authoritative contract', () => {
    const source  = 'port: 8317\ndebug: false\n'
    const decoded = decodeVisualConfigYaml(source)
    const content = encodeVisualConfigYaml(
        source,
        { ...decoded.values, debug: true },
        decoded.values,
        decoded.apiKeysStorage,
        source,
    )
    expect(parse(content)).not.toHaveProperty('oauth-model-alias')
    expect(parse(content).debug).toBe(true)
})
