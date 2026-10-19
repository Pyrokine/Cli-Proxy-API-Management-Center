import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {apiClient} from '@/services/api/client'
import {vertexApi} from '@/services/api/vertex'
import {useNotificationStore} from '@/stores'
import {type ChangeEvent, useCallback, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VendorSection.module.scss'

interface VertexImportFlowProps {
    disableControls: boolean
    onSuccess: () => Promise<void>
    onCancel: () => void
}

export function VertexImportFlow({ disableControls, onSuccess, onCancel }: VertexImportFlowProps) {
    const { t }                   = useTranslation()
    const showNotification        = useNotificationStore((s) => s.showNotification)
    const [file, setFile]         = useState<File | null>(null)
    const [location, setLocation] = useState('')
    const [loading, setLoading]   = useState(false)
    const mounted = useRef(false)
    const importing = useRef(false)
    useEffect(() => {
        mounted.current = true
        return () => {mounted.current = false}
    }, [])

    const handleImport = useCallback(async () => {
        if (!file || disableControls || !mounted.current || importing.current) {
            return
        }
        const generation = apiClient.getAuthGeneration()
        const isCurrent = () => mounted.current && apiClient.getAuthGeneration() === generation
        importing.current = true
        setLoading(true)
        try {
            const result = await vertexApi.importCredential(file, location.trim() || undefined)
            if (!isCurrent()) {
                return
            }
            const details = [
                ['result_project', result.project_id],
                ['result_email', result.email],
                ['result_location', result.location],
                ['result_file', result['auth-file'] ?? result.auth_file],
            ].filter((row) => typeof row[1] === 'string' && row[1].trim())
                .map(([label, value]) => `${t(`vertex_import.${label}`)}: ${value}`)
            showNotification([t('vertex_import.success'), ...details].join(' · '), 'success')
            await onSuccess()
        } catch {
            if (isCurrent()) {
                showNotification(t('common.error'), 'error')
            }
        } finally {
            importing.current = false
            if (mounted.current) {
                setLoading(false)
            }
        }
    }, [disableControls, file, location, onSuccess, showNotification, t])

    const selectFile = useCallback(() => {
        if (disableControls || importing.current) {
            return
        }
        const generation = apiClient.getAuthGeneration()
        const input    = document.createElement('input')
        input.type     = 'file'
        input.accept   = '.json,application/json'
        input.onchange = () => {
            if (!mounted.current || apiClient.getAuthGeneration() !== generation) {
                return
            }
            const selected = input.files?.[0]
            if (!selected) {
                return
            }
            if (!selected.name.toLowerCase().endsWith('.json')) {
                setFile(null)
                showNotification(t('vertex_import.file_required'), 'error')
                return
            }
            setFile(selected)
        }
        input.click()
    }, [disableControls, showNotification, t])

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
                <Button variant='primary' size='xs' onClick={handleImport} loading={loading} disabled={!file || disableControls || loading}>
                    {t('credentials.import_json')}
                </Button>
                <Button variant='secondary' size='xs' onClick={onCancel}>
                    {t('common.cancel')}
                </Button>
            </div>
        </div>
    )
}
