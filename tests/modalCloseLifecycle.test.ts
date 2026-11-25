import {expect, mock, test} from 'bun:test'
import {sourceCallback} from './sourceCallbacks'

test('a pending animation closes once with the current parent callback', () => {
    const before        = mock()
    const after         = mock()
    const onCloseRef    = { current: before }
    const closeTimerRef = { current: null as number | null }
    const setIsClosing  = mock()
    const setIsVisible  = mock()
    let finish: (() => void) | undefined
    const setTimeout    = mock((callback: () => void) => {
        finish = callback;
        return 1
    })
    const startClose    = sourceCallback<(notifyParent: boolean) => void>('components/ui/Modal.tsx', 'startClose', {
        onCloseRef, closeTimerRef, setIsClosing, setIsVisible,
        window: { setTimeout }, CLOSE_ANIMATION_DURATION: 350,
    })

    startClose(true)
    onCloseRef.current = after
    startClose(true)
    expect(setTimeout).toHaveBeenCalledTimes(1)
    expect(setIsClosing).toHaveBeenCalledWith(true)
    if (!finish) {
        throw new Error('Expected an animation timer')
    }
    finish()
    expect(before).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)
    expect(closeTimerRef.current).toBeNull()
    expect(setIsVisible).toHaveBeenCalledWith(false)
})
