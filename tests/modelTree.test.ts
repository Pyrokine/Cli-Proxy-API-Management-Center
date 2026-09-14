import {describe, expect, test} from 'bun:test'

import {buildModelTree, getModelMetadata, getModelProviderChannels} from '@/utils/modelTree'

describe('model tree metadata', () => {
    test('classifies current DeepSeek, GLM, Kimi, and MiniMax generations', () => {
        expect(getModelMetadata('deepseek-v4-pro')).toEqual({
                                                                provider: 'DeepSeek',
                                                                generation: 'DeepSeek V4',
                                                                family: 'V4',
                                                            })
        expect(getModelMetadata('glm-4.6')).toEqual({
                                                        provider: 'GLM',
                                                        generation: 'GLM 4',
                                                        family: 'GLM 4',
                                                    })
        expect(getModelMetadata('glm-5')).toEqual({
                                                      provider: 'GLM',
                                                      generation: 'GLM 5',
                                                      family: 'GLM 5',
                                                  })
        expect(getModelMetadata('kimi-k2.5')).toEqual({
                                                          provider: 'Kimi',
                                                          generation: 'Kimi K2.5',
                                                          family: 'K2.5',
                                                      })
        expect(getModelMetadata('kimi-k3')).toEqual({
                                                        provider: 'Kimi',
                                                        generation: 'Kimi K3',
                                                        family: 'K3',
                                                    })
        expect(getModelMetadata('minimax-m2.5')).toEqual({
                                                             provider: 'MiniMax',
                                                             generation: 'MiniMax',
                                                             family: 'M2.5',
                                                         })
        expect(getModelMetadata('MiniMax-M3')).toEqual({
                                                           provider: 'MiniMax',
                                                           generation: 'MiniMax',
                                                           family: 'M3',
                                                       })
    })

    test('groups current DeepSeek models from catalog metadata', () => {
        const tree = buildModelTree([
                                        { model: 'deepseek-flash', provider: 'DeepSeek', group: 'V4.1' },
                                        { model: 'deepseek-v4-pro', provider: 'DeepSeek', group: 'V4' },
                                    ])

        expect(tree[0]?.label).toBe('DeepSeek')
        expect(tree[0]?.children?.map((group) => group.label)).toEqual(['V4', 'V4.1'])
        const modelIds = tree[0]?.children?.flatMap((group) => group.children?.map((model) => model.id) ?? [])
        expect(modelIds).toEqual(['deepseek-v4-pro', 'deepseek-flash'])
    })

    test('uses explicit catalog provider and group before name inference', () => {
        const tree = buildModelTree([
                                        {
                                            model: 'deepseek-v4-pro',
                                            provider: 'Private DeepSeek',
                                            group: 'Production V4',
                                        },
                                    ])

        expect(tree).toEqual([
                                 {
                                     id: 'provider:Private DeepSeek',
                                     label: 'Private DeepSeek',
                                     provider: 'Private DeepSeek',
                                     kind: 'provider',
                                     children: [
                                         {
                                             id: 'group:Private DeepSeek:Production V4',
                                             label: 'Production V4',
                                             provider: 'Private DeepSeek',
                                             kind: 'group',
                                             children: [
                                                 {
                                                     id: 'deepseek-v4-pro',
                                                     label: 'deepseek-v4-pro',
                                                     provider: 'Private DeepSeek',
                                                     kind: 'model',
                                                 },
                                             ],
                                         },
                                     ],
                                 },
                             ])
    })

    test('includes iFlow in Kimi, GLM, and MiniMax provider channels', () => {
        expect(getModelProviderChannels('Kimi')).toContain('iflow')
        expect(getModelProviderChannels('GLM')).toContain('iflow')
        expect(getModelProviderChannels('MiniMax')).toContain('iflow')
    })
})
