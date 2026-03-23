/**
 * Shared draft lifecycle & field-setter logic for provider editor stores.
 *
 * Both Claude and OpenAI editor stores manage keyed drafts with identical
 * acquire/release ref-counting, init, ensure, field-set, and clear semantics.
 * This factory produces that common slice so each store only adds its own
 * domain-specific fields and actions.
 */

import type {SetStateAction} from 'react'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const resolveAction = <T>(action: SetStateAction<T>, prev: T): T =>
    typeof action === 'function' ? (action as (previous: T) => T)(prev) : action

/* ------------------------------------------------------------------ */
/*  Shared draft shape                                                */

/* ------------------------------------------------------------------ */

/** Minimum fields every provider draft must have. */
export interface BaseDraft {
    initialized: boolean;
    baselineSignature: string;
    form: object;
    testModel: string;
    testStatus: string;
    testMessage: string;
}

/* ------------------------------------------------------------------ */
/*  Shared state & actions                                            */

/* ------------------------------------------------------------------ */

export interface DraftSliceState<D extends BaseDraft> {
    drafts: Record<string, D>;
    refCounts: Record<string, number>;
    acquireDraft: (key: string) => void;
    releaseDraft: (key: string) => void;
    ensureDraft: (key: string) => void;
    initDraft: (key: string, draft: Omit<D, 'initialized'>) => void;
    setDraftBaselineSignature: (key: string, signature: string) => void;
    setDraftForm: (key: string, action: SetStateAction<D['form']>) => void;
    setDraftTestModel: (key: string, action: SetStateAction<string>) => void;
    setDraftTestStatus: (key: string, action: SetStateAction<D['testStatus']>) => void;
    setDraftTestMessage: (key: string, action: SetStateAction<string>) => void;
    clearDraft: (key: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

type ZustandSetGet<S> = {
    set: (partial: Partial<S> | ((state: S) => Partial<S>)) => void;
    get: () => S;
};

/**
 * Create the shared draft-management actions.
 *
 * @param buildEmpty - Provider-specific factory that returns a blank draft.
 * @param set - Zustand state setter.
 * @param get - Zustand state getter.
 */
export function createDraftSlice<D extends BaseDraft, S extends DraftSliceState<D>>(
    buildEmpty: () => D,
    { set, get }: ZustandSetGet<S>,
): DraftSliceState<D> {
    const patchDraft = (state: DraftSliceState<D>, key: string, patch: Partial<D>): Partial<DraftSliceState<D>> => {
        const existing = state.drafts[key] ?? buildEmpty()
        return {
            drafts: {
                ...state.drafts,
                [key]: { ...existing, initialized: true, ...patch } as D,
            },
        }
    }

    return {
        drafts: {},
        refCounts: {},

        acquireDraft: (key) => {
            if (!key) {
                return
            }
            set((state) => {
                const existingDraft = state.drafts[key]
                const currentCount  = state.refCounts[key] ?? 0
                return {
                    drafts: existingDraft ? state.drafts : { ...state.drafts, [key]: buildEmpty() },
                    refCounts: { ...state.refCounts, [key]: currentCount + 1 },
                } as Partial<S>
            })
        },

        releaseDraft: (key) => {
            if (!key) {
                return
            }
            set((state) => {
                const currentCount = state.refCounts[key]
                if (!currentCount) {
                    return state
                }
                if (currentCount > 1) {
                    return { refCounts: { ...state.refCounts, [key]: currentCount - 1 } } as Partial<S>
                }
                const nextCounts = { ...state.refCounts }
                delete nextCounts[key]
                const nextDrafts = { ...state.drafts }
                delete nextDrafts[key]
                return { refCounts: nextCounts, drafts: nextDrafts } as Partial<S>
            })
        },

        ensureDraft: (key) => {
            if (!key) {
                return
            }
            const existing = get().drafts[key]
            if (existing) {
                return
            }
            set(
                (state) =>
                    ({
                        drafts: { ...state.drafts, [key]: buildEmpty() },
                    }) as Partial<S>,
            )
        },

        initDraft: (key, draft) => {
            if (!key) {
                return
            }
            const existing = get().drafts[key]
            if (existing?.initialized) {
                return
            }
            set(
                (state) =>
                    ({
                        drafts: {
                            ...state.drafts,
                            [key]: { ...draft, initialized: true } as D,
                        },
                    }) as Partial<S>,
            )
        },

        setDraftBaselineSignature: (key, signature) => {
            if (!key) {
                return
            }
            set((state) => patchDraft(state, key, { baselineSignature: signature } as Partial<D>) as Partial<S>)
        },

        setDraftForm: (key, action) => {
            if (!key) {
                return
            }
            set((state) => {
                const existing = state.drafts[key] ?? buildEmpty()
                const nextForm = resolveAction(action, existing.form)
                return patchDraft(state, key, { form: nextForm } as Partial<D>) as Partial<S>
            })
        },

        setDraftTestModel: (key, action) => {
            if (!key) {
                return
            }
            set((state) => {
                const existing  = state.drafts[key] ?? buildEmpty()
                const nextValue = resolveAction(action, existing.testModel)
                return patchDraft(state, key, { testModel: nextValue } as Partial<D>) as Partial<S>
            })
        },

        setDraftTestStatus: (key, action) => {
            if (!key) {
                return
            }
            set((state) => {
                const existing  = state.drafts[key] ?? buildEmpty()
                const nextValue = resolveAction(action, existing.testStatus)
                return patchDraft(state, key, { testStatus: nextValue } as Partial<D>) as Partial<S>
            })
        },

        setDraftTestMessage: (key, action) => {
            if (!key) {
                return
            }
            set((state) => {
                const existing  = state.drafts[key] ?? buildEmpty()
                const nextValue = resolveAction(action, existing.testMessage)
                return patchDraft(state, key, { testMessage: nextValue } as Partial<D>) as Partial<S>
            })
        },

        clearDraft: (key) => {
            if (!key) {
                return
            }
            set((state) => {
                if (!state.drafts[key] && !state.refCounts[key]) {
                    return state
                }
                const nextDrafts = { ...state.drafts }
                delete nextDrafts[key]
                const nextCounts = { ...state.refCounts }
                delete nextCounts[key]
                return { drafts: nextDrafts, refCounts: nextCounts } as Partial<S>
            })
        },
    }
}
