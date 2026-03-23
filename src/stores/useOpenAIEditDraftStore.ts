/**
 * OpenAI provider editor draft state.
 *
 * Why this exists:
 * - The app uses `PageTransition` with iOS-style stacked routes for `/ai-providers/*`.
 * - Entering `/ai-providers/openai/.../models` creates a new route layer, so component-local state
 *   inside the OpenAI edit layout is not shared between the edit screen and the model picker screen.
 * - This store makes the OpenAI edit draft shared across route layers keyed by provider index/new.
 */

import type {OpenAIFormState} from '@/components/providers/types'
import {buildApiKeyEntry} from '@/components/providers/utils'
import type {SetStateAction} from 'react'
import {create} from 'zustand'
import {createDraftSlice, type DraftSliceState} from './createDraftSlice'

export type OpenAITestStatus = 'idle' | 'loading' | 'success' | 'error';

export type KeyTestStatus = {
    status: OpenAITestStatus;
    message: string;
};

type OpenAIEditDraft = {
    initialized: boolean;
    baselineSignature: string;
    form: OpenAIFormState;
    testModel: string;
    testStatus: OpenAITestStatus;
    testMessage: string;
    keyTestStatuses: KeyTestStatus[];
};

interface OpenAIEditDraftState extends DraftSliceState<OpenAIEditDraft> {
    setDraftForm: (key: string, action: SetStateAction<OpenAIFormState>) => void;
    setDraftTestStatus: (key: string, action: SetStateAction<OpenAITestStatus>) => void;
    setDraftKeyTestStatus: (draftKey: string, keyIndex: number, status: KeyTestStatus) => void;
    resetDraftKeyTestStatuses: (draftKey: string, count: number) => void;
}

const buildEmptyForm = (): OpenAIFormState => ({
    name: '',
    prefix: '',
    baseUrl: '',
    headers: [],
    apiKeyEntries: [buildApiKeyEntry()],
    modelEntries: [{ name: '', alias: '' }],
    testModel: undefined,
})

const buildEmptyDraft = (): OpenAIEditDraft => ({
    initialized: false,
    baselineSignature: '',
    form: buildEmptyForm(),
    testModel: '',
    testStatus: 'idle',
    testMessage: '',
    keyTestStatuses: [],
})

export const useOpenAIEditDraftStore = create<OpenAIEditDraftState>((set, get) => ({
    ...createDraftSlice<OpenAIEditDraft, OpenAIEditDraftState>(buildEmptyDraft, { set, get }),

    setDraftKeyTestStatus: (draftKey, keyIndex, status) => {
        if (!draftKey) {
            return
        }
        set((state) => {
            const existing         = state.drafts[draftKey] ?? buildEmptyDraft()
            const nextStatuses     = [...existing.keyTestStatuses]
            nextStatuses[keyIndex] = status
            return {
                drafts: {
                    ...state.drafts,
                    [draftKey]: { ...existing, initialized: true, keyTestStatuses: nextStatuses },
                },
            }
        })
    },

    resetDraftKeyTestStatuses: (draftKey, count) => {
        if (!draftKey) {
            return
        }
        set((state) => {
            const existing = state.drafts[draftKey] ?? buildEmptyDraft()
            return {
                drafts: {
                    ...state.drafts,
                    [draftKey]: {
                        ...existing,
                        initialized: true,
                        keyTestStatuses: Array.from({ length: count }, () => ({
                            status: 'idle' as const,
                            message: '',
                        })),
                    },
                },
            }
        })
    },
}))
