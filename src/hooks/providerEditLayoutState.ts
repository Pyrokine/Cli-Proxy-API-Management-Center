export type ProviderDraftInitAction = 'wait' | 'empty' | 'seed'

export function resolveProviderDraftInitAction<C>(options: {
    loading: boolean
    initialized: boolean
    hasIndexParam: boolean
    invalidIndexParam: boolean
    initialData?: C
}): ProviderDraftInitAction {
    if (options.loading || options.initialized || options.invalidIndexParam) {
        return 'wait'
    }
    if (!options.hasIndexParam) {
        return 'empty'
    }
    return options.initialData !== undefined ? 'seed' : 'wait'
}
