import {ConfirmationModal} from '@/components/common/ConfirmationModal'
import {NotificationContainer} from '@/components/common/NotificationContainer'
import {MainLayout} from '@/components/layout/MainLayout'
import {UnsavedChangesBlockerHost} from '@/hooks/useUnsavedChangesGuard'
import i18n from '@/i18n'
import {LoginPage} from '@/pages/LoginPage'
import {ProtectedRoute} from '@/router/ProtectedRoute'
import {useLanguageStore, useThemeStore} from '@/stores'
import React, {useEffect} from 'react'
import {createHashRouter, Outlet, RouterProvider} from 'react-router-dom'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: Error }> {
    state = { hasError: false, error: undefined as Error | undefined }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 40, textAlign: 'center' }}>
                    <h2>{i18n.t('common.unexpected_error')}</h2>
                    <pre style={{ whiteSpace: 'pre-wrap', color: '#888' }}>{this.state.error?.message}</pre>
                    <button onClick={() => window.location.reload()}>{i18n.t('common.reload')}</button>
                </div>
            )
        }
        return this.props.children
    }
}

function RootShell() {
    return (
        <>
            <NotificationContainer />
            <ConfirmationModal />
            <UnsavedChangesBlockerHost />
            <Outlet />
        </>
    )
}

const router = createHashRouter([
                                    {
                                        element: <RootShell />,
                                        children: [
                                            { path: '/login', element: <LoginPage /> },
                                            {
                                                path: '/*',
                                                element: (
                                                    <ProtectedRoute>
                                                        <MainLayout />
                                                    </ProtectedRoute>
                                                ),
                                            },
                                        ],
                                    },
                                ])

function App() {
    const initializeTheme = useThemeStore((state) => state.initializeTheme)
    const language        = useLanguageStore((state) => state.language)
    const setLanguage     = useLanguageStore((state) => state.setLanguage)

    useEffect(() => {
        return initializeTheme()
    }, [initializeTheme])

    useEffect(() => {
        setLanguage(language)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []) // 仅用于首屏同步 i18n 语言

    useEffect(() => {
        document.documentElement.lang = language
    }, [language])

    return (
        <ErrorBoundary>
            {/* useTransitions=false: bypass startTransition wrapping in React Router v7 + React 19 */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <RouterProvider router={router} {...({ useTransitions: false } as any)} />
        </ErrorBoundary>
    )
}

export default App
