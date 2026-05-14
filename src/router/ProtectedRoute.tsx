import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useAuthStore } from '@/stores'
import { type ReactElement, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

export function ProtectedRoute({ children }: { children: ReactElement }) {
    const location = useLocation()
    const hydrated = useAuthStore((state) => state.hydrated)
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
    const managementKey = useAuthStore((state) => state.managementKey)
    const apiBase = useAuthStore((state) => state.apiBase)
    const restoreSession = useAuthStore((state) => state.restoreSession)
    const checkAuth = useAuthStore((state) => state.checkAuth)
    const [checking, setChecking] = useState(true)

    useEffect(() => {
        const tryRestore = async () => {
            setChecking(true)
            try {
                if (!hydrated) {
                    await restoreSession()
                    return
                }
                if (!isAuthenticated && managementKey && apiBase) {
                    await checkAuth()
                }
            } finally {
                setChecking(false)
            }
        }
        void tryRestore()
    }, [apiBase, hydrated, isAuthenticated, managementKey, restoreSession, checkAuth])

    if (checking || !hydrated) {
        return (
            <div className="main-content">
                <LoadingSpinner />
            </div>
        )
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace state={{ from: location }} />
    }

    return children
}
