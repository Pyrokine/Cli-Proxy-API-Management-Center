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
})
