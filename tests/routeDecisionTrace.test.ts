import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'

import {expectSourceToContain} from './sourceContractAssertions'
import {parseRouteDecisionTrace, requestLogStateToRouteDecisionStatus} from '@/pages/hooks/routeDecisionTrace'

import {apiClient} from '@/services/api/client'
import {logsApi} from '@/services/api/logs'

const routeDecisionEvent = (overrides: Record<string, unknown> = {}) => ({
    sequence: 4,
    attempt: 2,
    action: 'route.decision',
    decision: {
        strategy: 'weighted-round-robin',
        requested_model: 'requested-model',
        routed_model: 'routed-model',
        providers: ['gemini', 'claude'],
        affinity: 'none',
        matched_rule: 'weighted_round_robin',
        candidate_scope: 'complete',
        candidates: [
            {
                provider: 'gemini',
                model: 'routed-model',
                target_model: 'target-model',
                auth_index: '0123456789abcdef',
                priority: 7,
                effective_weight: 5,
                native: false,
                converted: true,
                affinity: 'none',
                cooldowns: {
                    exact_model: { known: true, active: false },
                    quota_family: {
                        known: true,
                        active: true,
                        retry_after_ms: 2500,
                        reason: 'quota_exceeded',
                        effect_key: 'family-a',
                        state_generation: 9,
                        reset_authority: 'operator',
                    },
                    credential: { known: true, active: false },
                    provider: { known: false, active: false },
                },
                quota_status: 'fresh',
                quota_headroom: 0.75,
                quota_reset_after_ms: 60_000,
                in_flight: 2,
                matched_rules: ['highest_priority', 'quota_available_score'],
                excluded_reasons: [],
                selected: true,
            },
        ],
        selected: {
            provider: 'gemini',
            model: 'routed-model',
            target_model: 'target-model',
            auth_index: '0123456789abcdef',
            matched_rule: 'weighted_round_robin',
        },
        truncated_candidates: 3,
        ...overrides,
    },
})

const requestLog = (...events: unknown[]) => [
    '=== REQUEST ===',
    'request body',
    '',
    '=== ROUTE TRACE ===',
    ...events.map((event) => JSON.stringify(event)),
    '',
].join('\n')

describe('route decision trace parser', () => {
    test('parses the latest immutable route decision without deriving missing scheduler data', () => {
        const first  = routeDecisionEvent({ matched_rule: 'round_robin' })
        const latest = routeDecisionEvent()
        const state  = parseRouteDecisionTrace(
            requestLog(first, { truncated_events: 2 }, latest),
            false,
        )

        expect(state.status).toBe('ready')
        expect(state.attempt).toBe(2)
        expect(state.omittedEvents).toBe(2)
        expect(state.decision?.matchedRule).toBe('weighted_round_robin')
        expect(state.decision?.candidateScope).toBe('complete')
        expect(state.decision?.truncatedCandidates).toBe(3)
        expect(state.decision?.selected?.authIndex).toBe('0123456789abcdef')
        expect(state.decision?.candidates[0]?.priority).toBe(7)
        expect(state.decision?.candidates[0]?.native).toBeFalse()
        expect(state.decision?.candidates[0]?.converted).toBeTrue()
        expect(state.decision?.candidates[0]?.quotaStatus).toBe('fresh')
        expect(state.decision?.candidates[0]?.quotaHeadroom).toBe(0.75)
        expect(state.decision?.candidates[0]?.quotaResetAfterMs).toBe(60_000)
        expect(state.decision?.candidates[0]?.inFlight).toBe(2)
        expect(state.decision?.candidates[0]?.cooldowns.quotaFamily).toEqual({
                                                                                 known: true,
                                                                                 active: true,
                                                                                 indefinite: false,
                                                                                 retryAfterMs: 2500,
                                                                                 reason: 'quota_exceeded',
                                                                                 effectKey: 'family-a',
                                                                                 stateGeneration: 9,
                                                                                 resetAuthority: 'operator',
                                                                             })
    })

    test('validates quota-aware candidate signal types without deriving replacements', () => {
        const event = routeDecisionEvent()
        Object.assign(event.decision.candidates[0], {
            quota_status: 'expired',
            quota_headroom: 1.5,
            quota_reset_after_ms: -1,
            in_flight: -2,
        })

        const candidate = parseRouteDecisionTrace(requestLog(event), false).decision?.candidates[0]
        expect(candidate?.quotaStatus).toBe('')
        expect(candidate?.quotaHeadroom).toBeNull()
        expect(candidate?.quotaResetAfterMs).toBeNull()
        expect(candidate?.inFlight).toBeNull()
    })

    test('preserves selected-only Home scope', () => {
        const state = parseRouteDecisionTrace(
            requestLog(routeDecisionEvent({ candidate_scope: 'selected_only' })),
            false,
        )
        expect(state.status).toBe('ready')
        expect(state.decision?.candidateScope).toBe('selected_only')
    })

    test('requires a standalone route-trace marker and uses the final standalone section', () => {
        const embeddedMarker = [
            'response body contains === ROUTE TRACE === text',
            JSON.stringify(routeDecisionEvent()),
        ].join('\n')
        expect(parseRouteDecisionTrace(embeddedMarker, false).status).toBe('not_recorded')

        const content = [
            'response body contains === ROUTE TRACE === text',
            '=== ROUTE TRACE ===',
            JSON.stringify(routeDecisionEvent({ matched_rule: 'round_robin' })),
            '=== ROUTE TRACE ===',
            JSON.stringify(routeDecisionEvent()),
        ].join('\n')
        expect(parseRouteDecisionTrace(content, false).decision?.matchedRule).toBe('weighted_round_robin')
    })

    test('treats a malformed latest decision as authoritative instead of using an older snapshot', () => {
        const state = parseRouteDecisionTrace(
            requestLog(routeDecisionEvent(), routeDecisionEvent({ candidates: [{ provider: 'gemini' }] })),
            false,
        )
        expect(state).toMatchObject({ status: 'invalid', decision: null, invalidLines: 1 })
    })

    test('reports malformed non-decision lines beside a valid latest snapshot', () => {
        const state = parseRouteDecisionTrace(
            [
                '=== ROUTE TRACE ===',
                'not-json',
                JSON.stringify(routeDecisionEvent()),
            ].join('\n'),
            false,
        )
        expect(state).toMatchObject({ status: 'ready', invalidLines: 1 })
    })

    test('distinguishes old logs, truncated previews, and invalid JSONL', () => {
        expect(parseRouteDecisionTrace('legacy request log', false).status).toBe('not_recorded')
        expect(parseRouteDecisionTrace('legacy request log', true).status).toBe('truncated')
        expect(parseRouteDecisionTrace('=== ROUTE TRACE ===\nnot-json\n', false).status).toBe('invalid')
        expect(parseRouteDecisionTrace(
            requestLog({ sequence: 1, action: 'route.selected' }, { truncated_events: 4 }),
            false,
        )).toMatchObject({ status: 'truncated', omittedEvents: 4 })
    })

    test('rejects route decisions with malformed candidate identities', () => {
        const malformed = routeDecisionEvent({
                                                 candidates: [{ provider: 'gemini' }],
                                             })
        expect(parseRouteDecisionTrace(requestLog(malformed), false).status).toBe('invalid')
    })

    test('distinguishes an explicit empty selection from a malformed selection', () => {
        expect(parseRouteDecisionTrace(
            requestLog(routeDecisionEvent({ selected: null })),
            false,
        )).toMatchObject({ status: 'ready', decision: { selected: null } })
        expect(parseRouteDecisionTrace(
            requestLog(routeDecisionEvent({ selected: { provider: 'gemini' } })),
            false,
        )).toMatchObject({ status: 'invalid', decision: null })
    })

    test('maps every request-log lifecycle without conflating distinct terminal states', () => {
        expect(requestLogStateToRouteDecisionStatus('pending')).toBe('pending')
        expect(requestLogStateToRouteDecisionStatus('available')).toBe('not_recorded')
        for (const state of ['disabled', 'not_captured', 'publish_failed', 'expired', 'legacy_unknown'] as const) {
            expect(requestLogStateToRouteDecisionStatus(state)).toBe('lifecycle')
        }
    })
})

describe('route decision request-log integration', () => {
    test('normalizes a pending request-log lifecycle response', async () => {
        const originalGet = apiClient.get
        apiClient.get     = (async () => ({
            error: 'request log is still being published',
            request_log_state: 'pending',
            request_log_home_ip: '192.0.2.1',
        })) as typeof apiClient.get
        try {
            // noinspection ES6RedundantAwait
            await expect(logsApi.previewRequestLogById('request-id', 300, '192.0.2.1')).resolves.toEqual({
                                                                                                             content: '',
                                                                                                             truncated: false,
                                                                                                             total_lines: 0,
                                                                                                             requestLogState: 'pending',
                                                                                                             requestLogHomeIp: '192.0.2.1',
                                                                                                             message: 'request log is still being published',
                                                                                                         })
        } finally {
            apiClient.get = originalGet
        }
    })

    test('normalizes all request-log lifecycle values and rejects unknown values', async () => {
        const originalGet = apiClient.get
        let responseState = ''
        apiClient.get     = (async () => ({ request_log_state: responseState })) as typeof apiClient.get
        try {
            for (const state of [
                'pending',
                'available',
                'disabled',
                'not_captured',
                'publish_failed',
                'expired',
                'legacy_unknown',
            ] as const) {
                responseState = state
                // noinspection ES6RedundantAwait
                await expect(logsApi.previewRequestLogById('request-id')).resolves.toMatchObject({
                                                                                                     requestLogState: state,
                                                                                                 })
            }
            responseState = 'unexpected'
            // noinspection ES6RedundantAwait
            await expect(logsApi.previewRequestLogById('request-id')).resolves.toMatchObject({
                                                                                                 requestLogState: '',
                                                                                             })
        } finally {
            apiClient.get = originalGet
        }
    })

    test('keeps Home location propagation and stale-response generation guards in the trace flow', () => {
        const hookSource      = readFileSync(
            fileURLToPath(new URL('../src/pages/hooks/useTraceResolver.ts', import.meta.url)),
            'utf8',
        )
        const logsPageSource  = readFileSync(
            fileURLToPath(new URL('../src/pages/LogsPage.tsx', import.meta.url)),
            'utf8',
        )
        const requestLogStart = hookSource.indexOf('void logsApi.previewRequestLogById(')
        const usageBarrier    = hookSource.indexOf('const [eventsResult, authResult] = await Promise.allSettled([')
        expect(requestLogStart).toBeGreaterThan(-1)
        expect(usageBarrier).toBeGreaterThan(requestLogStart)
        expectSourceToContain(hookSource, 'const resetRequestId = ++traceRequestIdRef.current')
        expect(hookSource).toContain('requestId ? \'loading\' : \'missing_request_id\'')
        expect(hookSource).toContain('setRequestLogHomeIp(resolvedHomeIp)')
        expect(hookSource).toContain('setRouteDecisionTrace(createRouteDecisionTraceState(\'idle\'))')
        expect(hookSource).toContain('latestTraceScopeKeyRef.current = traceScopeKey')
        expect(hookSource).toContain('latestTraceScopeKeyRef.current === traceScopeKey')
        expect(logsPageSource).toContain('requestLogHomeIpByIdRef.current[line.requestId]')
        expect(logsPageSource).toContain('trace.requestLogHomeIp')
        expect(logsPageSource).toContain('routeRequestLogStateLabel')
        expect(logsPageSource).toContain('t(\'logs.trace_route_candidates_truncated_notice\'')
        expect(logsPageSource).toContain('t(\'logs.trace_route_events_omitted_notice\'')
        expect(logsPageSource).toContain('t(\'logs.trace_route_invalid_lines_notice\'')
        expect(logsPageSource).toContain('t(\'logs.trace_route_no_selected\')')
        expect(logsPageSource).toContain('t(\'logs.trace_route_none\')')
        expect(logsPageSource).toContain('candidate.quotaStatus')
        expect(logsPageSource).toContain('candidate.quotaResetAfterMs')
        expect(logsPageSource).toContain('candidate.cooldowns.quotaFamily')
    })
})
