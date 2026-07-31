export type VisualSectionId = 'connectivity' | 'network' | 'logging' | 'quota' | 'streaming' | 'advanced' | 'payload'

export interface ConfigFieldSearchEntry {
    fieldId: string
    sectionId: VisualSectionId
    labelKey: string
    qualifierKey?: string
    hintKey?: string
    yamlKeys?: string[]
    keywords?: string[]
}

export const configFieldDomId = (fieldId: string) => `cfg-field-${fieldId}`

type Translate = (key: string) => string

const L = (key: string) => `config_management.visual.${key}`

export const CONFIG_FIELD_SEARCH_INDEX: ConfigFieldSearchEntry[] = [
    {
        fieldId: 'host',
        sectionId: 'connectivity',
        labelKey: L('sections.server.host'),
        hintKey: L('sections.server.host_hint'),
        yamlKeys: ['host'],
    },
    { fieldId: 'port', sectionId: 'connectivity', labelKey: L('sections.server.port'), yamlKeys: ['port'] },
    {
        fieldId: 'tlsEnable',
        sectionId: 'connectivity',
        labelKey: L('sections.tls.enable'),
        hintKey: L('sections.tls.enable_desc'),
        yamlKeys: ['tls', 'enable'],
        keywords: ['ssl', 'https'],
    },
    {
        fieldId: 'tlsCert',
        sectionId: 'connectivity',
        labelKey: L('sections.tls.cert'),
        yamlKeys: ['tls', 'cert'],
        keywords: ['certificate', 'pem'],
    },
    {
        fieldId: 'tlsKey',
        sectionId: 'connectivity',
        labelKey: L('sections.tls.key'),
        yamlKeys: ['tls', 'key'],
        keywords: ['private key', 'pem'],
    },
    {
        fieldId: 'tlsHttpRedirectPort',
        sectionId: 'connectivity',
        labelKey: L('sections.tls.http_redirect_port'),
        yamlKeys: ['tls', 'http-redirect-port'],
    },
    {
        fieldId: 'tlsRequireForAuth',
        sectionId: 'connectivity',
        labelKey: L('sections.tls.require_for_auth'),
        hintKey: L('sections.tls.require_for_auth_desc'),
        yamlKeys: ['tls', 'require-for-auth'],
        keywords: ['https auth'],
    },
    {
        fieldId: 'tlsTrustForwardedProto',
        sectionId: 'connectivity',
        labelKey: L('sections.tls.trust_forwarded_proto'),
        hintKey: L('sections.tls.trust_forwarded_proto_desc'),
        yamlKeys: ['tls', 'trust-forwarded-proto'],
        keywords: ['forwarded proto', 'reverse proxy'],
    },
    {
        fieldId: 'rmAllowRemote',
        sectionId: 'connectivity',
        labelKey: L('sections.remote.allow_remote'),
        hintKey: L('sections.remote.allow_remote_desc'),
        yamlKeys: ['remote-management', 'allow-remote'],
    },
    {
        fieldId: 'rmSecretKey',
        sectionId: 'connectivity',
        labelKey: L('sections.remote.secret_key'),
        hintKey: L('sections.remote.secret_key_hint'),
        yamlKeys: ['remote-management', 'secret-key'],
    },
    {
        fieldId: 'authDir',
        sectionId: 'connectivity',
        labelKey: L('sections.auth.auth_dir'),
        hintKey: L('sections.auth.auth_dir_hint'),
        yamlKeys: ['auth-dir'],
    },
    {
        fieldId: 'apiKeys',
        sectionId: 'connectivity',
        labelKey: L('api_keys.label'),
        yamlKeys: ['api-keys'],
        keywords: ['api key', 'apikey', 'token'],
    },

    { fieldId: 'proxyUrl', sectionId: 'network', labelKey: L('sections.network.proxy_url'), yamlKeys: ['proxy-url'] },
    {
        fieldId: 'requestRetry',
        sectionId: 'network',
        labelKey: L('sections.network.request_retry'),
        yamlKeys: ['request-retry'],
    },
    {
        fieldId: 'maxRetryCredentials',
        sectionId: 'network',
        labelKey: L('sections.network.max_retry_credentials'),
        hintKey: L('sections.network.max_retry_credentials_hint'),
        yamlKeys: ['max-retry-credentials'],
    },
    {
        fieldId: 'maxRetryInterval',
        sectionId: 'network',
        labelKey: L('sections.network.max_retry_interval'),
        yamlKeys: ['max-retry-interval'],
    },
    {
        fieldId: 'authAutoRefreshWorkers',
        sectionId: 'network',
        labelKey: L('sections.network.auth_auto_refresh_workers'),
        hintKey: L('sections.network.auth_auto_refresh_workers_hint'),
        yamlKeys: ['auth-auto-refresh-workers'],
    },
    {
        fieldId: 'gptImage2BaseModel',
        sectionId: 'network',
        labelKey: L('sections.network.gpt_image_2_base_model'),
        hintKey: L('sections.network.gpt_image_2_base_model_hint'),
        yamlKeys: ['gpt-image-2-base-model'],
    },
    {
        fieldId: 'corsAllowedOrigins',
        sectionId: 'network',
        labelKey: L('sections.network.cors_allowed_origins'),
        hintKey: L('sections.network.cors_allowed_origins_hint'),
        yamlKeys: ['cors-allowed-origins'],
    },
    {
        fieldId: 'routingStrategy',
        sectionId: 'network',
        labelKey: L('sections.network.routing_strategy'),
        hintKey: L('sections.network.routing_strategy_hint'),
        yamlKeys: ['routing', 'strategy'],
        keywords: ['round-robin', 'fill-first'],
    },
    {
        fieldId: 'disableImageGeneration',
        sectionId: 'network',
        labelKey: L('sections.network.disable_image_generation'),
        hintKey: L('sections.network.disable_image_generation_hint'),
        yamlKeys: ['disable-image-generation'],
    },
    {
        fieldId: 'forceModelPrefix',
        sectionId: 'network',
        labelKey: L('sections.network.force_model_prefix'),
        hintKey: L('sections.network.force_model_prefix_desc'),
        yamlKeys: ['force-model-prefix'],
    },
    {
        fieldId: 'routingSessionAffinity',
        sectionId: 'network',
        labelKey: L('sections.network.session_affinity'),
        hintKey: L('sections.network.session_affinity_desc'),
        yamlKeys: ['routing', 'session-affinity'],
    },
    {
        fieldId: 'wsAuth',
        sectionId: 'network',
        labelKey: L('sections.network.ws_auth'),
        hintKey: L('sections.network.ws_auth_desc'),
        yamlKeys: ['ws-auth'],
        keywords: ['websocket'],
    },
    {
        fieldId: 'allowQueryAuth',
        sectionId: 'network',
        labelKey: L('sections.network.allow_query_auth'),
        hintKey: L('sections.network.allow_query_auth_desc'),
        yamlKeys: ['allow-query-auth'],
    },

    {
        fieldId: 'debug',
        sectionId: 'logging',
        labelKey: L('sections.system.debug'),
        hintKey: L('sections.system.debug_desc'),
        yamlKeys: ['debug'],
    },
    {
        fieldId: 'commercialMode',
        sectionId: 'logging',
        labelKey: L('sections.system.commercial_mode'),
        hintKey: L('sections.system.commercial_mode_desc'),
        yamlKeys: ['commercial-mode'],
    },
    {
        fieldId: 'loggingToFile',
        sectionId: 'logging',
        labelKey: L('sections.system.logging_to_file'),
        hintKey: L('sections.system.logging_to_file_desc'),
        yamlKeys: ['logging-to-file'],
    },
    {
        fieldId: 'requestLog',
        sectionId: 'logging',
        labelKey: L('sections.system.request_log'),
        hintKey: L('sections.system.request_log_desc'),
        yamlKeys: ['request-log'],
    },
    {
        fieldId: 'usageStatisticsEnabled',
        sectionId: 'logging',
        labelKey: L('sections.system.usage_statistics'),
        hintKey: L('sections.system.usage_statistics_desc'),
        yamlKeys: ['usage-statistics-enabled'],
    },
    {
        fieldId: 'pprofEnable',
        sectionId: 'logging',
        labelKey: L('sections.system.pprof_enable'),
        hintKey: L('sections.system.pprof_enable_desc'),
        yamlKeys: ['pprof', 'enable'],
    },
    {
        fieldId: 'logsMaxTotalSizeMb',
        sectionId: 'logging',
        labelKey: L('sections.system.logs_max_size'),
        hintKey: L('sections.system.logs_max_size_hint'),
        yamlKeys: ['logs-max-total-size-mb'],
    },
    {
        fieldId: 'imageArtifactCacheMaxTotalSizeMb',
        sectionId: 'logging',
        labelKey: L('sections.system.image_artifact_cache_max_size'),
        hintKey: L('sections.system.image_artifact_cache_max_size_hint'),
        yamlKeys: ['image-artifact-cache', 'max-total-size-mb'],
        keywords: ['artifact', 'image cache', 'generated image'],
    },
    {
        fieldId: 'imageArtifactCacheRetentionDays',
        sectionId: 'logging',
        labelKey: L('sections.system.image_artifact_cache_retention_days'),
        hintKey: L('sections.system.image_artifact_cache_retention_hint'),
        yamlKeys: ['image-artifact-cache', 'retention-days'],
        keywords: ['artifact', 'image cache', 'generated image'],
    },
    {
        fieldId: 'errorLogsMaxFiles',
        sectionId: 'logging',
        labelKey: L('sections.system.error_logs_max_files'),
        yamlKeys: ['error-logs-max-files'],
    },
    {
        fieldId: 'usageDataDir',
        sectionId: 'logging',
        labelKey: L('sections.system.usage_data_dir'),
        hintKey: L('sections.system.usage_data_dir_hint'),
        yamlKeys: ['usage-data-dir'],
    },
    {
        fieldId: 'usageRetentionDays',
        sectionId: 'logging',
        labelKey: L('sections.system.usage_retention_days'),
        hintKey: L('sections.system.usage_retention_hint'),
        yamlKeys: ['usage-retention-days'],
    },
    {
        fieldId: 'autoRefreshInterval',
        sectionId: 'logging',
        labelKey: L('sections.system.auto_refresh_interval'),
        hintKey: L('sections.system.auto_refresh_interval_hint'),
        yamlKeys: ['auto-refresh-interval'],
    },

    {
        fieldId: 'quotaSwitchProject',
        sectionId: 'quota',
        labelKey: L('sections.quota.switch_project'),
        hintKey: L('sections.quota.switch_project_desc'),
        yamlKeys: ['quota-exceeded', 'switch-project'],
    },
    {
        fieldId: 'quotaSwitchPreviewModel',
        sectionId: 'quota',
        labelKey: L('sections.quota.switch_preview_model'),
        hintKey: L('sections.quota.switch_preview_model_desc'),
        yamlKeys: ['quota-exceeded', 'switch-preview-model'],
    },
    {
        fieldId: 'quotaAntigravityCredits',
        sectionId: 'quota',
        labelKey: L('sections.quota.antigravity_credits'),
        hintKey: L('sections.quota.antigravity_credits_desc'),
        yamlKeys: ['quota-exceeded', 'antigravity-credits'],
    },
    {
        fieldId: 'disableCooling',
        sectionId: 'quota',
        labelKey: L('sections.quota.disable_cooling'),
        hintKey: L('sections.quota.disable_cooling_desc'),
        yamlKeys: ['disable-cooling'],
    },
    {
        fieldId: 'quotaRefreshEnabled',
        sectionId: 'quota',
        labelKey: L('sections.quota.refresh_enabled'),
        hintKey: L('sections.quota.refresh_enabled_desc'),
        yamlKeys: ['quota-refresh', 'enabled'],
    },
    {
        fieldId: 'quotaRefreshInterval',
        sectionId: 'quota',
        labelKey: L('sections.quota.refresh_interval'),
        hintKey: L('sections.quota.refresh_interval_hint'),
        yamlKeys: ['quota-refresh', 'interval'],
    },
    {
        fieldId: 'quotaRefreshMaxInterval',
        sectionId: 'quota',
        labelKey: L('sections.quota.refresh_max_interval'),
        hintKey: L('sections.quota.refresh_max_interval_hint'),
        yamlKeys: ['quota-refresh', 'max-interval'],
    },

    {
        fieldId: 'streamingKeepaliveSeconds',
        sectionId: 'streaming',
        labelKey: L('sections.streaming.keepalive_seconds'),
        hintKey: L('sections.streaming.keepalive_hint'),
        yamlKeys: ['streaming', 'keepalive-seconds'],
    },
    {
        fieldId: 'streamingBootstrapRetries',
        sectionId: 'streaming',
        labelKey: L('sections.streaming.bootstrap_retries'),
        hintKey: L('sections.streaming.bootstrap_hint'),
        yamlKeys: ['streaming', 'bootstrap-retries'],
    },
    {
        fieldId: 'streamingNonstreamKeepalive',
        sectionId: 'streaming',
        labelKey: L('sections.streaming.nonstream_keepalive'),
        hintKey: L('sections.streaming.nonstream_keepalive_hint'),
        yamlKeys: ['nonstream-keepalive-interval'],
    },

    {
        fieldId: 'pluginsEnabled',
        sectionId: 'advanced',
        labelKey: L('sections.system.plugins_enabled'),
        hintKey: L('sections.system.plugins_enabled_desc'),
        yamlKeys: ['plugins', 'enabled'],
    },
    {
        fieldId: 'pluginsDir',
        sectionId: 'advanced',
        labelKey: L('sections.system.plugins_dir'),
        hintKey: L('sections.system.plugins_dir_hint'),
        yamlKeys: ['plugins', 'dir'],
    },
    {
        fieldId: 'pluginStoreSources',
        sectionId: 'advanced',
        labelKey: L('sections.system.plugin_store_sources'),
        hintKey: L('sections.system.plugin_store_sources_hint'),
        yamlKeys: ['plugins', 'store-sources'],
    },
    {
        fieldId: 'pluginStoreAuth',
        sectionId: 'advanced',
        labelKey: L('sections.system.plugin_store_auth'),
        hintKey: L('sections.system.plugin_store_auth_hint'),
        yamlKeys: ['plugins', 'store-auth'],
    },
    {
        fieldId: 'pluginConfigs',
        sectionId: 'advanced',
        labelKey: L('sections.system.plugin_configs'),
        hintKey: L('sections.system.plugin_configs_hint'),
        yamlKeys: ['plugins', 'configs'],
    },
    {
        fieldId: 'providerConfig',
        sectionId: 'advanced',
        labelKey: L('sections.network.provider_keys'),
        yamlKeys: ['gemini-api-key', 'codex-api-key', 'claude-api-key', 'vertex-api-key', 'openai-compatibility'],
    },
    {
        fieldId: 'oauthExcludedModels',
        sectionId: 'advanced',
        labelKey: L('sections.network.oauth_excluded_models'),
        hintKey: L('sections.network.oauth_excluded_models_hint'),
        yamlKeys: ['oauth-excluded-models'],
    },
    {
        fieldId: 'oauthModelAlias',
        sectionId: 'advanced',
        labelKey: L('sections.network.oauth_model_alias'),
        hintKey: L('sections.network.oauth_model_alias_hint'),
        yamlKeys: ['oauth-model-alias'],
    },
    {
        fieldId: 'codexIdentityConfuse',
        sectionId: 'advanced',
        labelKey: L('sections.network.codex_identity_confuse'),
        hintKey: L('sections.network.codex_identity_confuse_desc'),
        yamlKeys: ['codex', 'identity-confuse'],
    },
    {
        fieldId: 'codexHeaderDefaults',
        sectionId: 'advanced',
        labelKey: L('sections.network.codex_header_defaults'),
        yamlKeys: ['codex-header-defaults'],
    },
    {
        fieldId: 'claudeHeaderDefaults',
        sectionId: 'advanced',
        labelKey: L('sections.network.claude_header_defaults'),
        yamlKeys: ['claude-header-defaults'],
    },

    {
        fieldId: 'payloadDefaultRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.default_rules'),
        hintKey: L('sections.payload.default_rules_desc'),
        keywords: ['payload', 'rule'],
    },
    {
        fieldId: 'payloadDefaultRawRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.default_raw_rules'),
        hintKey: L('sections.payload.default_raw_rules_desc'),
        keywords: ['payload', 'rule', 'json'],
    },
    {
        fieldId: 'payloadOverrideRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.override_rules'),
        hintKey: L('sections.payload.override_rules_desc'),
        keywords: ['payload', 'rule'],
    },
    {
        fieldId: 'payloadOverrideRawRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.override_raw_rules'),
        hintKey: L('sections.payload.override_raw_rules_desc'),
        keywords: ['payload', 'rule', 'json'],
    },
    {
        fieldId: 'payloadFilterRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.filter_rules'),
        hintKey: L('sections.payload.filter_rules_desc'),
        keywords: ['payload', 'rule', 'filter'],
    },
]

const MAX_RESULTS = 8

const buildYamlSearchText = (yamlKeys: string[] = []) => {
    const normalized = yamlKeys.map((key) => key.toLowerCase())
    return [
        ...normalized,
        normalized.join(' '),
        normalized.join('.'),
        normalized.join('-'),
        normalized.join('_'),
    ].join(' ')
}

export function searchConfigFields(query: string, t: Translate): ConfigFieldSearchEntry[] {
    const q = query.trim().toLowerCase()
    if (!q) {
        return []
    }

    const scored: Array<{ entry: ConfigFieldSearchEntry; score: number }> = []

    for (const entry of CONFIG_FIELD_SEARCH_INDEX) {
        const label     = t(entry.labelKey).toLowerCase()
        const qualifier = entry.qualifierKey ? t(entry.qualifierKey).toLowerCase() : ''
        const hint      = entry.hintKey ? t(entry.hintKey).toLowerCase() : ''
        const yaml      = buildYamlSearchText(entry.yamlKeys)
        const keywords  = (entry.keywords ?? []).join(' ').toLowerCase()

        let score = Number.POSITIVE_INFINITY
        if (label.startsWith(q)) {
            score = 0
        } else if (label.includes(q)) {
            score = 1
        } else if (qualifier.includes(q) || keywords.includes(q)) {
            score = 2
        } else if (yaml.includes(q)) {
            score = 3
        } else if (hint.includes(q)) {
            score = 4
        }

        if (Number.isFinite(score)) {
            scored.push({ entry, score })
        }
    }

    scored.sort((a, b) => a.score - b.score)
    return scored.slice(0, MAX_RESULTS).map((item) => item.entry)
}
