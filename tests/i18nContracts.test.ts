import {describe, expect, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

type LocaleTree = Record<string, unknown>
type FlatLocale = Record<string, string>

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const srcRoot     = join(projectRoot, 'src')
const localeNames = ['en', 'ru', 'zh-CN', 'zh-TW'] as const
const locales     = Object.fromEntries(
    localeNames.map((name) => [
        name,
        JSON.parse(readFileSync(join(srcRoot, 'i18n', 'locales', `${name}.json`), 'utf8')) as LocaleTree,
    ]),
) as Record<(typeof localeNames)[number], LocaleTree>

const flattenLocale = (value: LocaleTree, prefix = ''): FlatLocale => {
    const result: FlatLocale = {}
    Object.entries(value).forEach(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key
        if (child && typeof child === 'object' && !Array.isArray(child)) {
            Object.assign(result, flattenLocale(child as LocaleTree, path))
            return
        }
        if (typeof child !== 'string') {
            throw new Error(`Translation leaf ${path} must be a string`)
        }
        result[path] = child
    })
    return result
}

const flatLocales     = Object.fromEntries(
    localeNames.map((name) => [name, flattenLocale(locales[name])]),
) as Record<(typeof localeNames)[number], FlatLocale>
const referenceKeys   = Object.keys(flatLocales.en).sort()
const referenceKeySet = new Set(referenceKeys)

const interpolationNames = (value: string): string[] =>
    Array.from(value.matchAll(/{{\s*(?<name>[^},\s]+)/g), (match) => match.groups?.name ?? '').sort()

const sourceFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
            return sourceFiles(path)
        }
        return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
    })

const literalKeyPatterns: Array<{ pattern: RegExp; keyPrefix?: string }> = [
    {
        pattern: /\b(?:t|i18n\.t)\s*\(\s*(?<quote>['"])(?<key>[A-Za-z0-9_.:-]+)\k<quote>/g,
    },
    {
        pattern: /\bsectionT\s*\(\s*(?<quote>['"])(?<key>[A-Za-z0-9_.:-]+)\k<quote>/g,
        keyPrefix: 'config_management.visual.sections.',
    },
    {
        pattern: /\bvisualT\s*\(\s*(?<quote>['"])(?<key>[A-Za-z0-9_.:-]+)\k<quote>/g,
        keyPrefix: 'config_management.visual.',
    },
    {
        pattern: new RegExp(
            String.raw`\b(?:labelKey|qualifierKey|hintKey|titleKey|descriptionKey|` +
            String.raw`messageKey|translationKey|tKey)\s*:\s*(?<quote>['"])(?<key>[A-Za-z0-9_.:-]+)\k<quote>`,
            'g',
        ),
    },
]

const dynamicKeyManifest = [
    ...['gemini', 'interactions', 'codex', 'meta'].flatMap((provider) =>
                                                       [
                                                           'models_label',
                                                           'models_add_btn',
                                                           'models_fetch_button',
                                                           'models_hint',
                                                           'models_fetch_title',
                                                           'models_fetch_apply',
                                                           'models_fetch_hint',
                                                           'models_fetch_url_label',
                                                           'models_fetch_refresh',
                                                           'models_search_label',
                                                           'models_search_placeholder',
                                                           'models_fetch_loading',
                                                           'models_fetch_empty',
                                                           'models_search_empty',
                                                       ].map((suffix) => `ai_providers.${provider}_${suffix}`),
    ),
    ...['claude_models', 'openai_models'].flatMap((provider) =>
                                                      [
                                                          'fetch_error',
                                                          'fetch_title',
                                                          'fetch_apply',
                                                          'fetch_hint',
                                                          'fetch_url_label',
                                                          'fetch_refresh',
                                                          'search_label',
                                                          'search_placeholder',
                                                          'fetch_loading',
                                                          'fetch_empty',
                                                          'search_empty',
                                                      ].map((suffix) => `ai_providers.${provider}_${suffix}`),
    ),
    ...['gemini', 'interactions', 'codex', 'meta', 'claude', 'openai'].flatMap((provider) =>
                                                                           [
                                                                               'title',
                                                                               'hint',
                                                                               'select_placeholder',
                                                                               'select_empty',
                                                                               'action',
                                                                           ].map(
                                                                               (suffix) => `ai_providers.${provider}_test_${suffix}`,
                                                                           ),
    ),
    ...['all', 'available', 'exhausted', 'error', 'disabled'].map(
        (suffix) => `credentials.filter_${suffix}`,
    ),
    ...['all', 'api_key', 'auth_file'].map((suffix) => `credentials.filter_type_${suffix}`),
    ...['name', 'type', 'status', 'requests', 'priority'].map((suffix) => `credentials.sort_${suffix}`),
    ...['normal', 'unavailable', 'unknown', 'disabled', 'completed', 'stopped', 'error', 'running'].map(
        (suffix) => `credentials.inspection_status_${suffix}`,
    ),
    ...[
        'ok',
        'quota_exceeded',
        'account_banned',
        'refresh_failed',
        'token_expired',
        'provider_error',
        'disabled',
        'unknown',
        'pending',
        'refreshing',
    ].map((suffix) => `credentials.inspection_reason_${suffix}`),
    ...[
        'none',
        'wait_quota_recovery',
        'check_provider_account',
        'manual_refresh_token',
        'enable_account',
        'check_login_or_provider_status',
        'wait_or_check_login',
        'enable_when_needed',
    ].map((suffix) => `credentials.inspection_advice_${suffix}`),
    ...['healthy', 'warning', 'error', 'unknown'].map(
        (suffix) => `credentials.provider_health_status_${suffix}`,
    ),
    ...['panel', 'cpa'].map((suffix) => `version_history.target_${suffix}`),
    ...['downloading', 'verifying', 'replacing', 'done', 'error', 'poll_failed'].map(
        (suffix) => `version_history.status_${suffix}`,
    ),
    ...[
        'validation_blocked',
        'port_range',
        'non_negative_integer',
        'integer_range_1_3600',
        'quota_refresh_interval_range',
        'quota_refresh_max_interval_range',
        'payload_invalid_number',
        'payload_invalid_boolean',
        'payload_invalid_json',
    ].map((suffix) => `config_management.visual.validation.${suffix}`),
    ...['empty', 'masked', 'weak', 'fair', 'good', 'strong'].map(
        (suffix) => `config_management.visual.api_keys.strength.levels.${suffix}`,
    ),
    ...[
        'short',
        'limited_character_classes',
        'low_unique_characters',
        'repeated_characters',
        'repeated_pattern',
        'sequential_characters',
        'common_term',
    ].map((suffix) => `config_management.visual.api_keys.strength.patterns.${suffix}`),
    ...[
        'use_longer_key',
        'mix_character_classes',
        'increase_character_variety',
        'avoid_repeated_characters',
        'avoid_repeated_patterns',
        'avoid_sequences',
        'avoid_common_terms',
        'use_generator',
        'replace_masked_value',
    ].map((suffix) => `config_management.visual.api_keys.strength.suggestions.${suffix}`),
    ...['overview', 'events', 'settings'].map((suffix) => `usage_stats.tab_${suffix}`),
    ...['2xx', '3xx', '4xx', '5xx'].map((suffix) => `logs.filter_status_${suffix}`),
    ...['history', 'ban_started', 'automatic_expiry', 'manual_unban'].map(
        (suffix) => `system_info.rate_limit_event_${suffix}`,
    ),
]

const technicalOnlyPatterns = [
    /^CPAMC$/,
    /^CLI Proxy API(?: Management Center)?$/,
    /^G:{{gemini}} C:{{codex}} Cl:{{claude}} O:{{openai}}$/,
    /^low, medium, high$/,
    new RegExp(
        '^(?:Qwen|Gemini|GeminiCLI|Gemini CLI|Kimi|AIStudio|Claude|Anthropic|' +
        'Codex|Antigravity|xAI|iFlow|Vertex|Interactions|OpenAI|Devin)(?: OAuth)?$',
    ),
    /^(?:Free|Plus|Team|Pro(?: (?:5x|20x|100|200))?|Ultra(?: Lite)?|Max(?: (?:5x|20x))?|SuperGrok(?: Heavy)?|Iguana Necktie)$/,
    new RegExp(
        '^(?:API Key|Request ID|Tokens|Websockets?|WebSocket|IP|OAuth|JSON|' +
        'true|false|Bearer|Basic|GitHub Token|User-Agent|Registry|Metadata|' +
        'Artifact|Arch|Beta Features|OS|Package Version|Runtime Version|' +
        'Timeout|Base URL:)$',
    ),
    /^OpenAI Response$/,
    /^Responses$/,
    /^English$/,
    /^Русский$/,
    /^\dxx$/,
    /^us-central1$/,
    /^key: value$/,
    /^{{current}} \/ {{total}}$/,
    /^https?:\/\//,
    /^socks5:\/\//,
    /^\{[\s\S]*}$/,
]

const isTechnicalOnly = (value: string): boolean =>
    technicalOnlyPatterns.some((pattern) => pattern.test(value.trim()))

const simplifiedChineseFragments = [
    '会话',
    '暂',
    '参與',
    '账号',
    '這里',
    '記錄里',
    '緩冲',
    '時間轴',
    '连续',
    '追踪',
    '磁盘',
    '占用',
    '日志',
    '泄露',
    '不了解',
    '少于',
    '端点',
    '基于',
    '适用',
    '用户',
    '範圍内',
    '达到',
    '拒绝',
    '内容',
    '未经',
    '审核',
    '校验',
    '粘贴',
    '用尽',
    '跟随',
    '吗？',
    '撤销',
    '刚刚',
]

const quotaResetKeys = [
    'auth_files.quota_reset_manual_title',
    'auth_files.quota_reset_manual_confirm',
    'auth_files.quota_reset_manual_confirm_button',
    'auth_files.quota_reset_manual_hint',
    'auth_files.quota_reset_codex_hint',
    'auth_files.quota_reset_codex_confirm',
    'auth_files.quota_reset_codex_unavailable_zero',
    'auth_files.quota_reset_codex_unavailable_missing',
    'auth_files.quota_reset_codex_unavailable_invalid',
    'auth_files.quota_reset_codex_unavailable_conflict',
    'auth_files.quota_reset_manual_success',
    'auth_files.quota_reset_manual_failed',
    'auth_files.quota_reset_manual_missing_auth_index',
]

describe('global i18n contract', () => {
    test('keeps leaf keys, values, and interpolation parameters aligned', () => {
        localeNames.forEach((localeName) => {
            const locale = flatLocales[localeName]
            expect(Object.keys(locale).sort()).toEqual(referenceKeys)
            Object.entries(locale).forEach(([key, value]) => {
                expect(value.trim(), `${localeName}:${key}`).not.toBe('')
                expect(referenceKeySet.has(value.trim()), `${localeName}:${key}`).toBeFalse()
                expect(interpolationNames(value), `${localeName}:${key}`).toEqual(
                    interpolationNames(flatLocales.en[key] ?? ''),
                )
            })
        })
    })

    test('resolves every static source key', () => {
        const missing: string[] = []
        sourceFiles(srcRoot).forEach((file) => {
            const source = readFileSync(file, 'utf8')
            literalKeyPatterns.forEach(({ pattern, keyPrefix }) => {
                Array.from(source.matchAll(pattern)).forEach((match) => {
                    const literalKey = match.groups?.key
                    const key        = literalKey ? `${keyPrefix ?? ''}${literalKey}` : ''
                    if (key && !referenceKeySet.has(key)) {
                        missing.push(`${file.slice(projectRoot.length + 1)}:${key}`)
                    }
                })
            })
        })
        expect(missing).toEqual([])
    })

    test('keeps dynamic source keys in an explicit manifest', () => {
        localeNames.forEach((localeName) => {
            dynamicKeyManifest.forEach((key) => {
                expect(flatLocales[localeName][key]?.trim(), `${localeName}:${key}`).toBeTruthy()
            })
        })
    })

    test('does not leave English prose in localized resources', () => {
        const localeScripts = {
            ru: /[А-Яа-яЁё]/,
            'zh-CN': /[㐀-鿿]/,
            'zh-TW': /[㐀-鿿]/,
        } as const
        Object.entries(localeScripts).forEach(([localeName, script]) => {
            const untranslated = Object.entries(flatLocales[localeName as keyof typeof flatLocales])
                                       .filter(([, value]) => /[A-Za-z]/.test(value) &&
                                                              !script.test(value) &&
                                                              !isTechnicalOnly(value))
                                       .map(([key, value]) => `${key}=${value}`)
            expect(untranslated).toEqual([])
        })
    })

    test('does not mix Simplified Chinese into Traditional Chinese translations', () => {
        const mixed = Object.entries(flatLocales['zh-TW'])
                            .filter(([, value]) => simplifiedChineseFragments.some((fragment) => value.includes(fragment)))
                            .map(([key, value]) => `${key}=${value}`)
        expect(mixed).toEqual([])
    })

    test('uses the approved navigation section labels', () => {
        expect({
                   en: [
                       flatLocales.en['nav.section_overview'],
                       flatLocales.en['nav.section_configuration'],
                       flatLocales.en['nav.section_extensions'],
                       flatLocales.en['nav.section_system'],
                   ],
                   'zh-CN': [
                       flatLocales['zh-CN']['nav.section_overview'],
                       flatLocales['zh-CN']['nav.section_configuration'],
                       flatLocales['zh-CN']['nav.section_extensions'],
                       flatLocales['zh-CN']['nav.section_system'],
                   ],
                   'zh-TW': [
                       flatLocales['zh-TW']['nav.section_overview'],
                       flatLocales['zh-TW']['nav.section_configuration'],
                       flatLocales['zh-TW']['nav.section_extensions'],
                       flatLocales['zh-TW']['nav.section_system'],
                   ],
                   ru: [
                       flatLocales.ru['nav.section_overview'],
                       flatLocales.ru['nav.section_configuration'],
                       flatLocales.ru['nav.section_extensions'],
                       flatLocales.ru['nav.section_system'],
                   ],
               }).toEqual({
                              en: ['Overview', 'Configuration', 'Extensions', 'System'],
                              'zh-CN': ['概览', '配置', '扩展', '系统'],
                              'zh-TW': ['總覽', '設定', '擴充', '系統'],
                              ru: ['Обзор', 'Настройки', 'Расширения', 'Система'],
                          })
    })

    test('renders quota reset confirmation text in every locale', async () => {
        for (const localeName of localeNames) {
            const instance = createInstance()
            await instance.init({
                                    lng: localeName,
                                    fallbackLng: false,
                                    resources: { [localeName]: { translation: locales[localeName] } },
                                    interpolation: { escapeValue: false },
                                })
            quotaResetKeys.forEach((key) => {
                const value = instance.t(key, { name: 'credential.json', message: 'failure' })
                expect(value, `${localeName}:${key}`).not.toBe(key)
                expect(value, `${localeName}:${key}`).not.toContain('{{')
            })
        }
    })

    test('names the single reset count and requires explicit consumption confirmation in every locale', () => {
        expect(Object.fromEntries(localeNames.map((locale) => [locale,
            flatLocales[locale]['codex_quota.reset_credits_label']]))).toEqual({
            en: 'Available resets', ru: 'Доступные сбросы', 'zh-CN': '可用重置次数', 'zh-TW': '可用重置次數',
        })
        localeNames.forEach((locale) => {
            expect(flatLocales[locale]['codex_quota.reset_credits_applicable_label']).toBeUndefined()
            expect(flatLocales[locale]['codex_quota.reset_credits_expiry_label']).not.toContain('GMT+8')
            expect(flatLocales[locale]['auth_files.quota_reset_codex_title']).toBeTruthy()
            expect(flatLocales[locale]['auth_files.quota_reset_codex_confirm_button']).toBeTruthy()
            expect(flatLocales[locale]['auth_files.quota_reset_codex_confirm']).toContain('{{name}}')
            expect(flatLocales[locale]['auth_files.quota_reset_codex_failed']).toContain('{{message}}')
            expect(flatLocales[locale]['credentials.manual_token_refresh']).not.toMatch(/token|токен/i)
        })
    })

    test('distinguishes credential-recorded Codex subscription dates in every locale', () => {
        localeNames.forEach((localeName) => {
            expect(flatLocales[localeName]['credentials.subscription_recorded_until']).not.toBe(
                flatLocales[localeName]['credentials.subscription_active_until'],
            )
        })
    })

    test('documents GPT Image 2.5 Flare and Sunburst on image endpoints in every locale', () => {
        localeNames.forEach((localeName) => {
            const description = flatLocales[localeName]['model_management.image_call_desc']
            expect(description).toContain('GPT Image 2.5 Flare/Sunburst')
            expect(description).toContain('OpenAI')
        })
    })

    test('describes the merged models.json and runtime-discovered catalog in every locale', () => {
        const runtimeTerms = {
            en: 'runtime',
            ru: 'runtime',
            'zh-CN': '运行时',
            'zh-TW': '執行階段',
        } as const

        localeNames.forEach((localeName) => {
            const descriptions = [
                flatLocales[localeName]['model_management.total_models_hint'],
                flatLocales[localeName]['model_management.source_help'],
            ]
            descriptions.forEach((description) => {
                expect(description).toContain('models.json')
                expect(description.toLocaleLowerCase()).toContain(runtimeTerms[localeName])
            })
        })
    })
})
