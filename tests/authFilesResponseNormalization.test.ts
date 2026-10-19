import {describe, expect, test} from 'bun:test'
import {normalizeAuthFilesResponse} from '@/services/api/authFiles'

describe('auth-files response normalization', () => {
    test('normalizes lifecycle fields while preserving raw response data', () => {
        const result = normalizeAuthFilesResponse({
                                                      files: [
                                                          {
                                                              name: 'xai-a.json',
                                                              email: ' user@example.com ',
                                                              project_id: ' project-a ',
                                                              using_api: 'true',
                                                              disable_cooling: 1,
                                                              excluded_models: [
                                                                  ' GPT-5-* ',
                                                                  'gpt-5-*',
                                                                  'retired-model',
                                                              ],
                                                              account: 'sk-secret',
                                                          },
                                                      ],
                                                  })

        expect(result).toMatchObject({ total: 1 })
        expect(result.files[0]).toMatchObject({
                                                  email: 'user@example.com',
                                                  projectId: 'project-a',
                                                  usingApi: true,
                                                  disableCooling: true,
                                                  excludedModels: ['GPT-5-*', 'retired-model'],
                                                  account: 'sk-secret',
                                                  project_id: ' project-a ',
                                              })
    })

    test('only accepts an explicit boolean Meta manual-refresh capability', () => {
        const {files} = normalizeAuthFilesResponse({
            files: [
                {name: 'meta-dca.json', type: 'meta', manual_refresh_available: true},
                {name: 'meta-api-key.json', type: 'meta', manual_refresh_available: false},
                {name: 'meta-legacy.json', type: 'meta'},
                {name: 'meta-invalid.json', type: 'meta', manual_refresh_available: 'true'},
            ],
        })
        expect(Object.fromEntries(files.map((file) => [file.name, file.manualTokenRefreshAvailable]))).toEqual({
            'meta-dca.json': true,
            'meta-api-key.json': false,
            'meta-legacy.json': undefined,
            'meta-invalid.json': undefined,
        })
    })

    test('preserves credential runtime cooldown fields', () => {
        const result = normalizeAuthFilesResponse({
                                                      files: [
                                                          {
                                                              name: 'codex-a.json',
                                                              auth_index: 'codex:runtime-a',
                                                              disabled: false,
                                                              unavailable: true,
                                                              status: 'error',
                                                              status_message: 'quota exhausted',
                                                              runtime_error: {
                                                                  code: 'quota_exhausted',
                                                                  message: '{"error":{"type":"usage_limit_reached"}}',
                                                                  http_status: 429,
                                                                  model: 'gpt-5.6-sol',
                                                                  effect_scope: 'quota_family',
                                                                  effect_key: 'codex-sol',
                                                                  next_retry_after: '2026-08-31T02:00:00Z',
                                                                  state_generation: 7,
                                                                  observed_at: '2026-08-31T01:30:00Z',
                                                              },
                                                              updated_at: '2026-08-31T01:30:00Z',
                                                              last_refresh: '2026-08-31T01:00:00Z',
                                                              next_retry_after: '2026-08-31T02:00:00Z',
                                                          },
                                                      ],
                                                  })

        expect(result.files[0]).toMatchObject({
                                                  authIndex: 'codex:runtime-a',
                                                  disabled: false,
                                                  unavailable: true,
                                                  status: 'error',
                                                  statusMessage: 'quota exhausted',
                                                  runtimeError: {
                                                      code: 'quota_exhausted',
                                                      message: '{"error":{"type":"usage_limit_reached"}}',
                                                      httpStatus: 429,
                                                      model: 'gpt-5.6-sol',
                                                      effectScope: 'quota_family',
                                                      effectKey: 'codex-sol',
                                                      nextRetryAfter: '2026-08-31T02:00:00Z',
                                                      stateGeneration: 7,
                                                      observedAt: '2026-08-31T01:30:00Z',
                                                  },
                                                  updatedAt: '2026-08-31T01:30:00Z',
                                                  lastRefresh: '2026-08-31T01:00:00Z',
                                                  nextRetryAfter: '2026-08-31T02:00:00Z',
                                              })
    })

    test('merges duplicate disk and memory rows without losing identity fields', () => {
        const result = normalizeAuthFilesResponse({
                                                      files: [
                                                          {
                                                              name: 'codex-a.json',
                                                              source: 'memory',
                                                              email: 'user@example.com',
                                                              account: 'secret',
                                                          },
                                                          {
                                                              name: 'codex-a.json',
                                                              source: 'file',
                                                              path: '/auth/codex-a.json',
                                                              email: '',
                                                              project_id: 'project-a',
                                                          },
                                                      ],
                                                  })

        expect(result.files).toHaveLength(1)
        expect(result.files[0]).toMatchObject({
                                                  source: 'file',
                                                  path: '/auth/codex-a.json',
                                                  email: 'user@example.com',
                                                  projectId: 'project-a',
                                              })
    })

    test('preserves top-level observation metadata and valid atomic cooldown snapshots', () => {
        const result = normalizeAuthFilesResponse({
                                                      observed_at: '2026-09-16T12:00:00Z',
                                                      files: [
                                                          {
                                                              name: 'codex-a.json',
                                                              cooldowns: [
                                                                  {
                                                                      scope: 'credential',
                                                                      retry_at: '2026-09-16T12:01:00Z',
                                                                      remaining_seconds: 60,
                                                                      reason: 'quota_exceeded',
                                                                      backoff_level: 2,
                                                                      http_status: 429,
                                                                  },
                                                                  {
                                                                      scope: 'model',
                                                                      model_key: '<script>unsafe-as-text</script>',
                                                                      retry_at: '2026-09-16T12:01:00Z',
                                                                      remaining_seconds: 30,
                                                                  },
                                                              ],
                                                          },
                                                      ],
                                                  }, 1_000)

        expect(result).toMatchObject({
                                          observedAt: '2026-09-16T12:00:00.000Z',
                                          receivedAtMs: 1_000,
                                      })
        expect(result.files[0]).toMatchObject({
                                                  cooldownSnapshot: {
                                                      observedAt: '2026-09-16T12:00:00.000Z',
                                                      receivedAtMs: 1_000,
                                                      records: [
                                                          {
                                                              scope: 'credential',
                                                              retryAt: '2026-09-16T12:01:00.000Z',
                                                              remainingSeconds: 60,
                                                              reason: 'quota_exceeded',
                                                              backoffLevel: 2,
                                                              httpStatus: 429,
                                                          },
                                                          {
                                                              scope: 'model',
                                                              modelKey: '<script>unsafe-as-text</script>',
                                                              retryAt: '2026-09-16T12:01:00.000Z',
                                                              remainingSeconds: 30,
                                                              reason: 'unknown',
                                                          },
                                                      ],
                                                  },
                                              })
    })

    test('does not invent a server observation time when observed_at is invalid', () => {
        const result = normalizeAuthFilesResponse({
                                                      observed_at: 'invalid',
                                                      files: [{
                                                          name: 'codex-a.json',
                                                          cooldowns: [{
                                                              scope: 'credential',
                                                              retry_at: '2026-09-16T12:01:00Z',
                                                              remaining_seconds: 60,
                                                          }],
                                                      }],
                                                  }, 1_500)

        expect(result.observedAt).toBeUndefined()
        expect(result.files[0]?.cooldownSnapshot).toMatchObject({
            observedAt: undefined,
            receivedAtMs: 1_500,
        })
    })

    test('distinguishes omitted, unknown, known-empty, and non-empty cooldown snapshots', () => {
        const result = normalizeAuthFilesResponse({
                                                      observed_at: '2026-09-16T12:00:00Z',
                                                      files: [
                                                          {name: 'missing.json'},
                                                          {name: 'unknown.json', cooldowns: null},
                                                          {name: 'empty.json', cooldowns: []},
                                                          {
                                                              name: 'invalid.json',
                                                              cooldowns: [{
                                                                  scope: 'unsupported',
                                                                  retry_at: '2026-09-16T12:01:00Z',
                                                                  remaining_seconds: 60,
                                                              }],
                                                          },
                                                          {
                                                              name: 'expired.json',
                                                              cooldowns: [{
                                                                  scope: 'credential',
                                                                  retry_at: '2026-09-16T12:00:00Z',
                                                                  remaining_seconds: 0,
                                                              }],
                                                          },
                                                          {
                                                              name: 'invalid-diagnostics.json',
                                                              cooldowns: [{
                                                                  scope: 'credential',
                                                                  retry_at: '2026-09-16T12:01:00Z',
                                                                  remaining_seconds: 60,
                                                                  backoff_level: null,
                                                                  http_status: 200,
                                                              }],
                                                          },
                                                      ],
                                                  }, 2_000)

        const byName = Object.fromEntries(result.files.map((file) => [file.name, file.cooldownSnapshot]))
        expect(byName['missing.json']).toBeUndefined()
        expect(byName['unknown.json']).toEqual({
            observedAt: '2026-09-16T12:00:00.000Z',
            receivedAtMs: 2_000,
            records: null,
        })
        expect(byName['empty.json']?.records).toEqual([])
        expect(byName['invalid.json']?.records).toBeNull()
        expect(byName['expired.json']?.records).toBeNull()
        expect(byName['invalid-diagnostics.json']?.records).toEqual([{
            scope: 'credential',
            retryAt: '2026-09-16T12:01:00.000Z',
            remainingSeconds: 60,
            reason: 'unknown',
        }])
    })

    test('does not replace explicit null or empty cooldown snapshots with duplicate rows', () => {
        for (const records of [null, []]) {
            const result = normalizeAuthFilesResponse({
                                                          files: [
                                                              {
                                                                  name: 'codex-a.json',
                                                                  auth_index: 'codex:a',
                                                                  source: 'file',
                                                                  cooldowns: records,
                                                              },
                                                              {
                                                                  name: 'codex-a.json',
                                                                  auth_index: 'codex:a',
                                                                  source: 'memory',
                                                                  cooldowns: [{
                                                                      scope: 'credential',
                                                                      retry_at: '2026-09-16T12:01:00Z',
                                                                      remaining_seconds: 60,
                                                                  }],
                                                              },
                                                          ],
                                                      }, 3_000)

            expect(result.files).toHaveLength(1)
            expect(result.files[0]?.cooldownSnapshot).toEqual({
                observedAt: undefined,
                receivedAtMs: 3_000,
                records,
            })
        }
    })

    test('keeps same-file Devin identities separate while sharing disk fields', () => {
        const result = normalizeAuthFilesResponse({
                                                      files: [
                                                          {
                                                              name: 'devin-shared.json',
                                                              source: 'file',
                                                              path: '/auth/devin-shared.json',
                                                              size: 120,
                                                          },
                                                          {
                                                              name: 'devin-shared.json',
                                                              source: 'memory',
                                                              provider: 'devin',
                                                              auth_index: 'devin:a',
                                                              email: 'a@example.com',
                                                          },
                                                          {
                                                              name: 'devin-shared.json',
                                                              source: 'memory',
                                                              provider: 'devin',
                                                              auth_index: 'devin:b',
                                                              email: 'b@example.com',
                                                          },
                                                      ],
                                                  })

        expect(result.files).toHaveLength(2)
        expect(result.files.map((file) => ({
            authIndex: file.authIndex,
            email: file.email,
            path: file.path,
            size: file.size,
        }))).toEqual([
            { authIndex: 'devin:a', email: 'a@example.com', path: '/auth/devin-shared.json', size: 120 },
            { authIndex: 'devin:b', email: 'b@example.com', path: '/auth/devin-shared.json', size: 120 },
        ])
    })
})
