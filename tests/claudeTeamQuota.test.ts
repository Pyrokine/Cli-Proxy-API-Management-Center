import {describe, expect, test} from 'bun:test'
import {resolveClaudePlanType} from '@/utils/quota/resolvers'

describe('Claude organization plan', () => {
    test('uses an active Team organization before personal subscription flags', () => {
        expect(resolveClaudePlanType({
            account: {has_claude_max: true, has_claude_pro: true},
            organization: {organization_type: 'claude_team', subscription_status: 'active'},
        })).toBe('Team')
    })

    test('does not report an inactive Team organization as an active Team subscription', () => {
        expect(resolveClaudePlanType({
            account: {has_claude_max: true},
            organization: {organization_type: 'claude_team', subscription_status: 'inactive'},
        })).toBe('Max')
    })

    test('normalizes boolean flags and preserves legacy Team metadata', () => {
        expect(resolveClaudePlanType({
            account: {has_claude_max: 'false', has_claude_pro: 'false'},
        })).toBe('Free')
        expect(resolveClaudePlanType({
            organization: {organization_type: 'team'},
        })).toBe('Team')
    })
})
