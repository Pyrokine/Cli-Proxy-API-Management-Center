import {describe, expect, test} from 'bun:test'
import {applyProviderQuickFill} from '../src/pages/providerQuickFill.ts'

describe('provider quick fill', () => {
    test('updates only the Base URL', () => {
        const form = {name: 'Existing Provider', baseUrl: 'https://old.example/v1', priority: 10}
        const next = applyProviderQuickFill(form, {baseUrl: 'https://new.example/v1'})

        expect(next).toEqual({
            name: 'Existing Provider',
            baseUrl: 'https://new.example/v1',
            priority: 10,
        })
    })
})
