/**
 * Claude provider editor draft state.
 *
 * Why this exists:
 * - The app uses `PageTransition` with iOS-style stacked routes for `/ai-providers/*`.
 * - Entering `/ai-providers/claude/.../models` creates a new route layer, so component-local state
 *   inside the Claude edit layout is not shared between the edit screen and the model picker screen.
 * - This store makes the Claude edit draft shared across route layers keyed by provider index/new.
 */

import type {ProviderFormState} from '@/components/providers/types'
import type {SetStateAction} from 'react'
import {create} from 'zustand'
import {createDraftSlice, type DraftSliceState} from './createDraftSlice'

type ClaudeTestStatus = 'idle' | 'loading' | 'success' | 'error'

type ClaudeEditDraft = {
    initialized: boolean
    baselineSignature: string
    form: ProviderFormState
    testModel: string
    testStatus: ClaudeTestStatus
    testMessage: string
}

interface ClaudeEditDraftState extends DraftSliceState<ClaudeEditDraft> {
    setDraftForm: (key: string, action: SetStateAction<ProviderFormState>) => void
    setDraftTestStatus: (key: string, action: SetStateAction<ClaudeTestStatus>) => void
}

const buildEmptyForm = (): ProviderFormState => ({
    apiKey: '',
    prefix: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [],
    models: [],
    excludedModels: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedText: '',
})

const buildEmptyDraft = (): ClaudeEditDraft => ({
    initialized: false,
    baselineSignature: '',
    form: buildEmptyForm(),
    testModel: '',
    testStatus: 'idle',
    testMessage: '',
})

export const useClaudeEditDraftStore = create<ClaudeEditDraftState>((set, get) => ({
    ...createDraftSlice<ClaudeEditDraft, ClaudeEditDraftState>(buildEmptyDraft, { set, get }),
}))
