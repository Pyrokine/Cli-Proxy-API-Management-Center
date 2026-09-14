import type {ModelEntry} from '@/components/ui/modelInputListUtils'
import {useModelSelectOptions} from '@/hooks/useModelSelectOptions'
import {getApiCallErrorMessage} from '@/services/api'
import {useNotificationStore} from '@/stores'
import type {HeaderEntry} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

type ProviderConnectivityTestStatus = 'idle' | 'loading' | 'success' | 'error'

interface ProviderConnectivityTestSignatureInput {
    apiKey: string
    baseUrl?: string
    proxyUrl?: string
    testModel: string
    headers: HeaderEntry[]
    modelEntries: ModelEntry[]
}

type ProviderConnectivityTestResult = Parameters<typeof getApiCallErrorMessage>[0]

interface ProviderConnectivityTestMessages {
    running: string
    success: string
    failed: string
    timeout: string
    unknownError: string
}

export function buildProviderConnectivityTestSignature(
    input: ProviderConnectivityTestSignatureInput,
): string {
    return JSON.stringify({
                              apiKey: input.apiKey.trim(),
                              baseUrl: input.baseUrl?.trim() ?? '',
                              proxyUrl: input.proxyUrl?.trim() ?? '',
                              testModel: input.testModel.trim(),
                              headers: input.headers.map((entry) => [entry.key.trim(), entry.value.trim()]),
                              models: input.modelEntries.map((entry) => [entry.name.trim(), entry.alias.trim()]),
                          })
}

const normalizeTestModel = (value: string) => value.trim()

export function useProviderConnectivityTestModel(
    modelEntries: ModelEntry[],
    normalizeModel: (value: string) => string = normalizeTestModel,
) {
    const [testModel, setTestModel] = useState('')
    const modelSelectOptions        = useModelSelectOptions(modelEntries)
    const availableModels           = useMemo(
        () => modelSelectOptions.map((option) => normalizeModel(option.value)).filter(Boolean),
        [modelSelectOptions, normalizeModel],
    )
    const resolvedTestModel         = useMemo(() => {
        const selectedModel = normalizeModel(testModel)
        if (!selectedModel) {
            return ''
        }
        const stillAvailable = availableModels.some((model) => model.toLowerCase() === selectedModel.toLowerCase())
        return stillAvailable ? selectedModel : ''
    }, [availableModels, normalizeModel, testModel])

    return {
        testModel,
        setTestModel,
        modelSelectOptions,
        availableModels,
        resolvedTestModel,
    }
}

export function useProviderConnectivityTestState(input: ProviderConnectivityTestSignatureInput) {
    const configSignature               = buildProviderConnectivityTestSignature(input)
    const { showNotification }          = useNotificationStore()
    const [testStatus, setTestStatus]   = useState<ProviderConnectivityTestStatus>('idle')
    const [testMessage, setTestMessage] = useState('')
    const [isTesting, setIsTesting]     = useState(false)
    const previousConfigRef             = useRef(configSignature)

    useEffect(() => {
        if (previousConfigRef.current === configSignature) {
            return
        }
        previousConfigRef.current = configSignature
        setTestStatus('idle')
        setTestMessage('')
    }, [configSignature])

    const showTestError = useCallback(
        (message: string) => {
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
        },
        [showNotification],
    )

    const runConnectivityTest = useCallback(
        async (
            request: () => Promise<ProviderConnectivityTestResult>,
            messages: ProviderConnectivityTestMessages,
        ) => {
            if (isTesting) {
                return
            }

            setIsTesting(true)
            setTestStatus('loading')
            setTestMessage(messages.running)

            try {
                const result = await request()
                if (result.statusCode < 200 || result.statusCode >= 300) {
                    const detail = getApiCallErrorMessage(result) || messages.unknownError
                    showTestError(`${messages.failed}: ${detail}`)
                    return
                }

                setTestStatus('success')
                setTestMessage(messages.success)
                showNotification(messages.success, 'success')
            } catch (err: unknown) {
                const message   = getErrorMessage(err)
                const errorCode =
                          typeof err === 'object' && err !== null && 'code' in err
                          ? String((err as { code?: string }).code)
                          : ''
                const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout')
                showTestError(isTimeout ? messages.timeout : `${messages.failed}: ${message || messages.unknownError}`)
            } finally {
                setIsTesting(false)
            }
        },
        [isTesting, showNotification, showTestError],
    )

    return {
        testStatus,
        setTestStatus,
        testMessage,
        setTestMessage,
        isTesting,
        runConnectivityTest,
        showTestError,
    }
}
