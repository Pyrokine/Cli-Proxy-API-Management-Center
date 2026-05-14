import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack'
import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type LocationState = { fromAiProviders?: boolean } | null

/**
 * Encapsulates the common navigation pattern for provider edit pages:
 * handleBack (with history-aware fallback), Escape key listener, and edge swipe support.
 */
export function useEditPageNavigation(fallbackPath = '/credentials') {
    const navigate = useNavigate()
    const location = useLocation()

    const handleBack = useCallback(() => {
        const state = location.state as LocationState
        if (state?.fromAiProviders) {
            navigate(-1)
            return
        }
        navigate(fallbackPath, { replace: true })
    }, [fallbackPath, location.state, navigate])

    const swipeRef = useEdgeSwipeBack({ onBack: handleBack })

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                handleBack()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleBack])

    return { handleBack, swipeRef }
}
