import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {vertexApi} from '@/services/api/vertex'
import {useNotificationStore} from '@/stores'
import {type ChangeEvent, useCallback, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VendorSection.module.scss'

interface VertexImportFlowProps {
    disableControls: boolean;
    onSuccess: () => Promise<void>;
    onCancel: () => void;
}

export function VertexImportFlow({ disableControls, onSuccess, onCancel }: VertexImportFlowProps) {
    const { t }                   = useTranslation()
    const showNotification        = useNotificationStore((s) => s.showNotification)
    const [file, setFile]         = useState<File | null>(null)
    const [location, setLocation] = useState('')
    const [loading, setLoading]   = useState(false)

    const handleImport = useCallback(async () => {
        if (!file) {
            return
        }
        setLoading(true)
        try {
            await vertexApi.importCredential(file, location.trim() || undefined)
            showNotification(t('common.success'), 'success')
            await onSuccess()
        } catch {
            showNotification(t('common.error'), 'error')
        } finally {
            setLoading(false)
        }
    }, [file, location, onSuccess, showNotification, t])

    const selectFile = useCallback(() => {
        const input    = document.createElement('input')
        input.type     = 'file'
        input.accept   = '.json'
        input.onchange = () => {
            const selected = input.files?.[0]
            if (selected) {
                setFile(selected)
            }
        }
        input.click()
    }, [])

    return (
        <div className={styles.flowArea}>
            <div className={styles.fileSelect}>
                <Button variant='secondary' size='xs' onClick={selectFile} disabled={disableControls || loading}>
                    {t('credentials.vertex_select_file')}
                </Button>
                {file && <span className={styles.fileName}>{file.name}</span>}
            </div>
            <Input
                placeholder={t('credentials.vertex_location_placeholder')}
                value={location}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)}
                disabled={disableControls || loading}
            />
            <div className={styles.flowButtons}>
                <Button variant='primary' size='xs' onClick={handleImport} loading={loading} disabled={!file}>
                    {t('credentials.import_json')}
                </Button>
                <Button variant='secondary' size='xs' onClick={onCancel}>
                    {t('common.cancel')}
                </Button>
            </div>
        </div>
    )
}
