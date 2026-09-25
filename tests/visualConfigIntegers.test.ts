import {describe, expect, test} from 'bun:test'
import {parse} from 'yaml'
import {getVisualConfigValidationErrors} from '@/hooks/useVisualConfig'
import type {VisualConfigValues} from '@/types/visualConfig'
import {decodeVisualConfigYaml, encodeVisualConfigYaml, integerFieldValue, VISUAL_INTEGER_FIELDS} from '@/hooks/visualConfigCodec'

function setInteger(values: VisualConfigValues, field: string, value: string): void {
    if (field.startsWith('streaming.')) {
        values.streaming[field.slice(10) as keyof VisualConfigValues['streaming']] = value
    } else {
        Object.assign(values, {[field]: value})
    }
}

describe('visual configuration integer contracts', () => {
    test('int32 and nanosecond duration consumers cannot overflow from positive values', () => {
        const decoded = decodeVisualConfigYaml('debug: false\n')
        for (const [field, value] of Object.entries({requestRetry: '2147483648', maxRetryCredentials: '2147483648', maxRetryInterval: '9223372037'})) {
            const next = {...decoded.values, [field]: value}
            expect(getVisualConfigValidationErrors(next)[field as keyof ReturnType<typeof getVisualConfigValidationErrors>]).toBeDefined()
            expect(() => encodeVisualConfigYaml('debug: false\n', next, decoded.values, decoded.apiKeysStorage)).toThrow()
        }
    })

    for (const field of ['maxRetryCredentials', 'maxRetryInterval', 'authAutoRefreshWorkers', 'streaming.keepaliveSeconds', 'streaming.bootstrapRetries', 'streaming.nonstreamKeepaliveInterval']) {
        test(`${field}: signed safe integers and blanks follow the same validator and writer contract`, () => {
            const source = 'debug: false\n'
            const decoded = decodeVisualConfigYaml(source)
            for (const value of ['-1', '0', '8', '', String(VISUAL_INTEGER_FIELDS[field]!.minimum), String(VISUAL_INTEGER_FIELDS[field]!.maximum)]) {
                const next = structuredClone(decoded.values)
                setInteger(next, field, value)
                expect(getVisualConfigValidationErrors(next)[field as keyof ReturnType<typeof getVisualConfigValidationErrors>]).toBeUndefined()
                const output = encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage)
                expect(integerFieldValue(decodeVisualConfigYaml(output).values, field)).toBe(value)
            }
            for (const value of ['9007199254740993', '-9007199254740993', '1.5', '1e3', 'NaN', 'Infinity', '1x']) {
                const next = structuredClone(decoded.values)
                setInteger(next, field, value)
                expect(getVisualConfigValidationErrors(next)[field as keyof ReturnType<typeof getVisualConfigValidationErrors>]).toBeDefined()
                expect(() => encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage)).toThrow('Invalid configuration integer')
            }
        })
    }

    test('integer decoding retains unsafe digits, deletion removes keys, and bounds remain enforced', () => {
        const source = 'max-retry-interval: 9007199254740993\n'
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values.maxRetryInterval).toBe('9007199254740993')
        const next = {...decoded.values, maxRetryInterval: ''}
        expect(parse(encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage)) ?? {}).not.toHaveProperty('max-retry-interval')
        for (const [field] of Object.entries(VISUAL_INTEGER_FIELDS).filter(([, contract]) => contract.minimum >= 0)) {
            const values = structuredClone(decodeVisualConfigYaml('').values)
            setInteger(values, field, '-1')
            expect(getVisualConfigValidationErrors(values)[field as keyof ReturnType<typeof getVisualConfigValidationErrors>]).toBeDefined()
        }
        const values = structuredClone(decodeVisualConfigYaml('').values)
        for (const [field, value] of Object.entries({port: '65536', tlsHttpRedirectPort: '65536', usageRetentionWarningThresholdPct: '101', redisUsageQueueRetentionSeconds: '3601', usageRetentionDays: '-2'})) {
            setInteger(values, field, value)
            expect(getVisualConfigValidationErrors(values)[field as keyof ReturnType<typeof getVisualConfigValidationErrors>]).toBeDefined()
        }
    })

    test('omitted quota intervals use effective defaults only for validation', () => {
        const source = 'debug: false\nquota-refresh:\n  enabled: true\n'
        const decoded = decodeVisualConfigYaml(source)
        const next = {...decoded.values, debug: true}
        expect(Object.values(getVisualConfigValidationErrors(next)).filter(Boolean)).toEqual([])
        const output = encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage)
        expect(output).not.toContain('interval')
        expect(parse(output)).toEqual({debug: true, 'quota-refresh': {enabled: true}})
        expect(getVisualConfigValidationErrors({...next, quotaRefreshInterval: '2000'}).quotaRefreshMaxInterval).toBeDefined()
        expect(getVisualConfigValidationErrors({...next, quotaRefreshMaxInterval: '300'}).quotaRefreshMaxInterval).toBeDefined()
        expect(getVisualConfigValidationErrors({...next, quotaRefreshInterval: '0'}).quotaRefreshInterval).toBeDefined()
    })
})
