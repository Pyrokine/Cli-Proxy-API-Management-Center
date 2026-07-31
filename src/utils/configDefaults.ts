import {isMap, parse as parseYaml, parseDocument} from 'yaml'

/**
 * 完整配置模板，包含所有可配置字段的默认值和分区注释
 * 当后端返回的 YAML 缺少某些字段时，用此模板补充
 */
const CONFIG_TEMPLATE = `\
# ── 服务器 ──────────────────────────
host: "127.0.0.1"
port: 8317

# ── TLS ─────────────────────────────
tls:
  enable: false
  cert: ""
  key: ""
  http-redirect-port: 80
  require-for-auth: false
  trust-forwarded-proto: false

# ── 远程管理 ────────────────────────
remote-management:
  allow-remote: false
  secret-key: ""
  disable-control-panel: false
  auto-update-panel: true
  auto-check-update: false
  auto-update-cpa: false
  check-interval: 180
  panel-github-repository: "https://github.com/Pyrokine/Cli-Proxy-API-Management-Center"
  cpa-github-repository: "https://github.com/Pyrokine/CLIProxyAPI"

# ── 认证 ────────────────────────────
auth-dir: "~/.cli-proxy-api"
api-keys: []
api-key-aliases: {}
api-key-rules: {}
auth:
  providers:
    config-api-key:
      api-key-entries: []
allow-query-auth: false

# ── 系统 ────────────────────────────
debug: false
pprof:
  enable: false
  addr: "127.0.0.1:8316"
commercial-mode: false
logging-to-file: false
request-log: false
logs-max-total-size-mb: 0
image-artifact-cache:
  retention-days: 7
  max-total-size-mb: 10240
error-logs-max-files: 10
usage-statistics-enabled: false
redis-usage-queue-retention-seconds: 60
usage-statistics-file: ""
usage-data-dir: ""
usage-retention:
  days: 0
  max-db-size-mb: 0
  warning-threshold-pct: 80
plugins:
  enabled: false
  dir: "plugins"
  configs: {}

# ── 管理面板 ────────────────────────
auto-refresh-interval: 3     # seconds; 0 to disable
model-refresh-interval: 3    # hours; 0 to disable

# ── 网络 ────────────────────────────
proxy-url: ""
force-model-prefix: false
enable-gemini-cli-endpoint: false
passthrough-headers: false
# off/all/chat/passthrough
disable-image-generation: "off"
gpt-image-2-base-model: "gpt-5.4-mini"
request-retry: 3
max-retry-credentials: 0
max-retry-interval: 30
auth-auto-refresh-workers: 16
ws-auth: true
cors-allowed-origins: []  # Empty = allow all (*); set to restrict browser access
routing:
  strategy: round-robin  # round-robin (default), fill-first (优先填充)
  claude-code-session-affinity: false
  session-affinity: false
  session-affinity-ttl: ""

# ── 配额超限 ────────────────────────
quota-exceeded:
  switch-project: true
  switch-preview-model: true
  antigravity-credits: false
quota-refresh:
  enabled: false
  interval: 600
  max-interval: 1800
disable-cooling: false

# ── 流式传输 ────────────────────────
nonstream-keepalive-interval: 0
streaming:
  keepalive-seconds: 0
  bootstrap-retries: 1

# ── 供应商配置 ──────────────────────
gemini-api-key: []
codex-api-key: []
claude-api-key: []
vertex-api-key: []
openai-compatibility: []
oauth-model-alias: {}
oauth-excluded-models: {}
codex:
  identity-confuse: false
codex-header-defaults:
  user-agent: ""
  beta-features: ""
claude-header-defaults:
  user-agent: ""
  package-version: ""
  runtime-version: ""
  os: ""
  arch: ""
  timeout: ""
# ── 载荷规则 ────────────────────────
payload:
  default: []
  default-raw: []
  override: []
  override-raw: []
  filter: []
`

/**
 * 将后端返回的 YAML 与完整默认模板合并
 *
 * 策略：以模板为骨架，将后端的值叠加上去
 * - 后端有的字段保留后端值
 * - 后端缺失的字段保留模板默认值（含注释）
 * - 后端有但模板没有的字段追加到末尾
 */
export function mergeConfigWithDefaults(serverYaml: string): string {
    const trimmed = serverYaml.trim()
    if (!trimmed) {
        return CONFIG_TEMPLATE
    }

    let serverObj: Record<string, unknown>
    try {
        const parsed = parseYaml(trimmed)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return CONFIG_TEMPLATE
        }
        serverObj = parsed as Record<string, unknown>
    } catch {
        // YAML 解析失败，返回原文
        return serverYaml
    }

    // 以模板为基础文档
    const doc = parseDocument(CONFIG_TEMPLATE)

    // 递归覆盖模板值
    function overlayValues(obj: Record<string, unknown>, path: string[] = []): void {
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = [...path, key]

            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                // 嵌套对象：确保模板中存在此 map，然后递归
                const existing = doc.getIn(currentPath, true)
                if (!isMap(existing)) {
                    doc.setIn(currentPath, doc.createNode({}))
                }
                overlayValues(value as Record<string, unknown>, currentPath)
            } else {
                // 标量或数组：直接设置
                doc.setIn(currentPath, value)
            }
        }
    }

    overlayValues(serverObj)

    return doc.toString()
}
