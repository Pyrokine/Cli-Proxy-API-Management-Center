import type {Config} from '@/types'
import assert from 'node:assert/strict'
import {installTestLockManager} from './browserLockManager'
import {installMemoryStorageEnvironment} from './memoryStorage'

installTestLockManager()

const browserWindow = installMemoryStorageEnvironment(false)

const [{ secureStorage }, { useAuthStore }, { useConfigStore }] = await Promise.all([
                                                                                        import('../../src/services/storage/secureStorage'),
                                                                                        import('../../src/stores/useAuthStore'),
                                                                                        import('../../src/stores/useConfigStore'),
                                                                                    ])
await useAuthStore.persist.rehydrate()
const originalFetchConfig          = useConfigStore.getState().fetchConfig
const originalRefreshServerVersion = useAuthStore.getState().refreshServerVersion
useConfigStore.setState({
                            fetchConfig: async (): Promise<Config> => ({}),
                        })
useAuthStore.setState({
                          refreshServerVersion: async () => {
                          },
                      })

try {
    await useAuthStore.getState().login({
                                            apiBase: 'https://example.test',
                                            managementKey: 'memory-key',
                                            rememberPassword: true,
                                        })

    let state = useAuthStore.getState()
    assert.equal(state.isAuthenticated, true)
    assert.equal(state.managementKey, 'memory-key')
    assert.equal(state.rememberPassword, false)
    assert.equal(state.storagePersistenceFailed, true)
    assert.equal(localStorage.length, 0)
    assert.equal(sessionStorage.length, 0)

    browserWindow.isSecureContext = true
    await state.login({
                          apiBase: 'https://example.test',
                          managementKey: 'stored-key',
                          rememberPassword: true,
                      })
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials')?.startsWith('enc::v2::'), true)
    assert.equal(localStorage.getItem('managementKey'), null)
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')

    browserWindow.dispatchEvent(new Event('unauthorized'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    for (const key of [
        'cli-proxy-auth',
        'cli-proxy-auth:credentials',
        'cli-proxy-auth:intent',
        'cli-proxy-auth:transaction',
        'managementKey',
        'apiBase',
        'apiUrl',
    ]) {
        assert.equal(localStorage.getItem(key), null)
        assert.equal(sessionStorage.getItem(key), null)
    }
    assert.equal(localStorage.getItem('isLoggedIn'), null)
    state = useAuthStore.getState()
    assert.equal(state.managementKey, '')
    assert.equal(state.sessionRestoreStatus, 'failed')
    assert.equal(await state.restoreSession(), false)

    assert.equal(
        await secureStorage.setItem('managementKey', 'expired-key', { persistent: true }),
        'stored',
    )
    localStorage.setItem('isLoggedIn', 'true')
    const unauthorized = Object.assign(new Error('unauthorized'), { status: 401 })
    useConfigStore.setState({
                                fetchConfig: async () => {
                                    throw unauthorized
                                },
                            })
    await assert.rejects(
        state.login({
                        apiBase: 'https://example.test',
                        managementKey: 'expired-key',
                        rememberPassword: true,
                    }),
        (error: unknown) => error === unauthorized,
    )
    assert.equal(localStorage.getItem('managementKey'), null)
    assert.equal(localStorage.getItem('isLoggedIn'), null)
    assert.equal(useAuthStore.getState().sessionRestoreStatus, 'failed')
} finally {
    useConfigStore.setState({ fetchConfig: originalFetchConfig })
    useAuthStore.setState({ refreshServerVersion: originalRefreshServerVersion })
    useAuthStore.getState().logout()
}

console.log('secure-storage-auth-lifecycle=PASS')
