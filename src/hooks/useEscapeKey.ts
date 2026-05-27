import {useEffect} from 'react'

/** Calls `onEscape` whenever the user presses the Escape key. */
export function useEscapeKey(onEscape: () => void) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onEscape()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onEscape])
}
