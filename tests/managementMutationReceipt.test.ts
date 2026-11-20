import {authFilesApi} from '@/services/api/authFiles'
import {apiClient, mutationReceiptError, parseManagementMutationResult} from '@/services/api/client'
import {configFileApi} from '@/services/api/configFile'
import {useAuthFileStatusStore} from '@/stores/useAuthFileStatusStore'
import type {ApiError, ManagementMutationReceipt, ManagementMutationResult} from '@/types/api'
import {AxiosError, type AxiosInstance, type InternalAxiosRequestConfig} from 'axios'
import {afterEach, describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'

const Client          = apiClient.constructor as new () => typeof apiClient
const instance        = (client: typeof apiClient) => (client as unknown as { instance: AxiosInstance }).instance
const response        = (config: InternalAxiosRequestConfig, data: unknown, headers = {}) => ({
    config,
    data,
    headers,
    status: 200,
    statusText: 'OK',
})
const mutationId      = (config: InternalAxiosRequestConfig) => String(config.headers['X-CPA-Mutation-ID'])
const result          = (
    id: string,
    outcome: ManagementMutationResult['outcome'] = 'succeeded',
): ManagementMutationResult => ({
    mutation_id: id, request_id: 'synthetic-request-id', outcome,
    confirmed_effect: outcome === 'succeeded' || outcome === 'partial',
    effects: outcome === 'succeeded' || outcome === 'partial' ?
        [{ kind: 'configuration.persisted', target: 'configuration' }] :
        [],
    audit_available: true,
})
const receipt         = (client: typeof apiClient, id: string): ManagementMutationReceipt => ({
    mutation_id: id,
    authGeneration: client.getAuthGeneration(),
    metadata_present: false,
})
const id              = '390a2cab-7e1a-478e-a8d2-60ac023d1025'
const originalAdapter = instance(apiClient).defaults.adapter

afterEach(() => {
    instance(apiClient).defaults.adapter = originalAdapter
    apiClient.setConfig({ apiBase: '', managementKey: '' })
    useAuthFileStatusStore.setState({ requests: new Map() })
})

describe('management mutation transport', () => {
    test('assigns a distinct UUID to every write and preserves the original response bodies', async () => {
        const client                      = new Client()
        const identities: string[]        = []
        instance(client).defaults.adapter = async (config) => {
            if (config.method === 'get') {
                expect(config.headers['X-CPA-Mutation-ID']).toBeUndefined()
            } else {
                const current = mutationId(config)
                expect(current).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
                identities.push(current)
            }
            return response(config, { body: 'unchanged' })
        }
        for (const send of
            [
                () => client.post('/fixture', {}),
                () => client.put('/fixture', {}),
                () => client.patch('/fixture', {}),
                () => client.delete('/fixture'),
                () => client.postForm('/fixture', new FormData()),
            ]) {
            expect(await send()).toEqual({ body: 'unchanged' })
        }
        await client.get('/fixture')
        expect(new Set(identities).size).toBe(5)
    })

    for (const outcome of ['succeeded', 'rejected', 'partial', 'uncertain'] as const) {
        test(`observes a ${outcome} receipt without replacing the HTTP body`, async () => {
            const client                      = new Client()
            let observed: ManagementMutationReceipt | undefined
            instance(client).defaults.adapter =
                async (config) => response(
                    config,
                    { original: true },
                    {
                        'x-cpa-mutation-result': JSON.stringify(result(
                            mutationId(config),
                            outcome,
                        )),
                    },
                )
            expect(await client.put<{ original: boolean }>('/fixture', {}, {
                onMutationReceipt: (value) => {
                    observed = value
                },
            })).toEqual({ original: true })
            expect(observed?.result?.outcome).toBe(outcome)
            expect(observed?.request_id).toBe('synthetic-request-id')
            expect(observed?.authGeneration).toBe(client.getAuthGeneration())
        })
    }

    test('rejects missing, conflicting and inconsistent receipt fields', () => {
        for (const value of
            [
                {},
                { ...result(id), request_id: '' },
                { ...result(id), mutation_id: 'other' },
                { ...result(id), effects: [] },
                { ...result(id), audit_available: false },
                { ...result(id), outcome: ['succeeded'] },
                { ...result(id), effects: [{ kind: 'configuration.persisted' }] },
            ]) {
            expect(parseManagementMutationResult(value, id)).toBeUndefined()
        }
    })

    test('preserves HTTP status, body, request ID and mutation identity on an error', async () => {
        const client                      = new Client()
        instance(client).defaults.adapter = async (config) => {
            throw new AxiosError(
                'request failed',
                'ERR_BAD_RESPONSE',
                config,
                undefined,
                {
                    ...response(
                        config,
                        { error: 'runtime_sync_failed', generation: 2 },
                        {
                            'X-CPA-Mutation-Result': JSON.stringify(result(
                                mutationId(config),
                                'partial',
                            )), 'X-Request-ID': 'synthetic-request-id',
                        },
                    ), status: 503,
                },
            )
        }
        try {
            await client.put('/fixture', {});
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('Expected failure')
        } catch (error) {
            const failure = error as ApiError
            expect(failure.status).toBe(503)
            expect(failure.data).toEqual({ error: 'runtime_sync_failed', generation: 2 })
            expect(failure.requestId).toBe('synthetic-request-id')
            expect(failure.mutation?.result?.outcome).toBe('partial')
            expect(failure.mutation?.mutation_id).toMatch(/^[0-9a-f-]{36}$/)
        }
    })

    for (const recovery of ['unknown', 'unavailable', 'malformed', 'succeeded', 'uncertain'] as const) {
        test(`reads back ${recovery} without replaying the write`, async () => {
            const client                      = new Client()
            const calls: string[]             = []
            instance(client).defaults.adapter = async (config) => {
                calls.push(`${config.method} ${config.url}`)
                if (recovery === 'unknown' || recovery === 'unavailable') {
                    throw new AxiosError(
                        'recovery failed',
                        'ERR_BAD_RESPONSE',
                        config,
                        undefined,
                        {
                            ...response(config, { status: recovery }),
                            status: recovery === 'unknown' ? 404 : 503,
                        },
                    )
                }
                return response(config, recovery === 'malformed' ? {} : result(id, recovery))
            }
            const recovered                   = await client.reconcileMutation(receipt(client, id))
            expect(calls).toEqual([`get /mutations/${id}`])
            expect(recovered.mutation_id).toBe(id)
            if (recovery === 'succeeded' || recovery === 'uncertain') {
                expect(recovered.result?.outcome).toBe(recovery)
            } else {
                expect(recovered.recovery).toBe(recovery === 'unknown' ? 'unknown' : 'unavailable')
            }
        })
    }

    test('late confirmation clears a prior unknown result for the same identity', async () => {
        const client                      = new Client()
        instance(client).defaults.adapter = async (config) => response(config, result(id))
        const recovered                   = await client.reconcileMutation({
                                                                               ...receipt(client, id),
                                                                               recovery: 'unknown',
                                                                           })
        expect(recovered.result?.outcome).toBe('succeeded')
        expect(recovered.recovery).toBeUndefined()
    })

    test('does not query or publish recovery across an A-B-A authentication transition', async () => {
        const client                      = new Client()
        const attempt                     = receipt(client, id)
        let resolve!: (value: ReturnType<typeof response>) => void
        let request!: InternalAxiosRequestConfig
        let requests                      = 0
        instance(client).defaults.adapter = (config) => {
            requests += 1;
            request = config;
            return new Promise((accept) => {
                resolve = accept
            })
        }
        const pending                     = client.reconcileMutation(attempt)
        await Promise.resolve()
        await Promise.resolve()
        client.setConfig({ apiBase: 'https://synthetic-b.example', managementKey: 'synthetic-b' })
        client.setConfig({ apiBase: 'https://synthetic-a.example', managementKey: 'synthetic-a' })
        resolve(response(request, result(id)))
        expect(await pending).toEqual(attempt)
        expect(await client.reconcileMutation(attempt)).toEqual(attempt)
        expect(requests).toBe(1)
    })
})

describe(
    'real configuration and credential receipt consumers',
    () => {
        for (const outcome of ['succeeded', 'rejected', 'partial', 'uncertain', 'malformed'] as const) {
            test(
                `configuration save consumes ${outcome} while retaining its If-Match contract`,
                async () => {
                    const calls: string[]                = []
                    instance(apiClient).defaults.adapter = async (config) => {
                        calls.push(`${config.method} ${config.url}`)
                        const current = mutationId(config)
                        expect(config.headers['If-Match']).toBe('"synthetic-etag"')
                        return response(
                            config,
                            { cleanup_error: 'synthetic cleanup warning' },
                            {
                                'X-CPA-Mutation-Result': outcome === 'malformed' ?
                                                         '{}' :
                                                         JSON.stringify(result(current, outcome)),
                            },
                        )
                    }
                    if (outcome === 'succeeded') {
                        const saved = await configFileApi.saveConfigYaml('debug: true\n', '"synthetic-etag"')
                        expect(saved.cleanupError).toBe('synthetic cleanup warning')
                        expect(saved.mutation?.result?.outcome).toBe('succeeded')
                    } else {
                        if (outcome === 'uncertain' || outcome === 'malformed') {
                            const write                          = instance(apiClient).defaults.adapter
                            instance(apiClient).defaults.adapter =
                                async (config) => {
                                    if (config.method !== 'get') {
                                        return (write as (config: InternalAxiosRequestConfig) => Promise<
                                            ReturnType<
                                                typeof response>>)(
                                            config)
                                    }
                                    calls.push(`${config.method} ${config.url}`)
                                    throw new AxiosError(
                                        'record unavailable',
                                        'ERR_BAD_RESPONSE',
                                        config,
                                        undefined,
                                        { ...response(config, { status: 'unavailable' }), status: 503 },
                                    )
                                }
                        }
                        expect(configFileApi.saveConfigYaml('debug: true\n', '"synthetic-etag"'))
                            .rejects
                            .toHaveProperty(
                                'mutation')
                    }
                    expect(calls.filter((call) => call.startsWith('put '))).toHaveLength(1)
                },
            )
        }

        for (const code of ['ECONNABORTED', 'ERR_NETWORK']) {
            for (const recovery of ['unknown', 'unavailable'] as const) {
                test(`${code} retains identity and explicit ${recovery} after recovery`, async () => {
                    const calls: string[]                = []
                    let currentId                        = ''
                    instance(apiClient).defaults.adapter = async (config) => {
                        calls.push(`${config.method} ${config.url}`)
                        if (config.method === 'put') {
                            currentId = mutationId(config);
                            throw new AxiosError('response lost', code, config)
                        }
                        expect(config.url).toBe(`/mutations/${currentId}`)
                        throw new AxiosError(
                            'read failed',
                            'ERR_BAD_RESPONSE',
                            config,
                            undefined,
                            {
                                ...response(config, { status: recovery }),
                                status: recovery === 'unknown' ? 404 : 503,
                            },
                        )
                    }
                    try {
                        await configFileApi.saveConfigYaml('debug: true\n', '"synthetic-etag"');
                        // noinspection ExceptionCaughtLocallyJS
                        throw new Error('Expected failure')
                    } catch (error) {
                        const failure = error as ApiError
                        expect(failure.code).toBe(code)
                        expect(failure.mutation?.mutation_id).toBe(currentId)
                        expect(failure.mutation?.recovery).toBe(recovery)
                        expect(failure.message).toContain(currentId)
                    }
                    expect(calls).toHaveLength(2)
                    expect(calls[0]).toBe('put /config.yaml')
                })
            }
        }

        for (const outcome of ['succeeded', 'rejected', 'partial', 'uncertain'] as const) {
            test(
                `credential status consumes ${outcome} and releases its existing identity lock`,
                async () => {
                    let patches                          = 0
                    instance(apiClient).defaults.adapter = async (config) => {
                        if (config.method === 'get') {
                            throw new AxiosError(
                                'unknown',
                                'ERR_BAD_RESPONSE',
                                config,
                                undefined,
                                { ...response(config, { status: 'unknown' }), status: 404 },
                            )
                        }
                        patches += 1
                        expect(JSON.parse(String(config.data))).toEqual({
                                                                            name: '',
                                                                            disabled: true,
                                                                            auth_index: 'synthetic-auth-index',
                                                                        })
                        return response(
                            config,
                            { status: 'ok', disabled: true },
                            { 'X-CPA-Mutation-Result': JSON.stringify(result(mutationId(config), outcome)) },
                        )
                    }
                    if (outcome === 'succeeded') {
                        expect(authFilesApi.setStatus('', true, 'synthetic-auth-index')).resolves.toEqual(
                            {
                                status: 'ok',
                                disabled: true,
                            },
                        )
                    } else {
                        expect(authFilesApi.setStatus('', true, 'synthetic-auth-index'))
                            .rejects
                            .toHaveProperty('mutation')
                    }
                    expect(patches).toBe(1)
                    expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
                },
            )
        }

        test('legacy successful writes preserve the body contract and report absent receipt metadata', async () => {
            instance(apiClient).defaults.adapter = async (config) => response(config, { status: 'ok' })
            const saved                          = await configFileApi.saveConfigYaml(
                'debug: true\n',
                '"synthetic-etag"',
            )
            expect(saved.mutation?.metadata_present).toBe(false)
            expect(saved.mutation?.result).toBeUndefined()
        })

        test('all locales describe four outcomes, unavailable records and both identities', () => {
            for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
                const messages = JSON.parse(readFileSync(
                    new URL(`../src/i18n/locales/${locale}.json`, import.meta.url),
                    'utf8',
                )).common
                for (const state of ['succeeded', 'rejected', 'partial', 'uncertain', 'unknown', 'unavailable']) {
                    expect(messages[`mutation_${state}`]).toBeTruthy()
                }
                expect(messages.mutation_identity).toContain('{{mutationId}}')
                expect(messages.mutation_identity).toContain('{{requestId}}')
            }
            expect(mutationReceiptError({ ...receipt(apiClient, id), recovery: 'unknown' }).message).toContain(id)
        })
    },
)
