import {describe, expect, test} from 'bun:test'
import {buildManualKeyCardItems} from '@/components/credentials/apiKeyStatus'
import {countCredentialCards, createVendorRegistry} from '@/components/credentials/hooks/useVendorRegistry'
import {normalizeAuthFilesResponse} from '@/services/api/authFiles'
import type {Config} from '@/types'

const Icon = () => null
const vendors = createVendorRegistry({
    Gemini: Icon, Claude: Icon, Codex: Icon, Meta: Icon, Vertex: Icon, OpenAI: Icon,
    Kimi: Icon, Qwen: Icon, IFlow: Icon, Grok: Icon, Devin: Icon, Generic: Icon,
})
const config: Config = {
    apiKeys: ['fixture-access-key'],
    geminiApiKeys: [{apiKey: 'fixture-gemini'}],
    interactionsApiKeys: [{apiKey: 'fixture-interactions'}],
    claudeApiKeys: [{apiKey: 'fixture-claude'}],
    codexApiKeys: [{apiKey: 'fixture-codex'}],
    metaApiKeys: [{apiKey: 'fixture-meta'}],
    vertexApiKeys: [{apiKey: 'fixture-vertex'}],
    xaiApiKeys: [{apiKey: 'fixture-xai'}],
    openaiCompatibility: [
        {name: 'fixture-multi', baseUrl: 'https://fixture.invalid', apiKeyEntries: [
            {apiKey: 'fixture-one'}, {apiKey: 'fixture-two'},
        ], models: [], disabled: true},
        {name: 'fixture-empty', baseUrl: 'https://fixture.invalid', apiKeyEntries: [], models: [], disabled: true},
    ],
}

describe('credential summary card count', () => {
    test('counts all eight manual groups using the same expanded cards as the registry', () => {
        const manualVendors = vendors.filter((vendor) => vendor.configExtractor)
        expect(manualVendors).toHaveLength(8)
        const cards = manualVendors.flatMap((vendor) => buildManualKeyCardItems(
            vendor.id, vendor.configExtractor!(config),
        ))
        expect(cards).toHaveLength(10)
        expect(cards.filter((card) => card.disabled)).toHaveLength(3)
        expect(countCredentialCards(config, 3)).toBe(13)
    })

    test('updates with config changes and excludes management access keys', () => {
        expect(countCredentialCards({}, 0)).toBe(0)
        expect(countCredentialCards({apiKeys: ['fixture-access']}, 2)).toBe(2)
        expect(countCredentialCards({codexApiKeys: config.codexApiKeys}, 2)).toBe(3)
        expect(countCredentialCards(config, 2)).toBe(12)
        expect(countCredentialCards({...config, openaiCompatibility: []}, 2)).toBe(9)
    })

    test('keeps the badge unknown until both auth and config sources are known', () => {
        expect(countCredentialCards(null, 2)).toBeNull()
        expect(countCredentialCards(config, null)).toBeNull()
        expect(countCredentialCards(null, null)).toBeNull()
        expect(countCredentialCards({}, 0)).toBe(0)
    })

    test('includes disabled and unknown auth vendors after same-file identity normalization', () => {
        const {files} = normalizeAuthFilesResponse({files: [
            {name: 'shared.json', type: 'devin', auth_index: 'a'},
            {name: 'shared.json', type: 'devin', auth_index: 'b', disabled: true},
            {name: 'shared.json', type: 'devin', auth_index: 'a'},
            {name: 'unknown.json', type: 'fixture-unknown', disabled: true},
        ]})
        expect(files).toHaveLength(3)
        expect(countCredentialCards({}, files.length)).toBe(3)
        expect(countCredentialCards(config, files.length)).toBe(13)
    })
})
