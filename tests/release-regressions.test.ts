import {describe, expect, test} from 'bun:test'
import {hasImageArtifactCacheChanges} from '../src/hooks/useVisualConfig.ts'
import {applyProviderQuickFill} from '../src/pages/providerQuickFill.ts'
import {normalizePluginReleaseVersions} from '../src/pages/pluginReleaseVersions.ts'
import {buildPluginStoreReleasesPath} from '../src/services/api/plugins.ts'

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

describe('plugin release versions', () => {
    test('uses the authenticated plugin-store endpoint and normalizes its response', () => {
        expect(buildPluginStoreReleasesPath('sample-provider', 'private-source')).toBe(
            '/plugin-store/sample-provider/releases?source=private-source',
        )
        expect(normalizePluginReleaseVersions([
            {
                tag_name: 'v1.2.3',
                name: 'Version 1.2.3',
                published_at: '2026-07-31T00:00:00Z',
                prerelease: false,
                html_url: 'https://github.com/example/sample/releases/tag/v1.2.3',
                asset_names: ['sample_1.2.3_linux_amd64.zip'],
            },
        ])).toEqual([
            {
                tagName: 'v1.2.3',
                name: 'Version 1.2.3',
                publishedAt: '2026-07-31T00:00:00Z',
                prerelease: false,
                htmlUrl: 'https://github.com/example/sample/releases/tag/v1.2.3',
                assetNames: ['sample_1.2.3_linux_amd64.zip'],
            },
        ])
    })
})
