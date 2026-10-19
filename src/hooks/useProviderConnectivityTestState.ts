import type {ModelEntry} from '@/components/ui/modelInputListUtils'
import {useModelSelectOptions} from '@/hooks/useModelSelectOptions'
import {getApiCallErrorMessage} from '@/services/api'
import {apiClient} from '@/services/api/client'
import {useAuthStore, useNotificationStore} from '@/stores'
import type {HeaderEntry} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

type ProviderConnectivityTestStatus = 'idle' | 'loading' | 'success' | 'error'

interface ProviderConnectivityTestSignatureInput {
    authIndex?: string
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
                              authIndex: input.authIndex?.trim() ?? '',
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
    const authGeneration               = useAuthStore(() => apiClient.getAuthGeneration())
    const configSignature              = JSON.stringify([authGeneration, buildProviderConnectivityTestSignature(input)])
    const { showNotification }         = useNotificationStore()
    const [testStatus, setTestStatus]   = useState<ProviderConnectivityTestStatus>('idle')
    const [testMessage, setTestMessage] = useState('')
    const [isTesting, setIsTesting]     = useState(false)
    const previousConfigRef            = useRef<string | null>(configSignature)
    const testRequestRef               = useRef<{authGeneration: number; configSignature: string} | null>(null)
    const isCurrentConfig              = previousConfigRef.current === configSignature &&
                                         authGeneration === apiClient.getAuthGeneration()

    useEffect(() => {
        if (previousConfigRef.current === configSignature) {
            return
        }
        previousConfigRef.current = configSignature
        testRequestRef.current = null
        setIsTesting(false)
        setTestStatus('idle')
        setTestMessage('')
    }, [configSignature])

    useEffect(() => () => {
        previousConfigRef.current = null
        testRequestRef.current = null
    }, [])

    const showTestError = useCallback(
        (message: string) => {
            if (previousConfigRef.current !== configSignature || authGeneration !== apiClient.getAuthGeneration()) {
                return
            }
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
        },
        [authGeneration, configSignature, showNotification],
    )

    const runConnectivityTest = useCallback(
        async (
            request: () => Promise<ProviderConnectivityTestResult>,
            messages: ProviderConnectivityTestMessages,
        ) => {
            if (previousConfigRef.current !== configSignature || authGeneration !== apiClient.getAuthGeneration() ||
                testRequestRef.current) {
                return
            }

            const testRequest = {authGeneration, configSignature}
            testRequestRef.current = testRequest
            const isCurrentTest = () => testRequestRef.current === testRequest &&
                                        previousConfigRef.current === testRequest.configSignature &&
                                        testRequest.authGeneration === apiClient.getAuthGeneration()
            setIsTesting(true)
            setTestStatus('loading')
            setTestMessage(messages.running)

            try {
                const result = await request()
                if (!isCurrentTest()) {
                    return
                }
                if (result.statusCode < 200 || result.statusCode >= 300) {
                    const detail = getApiCallErrorMessage(result) || messages.unknownError
                    showTestError(`${messages.failed}: ${detail}`)
                    return
                }

                setTestStatus('success')
                setTestMessage(messages.success)
                showNotification(messages.success, 'success')
            } catch (err: unknown) {
                if (!isCurrentTest()) {
                    return
                }
                const message   = getErrorMessage(err)
                const errorCode =
                          typeof err === 'object' && err !== null && 'code' in err
                          ? String((err as { code?: string }).code)
                          : ''
                const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout')
                showTestError(isTimeout ? messages.timeout : `${messages.failed}: ${message || messages.unknownError}`)
            } finally {
                if (isCurrentTest()) {
                    testRequestRef.current = null
                    setIsTesting(false)
                }
            }
        },
        [authGeneration, configSignature, showNotification, showTestError],
    )

    return {
        testStatus: isCurrentConfig ? testStatus : 'idle',
        setTestStatus,
        testMessage: isCurrentConfig ? testMessage : '',
        setTestMessage,
        isTesting: isCurrentConfig && isTesting,
        runConnectivityTest,
        showTestError,
    }
}
