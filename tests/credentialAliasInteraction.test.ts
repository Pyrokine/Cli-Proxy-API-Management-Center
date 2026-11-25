import {createLatestCredentialsRequestTracker} from '@/components/credentials/credentialsDataLifecycle'
import {getErrorMessage} from '@/utils/helpers'
import {expect, mock, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import ts from 'typescript'
import {sourceCallback, sourceExpression} from './sourceCallbacks'

const card = 'components/credentials/CredentialCard.tsx'

function aliasEditor(onAliasChange: (alias: string) => Promise<boolean>, overrides: Record<string, unknown> = {}) {
    const setSavingAlias  = mock()
    const setEditingAlias = mock()
    const preventDefault  = mock()
    const action          = sourceCallback<(event: { preventDefault: () => void }) => Promise<void>>(
        card, 'handleAliasEditConfirm', {
            alias: 'Old', aliasInput: ' New ', disableControls: false, savingAlias: false,
            onAliasChange, setSavingAlias, setEditingAlias, ...overrides,
        },
    )
    return { submit: () => action({ preventDefault }), setSavingAlias, setEditingAlias, preventDefault }
}

test('an alias editor stays open until the save has been confirmed', async () => {
    const pending = Promise.withResolvers<boolean>()
    const send    = mock((_alias: string) => pending.promise)
    const editor  = aliasEditor(send)
    const work    = editor.submit()
    expect(editor.preventDefault).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('New')
    expect(editor.setSavingAlias.mock.calls).toEqual([[true]])
    expect(editor.setEditingAlias).not.toHaveBeenCalled()

    pending.resolve(true)
    await work
    expect(editor.setSavingAlias.mock.calls).toEqual([[true], [false]])
    expect(editor.setEditingAlias).toHaveBeenCalledWith(false)
})

test('a failed save leaves the same alias draft available for retry', async () => {
    let accepted = false
    const send   = mock(async (_alias: string) => accepted)
    const editor = aliasEditor(send)
    await editor.submit()
    expect(editor.setEditingAlias).not.toHaveBeenCalled()
    expect(editor.setSavingAlias.mock.calls).toEqual([[true], [false]])

    accepted = true
    await editor.submit()
    expect(send.mock.calls).toEqual([['New'], ['New']])
    expect(editor.setEditingAlias.mock.calls).toEqual([[false]])
})

test('blank aliases are submitted for removal; unchanged and disabled values issue no request', async () => {
    const send = mock(async (_alias: string) => true)
    await aliasEditor(send, { aliasInput: '' }).submit()
    const unchanged = aliasEditor(send, { aliasInput: ' Old ' })
    await unchanged.submit()
    await aliasEditor(send, { disableControls: true }).submit()
    await aliasEditor(send, { savingAlias: true }).submit()
    expect(send.mock.calls).toEqual([['']])
    expect(unchanged.setEditingAlias.mock.calls).toEqual([[false]])
})

test('moving focus leaves the draft untouched, and Escape explicitly cancels it', () => {
    const handleAliasEditConfirm = mock()
    const setEditingAlias        = mock()
    const preventDefault         = mock()
    const form                   = sourceExpression<ReactElement<{
        children: Array<ReactElement<{ type?: string; onBlur?: () => void }>>;
        onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
    }>>(
        card,
        (node, tree) => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'form' &&
                        node.openingElement.getText(tree).includes('styles.aliasEdit'),
        {
            React, styles: {}, aliasInput: 'New', setAliasInput: mock(), setEditingAlias,
            disableControls: false, savingAlias: false, handleAliasEditConfirm,
            t: (key: string) => key, Button: () => null,
        },
    )
    expect(form.props.children[0].props.onBlur).toBeUndefined()
    expect(form.props.children[1].props.type).toBe('submit')
    expect(form.props.children[2].props.type).toBe('button')
    form.props.onKeyDown({ key: 'Escape', preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(setEditingAlias).toHaveBeenCalledWith(false)
    expect(handleAliasEditConfirm).not.toHaveBeenCalled()
})

test('a refresh started before a confirmed alias save cannot restore the old alias', async () => {
    const page              = 'pages/CredentialsPage.tsx'
    const reference         = 'alias_' + 'a'.repeat(32)
    const delayedRefresh    = Promise.withResolvers<Record<string, string>>()
    const listCredentials   = mock(() => delayedRefresh.promise)
    const pendingAliasSaves = { current: new Set<string>() }
    type State = { generation: number; values: Record<string, string> }
    let state: State = { generation: 1, values: { [reference]: 'Old' } }
    const scope      = {
        authGeneration: 1, connectionStatus: 'connected', apiClient: { getAuthGeneration: () => 1 },
        aliasRequests: { current: createLatestCredentialsRequestTracker() }, pendingAliasSaves,
        apiKeyAliasApi: {
            listCredentials,
            setCredential: (_keyRef: string, _alias: string, readback: () => Promise<void>) => readback(),
        },
        showNotification: mock(), getErrorMessage, t: (key: string) => key,
        setAliasState: (next: State | ((previous: State) => State)) => {
            state = typeof next === 'function' ? next(state) : next
        },
    }
    const refresh    = sourceCallback<() => Promise<void>>(page, 'refreshAliases', scope)
    const save       = sourceCallback<(ref: string, alias: string) => Promise<boolean>>(
        page,
        'handleAliasChange',
        scope,
    )
    const old        = refresh()
    listCredentials.mockResolvedValue({ [reference]: 'New' })
    expect(await save(reference, 'New')).toBeTrue()
    expect(pendingAliasSaves.current.size).toBe(0)
    delayedRefresh.resolve({ [reference]: 'Old' })
    await old
    expect(state.values).toEqual({ [reference]: 'New' })
})
