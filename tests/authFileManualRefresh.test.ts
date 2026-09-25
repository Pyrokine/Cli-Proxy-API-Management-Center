import {describe, expect, spyOn, test} from 'bun:test'

import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'

const safeResult = {
    filename: 'shared.json',
    provider: 'devin',
    auth_index: 'devin-2',
    status: 'active',
    refreshed_at: '2026-09-16T00:00:00Z',
}

describe('auth-file manual token refresh', () => {
    test('posts the exact credential identity and returns only the safe projection', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({
            ...safeResult,
            refreshed_at: '2026-09-16T00:00:00Z',
            metadata: {access_token: 'must-not-propagate'},
        })
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
        try {
            await expect(authFilesApi.requestManualRefresh(' shared.json ', ' devin-2 ')).resolves.toEqual({
                ...safeResult,
                refreshed_at: '2026-09-16T00:00:00.000Z',
            })
            expect(post).toHaveBeenCalledWith('/auth-files/refresh', {
                name: 'shared.json',
                auth_index: 'devin-2',
            }, {timeout: 35_000})
            expect(patch).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
            patch.mockRestore()
        }
    })

    test('posts all:true for the backend bulk token refresh contract', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({
            results: [
                {...safeResult, success: true},
                {
                    ...safeResult,
                    auth_index: 'devin-3',
                    success: false,
                    error: 'credential_refresh_failed',
                    metadata: {refresh_token: 'must-not-propagate'},
                },
            ],
        })
        try {
            await expect(authFilesApi.requestManualRefreshAll()).resolves.toEqual({
                results: [
                    {...safeResult, refreshed_at: '2026-09-16T00:00:00.000Z', success: true},
                    {
                        ...safeResult,
                        auth_index: 'devin-3',
                        refreshed_at: '2026-09-16T00:00:00.000Z',
                        success: false,
                        error: 'credential_refresh_failed',
                    },
                ],
            })
            expect(post).toHaveBeenCalledWith('/auth-files/refresh', {all: true}, {timeout: 35_000})
        } finally {
            post.mockRestore()
        }
    })

    test('does not issue an ambiguous file-level refresh', () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({})
        try {
            expect(() => authFilesApi.requestManualRefresh('shared.json')).toThrow(
                'auth_files.refresh_identity_required',
            )
            expect(post).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
        }
    })

    test('propagates refresh failures without falling back to metadata edits', async () => {
        const error = new Error('refresh failed')
        const post = spyOn(apiClient, 'post').mockRejectedValue(error)
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
        try {
            await expect(authFilesApi.requestManualRefresh('shared.json', 'devin-2')).rejects.toBe(error)
            expect(post).toHaveBeenCalledTimes(1)
            expect(patch).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
            patch.mockRestore()
        }
    })
})
