import {
    listYamlConfigFields,
    VISUAL_YAML_FIELDS,
    type YamlConfigField,
    yamlConfigField,
} from '@/hooks/visualConfigFields'
import type {YamlConfigFieldState, YamlConfigFieldStates} from '@/types/visualConfig'

export type VisualSectionId = 'connectivity' | 'network' | 'logging' | 'quota' | 'streaming' | 'advanced' | 'payload'

export interface ConfigFieldSearchEntry {
    fieldId: string
    sectionId: VisualSectionId
    path?: string
    destination?: string
    yamlPath?: string
    sourceField?: YamlConfigField
    labelKey: string
    label?: string
    qualifierKey?: string
    hintKey?: string
    yamlKeys?: string[]
    keywords?: string[]
}

export const configFieldDomId = (fieldId: string) => `cfg-field-${fieldId}`

type Translate = (key: string) => string

const L = (key: string) => `config_management.visual.${key}`

const CONFIG_FIELD_SEARCH_INDEX: ConfigFieldSearchEntry[] = [
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
        fieldId: 'rmTrustedProxies',
        sectionId: 'connectivity',
        labelKey: L('sections.remote.trusted_proxies'),
        hintKey: L('sections.remote.trusted_proxies_hint'),
        yamlKeys: ['remote-management', 'trusted-proxies'],
        keywords: ['reverse proxy', 'forwarded for', 'real ip'],
    },
    {
        fieldId: 'rmSecretKey',
        sectionId: 'connectivity',
        labelKey: L('sections.remote.secret_key'),
        hintKey: L('sections.remote.secret_key_hint'),
        yamlKeys: ['remote-management', 'secret-key'],
    },
    ...([
        ['rmDisableControlPanel', 'disable-control-panel', 'disable_panel'],
        ['rmAutoUpdatePanel', 'auto-update-panel', 'auto_update_panel'],
        ['rmAutoUpdateCPA', 'auto-update-cpa', 'auto_update_cpa'],
        ['rmAutoCheckUpdate', 'auto-check-update', 'auto_check_update'],
        ['rmCheckInterval', 'check-interval', 'check_interval'],
        ['rmPanelRepo', 'panel-github-repository', 'panel_repo'],
        ['rmCpaRepo', 'cpa-github-repository', 'cpa_repo'],
    ] as const).map(([fieldId, key, label]) => ({
        fieldId, sectionId: 'connectivity' as const, labelKey: L(`sections.remote.${label}`),
        yamlKeys: ['remote-management', key],
        keywords: fieldId === 'rmAutoUpdatePanel' ? ['remote-management.disable-auto-update-panel'] : undefined,
    })),
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
        hintKey: L('api_keys.policy_hint'),
        yamlKeys: [
            'api-keys',
            'api-key-aliases',
            'api-key-rules',
            'blocked-models',
            'providers',
            'canonical-models',
            'model-mappings',
            'policy-profile',
            'reservation-ttl',
            'limits',
            'requests',
            'tokens',
            'cost-micro',
        ],
        keywords: ['api key', 'apikey', 'token', 'quota', 'policy', 'provider', 'canonical model', 'mapping'],
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
        fieldId: 'videoResultAuthCacheTTL',
        sectionId: 'network',
        labelKey: L('sections.network.video_result_auth_cache_ttl'),
        hintKey: L('sections.network.video_result_auth_cache_ttl_hint'),
        yamlKeys: ['video-result-auth-cache-ttl'],
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
        keywords: ['round-robin', 'weighted-round-robin', 'wrr', 'quota-aware', 'headroom', 'reset', 'fill-first'],
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
        fieldId: 'routingSessionAffinitySubagents',
        sectionId: 'network',
        labelKey: L('sections.network.session_affinity_subagents'),
        hintKey: L('sections.network.session_affinity_subagents_desc'),
        yamlKeys: ['routing', 'session-affinity-subagents'],
    },
    {
        fieldId: 'routingSessionAffinityTTL', sectionId: 'network',
        labelKey: L('sections.network.session_affinity_ttl'), hintKey: L('sections.network.session_affinity_ttl_hint'),
        yamlKeys: ['routing', 'session-affinity-ttl'],
    },
    {
        fieldId: 'enableGeminiCliEndpoint', sectionId: 'network',
        labelKey: L('sections.network.enable_gemini_cli_endpoint'),
        hintKey: L('sections.network.enable_gemini_cli_endpoint_desc'), yamlKeys: ['enable-gemini-cli-endpoint'],
    },
    {
        fieldId: 'passthroughHeaders', sectionId: 'network',
        labelKey: L('sections.network.passthrough_headers'),
        hintKey: L('sections.network.passthrough_headers_desc'), yamlKeys: ['passthrough-headers'],
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
        fieldId: 'redisUsageQueueRetentionSeconds',
        sectionId: 'logging',
        labelKey: L('sections.system.redis_usage_retention'),
        hintKey: L('sections.system.redis_usage_retention_hint'),
        yamlKeys: ['redis-usage-queue-retention-seconds'],
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
        yamlKeys: ['usage-retention', 'days'],
        keywords: ['usage-retention-days'],
    },
    ...([
        ['pprofAddr', ['pprof', 'addr'], 'pprof_addr'],
        ['usageStatisticsFile', ['usage-statistics-file'], 'usage_statistics_file'],
        ['usageRetentionMaxDbSizeMb', ['usage-retention', 'max-db-size-mb'], 'usage_retention_max_db_size'],
        [
            'usageRetentionWarningThresholdPct',
            ['usage-retention', 'warning-threshold-pct'],
            'usage_retention_warning_threshold',
        ],
        ['modelRefreshInterval', ['model-refresh-interval'], 'model_refresh_interval'],
    ] as const).map(([fieldId, yamlKeys, label]) => ({
        fieldId, sectionId: 'logging' as const, yamlKeys: [...yamlKeys],
        labelKey: L(`sections.system.${label}`),
    })),
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
        hintKey: L('quota_switch_inactive_hint'),
        qualifierKey: 'config_management.yaml_fields.legacy',
        yamlKeys: ['quota-exceeded', 'switch-project'],
    },
    {
        fieldId: 'quotaSwitchPreviewModel',
        sectionId: 'quota',
        labelKey: L('sections.quota.switch_preview_model'),
        hintKey: L('quota_switch_inactive_hint'),
        qualifierKey: 'config_management.yaml_fields.legacy',
        yamlKeys: ['quota-exceeded', 'switch-preview-model'],
    },
    ...([
        ['quotaRefreshEnabled', 'enabled', 'credentials.quota_auto_refresh'],
        ['quotaRefreshInterval', 'interval', 'credentials.quota_interval_minutes'],
        ['quotaRefreshMaxInterval', 'max-interval', 'credentials.quota_max_interval_minutes'],
    ] as const).map(([fieldId, yamlKey, labelKey]) => ({
        fieldId, sectionId: 'quota' as const, path: '/credentials',
        destination: '/credentials?tab=inspection#quota-refresh-settings',
        labelKey, yamlKeys: ['quota-refresh', yamlKey],
    })),
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
        fieldId: 'saveCooldownStatus',
        sectionId: 'quota',
        labelKey: L('sections.quota.save_cooldown_status'),
        hintKey: L('sections.quota.save_cooldown_status_desc'),
        yamlKeys: ['save-cooldown-status'],
    },
    {
        fieldId: 'transientErrorCooldownSeconds',
        sectionId: 'quota',
        labelKey: L('sections.quota.transient_error_cooldown_seconds'),
        hintKey: L('sections.quota.transient_error_cooldown_seconds_hint'),
        yamlKeys: ['transient-error-cooldown-seconds'],
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
        fieldId: 'antigravitySensitiveWords',
        sectionId: 'advanced',
        labelKey: L('sections.system.antigravity_sensitive_words'),
        hintKey: L('sections.system.antigravity_sensitive_words_desc'),
        yamlKeys: ['antigravity', 'sensitive-words'],
        keywords: ['antigravity', 'obfuscate', 'zero-width'],
    },
    {
        fieldId: 'antigravityConnectionPoolEnabled', sectionId: 'advanced',
        labelKey: L('sections.advanced.pool_enabled'),
        yamlKeys: ['antigravity', 'connection-pool', 'enabled'],
    },
    {
        fieldId: 'antigravityConnectionPoolIdleTimeout', sectionId: 'advanced',
        labelKey: L('sections.advanced.pool_idle_timeout'),
        yamlKeys: ['antigravity', 'connection-pool', 'idle-conn-timeout'],
    },
    {
        fieldId: 'antigravityConnectionPoolMaxIdleConnsPerHost', sectionId: 'advanced',
        labelKey: L('sections.advanced.pool_max_idle_conns'),
        yamlKeys: ['antigravity', 'connection-pool', 'max-idle-conns-per-host'],
    },
    {
        fieldId: 'devinSensitiveWords',
        sectionId: 'advanced',
        labelKey: L('sections.system.devin_sensitive_words'),
        hintKey: L('sections.system.devin_sensitive_words_desc'),
        yamlKeys: ['devin', 'sensitive-words'],
        keywords: ['devin', 'system prompt', 'remove line', 'obfuscate', 'zero-width'],
    },
    {
        fieldId: 'providerConfig',
        sectionId: 'advanced',
        labelKey: L('sections.network.provider_keys'),
        yamlKeys: [
            'gemini-api-key',
            'interactions-api-key',
            'codex-api-key',
            'claude-api-key',
            'vertex-api-key',
            'meta-api-key',
            'xai-api-key',
            'openai-compatibility',
        ],
        keywords: ['use-max-completion-tokens', 'max_completion_tokens', 'max_tokens'],
    },
    {
        fieldId: 'clientCodexEnableApplyPatch', sectionId: 'advanced',
        labelKey: L('sections.advanced.client_apply_patch'), hintKey: L('sections.advanced.client_apply_patch_hint'),
        yamlKeys: ['client', 'codex', 'enable-apply-patch'], keywords: ['apply_patch', 'freeform'],
    },
    {
        fieldId: 'oauthSettings',
        path: '/credentials/oauth-config', sectionId: 'advanced',
        labelKey: L('sections.advanced.oauth_settings_title'), hintKey: L('sections.advanced.oauth_settings_hint'),
        yamlKeys: ['oauth-settings', 'name', 'alias', 'max-context-length'],
    },
    {
        fieldId: 'oauthRequestScopedErrors',
        path: '/credentials/oauth-config', sectionId: 'advanced',
        labelKey: L('sections.advanced.oauth_errors_title'), hintKey: L('sections.advanced.oauth_errors_hint'),
        yamlKeys: ['oauth-request-scoped-errors', 'status', 'match', 'match-regexr', 'action'],
    },
    {
        fieldId: 'oauthExcludedModels',
        path: '/credentials/oauth-config',
        sectionId: 'advanced',
        labelKey: L('sections.network.oauth_excluded_models'),
        hintKey: L('sections.network.oauth_excluded_models_hint'),
        yamlKeys: ['oauth-excluded-models'],
    },
    {
        fieldId: 'oauthModelAlias',
        path: '/models/oauth-aliases',
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
        fieldId: 'codexOptimizeMultiAgentV2',
        sectionId: 'advanced',
        labelKey: L('sections.network.codex_optimize_multi_agent_v2'),
        hintKey: L('sections.network.codex_optimize_multi_agent_v2_desc'),
        yamlKeys: ['codex', 'optimize-multi-agent-v2'],
    },
    {
        fieldId: 'codexDisableCloaking',
        sectionId: 'advanced',
        labelKey: L('sections.network.codex_disable_cloaking'),
        hintKey: L('sections.network.codex_disable_cloaking_desc'),
        yamlKeys: ['codex', 'disable-codex-cloaking'],
    },
    {
        fieldId: 'codexOrphanDelegationCompatibility',
        sectionId: 'advanced',
        labelKey: L('sections.network.codex_orphan_delegation_compatibility'),
        hintKey: L('sections.network.codex_orphan_delegation_compatibility_desc'),
        yamlKeys: ['codex', 'orphan-delegation-compatibility'],
    },
    {
        fieldId: 'claudeDisableCloakMode',
        sectionId: 'advanced',
        labelKey: L('sections.network.claude_disable_cloak_mode'),
        hintKey: L('sections.network.claude_disable_cloak_mode_desc'),
        yamlKeys: ['disable-claude-cloak-mode'],
    },
    {
        fieldId: 'claudeCodeDisableCloakingModelList',
        sectionId: 'advanced',
        labelKey: L('sections.network.claude_code_disable_cloaking_model_list'),
        hintKey: L('sections.network.claude_code_disable_cloaking_model_list_desc'),
        yamlKeys: ['claude-code', 'disable-cloaking-model-list'],
    },
    {
        fieldId: 'claudeModelLevelCooling',
        sectionId: 'advanced',
        labelKey: L('sections.network.claude_model_level_cooling'),
        hintKey: L('sections.network.claude_model_level_cooling_desc'),
        yamlKeys: ['claude', 'model-level-cooling'],
    },
    {
        fieldId: 'xaiInjectXSearch',
        sectionId: 'advanced',
        labelKey: L('sections.network.xai_inject_x_search'),
        hintKey: L('sections.network.xai_inject_x_search_desc'),
        yamlKeys: ['xai', 'inject-x-search'],
    },
    {
        fieldId: 'codexLiveMediaRelayEnabled', sectionId: 'advanced',
        labelKey: L('sections.advanced.relay_enabled'),
        yamlKeys: ['codex', 'live-media-relay', 'enabled'],
    },
    {
        fieldId: 'codexLiveMediaRelayMaxSessions', sectionId: 'advanced',
        labelKey: L('sections.advanced.relay_max_sessions'),
        yamlKeys: ['codex', 'live-media-relay', 'max-sessions'],
    },
    {
        fieldId: 'codexLiveMediaRelayDisablePrivateRemoteIPs', sectionId: 'advanced',
        labelKey: L('sections.advanced.relay_block_private_ips'),
        yamlKeys: ['codex', 'live-media-relay', 'disable-private-remote-ips'],
    },
    {
        fieldId: 'codexLiveMediaRelayPublicIP', sectionId: 'advanced',
        labelKey: L('sections.advanced.relay_public_ip'),
        yamlKeys: ['codex', 'live-media-relay', 'public-ip'],
    },
    {
        fieldId: 'codexLiveMediaRelayUDPPortMin', sectionId: 'advanced',
        labelKey: L('sections.advanced.relay_udp_min'),
        yamlKeys: ['codex', 'live-media-relay', 'udp-port-min'],
    },
    {
        fieldId: 'codexLiveMediaRelayUDPPortMax', sectionId: 'advanced',
        labelKey: L('sections.advanced.relay_udp_max'),
        yamlKeys: ['codex', 'live-media-relay', 'udp-port-max'],
    },
    {
        fieldId: 'codexLiveMediaRelayICEServers', sectionId: 'advanced',
        labelKey: L('sections.advanced.ice_servers'),
        yamlKeys: ['codex', 'live-media-relay', 'ice-servers'],
        keywords: ['stun', 'turn'],
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

    ...VISUAL_YAML_FIELDS.filter((field) => field.editable || field.owner === 'home')
                         .map((field) => ({
                             fieldId: field.id, sectionId: 'advanced' as const, labelKey: '', label: field.id,
                             yamlKeys: field.path.map(String),
                         })),
    {
        fieldId: 'payloadDefaultRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.default_rules'),
        hintKey: L('sections.payload.default_rules_desc'),
        yamlKeys: ['payload', 'default'],
        keywords: ['payload', 'rule'],
    },
    {
        fieldId: 'payloadDefaultRawRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.default_raw_rules'),
        hintKey: L('sections.payload.default_raw_rules_desc'),
        yamlKeys: ['payload', 'default-raw'],
        keywords: ['payload', 'rule', 'json'],
    },
    {
        fieldId: 'payloadOverrideRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.override_rules'),
        hintKey: L('sections.payload.override_rules_desc'),
        yamlKeys: ['payload', 'override'],
        keywords: ['payload', 'rule'],
    },
    {
        fieldId: 'payloadOverrideRawRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.override_raw_rules'),
        hintKey: L('sections.payload.override_raw_rules_desc'),
        yamlKeys: ['payload', 'override-raw'],
        keywords: ['payload', 'rule', 'json'],
    },
    {
        fieldId: 'payloadFilterRules',
        sectionId: 'payload',
        labelKey: L('sections.payload.filter_rules'),
        hintKey: L('sections.payload.filter_rules_desc'),
        yamlKeys: ['payload', 'filter'],
        keywords: ['payload', 'rule', 'filter'],
    },
]

const MAX_RESULTS = 8

const SEARCH_BY_ID   = new Map(CONFIG_FIELD_SEARCH_INDEX.map((entry) => [entry.fieldId, entry]))
const SEARCH_BY_PATH = new Map(CONFIG_FIELD_SEARCH_INDEX.filter((entry) => entry.yamlKeys)
                                                        .map((entry) => [entry.yamlKeys!.join('.'), entry]))

export function getYamlConfigFieldEntry(field: YamlConfigField, state?: YamlConfigFieldState, pluginsAvailable = false):
    ConfigFieldSearchEntry | undefined {
    if (field.owner === 'runtime') {
        return undefined
    }
    const direct     = SEARCH_BY_PATH.get(field.id)
    const target     = (field.target && SEARCH_BY_ID.get(field.target)) || direct
    const sourceOnly = field.owner !== 'home' && field.owner !== 'catalog' && field.owner !== 'ignored' &&
                       (state?.source === 'inherited' || state?.shared || state?.source === 'unsupported' ||
                        (state?.source === 'redacted' && field.editable))
    const label      = { yamlPath: field.id, labelKey: '', label: field.id, yamlKeys: field.path.map(String) }
    const fallback   = { ...label, fieldId: field.id, sectionId: target?.sectionId ?? 'advanced' as const }
    if (sourceOnly || (field.destination === '/plugins' && (!pluginsAvailable || field.path.length > 2)) ||
        (field.destination === '/credentials' && field.path.length > 1)) {
        return { ...fallback, sourceField: field }
    }
    if (field.destination) {
        return direct?.destination === field.destination ? direct :
            { ...fallback, destination: field.destination }
    }
    if (target) {
        return target === direct ? target : { ...target, ...label }
    }
    if (field.owner === 'home' || field.owner === 'ignored') {
        return undefined
    }
    return { ...fallback, sourceField: field }
}

export function findConfigFieldById(fieldId: string | null | undefined): ConfigFieldSearchEntry | undefined {
    if (!fieldId) {
        return undefined
    }
    const entry = SEARCH_BY_ID.get(fieldId)
    const field = yamlConfigField(fieldId)
    return entry ?? (field && getYamlConfigFieldEntry(field))
}

const withoutSelectors = (path: string) => path.replace(/\[(?:\d*)\]|\{\*\}/g, '')

export function matchesYamlConfigField(path: string, query: string): boolean {
    const lower = path.toLowerCase()
    const plain = withoutSelectors(query)
    return lower.includes(query) || (plain !== '' && withoutSelectors(lower).includes(plain))
}

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

export function searchConfigFields(
    query: string, t: Translate, states: YamlConfigFieldStates = {},
    pluginsAvailable                                           = false,
): ConfigFieldSearchEntry[] {
    const q = query.trim().toLowerCase()
    if (!q) {
        return []
    }

    const candidates = new Map<string, ConfigFieldSearchEntry>()
    for (const entry of CONFIG_FIELD_SEARCH_INDEX) {
        const field = yamlConfigField(entry.yamlKeys?.join('.') ?? '')
        if (!field) {
            candidates.set(entry.fieldId, entry)
        }
    }
    for (const field of listYamlConfigFields(states)) {
        const entry = getYamlConfigFieldEntry(field, states[field.id], pluginsAvailable)
        if (!entry) {
            continue
        }
        candidates.set(entry.yamlPath ?? entry.fieldId, entry)
    }

    const scored: Array<{ entry: ConfigFieldSearchEntry; score: number }> = []
    for (const entry of candidates.values()) {
        const label     = (entry.label ?? t(entry.labelKey)).toLowerCase()
        const qualifier = entry.qualifierKey ? t(entry.qualifierKey).toLowerCase() : ''
        const hint      = entry.hintKey ? t(entry.hintKey).toLowerCase() : ''
        const path      = (entry.yamlPath ?? entry.yamlKeys?.join('.') ?? '').toLowerCase()
        const keywords  = (entry.keywords ?? []).join(' ').toLowerCase()

        let score = Number.POSITIVE_INFINITY
        if (path === q) {
            score = -2
        } else if (withoutSelectors(path) === q || entry.yamlKeys?.some((key) => key.toLowerCase() === q)) {
            score = -1
        } else if (label.startsWith(q)) {
            score = 0
        } else if (label.includes(q)) {
            score = 1
        } else if (qualifier.includes(q) || keywords.includes(q)) {
            score = 2
        } else if (path && (matchesYamlConfigField(path, q) || buildYamlSearchText(entry.yamlKeys).includes(q))) {
            score = 3
        } else if (hint.includes(q)) {
            score = 4
        }

        if (Number.isFinite(score)) {
            scored.push({ entry, score })
        }
    }

    scored.sort((a, b) => a.score -
                          b.score ||
                          Number(Boolean(a.entry.sourceField)) -
                          Number(Boolean(b.entry.sourceField)))
    return scored.slice(0, MAX_RESULTS).map((item) => item.entry)
}

export function getVisualConfigSectionId(field: string): VisualSectionId | undefined {
    const groups: Record<string, VisualSectionId> = {
        rmDisableControlPanel: 'connectivity',
        rmAutoUpdatePanel: 'connectivity',
        rmAutoUpdateCPA: 'connectivity',
        rmAutoCheckUpdate: 'connectivity',
        rmCheckInterval: 'connectivity',
        rmPanelRepo: 'connectivity',
        rmCpaRepo: 'connectivity',
        apiKeysText: 'connectivity',
        apiKeyAliasesText: 'connectivity',
        apiKeyRules: 'connectivity',
        usageStatisticsFile: 'logging',
        pprofAddr: 'logging',
        usageRetentionMaxDbSizeMb: 'logging',
        usageRetentionWarningThresholdPct: 'logging',
        modelRefreshInterval: 'logging',
        enableGeminiCliEndpoint: 'network',
        passthroughHeaders: 'network',
        routingSessionAffinityTTL: 'network',
        pluginConfigsText: 'advanced',
        providerConfigText: 'advanced',
        oauthExcludedModelsText: 'advanced',
        clientCodexEnableApplyPatch: 'advanced',
        oauthSettingsText: 'advanced',
        oauthRequestScopedErrorsText: 'advanced',
        oauthModelAliasText: 'advanced',
        yamlFieldEdits: 'advanced',
        streaming: 'streaming',
    }
    return groups[field] ?? findConfigFieldById(field)?.sectionId
}
