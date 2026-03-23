import {isMap, parse as parseYaml, parseDocument} from 'yaml'

/**
 * 完整配置模板，包含所有可配置字段的默认值和分区注释。
 * 当后端返回的 YAML 缺少某些字段时，用此模板补充。
 */
const CONFIG_TEMPLATE = `\
# ── 服务器 ──────────────────────────
host: "127.0.0.1"
port: 8317

# ── TLS ─────────────────────────────
tls:
  enable: false
  # cert: "/path/to/cert.pem"
  # key: "/path/to/key.pem"

# ── 远程管理 ────────────────────────
remote-management:
  allow-remote: false
  # secret-key: ""
  disable-control-panel: false
  panel-github-repository: "https://github.com/Pyrokine/Cli-Proxy-API-Management-Center"
  cpa-github-repository: "https://github.com/Pyrokine/CLIProxyAPI"

# ── 认证 ────────────────────────────
# auth-dir: "~/.cli-proxy-api"
# api-keys: []

# ── 系统 ────────────────────────────
debug: false
commercial-mode: false
logging-to-file: false
# logs-max-total-size-mb: 0
usage-statistics-enabled: false

# ── 网络 ────────────────────────────
# proxy-url: ""
force-model-prefix: false
request-retry: 3
max-retry-interval: 30
ws-auth: true
# allow-query-auth: false  # SECURITY RISK: exposes credentials in URL query strings
# cors-allowed-origins: []  # Empty = allow all (*); set to restrict browser access
routing:
  strategy: round-robin

# ── 配额超限 ────────────────────────
quota-exceeded:
  switch-project: true
  switch-preview-model: true

# ── 流式传输 ────────────────────────
streaming:
  keepalive-seconds: 0
  bootstrap-retries: 1
  # nonstream-keepalive-interval: 0

# ── 载荷规则 ────────────────────────
# payload:
#   default: []
#   override: []
#   filter: []
`

/**
 * 将后端返回的 YAML 与完整默认模板合并。
 *
 * 策略：以模板为骨架，将后端的值叠加上去。
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
