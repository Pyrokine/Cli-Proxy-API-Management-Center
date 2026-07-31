import {describe, expect, test} from 'bun:test'
import {hasImageArtifactCacheChanges} from '../src/hooks/useVisualConfig.ts'
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

describe('visual config concurrent edits', () => {
    test('preserves a newer image artifact cache config when the user did not edit it', () => {
        const baseline = {
            imageArtifactCacheRetentionDays: '7',
            imageArtifactCacheMaxTotalSizeMb: '1024',
        }

        expect(hasImageArtifactCacheChanges({...baseline}, baseline)).toBe(false)
        expect(hasImageArtifactCacheChanges({
            ...baseline,
            imageArtifactCacheRetentionDays: '14',
        }, baseline)).toBe(true)
    })
})
