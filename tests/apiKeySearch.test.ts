import i18n from '@/i18n'
import {apiKeysApi} from '@/services/api/apiKeys'
import {apiClient} from '@/services/api/client'
import {maskApiKey} from '@/utils/format'
import type {AxiosInstance} from 'axios'
import {expect, test} from 'bun:test'
import ts from 'typescript'
import {sourceExpression, sourceInitializer} from './sourceCallbacks'

const file                      = 'components/config/VisualConfigEditorBlocks.tsx'
const CONFIG_SECRET_PLACEHOLDER = sourceInitializer<RegExp>(file, 'CONFIG_SECRET_PLACEHOLDER', {})
const saved                     = Array.from({ length: 23 }, (_, index) =>
    `__CLI_PROXY_CONFIG_SECRET_${index.toString(16).padStart(32, '0')}__`)
const draft                     = 'sk-synthetic-draft-key'
const apiKeys                   = [...saved, draft]
const keyLabel                  = i18n.t('config_management.visual.api_keys.input_label', { lng: 'en' })
const hiddenKeyLabel            = i18n.t('config_management.visual.api_keys.saved_key_hidden', { lng: 'en' })

function filtered(searchQuery: string, aliases: Record<string, string> = {}) {
    return sourceInitializer<Array<{ key: string; index: number }>>(file, 'filteredKeys', {
        useMemo: (callback: () => unknown) => callback(),
        apiKeys, searchQuery, aliases, keyLabel, hiddenKeyLabel, CONFIG_SECRET_PLACEHOLDER, maskApiKey,
    })
}

test('saved keys match visible labels, row numbers and current draft aliases', () => {
    expect(filtered('  PRIMARY  ', { [saved[1]]: 'PrimaryAlias' })).toEqual([{ key: saved[1], index: 1 }])
    expect(filtered('#2').map(({ index }) => index)).toEqual([1, 19, 20, 21, 22, 23])
    expect(filtered(hiddenKeyLabel).map(({ key }) => key)).toEqual(saved)
    expect(filtered(keyLabel).map(({ key }) => key)).toEqual(apiKeys)
    for (const alias of ['Renamed', '']) {
        expect(filtered('PrimaryAlias', { [saved[1]]: alias })).toEqual([])
    }
})

test('search excludes saved references and still finds an unsaved key', () => {
    for (const query of ['CONFIG_SECRET', saved[0], '0000000000000000', 'saved-key-private-value']) {
        expect(filtered(query)).toEqual([])
    }
    expect(filtered('DRAFT')).toEqual([{ key: draft, index: saved.length }])
    expect(filtered(maskApiKey(draft))).toEqual([{ key: draft, index: saved.length }])
    expect(filtered('  ').map(({ key }) => key)).toEqual(apiKeys)
})

test('the editor paginates search results with their original row indexes', () => {
    const rows   = filtered(hiddenKeyLabel)
    const result = sourceExpression<unknown[]>(
        file,
        (node, tree) => ts.isCallExpression(node) && node.expression.getText(tree) === 'usePagination' &&
                        node.arguments[0]?.getText(tree) === 'filteredKeys',
        {
            filteredKeys: rows,
            usePagination: (items: typeof rows, size: number) => items.slice(size),
        },
    )
    expect(result).toEqual(saved.slice(20).map((key, index) => ({ key, index: index + 20 })))
})

test('the ordinary API key list uses the masked values and no search parameter', async () => {
    const instance        = (apiClient as unknown as { instance: AxiosInstance }).instance
    const originalAdapter = instance.defaults.adapter
    const masks           = ['abcd...wxyz#1', 'abcd...wxyz#2']
    apiClient.setConfig({ apiBase: 'https://management.synthetic.invalid', sessionToken: '' })
    instance.defaults.adapter = async (config) => {
        expect(config.method).toBe('get')
        expect(config.url).toBe('/api-keys')
        expect(config.params).toBeUndefined()
        return { config, data: { 'api-keys': masks }, headers: {}, status: 200, statusText: 'OK' }
    }
    try {
        expect(await apiKeysApi.list()).toEqual(masks)
    } finally {
        instance.defaults.adapter = originalAdapter
        apiClient.setConfig({ apiBase: '', sessionToken: '' })
    }
})
