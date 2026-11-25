import {apiClient} from '@/services/api/client'
import {createElement, useState} from 'react'
import {type BackupPasswordAction, UsageBackupPasswordDialog} from '../UsageBackupPasswordDialog'

export function useUsageBackupPassword() {
    const [request, setRequest] = useState<(BackupPasswordAction & { generation: number }) | null>(null)
    return {
        requestBackupPassword: (action: BackupPasswordAction) => {
            setRequest({ ...action, generation: apiClient.getAuthGeneration() })
        },
        backupPasswordDialog: request && createElement(UsageBackupPasswordDialog, {
            action: request,
            onClose: () => setRequest(null),
        }),
    }
}
