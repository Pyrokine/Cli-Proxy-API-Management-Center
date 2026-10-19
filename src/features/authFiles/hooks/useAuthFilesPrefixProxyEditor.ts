import {
    inferProviderFromAuthFileName,
    normalizeAuthFileProvider,
    parsePriorityValue,
    readAuthFileDisableCooling,
    readAuthFileRequestRetry,
    readAuthFileUsingApi,
    readAuthFileWebsockets,
    supportsAuthFileUsingApi,
    supportsAuthFileWebsockets,
} from '@/features/authFiles/constants'
import {buildSafeAuthFileDisplayInfo} from '@/features/authFiles/identity'
import {type AuthFileFieldsPatch, authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {useAuthStore, useNotificationStore} from '@/stores'
import type {AuthFileItem, CredentialOverrides} from '@/types'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'
import {
    type CredentialWeightError,
    parseCredentialWeightText,
    readCredentialWeight,
    validateCredentialWeightText,
} from '@/utils/credentialWeight'
import {formatExcludedModelsText, normalizeExcludedModelsValue, parseExcludedModelsText} from '@/utils/excludedModels'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

type AuthFileHeaders = Record<string, string>
type AuthFileHeadersErrorKey =
    | 'auth_files.headers_invalid_json'
    | 'auth_files.headers_invalid_object'
    | 'auth_files.headers_invalid_value'
    | 'auth_files.headers_sensitive_name'
type AuthFileWeightErrorKey = 'auth_files.weight_integer_error' | 'auth_files.weight_max_error'
type AuthFilePolicyErrorKey =
    | 'auth_files.policy_invalid_json'
    | 'auth_files.model_aliases_invalid'
    | 'auth_files.request_rules_invalid'
type AuthFileEditorErrorKey = AuthFileHeadersErrorKey | AuthFileWeightErrorKey | AuthFilePolicyErrorKey | 'auth_files.request_retry_invalid'
type AuthFileContentErrorKey = 'auth_files.prefix_proxy_invalid_json' | 'auth_files.prefix_proxy_html_challenge'

const credentialWeightErrorKey = (error: CredentialWeightError): AuthFileWeightErrorKey =>
    error === 'max' ? 'auth_files.weight_max_error' : 'auth_files.weight_integer_error'

export type PrefixProxyEditorField =
    | 'prefix'
    | 'proxyUrl'
    | 'priority'
    | 'weight'
    | 'note'
    | 'headersText'
    | 'excludedModelsText'
    | 'modelAliasesText'
    | 'requestRulesText'
export type PrefixProxyEditorFieldValue = string

export type PrefixProxyEditorState = {
    fileName: string
    authIndex?: string | number | null
    fileInfoText: string
    loading: boolean
    saving: boolean
    readOnly: boolean
    error: string | null
    json: Record<string, unknown> | null
    prefix: string
    proxyUrl: string
    priority: string
    weight: string
    weightError: string | null
    note: string
    noteTouched: boolean
    headersText: string
    headersTouched: boolean
    headersError: string | null
    supportsModelAliases: boolean
    modelAliasesText: string
    modelAliasesTouched: boolean
    modelAliasesError: string | null
    requestRulesText: string
    requestRulesTouched: boolean
    requestRulesError: string | null
    disableCooling: boolean | undefined
    disableCoolingTouched: boolean
    requestRetry: number | undefined
    requestRetryTouched: boolean
    supportsWebsockets: boolean
    websockets: boolean
    websocketsTouched: boolean
    supportsUsingApi: boolean
    usingApi: boolean
    usingApiTouched: boolean
    excludedModelsText: string
    excludedModelsTouched: boolean
}

type UseAuthFilesPrefixProxyEditorOptions = {
    disableControls: boolean
    completeMutation: (
        name: string,
        fields: AuthFileFieldsPatch,
        authIndex?: string | number | null,
    ) => Promise<void>
}

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isRuntimeOnlyAuthFile = (file: AuthFileItem): boolean =>
    file.runtimeOnly === true || String(file.runtimeOnly ?? '').trim().toLowerCase() === 'true'

const validateHeadersValue = (value: unknown): AuthFileHeadersErrorKey | null => {
    if (!isRecordObject(value)) {
        return 'auth_files.headers_invalid_object'
    }
    return Object.values(value).every((item) => typeof item === 'string') ? null : 'auth_files.headers_invalid_value'
}

const parseHeadersText = (text: string): {
    value: AuthFileHeaders | null;
    errorKey: AuthFileHeadersErrorKey | null
} => {
    const trimmed = text.trim()
    if (!trimmed) {
        return { value: null, errorKey: null }
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(text) as unknown
    } catch {
        return { value: null, errorKey: 'auth_files.headers_invalid_json' }
    }

    const errorKey = validateHeadersValue(parsed)
    if (errorKey) {
        return { value: null, errorKey }
    }
    if (Object.keys(parsed as Record<string, unknown>).some((name) => SENSITIVE_HEADER_NAME_PATTERN.test(name))) {
        return { value: null, errorKey: 'auth_files.headers_sensitive_name' }
    }

    return { value: parsed as AuthFileHeaders, errorKey: null }
}

type AuthFilePolicyField = 'model_aliases' | 'request_scoped_errors'

const readAuthFilePolicyField = (file: Record<string, unknown>, field: AuthFilePolicyField): unknown =>
    Object.prototype.hasOwnProperty.call(file, field)
    ? file[field]
    : file[field === 'model_aliases' ? 'model-aliases' : 'request-scoped-errors']

const formatAuthFilePolicyRows = (value: unknown): string =>
    value === undefined || value === null || (Array.isArray(value) && value.length === 0)
    ? '' : JSON.stringify(value, null, 2)

const parseAuthFilePolicyRows = (text: string, field: AuthFilePolicyField, original?: unknown): {
    value: Array<Record<string, unknown>> | null;
    errorKey: AuthFilePolicyErrorKey | null
} => {
    if (!text.trim()) {
        return {value: [], errorKey: null}
    }
    const invalidKey = field === 'model_aliases'
        ? 'auth_files.model_aliases_invalid' : 'auth_files.request_rules_invalid'
    let parsed: unknown
    try {
        parsed = JSON.parse(text) as unknown
    } catch {
        return {value: null, errorKey: 'auth_files.policy_invalid_json'}
    }
    if (!Array.isArray(parsed) || !parsed.every(isRecordObject)) {
        return {value: null, errorKey: invalidKey}
    }
    const rows = parsed as Array<Record<string, unknown>>
    if (field === 'model_aliases') {
        const seen = new Set<string>()
        for (const row of rows) {
            const name = typeof row.name === 'string' ? row.name.trim() : ''
            const alias = typeof row.alias === 'string' ? row.alias.trim() : ''
            const key = alias.toLowerCase()
            if (!name || !alias || name.toLowerCase() === key || seen.has(key) ||
                (row.fork !== undefined && typeof row.fork !== 'boolean') ||
                (row['force-mapping'] !== undefined && typeof row['force-mapping'] !== 'boolean') ||
                (row['display-name'] !== undefined && typeof row['display-name'] !== 'string') ||
                row.forceMapping !== undefined) {
                return {value: null, errorKey: invalidKey}
            }
            seen.add(key)
        }
    } else {
        const actions = new Set(['stop', 'stop-and-cooldown', 'continue', 'continue-and-cooldown'])
        const unchanged = Array.isArray(original) ? [...original] : []
        for (const row of rows) {
            const previousIndex = unchanged.findIndex((previous) => JSON.stringify(previous) === JSON.stringify(row))
            if (previousIndex >= 0) {
                unchanged.splice(previousIndex, 1)
                continue
            }
            const match = row.match
            const regex = row['match-regexr']
            if (!Number.isSafeInteger(row.status) || Number(row.status) < 100 || Number(row.status) > 599 ||
                typeof row.action !== 'string' || !actions.has(row.action.trim().toLowerCase()) ||
                (match !== undefined && (!Array.isArray(match) || !match.every((item) => typeof item === 'string'))) ||
                (regex !== undefined && (!Array.isArray(regex) || !regex.every((item) => typeof item === 'string'))) ||
                row.matchRegex !== undefined ||
                ![...(Array.isArray(match) ? match : []), ...(Array.isArray(regex) ? regex : [])]
                    .some((item) => item.length > 0)) {
                return {value: null, errorKey: invalidKey}
            }
            if ([...(Array.isArray(match) ? match : []), ...(Array.isArray(regex) ? regex : [])]
                .some((item) => item.length === 0)) {
                const conditionIndex = unchanged.findIndex((previous) => isRecordObject(previous) &&
                    JSON.stringify(previous.match ?? []) === JSON.stringify(match ?? []) &&
                    JSON.stringify(previous['match-regexr'] ?? []) === JSON.stringify(regex ?? []))
                if (conditionIndex < 0) {
                    return {value: null, errorKey: invalidKey}
                }
                unchanged.splice(conditionIndex, 1)
            }
        }
    }
    return {value: rows, errorKey: null}
}

const normalizeTextField = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeAuthIndex = (value: string | number | null | undefined): string =>
    String(value ?? '').trim()

const isEditorIdentity = (
    editor: PrefixProxyEditorState | null,
    fileName: string,
    authIndex?: string | number | null,
): editor is PrefixProxyEditorState =>
    editor?.fileName === fileName && normalizeAuthIndex(editor.authIndex) === normalizeAuthIndex(authIndex)

const getAuthFileContentErrorKey = (text: string): AuthFileContentErrorKey => {
    const head               = text.trimStart().slice(0, 4096).toLowerCase()
    const looksLikeHtml      =
              head.startsWith('<!doctype html') ||
              head.startsWith('<html') ||
              head.includes('<head') ||
              head.includes('<body')
    const looksLikeChallenge =
              head.includes('cf_chl') ||
              head.includes('__cf_chl_tk') ||
              head.includes('challenge-platform') ||
              head.includes('cloudflare')

    return looksLikeHtml || looksLikeChallenge
           ? 'auth_files.prefix_proxy_html_challenge'
           : 'auth_files.prefix_proxy_invalid_json'
}

const hasKeys = (value: Record<string, unknown> | AuthFileFieldsPatch | null | undefined): boolean =>
    Boolean(value && Object.keys(value).length > 0)

const SENSITIVE_HEADER_NAME_PATTERN =
          /authorization|cookie|token|secret|password|api[-_]?key|access[-_]?key|client[-_]?key/i

const normalizeHeaders = (value: unknown): AuthFileHeaders => {
    if (!isRecordObject(value)) {
        return {}
    }

    return Object.entries(value).reduce<AuthFileHeaders>((result, [key, rawValue]) => {
        if (typeof rawValue !== 'string') {
            return result
        }
        const name        = key.trim()
        const headerValue = rawValue.trim()
        if (!name || !headerValue) {
            return result
        }
        result[name] = headerValue
        return result
    }, {})
}

const normalizeEditableHeaders = (value: unknown): AuthFileHeaders =>
    Object.fromEntries(
        Object.entries(normalizeHeaders(value)).filter(([name]) => !SENSITIVE_HEADER_NAME_PATTERN.test(name)),
    )

const buildHeadersPatch = (
    originalHeaders: AuthFileHeaders,
    nextHeaders: AuthFileHeaders,
): AuthFileHeaders | undefined => {
    const patch: AuthFileHeaders = {}
    const nextNames              = new Set(Object.keys(nextHeaders))

    Object.entries(nextHeaders).forEach(([name, value]) => {
        if (originalHeaders[name] !== value) {
            patch[name] = value
        }
    })

    Object.keys(originalHeaders).forEach((name) => {
        if (!nextNames.has(name)) {
            patch[name] = ''
        }
    })

    return Object.keys(patch).length > 0 ? patch : undefined
}

export const buildAuthFileFieldsPatch = (
    editor: PrefixProxyEditorState,
    resolveHeadersError: (key: AuthFileEditorErrorKey) => string,
): AuthFileFieldsPatch => {
    if (editor.readOnly) {
        return {}
    }

    const original                   = editor.json ?? {}
    const patch: AuthFileFieldsPatch = {}

    const originalPrefix = normalizeTextField(original.prefix)
    const nextPrefix     = editor.prefix.trim()
    if (nextPrefix !== originalPrefix) {
        patch.prefix = nextPrefix
    }

    const originalProxyUrl = normalizeTextField(original.proxy_url)
    const nextProxyUrl     = editor.proxyUrl.trim()
    if (nextProxyUrl !== originalProxyUrl) {
        patch.proxy_url = nextProxyUrl
    }

    const originalPriority = parsePriorityValue(original.priority)
    const priorityText     = editor.priority.trim()
    const nextPriority     = parsePriorityValue(priorityText)
    if (!priorityText) {
        if (originalPriority !== undefined && originalPriority !== 0) {
            patch.priority = 0
        }
    } else if (nextPriority !== undefined) {
        if (nextPriority === 0) {
            if (originalPriority !== undefined && originalPriority !== 0) {
                patch.priority = 0
            }
        } else if (nextPriority !== originalPriority) {
            patch.priority = nextPriority
        }
    }

    const weightError = validateCredentialWeightText(editor.weight)
    if (weightError) {
        throw new Error(resolveHeadersError(credentialWeightErrorKey(weightError)))
    }
    const originalWeight = readCredentialWeight(original.weight)
    const nextWeight     = parseCredentialWeightText(editor.weight)
    if (nextWeight === undefined) {
        if (originalWeight !== undefined) {
            patch.weight = null
        }
    } else if (nextWeight !== originalWeight) {
        patch.weight = nextWeight
    }

    if (editor.noteTouched) {
        const originalNote = normalizeTextField(original.note)
        const nextNote     = editor.note.trim()
        if (nextNote !== originalNote) {
            patch.note = nextNote
        }
    }

    if (editor.headersTouched) {
        const { value: parsedHeaders, errorKey } = parseHeadersText(editor.headersText)
        if (errorKey) {
            throw new Error(resolveHeadersError(errorKey))
        }
        const headersPatch = buildHeadersPatch(
            normalizeEditableHeaders(original.headers),
            normalizeEditableHeaders(parsedHeaders ?? {}),
        )
        if (headersPatch) {
            patch.headers = headersPatch
        }
    }

    if (editor.disableCoolingTouched) {
        const originalDisableCooling = readAuthFileDisableCooling(original as AuthFileItem)
        if (editor.disableCooling !== originalDisableCooling) {
            patch.disable_cooling = editor.disableCooling ?? null
        }
    }

    if (editor.requestRetryTouched) {
        const errorKey = getCredentialRetryValidationKey(editor.requestRetry)
        if (errorKey) {
            throw new Error(resolveHeadersError(errorKey))
        }
        const originalRequestRetry = readAuthFileRequestRetry(original)
        const nextRequestRetry = editor.requestRetry !== undefined && editor.requestRetry >= 0
            ? editor.requestRetry : undefined
        if (nextRequestRetry !== originalRequestRetry) {
            patch.request_retry = nextRequestRetry ?? null
        }
    }

    if (editor.supportsWebsockets && editor.websocketsTouched) {
        const originalWebsockets = readAuthFileWebsockets(original) ?? false
        if (editor.websockets !== originalWebsockets) {
            patch.websockets = editor.websockets
        }
    }

    if (editor.supportsUsingApi && editor.usingApiTouched) {
        const originalUsingApi = readAuthFileUsingApi(original as AuthFileItem)
        if (editor.usingApi !== originalUsingApi) {
            patch.using_api = editor.usingApi
        }
    }

    if (editor.excludedModelsTouched) {
        const originalRules = normalizeExcludedModelsValue(
            original.excluded_models ?? original['excluded-models'] ?? original.excludedModels,
        )
        const nextRules     = parseExcludedModelsText(editor.excludedModelsText)
        if (JSON.stringify(nextRules) !== JSON.stringify(originalRules)) {
            patch.excluded_models = nextRules
        }
    }

    for (const [field, touched, text] of [
        ['model_aliases', editor.supportsModelAliases && editor.modelAliasesTouched, editor.modelAliasesText],
        ['request_scoped_errors', editor.requestRulesTouched, editor.requestRulesText],
    ] as const) {
        if (!touched) {
            continue
        }
        const originalRows = readAuthFilePolicyField(original, field)
        const {value, errorKey} = parseAuthFilePolicyRows(text, field, originalRows)
        if (errorKey || !value) {
            throw new Error(resolveHeadersError(errorKey ?? 'auth_files.policy_invalid_json'))
        }
        if (JSON.stringify(value) !== JSON.stringify(originalRows === undefined ? [] : originalRows)) {
            patch[field] = value
        }
    }

    return patch
}

export function useAuthFilesPrefixProxyEditor(options: UseAuthFilesPrefixProxyEditorOptions) {
    const { disableControls, completeMutation }     = options
    const { t }                                     = useTranslation()
    const showNotification                          = useNotificationStore((state) => state.showNotification)
    const [prefixProxyEditor, setPrefixProxyEditor] = useState<PrefixProxyEditorState | null>(null)
    const authGeneration = useAuthStore(() => apiClient.getAuthGeneration())
    const editorRequestRef = useRef<{authGeneration: number} | null>({authGeneration})
    const editorRequest = editorRequestRef.current
    const isCurrentEditor = (request = editorRequest) =>
        request !== null && request === editorRequestRef.current &&
        request.authGeneration === apiClient.getAuthGeneration()

    useEffect(() => () => {
        editorRequestRef.current = null
    }, [])

    const hasBlockingValidationError = Boolean(
        prefixProxyEditor?.weightError || (prefixProxyEditor?.headersTouched && prefixProxyEditor.headersError) ||
        (prefixProxyEditor?.modelAliasesTouched && prefixProxyEditor.modelAliasesError) ||
        (prefixProxyEditor?.requestRulesTouched && prefixProxyEditor.requestRulesError) ||
        (prefixProxyEditor?.requestRetryTouched && getCredentialRetryValidationKey(prefixProxyEditor.requestRetry)),
    )
    const prefixProxyPatch           =
              prefixProxyEditor?.json && !hasBlockingValidationError
              ? buildAuthFileFieldsPatch(prefixProxyEditor, (key) => t(key))
              : null
    const prefixProxyDirty           = Boolean(
        isCurrentEditor() && prefixProxyEditor && !prefixProxyEditor.readOnly &&
        (hasBlockingValidationError || hasKeys(prefixProxyPatch)),
    )

    const closePrefixProxyEditor = () => {
        if (!isCurrentEditor()) {
            return
        }
        editorRequestRef.current = null
        setPrefixProxyEditor(null)
    }

    const openPrefixProxyEditor = async (file: AuthFileItem) => {
        const name      = file.name
        const authIndex = file.authIndex
        if (disableControls || authGeneration !== apiClient.getAuthGeneration()) {
            return
        }
        if (isCurrentEditor() && isEditorIdentity(prefixProxyEditor, name, authIndex)) {
            closePrefixProxyEditor()
            return
        }
        const request = {authGeneration}
        editorRequestRef.current = request

        const provider = file.provider || file.type || inferProviderFromAuthFileName(file.name)
        if (isRuntimeOnlyAuthFile(file)) {
            const headers                       = normalizeEditableHeaders(file.headers)
            const json: Record<string, unknown> = {
                prefix: file.prefix,
                proxy_url: file.proxy_url ?? file.proxyUrl,
                priority: file.priority,
                weight: file.weight,
                note: file.note,
                headers,
                disable_cooling: readAuthFileDisableCooling(file),
                request_retry: readAuthFileRequestRetry(file),
                websockets: readAuthFileWebsockets(file),
                using_api: file.usingApi,
                excluded_models: file.excludedModels,
                model_aliases: readAuthFilePolicyField(file, 'model_aliases'),
                request_scoped_errors: readAuthFilePolicyField(file, 'request_scoped_errors'),
            }
            setPrefixProxyEditor({
                                     fileName: name,
                                     authIndex,
                                     fileInfoText: JSON.stringify(buildSafeAuthFileDisplayInfo(file), null, 2),
                                     loading: false,
                                     saving: false,
                                     readOnly: true,
                                     error: null,
                                     json,
                                     prefix: normalizeTextField(json.prefix),
                                     proxyUrl: normalizeTextField(json.proxy_url),
                                     priority: file.priority !== undefined ? String(file.priority) : '',
                                     weight: file.weight !== undefined ? String(file.weight) : '',
                                     weightError: null,
                                     note: file.note ?? '',
                                     noteTouched: false,
                                     headersText:
                                         Object.keys(headers).length > 0 ? JSON.stringify(headers, null, 2) : '',
                                     headersTouched: false,
                                     headersError: null,
                                     supportsModelAliases: false,
                                     modelAliasesText: '',
                                     modelAliasesTouched: false,
                                     modelAliasesError: null,
                                     requestRulesText: '',
                                     requestRulesTouched: false,
                                     requestRulesError: null,
                                     disableCooling: readAuthFileDisableCooling(file),
                                     disableCoolingTouched: false,
                                     requestRetry: readAuthFileRequestRetry(file),
                                     requestRetryTouched: false,
                                     supportsWebsockets: supportsAuthFileWebsockets(provider),
                                     websockets: readAuthFileWebsockets(file) ?? false,
                                     websocketsTouched: false,
                                     supportsUsingApi: supportsAuthFileUsingApi(provider),
                                     usingApi: readAuthFileUsingApi(file),
                                     usingApiTouched: false,
                                     excludedModelsText: formatExcludedModelsText(file.excludedModels ?? []),
                                     excludedModelsTouched: false,
                                 })
            return
        }

        setPrefixProxyEditor({
                                 fileName: name,
                                 authIndex,
                                 fileInfoText: JSON.stringify(buildSafeAuthFileDisplayInfo(file), null, 2),
                                 loading: true,
                                 saving: false,
                                 readOnly: false,
                                 error: null,
                                 json: null,
                                 prefix: '',
                                 proxyUrl: '',
                                 priority: '',
                                 weight: '',
                                 weightError: null,
                                 note: '',
                                 noteTouched: false,
                                 headersText: '',
                                 headersTouched: false,
                                 headersError: null,
                                 supportsModelAliases: false,
                                 modelAliasesText: '',
                                 modelAliasesTouched: false,
                                 modelAliasesError: null,
                                 requestRulesText: '',
                                 requestRulesTouched: false,
                                 requestRulesError: null,
                                 disableCooling: readAuthFileDisableCooling(file),
                                 disableCoolingTouched: false,
                                 requestRetry: readAuthFileRequestRetry(file),
                                 requestRetryTouched: false,
                                 supportsWebsockets: supportsAuthFileWebsockets(provider),
                                 websockets: readAuthFileWebsockets(file) ?? false,
                                 websocketsTouched: false,
                                 supportsUsingApi: supportsAuthFileUsingApi(provider),
                                 usingApi: readAuthFileUsingApi(file),
                                 usingApiTouched: false,
                                 excludedModelsText: formatExcludedModelsText(file.excludedModels ?? []),
                                 excludedModelsTouched: false,
                             })

        try {
            const rawText = await authFilesApi.downloadText(name)
            if (!isCurrentEditor(request)) {
                return
            }
            const trimmed = rawText.trim()
            let parsed: unknown
            try {
                parsed = JSON.parse(trimmed) as unknown
            } catch {
                setPrefixProxyEditor((prev) =>
                                         isCurrentEditor(request) && isEditorIdentity(prev, name, authIndex)
                                         ? {
                                                 ...prev,
                                                 loading: false,
                                                 error: t(getAuthFileContentErrorKey(rawText)),
                                             }
                                         : prev,
                )
                return
            }

            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setPrefixProxyEditor((prev) =>
                                         isCurrentEditor(request) && isEditorIdentity(prev, name, authIndex)
                                         ? {
                                                 ...prev,
                                                 loading: false,
                                                 error: t(getAuthFileContentErrorKey(rawText)),
                                             }
                                         : prev,
                )
                return
            }

            const downloaded                    = parsed as Record<string, unknown>
            const json: Record<string, unknown> = {
                prefix: downloaded.prefix,
                proxy_url: downloaded.proxy_url,
                priority: downloaded.priority,
                weight: downloaded.weight,
                note: downloaded.note,
                headers: normalizeEditableHeaders(downloaded.headers),
                disable_cooling: readAuthFileDisableCooling(downloaded),
                request_retry: readAuthFileRequestRetry(downloaded),
                websockets: readAuthFileWebsockets(downloaded),
                using_api: downloaded.using_api,
                excluded_models: downloaded.excluded_models ?? downloaded['excluded-models'],
                model_aliases: readAuthFilePolicyField(downloaded, 'model_aliases'),
                request_scoped_errors: readAuthFilePolicyField(downloaded, 'request_scoped_errors'),
            }
            const priority                      = parsePriorityValue(json.priority)
            const weight                        = readCredentialWeight(json.weight)
            const authKind                      = String(downloaded.auth_kind ?? '').trim().toLowerCase()
            const headers                       = json.headers
            let headersText                     = ''
            let headersError: string | null     = null
            if (headers !== undefined) {
                headersText        = JSON.stringify(normalizeEditableHeaders(headers), null, 2)
                const { errorKey } = parseHeadersText(headersText)
                headersError       = errorKey ? t(errorKey) : null
            }

            setPrefixProxyEditor((prev) =>
                                     isEditorIdentity(prev, name, authIndex)
                                     ? {
                                             ...prev,
                                             loading: false,
                                             json,
                                             prefix: typeof json.prefix === 'string' ? json.prefix : '',
                                             proxyUrl: typeof json.proxy_url === 'string' ? json.proxy_url : '',
                                             priority: priority !== undefined ? String(priority) : '',
                                             weight: weight !== undefined ? String(weight) : '',
                                             weightError: null,
                                             note: typeof json.note === 'string' ? json.note : '',
                                             noteTouched: false,
                                             headersText,
                                             headersTouched: false,
                                             headersError,
                                             supportsModelAliases: ['oauth', 'oauth2'].includes(authKind) || (
                                                 !['apikey', 'api_key', 'api-key'].includes(authKind) &&
                                                 !Object.prototype.hasOwnProperty.call(downloaded, 'api_key') &&
                                                 !Object.prototype.hasOwnProperty.call(downloaded, 'api-key')
                                             ),
                                             modelAliasesText: formatAuthFilePolicyRows(json.model_aliases),
                                             modelAliasesTouched: false,
                                             modelAliasesError: null,
                                             requestRulesText: formatAuthFilePolicyRows(json.request_scoped_errors),
                                             requestRulesTouched: false,
                                             requestRulesError: null,
                                             disableCooling: readAuthFileDisableCooling(json as AuthFileItem),
                                             disableCoolingTouched: false,
                                             requestRetry: readAuthFileRequestRetry(json),
                                             requestRetryTouched: false,
                                             supportsWebsockets: supportsAuthFileWebsockets(provider),
                                             websockets: readAuthFileWebsockets(json) ?? false,
                                             websocketsTouched: false,
                                             supportsUsingApi: supportsAuthFileUsingApi(
                                                 normalizeAuthFileProvider(
                                                     file.provider ||
                                                     file.type ||
                                                     inferProviderFromAuthFileName(file.name),
                                                 ),
                                             ),
                                             usingApi: readAuthFileUsingApi(json as AuthFileItem),
                                             usingApiTouched: false,
                                             excludedModelsText: formatExcludedModelsText(
                                                 normalizeExcludedModelsValue(
                                                     json.excluded_models ?? json['excluded-models'],
                                                 ),
                                             ),
                                             excludedModelsTouched: false,
                                             error: null,
                                         }
                                     : prev,
            )
        } catch (err: unknown) {
            if (!isCurrentEditor(request)) {
                return
            }
            const errorMessage = err instanceof Error ? err.message : t('notification.download_failed')
            setPrefixProxyEditor((prev) =>
                                     isEditorIdentity(prev, name, authIndex)
                                     ? { ...prev, loading: false, error: errorMessage }
                                     : prev,
            )
            showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error')
        }
    }

    const handlePrefixProxyChange = (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => {
        setPrefixProxyEditor((prev) => {
            if (disableControls || !isCurrentEditor() || !prev || prev.readOnly || prev.loading || prev.saving) {
                return prev
            }
            if (field === 'prefix') {
                return { ...prev, prefix: value }
            }
            if (field === 'proxyUrl') {
                return { ...prev, proxyUrl: value }
            }
            if (field === 'priority') {
                return { ...prev, priority: value }
            }
            if (field === 'weight') {
                const weightError = validateCredentialWeightText(value)
                return {
                    ...prev,
                    weight: value,
                    weightError: weightError ? t(credentialWeightErrorKey(weightError)) : null,
                }
            }
            if (field === 'note') {
                return { ...prev, note: value, noteTouched: true }
            }
            if (field === 'excludedModelsText') {
                return { ...prev, excludedModelsText: value, excludedModelsTouched: true }
            }
            if (field === 'modelAliasesText' || field === 'requestRulesText') {
                const modelAliases = field === 'modelAliasesText'
                const policyField = modelAliases ? 'model_aliases' : 'request_scoped_errors'
                const {errorKey} = parseAuthFilePolicyRows(value, policyField,
                    readAuthFilePolicyField(prev.json ?? {}, policyField))
                return modelAliases
                    ? {...prev, modelAliasesText: value, modelAliasesTouched: true,
                        modelAliasesError: errorKey ? t(errorKey) : null}
                    : {...prev, requestRulesText: value, requestRulesTouched: true,
                        requestRulesError: errorKey ? t(errorKey) : null}
            }
            const { errorKey } = parseHeadersText(value)
            return {
                ...prev,
                headersText: value,
                headersTouched: true,
                headersError: errorKey ? t(errorKey) : null,
            }
        })
    }

    const handlePrefixProxyBooleanChange = (field: 'usingApi' | 'websockets', value: boolean) => {
        setPrefixProxyEditor((prev) => {
            if (disableControls || !isCurrentEditor() || !prev || prev.readOnly || prev.loading || prev.saving) {
                return prev
            }
            return field === 'websockets'
                ? { ...prev, websockets: value, websocketsTouched: true }
                : { ...prev, usingApi: value, usingApiTouched: true }
        })
    }

    const handlePrefixProxyOverridesChange = (overrides: CredentialOverrides) => {
        setPrefixProxyEditor((prev) => {
            if (disableControls || !isCurrentEditor() || !prev || prev.readOnly || prev.loading || prev.saving) {
                return prev
            }
            return {
                ...prev,
                ...(Object.prototype.hasOwnProperty.call(overrides, 'disableCooling')
                    ? { disableCooling: overrides.disableCooling, disableCoolingTouched: true } : {}),
                ...(Object.prototype.hasOwnProperty.call(overrides, 'requestRetry')
                    ? { requestRetry: overrides.requestRetry, requestRetryTouched: true } : {}),
            }
        })
    }

    const handlePrefixProxySave = async () => {
        if (disableControls || !isCurrentEditor() || !prefixProxyEditor?.json || prefixProxyEditor.readOnly || prefixProxyEditor.loading ||
            prefixProxyEditor.saving || hasBlockingValidationError || !prefixProxyDirty) {
            return
        }
        const name      = prefixProxyEditor.fileName
        const authIndex = prefixProxyEditor.authIndex
        let payload: AuthFileFieldsPatch
        try {
            payload = buildAuthFileFieldsPatch(prefixProxyEditor, (key) => t(key))
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Invalid format'
            showNotification(errorMessage, 'error')
            return
        }
        if (!hasKeys(payload)) {
            return
        }

        const request = {authGeneration}
        editorRequestRef.current = request
        setPrefixProxyEditor((prev) => (isCurrentEditor(request) && isEditorIdentity(prev, name, authIndex)
            ? { ...prev, saving: true } : prev))
        try {
            await authFilesApi.patchFields(name, payload, authIndex)
            if (!isCurrentEditor(request)) {
                return
            }
            await completeMutation(name, payload, authIndex)
            if (!isCurrentEditor(request)) {
                return
            }
            showNotification(t('auth_files.prefix_proxy_saved_success', { name }), 'success')
            editorRequestRef.current = null
            setPrefixProxyEditor(null)
        } catch (err: unknown) {
            if (!isCurrentEditor(request)) {
                return
            }
            const errorMessage = err instanceof Error ? err.message : ''
            showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error')
            setPrefixProxyEditor((prev) => (isCurrentEditor(request) && isEditorIdentity(prev, name, authIndex)
                ? { ...prev, saving: false } : prev))
        }
    }

    return {
        prefixProxyEditor: isCurrentEditor() ? prefixProxyEditor : null,
        prefixProxyDirty,
        openPrefixProxyEditor,
        closePrefixProxyEditor,
        handlePrefixProxyChange,
        handlePrefixProxyBooleanChange,
        handlePrefixProxyOverridesChange,
        handlePrefixProxySave,
    }
}
