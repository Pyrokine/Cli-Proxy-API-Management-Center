# Changelog

## v1.26.0-aug.3 - 2026-10-20

### Release basis

- Upstream release: v1.26.0 (`c9e2f7cb0b065c13211285d9525bcc8761f17837`)
- Fork point: `ee784b579cc2278563d44789afed7c9c864570a7`
- Previous local release: v1.26.0-aug.2
- Paired release: CLIProxyAPI v8.0.23-aug.2

### Changes

- Let development builds install a selected release from version history without assigning them a semantic version
- Show an installation confirmation in all four languages and retain compatibility checks, restart warnings and update progress

### Compatibility

The minimum backend version remains `8.0.23-aug.1`

### 中文

#### 版本依据

- 上游版本：v1.26.0（`c9e2f7cb0b065c13211285d9525bcc8761f17837`）
- 分叉点：`ee784b579cc2278563d44789afed7c9c864570a7`
- 上一个本地版本：v1.26.0-aug.2
- 配套版本：CLIProxyAPI v8.0.23-aug.2

#### 更新内容

- 开发构建可从版本历史安装所选正式版本，保留实际版本标识
- 四种语言均展示安装确认，保留兼容性检查、重启提示和更新进度

#### 兼容性

最低后端版本保持 `8.0.23-aug.1`

Full changelog: https://github.com/Pyrokine/Cli-Proxy-API-Management-Center/compare/v1.26.0-aug.2...v1.26.0-aug.3

## v1.26.0-aug.2 - 2026-10-20

### Release basis

- Upstream release: v1.26.0 (`c9e2f7cb0b065c13211285d9525bcc8761f17837`)
- Fork point: `ee784b579cc2278563d44789afed7c9c864570a7`
- Previous local release: v1.23.1-aug.1
- Paired release: CLIProxyAPI v8.0.23-aug.1

### Changes

- Place the local cooldown action on its own row with an 8-pixel gap below the observation time
- Keep credential actions icon-only during refresh and reset progress, and allow action rows to wrap
- Count all credential cards in the sidebar, including manual providers and each OpenAI-compatible key
- Preserve cached quota and observation times on enable/disable changes; reconcile server state after uncertain failures
- Label partial refreshes separately from successful refreshes and retain each query's error details

- Make configuration search focus the exact quota switch in both simple and full modes

- Update provider and Meta forms, model metadata editing, and discovery while retaining flat configuration and `/v0/management` requests
- Preserve configuration drafts, comments, unknown fields, and concurrent-save checks; associate field errors with their labels and configuration sections
- Keep credential login, refresh, mutation, and confirmation results bound to the active connection and credential identity
- Display subscription, native quota, and plugin quota states without presenting unavailable usage as a measured balance
- Display owned Codex reset credits and allow confirmation when the applicable count is zero; recheck the owned balance and snapshot freshness before submitting
- Preserve plugin OAuth and resource state across connection changes
- Preserve log cursors, reading position, filtering, pagination, and fullscreen state across updates

### Compatibility

The minimum backend version is `8.0.23-aug.1`; older versions produce a dismissible compatibility warning without blocking login or disabling the panel

Model availability and image-generation access depend on the connected backend, provider, and account

### 中文

### 版本依据

- 上游版本：v1.26.0（`c9e2f7cb0b065c13211285d9525bcc8761f17837`）
- 分叉点：`ee784b579cc2278563d44789afed7c9c864570a7`
- 上一个本地版本：v1.23.1-aug.1
- 配套版本：CLIProxyAPI v8.0.23-aug.1

#### 更新内容

- 清除本地冷却按钮独立成行，与更新时间保留 8px 间距
- 凭证操作在刷新和重置过程中保持图标按钮，操作区允许换行
- 侧栏按全部凭证卡片计数，包含手动配置和 OpenAI-compatible 的每个 Key
- 启停时保留配额缓存与观测时间，返回结果不确定时读取服务端状态
- 部分刷新单独显示为部分更新，保留各查询的错误明细

- 配置搜索在简单和完整模式下均定位并聚焦对应的配额开关

- 更新 Provider 与 Meta 表单、模型元数据编辑和模型发现，保留 flat 配置与 `/v0/management` 请求
- 保留配置草稿、注释、未知字段和并发保存检查，字段错误关联到标签与配置分区
- 凭证登录、续期、状态修改和确认结果按当前连接与凭证身份处理
- 展示订阅、原生额度和插件额度状态，用量不可用时不显示为已测得的余额
- Codex 主动重置按持有次数显示，适用次数为 0 时仍可打开确认框；提交前重新检查持有次数和快照新鲜度
- 连接变化时保留插件 OAuth 与资源状态的归属
- 日志更新保留游标、阅读位置、筛选、分页和全屏状态

#### 兼容性

最低后端版本为 `8.0.23-aug.1`，较旧版本显示可关闭的兼容警告，不阻止登录或禁用面板

模型可用性和生图权限取决于连接的后端、Provider 与账号

Full changelog: https://github.com/Pyrokine/Cli-Proxy-API-Management-Center/compare/v1.23.1-aug.1...v1.26.0-aug.2

## v1.23.1-aug.1 - 2026-09-25

### Release Basis

- Upstream semantic basis: v1.23.1 (`c12997e1a544374336ea385d5e9a9bbabe1e4767`)
- Fork point with upstream v1.23.1: `ee784b579cc2278563d44789afed7c9c864570a7`
- Previous local release: v1.22.2-aug.1
- Local release: v1.23.1-aug.1
- Paired server release and minimum compatible server: CLIProxyAPI v7.3.2-aug.1

### What's Changed

- feat (config): Preserve visual YAML edits and unknown fields through merges and concurrent revisions; add typed Provider settings, credential overrides and configuration navigation
- feat (credentials): Add Devin OAuth and quota views, manual credential refresh and account inspection; keep refresh separate from active quota reset
- fix (oauth): Bind login attempts to their current owner and cancel stale polling after account, source or session changes
- fix (ui): Keep log previews, downloads and notifications scoped to the active request; refine navigation, accessibility and shared messages across four locales
- feat (models): Read Dashboard and System inventory from current runtime data, display model capabilities and prices, and recognize sync dirty builds in version history

### Compatibility

- This panel requires CLIProxyAPI v7.3.2-aug.1 or newer for the credential refresh endpoint; upgrade the server before installing this panel
- The release asset remains the single-file `management.html`
- Real paid Provider inference and active quota reset were not part of the local release checks

---

### 版本依据

- 上游语义基线：v1.23.1（`c12997e1a544374336ea385d5e9a9bbabe1e4767`）
- 与上游 v1.23.1 的分叉点：`ee784b579cc2278563d44789afed7c9c864570a7`
- 上一个本地版本：v1.22.2-aug.1
- 本地发布版本：v1.23.1-aug.1
- 配套后端与最低兼容版本：CLIProxyAPI v7.3.2-aug.1

### 更新内容

- feat (config)：合并及并发修订期间保留可视化 YAML 编辑和未知字段，增加类型化 Provider 设置、凭证覆盖项与配置导航
- feat (credentials)：增加 Devin OAuth 与 quota 展示、手动凭证刷新和账号巡检；凭证刷新与主动重置配额分开
- fix (oauth)：登录尝试绑定当前归属，账号、来源或会话变化后取消过期轮询
- fix (ui)：日志预览、下载和通知只更新当前请求，调整导航、无障碍交互与四语共用文案
- feat (models)：Dashboard 与 System 读取当前运行时模型，展示模型能力和价格，并在版本历史中识别 sync dirty 构建

### 兼容性

- 面板依赖 CLIProxyAPI v7.3.2-aug.1 或更新版本的凭证刷新接口，安装面板前先升级后端
- 发布资产仍是单文件 `management.html`
- 本地发版检查没有发起真实付费 Provider 推理或主动重置配额

## v1.22.2-aug.1 - 2026-09-13

### Release Basis

- Upstream semantic basis: v1.22.2
- Previous local release: v1.17.14-aug.2
- Local release: v1.22.2-aug.1
- Target server release: CLIProxyAPI v7.2.127-aug.1
- Minimum compatible server: CLIProxyAPI v7.2.67-aug.2

### What's Changed

- feat (providers): Add current DeepSeek V4.1 presets and retain protocol-specific connectivity tests while sharing
  model selection, request state, status handling, and common connection fields
- feat (images): Document GPT Image 2.5 Flare and Sunburst support in the image endpoint guidance for all four locales
- fix (credentials): Preserve bound credential identity across subscription changes and reject stale refresh responses
  after management-session or source changes
- fix (quota): Distinguish the general active-reset credit pool from credits applicable to the current credential, keep
  reset disabled when the applicable count is zero, and show every expiration in the effective user timezone without
  truncation
- fix (usage): Show complete request IDs from the first through last character with left-aligned wrapping and keep request
  log actions below the identifier in narrow layouts
- fix (errors): Format provider and Management API failures as readable structured messages instead of exposing raw
  nested response payloads
- fix (refresh): Keep credential, quota, runtime-model, and system requests tied to the current authenticated session so
  long-open pages cannot apply stale results after a successful refresh
- feat (security): Store sensitive browser values as `enc::v2::` using AES-256-GCM and PBKDF2-SHA-256, migrate readable
  legacy values, and avoid writing plaintext when secure storage is unavailable
- refactor (providers): Share provider presentation, focus restoration, connection fields, model selection, stable test
  signatures, and connectivity-test lifecycle without merging protocol-specific endpoints, headers, payloads, or auth
- chore (toolchain): Use TypeScript native 7.0.2 for application code, tests, root type checking, and builds while
  keeping the TypeScript 6 compatibility package only for `typescript-eslint`
- test (release): Repair the existing regression suite and validate the single-file `management.html` contract with the
  frozen Bun lockfile

### Compatibility

- This panel requires CLIProxyAPI v7.2.67-aug.2 or newer and is prepared for the v7.2.127-aug.1 paired release
- The release asset remains `management.html`; installation and upgrade paths do not change
- The build-time version remains `VERSION` → `git describe` → non-placeholder package version → `dev`

---

### 版本依据

- 上游语义基线：v1.22.2
- 上一个本地版本：v1.17.14-aug.2
- 本地发布版本：v1.22.2-aug.1
- 目标后端版本：CLIProxyAPI v7.2.127-aug.1
- 最低兼容后端：CLIProxyAPI v7.2.67-aug.2

### 更新内容

- feat (providers)：增加当前 DeepSeek V4.1 快速配置；保留各协议的连接测试，同时复用模型选择、请求状态、结果处理和公共连接字段
- feat (images)：在四种语言的图片端点说明中加入 GPT Image 2.5 Flare 与 Sunburst 支持范围
- fix (credentials)：套餐变化后保留已绑定凭证身份；管理会话或数据源变化后，过期刷新响应不能覆盖当前数据
- fix (quota)：区分通用主动重置 credit 池与当前凭证适用次数；适用次数为 0 时保持禁用，并按用户有效时区完整显示每条过期时间
- fix (usage)：request ID 从首字符到末字符完整显示并左对齐换行，窄布局中日志操作按钮位于 ID 下方
- fix (errors)：把 Provider 和 Management API 错误格式化为可读的结构化消息，不再直接展示嵌套原始响应
- fix (refresh)：凭证、配额、运行时模型和系统请求与当前认证会话关联，长时间打开页面后成功刷新的数据不会被旧请求覆盖
- feat (security)：敏感浏览器数据使用 AES-256-GCM 和 PBKDF2-SHA-256 保存为 `enc::v2::`；可读取的旧值会迁移，安全存储不可用时不写明文
- refactor (providers)：复用 Provider 展示、焦点恢复、连接字段、模型选择、稳定测试签名和连接测试生命周期，
  不合并协议专属 endpoint、header、payload 或 auth
- chore (toolchain)：应用代码、测试、根类型检查和构建使用 TypeScript native 7.0.2；
  TypeScript 6 compatibility package 仅供 `typescript-eslint` 使用
- test (release)：修复原有回归测试，并用 frozen Bun lockfile 验证单文件 `management.html` 构建契约

### 兼容性

- 本面板最低要求 CLIProxyAPI v7.2.67-aug.2，并已按 v7.2.127-aug.1 配套发版准备
- 发布资产仍为 `management.html`，安装和升级路径不变
- 构建版本来源仍为 `VERSION` → `git describe` → 非占位 package version → `dev`

## v1.17.14-aug.2 - 2026-08-02

### Release Basis

- Upstream semantic basis: v1.17.14
- Previous local release: v1.17.14-aug.1
- Local release: v1.17.14-aug.2
- Required server: CLIProxyAPI v7.2.67-aug.2 or newer

### What's Changed

- fix (system): Load the current service's registered runtime models through the authenticated Management API instead of
  calling public `/v1/models` with redacted proxy API keys
- fix (system): Cancel and clear model requests and caches when the authenticated management session changes
- docs (system): Describe runtime registry data, empty states, page refresh, and catalog refresh behavior accurately
- test (release): Run the Bun test suite before building the release asset
- fix (compat): Require CLIProxyAPI v7.2.67-aug.2 for the paired credential-source privacy release

### Compatibility

- This panel requires CLIProxyAPI v7.2.67-aug.2 or newer
- Dashboard keeps its public `/v1/models` request; provider model discovery keeps its authenticated Management
  `/api-call` proxy flow and provider-specific model endpoints
- The release asset remains `management.html`; deployment paths do not change

---

### 版本依据

- 上游语义基线：v1.17.14
- 上一个本地版本：v1.17.14-aug.1
- 本地发布版本：v1.17.14-aug.2
- 要求的后端版本：CLIProxyAPI v7.2.67-aug.2 或更新

### 更新内容

- fix (system)：通过已认证的 Management API 读取当前服务注册的运行时模型，不再用脱敏后的代理 API Key 请求公共 `/v1/models`
- fix (system)：管理认证会话变化时取消并清理模型请求与缓存
- docs (system)：准确说明运行时注册数据、空状态、页面刷新与模型目录刷新行为
- test (release)：构建 release 资产前执行 Bun 测试
- fix (compat)：配套使用统计 credential source 隐私修复，最低后端版本提升到 CLIProxyAPI v7.2.67-aug.2

### 兼容性

- 本面板要求 CLIProxyAPI v7.2.67-aug.2 或更新
- 仪表盘继续请求公共 `/v1/models`；provider 模型发现继续通过已认证的 Management `/api-call` 代理调用 provider 专用模型接口
- release 资产仍为 `management.html`，部署路径不变

## v1.17.14-aug.1 - 2026-07-31

### Release Basis

- Upstream semantic basis: v1.17.14
- Previous local release: v1.17.10-aug.1
- Local release: v1.17.14-aug.1
- Required server: CLIProxyAPI v7.2.67-aug.1 or newer

### What's Changed

- feat (xai): Display xAI weekly billing periods, reset timing, and quota usage from the server
- feat (providers): Add provider quick-fill presets that update only the Base URL and preserve unsaved drafts while
  concurrent data refreshes complete
- feat (config): Manage image artifact cache settings through the visual configuration editor without overwriting
  concurrent server changes when those fields were not edited
- feat (plugins): Validate plugin releases, query private repositories through server-side store authentication, and
  allow an explicit release version to be selected before installation
- fix (models): Cancel stale model and API-key requests so older responses cannot replace newer selections
- fix (auth-files): Preserve explicit false values in credential mappings instead of treating them as missing
- fix (usage): Preserve multi-key filters, redact request-log data, load model prices only from the server, and poll
  background historical repricing to completion
- fix (compat): Require CLIProxyAPI v7.2.67-aug.1 and compare augmented versions independently of their semantic base

### Compatibility

- This panel requires CLIProxyAPI v7.2.67-aug.1 because it uses the new model-catalog, usage backup, artifact cache,
  plugin release, and asynchronous repricing management APIs
- Saving model prices returns before historical repricing finishes; the Usage page displays progress and refreshes
  totals after the server reports completion
- The release asset remains `management.html`; deployment paths do not change

---

### 版本依据

- 上游语义基线：v1.17.14
- 上一个本地版本：v1.17.10-aug.1
- 本地发布版本：v1.17.14-aug.1
- 要求的后端版本：CLIProxyAPI v7.2.67-aug.1 或更新

### 更新内容

- feat (xai)：展示后端返回的 xAI 周账期、重置时间和 quota 使用情况
- feat (providers)：新增只修改 Base URL 的 provider 快速填充预设，并在并发数据刷新期间保留未保存草稿
- feat (config)：通过可视化配置编辑器管理图片 artifact cache 配置，未编辑这些字段时保留服务端并发修改
- feat (plugins)：校验 plugin release，通过后端 store 认证查询私有仓库，并允许安装前明确选择 release 版本
- fix (models)：取消过期的模型和 API Key 请求，避免旧响应覆盖较新的选择
- fix (auth-files)：保留凭证映射中的显式 false 值，不再把它们当作缺失字段
- fix (usage)：保留多 API Key 筛选、对请求日志数据脱敏、只从后端加载模型价格，并轮询后台历史费用重算直到完成
- fix (compat)：最低后端版本提升到 CLIProxyAPI v7.2.67-aug.1，augmented 版本号独立于语义基线进行比较

### 兼容性

- 本面板要求 CLIProxyAPI v7.2.67-aug.1，因为使用了新的模型目录、使用量备份、artifact cache、plugin release 和异步费用重算管理
  API
- 保存模型价格后不等待历史费用重算，Usage 页面会显示进度，并在后端报告完成后刷新统计结果
- release 资产仍为 `management.html`，部署路径不变

## v1.17.10-aug.1 - 2026-07-07

### Release Basis

- Upstream: v1.17.10
- Previous local release: v1.15.3-aug.1
- Local release: v1.17.10-aug.1
- Required server: CLIProxyAPI v7.2.50-aug.1 or newer

### What's Changed

- chore (deps): Upgrade frontend dependencies and keep the Bun/Vite single-file build current
- feat (plugins): Add plugin store and plugin resource pages with management API integration
- feat (config): Redesign the visual config editor with searchable indexed fields, collapsible sections, and expanded
  validation
- feat (credentials): Add provider health summaries, quota-aware credential cards, iFlow Cookie secret input, and richer
  account inspection states
- feat (logs): Add request-log cursor support, trace resolution, redacted table/filter/copy/raw/download output, and
  request detail improvements
- feat (system): Improve version history, update checks, notification dedupe, and security/quota notification handling
- refactor (ui): Update shared components, provider utilities, model tree handling, styles, and locale coverage
- refactor (ampcode): Remove Amp management UI, service client, type definitions, and icon

### Breaking Changes

- The panel now requires CLIProxyAPI v7.2.50-aug.1 or newer for the expanded management API surface
- Amp management UI is removed in this release
- The release asset remains `management.html`; deployment paths do not change

---

### 版本依据

- 上游版本：v1.17.10
- 上一个本地版本：v1.15.3-aug.1
- 本地发布版本：v1.17.10-aug.1
- 要求的后端版本：CLIProxyAPI v7.2.50-aug.1 或更新

### 更新内容

- chore (deps)：升级前端依赖，并保持 Bun/Vite 单文件构建链路更新
- feat (plugins)：新增插件商店和插件资源页面，并接入管理 API
- feat (config)：重设计可视化配置编辑器，新增可搜索字段索引、折叠分区和更完整校验
- feat (credentials)：新增 provider 健康汇总、quota 感知凭证卡片、iFlow Cookie 密文输入和更完整账号巡检状态
- feat (logs)：新增请求日志游标、trace 解析、表格/filter/copy/raw/download 脱敏和请求详情改进
- feat (system)：改进版本历史、更新检查、通知去重和安全/quota 通知处理
- refactor (ui)：更新共享组件、provider 工具、模型树处理、样式和多语言覆盖
- refactor (ampcode)：移除 Amp 管理界面、service client、类型定义和图标

### 不兼容变更

- 面板现在要求 CLIProxyAPI v7.2.50-aug.1 或更新，以使用扩展后的管理 API
- 本版本移除 Amp 管理界面
- release 资产仍为 `management.html`，部署路径不变

## v1.15.3-aug.1 - 2026-06-24

### Release Basis

- Upstream: v1.15.3 / 483dad6
- Previous local release: v1.12.0-aug.1
- Local release: v1.15.3-aug.1
- Required server: CLIProxyAPI v7.1.68-aug.1 or newer

### What's Changed

- chore (tooling): Switch release builds to Bun and make tag releases consume the matching changelog entry as release
  notes
- feat (management): Add model management and plugin management pages with routing and API clients
- feat (config): Expand the visual configuration editor, source configuration coverage, validation, and save/reload
  flows
- feat (credentials): Add account inspection, quota state handling, credential metadata editing, and provider-specific
  credential actions
- feat (usage): Improve request analytics, request event details, log parsing, token breakdown, model pricing, and usage
  filters
- docs: Update management-center copy and README content for the expanded panel behavior
- refactor (ui): Update shared components, table/status patterns, tabs, inputs, layout styles, and model tree utilities

### Breaking Changes

- The panel now requires CLIProxyAPI v7.1.68-aug.1 or newer for the expanded management API surface
- The release asset remains `management.html`; deployment paths do not change

---

### 版本依据

- 上游版本：v1.15.3 / 483dad6
- 上一个本地版本：v1.12.0-aug.1
- 本地发布版本：v1.15.3-aug.1
- 要求的后端版本：CLIProxyAPI v7.1.68-aug.1 或更新

### 更新内容

- chore (tooling)：切换 release 构建到 Bun，tag release 使用对应 tag 段落作为 release notes
- feat (management)：新增模型管理页和插件管理页，包含路由和 API client
- feat (config)：扩展可视化配置编辑器、源码配置覆盖、校验和保存/重载流程
- feat (credentials)：新增账号巡检、quota 状态处理、凭证元数据编辑和 provider 相关凭证操作
- feat (usage)：改进请求分析、请求事件明细、日志解析、token 分布、模型价格和使用筛选
- docs：更新管理面板说明和 README 内容，覆盖扩展后的面板行为
- refactor (ui)：更新共享组件、表格/状态模式、tabs、inputs、布局样式和模型树工具

### 不兼容变更

- 面板现在要求 CLIProxyAPI v7.1.68-aug.1 或更新，以使用扩展后的管理 API
- release 资产仍为 `management.html`，部署路径不变

## v1.12.0-aug.1 - 2026-05-27

### Release Basis

- Upstream: v1.12.0
- Local release: v1.12.0-aug.1

### What's Changed

- feat (xai): Add xAI/Grok OAuth flow, vendor registry, quota registration, and model discovery pages
- feat (i18n): Add full Traditional Chinese locale across pages and components
- feat (credentials): Add prefix proxy editor modal for inline prefix/proxy_url editing
- feat (dashboard): Update logs, auth files, quota hooks, and dashboard views with new data flows
- feat (config): Improve the visual config editor with payload validation, stable item IDs, visual save, and reload
  flows
- feat (system): Replace version switcher with a unified version card and inline version history with augmented tag
  support
- feat (usage): Expand analytics, rate-limit display, pricing data, and service health views
- refactor (ui): Rebuild shared components, Sheet table, DataStatusCard, stores, and routing
- chore (build): Upgrade Vite, TypeScript, CI workflow, and dependencies
- docs: Update README and ignore rules

---

### 版本依据

- 上游版本：v1.12.0
- 本地发布版本：v1.12.0-aug.1

### 更新内容

- feat (xai)：新增 xAI/Grok OAuth 流程、vendor registry、quota 注册和模型发现页
- feat (i18n)：全站新增繁体中文语言包
- feat (credentials)：新增 prefix proxy 编辑弹窗，支持内联编辑 prefix/proxy_url
- feat (dashboard)：更新日志、Auth file、quota hooks 和 dashboard 视图的数据流
- feat (config)：改进可视化配置编辑器，覆盖参数值校验、稳定 item ID、可视化保存和重载流程
- feat (system)：统一版本卡片替换切换器，内联版本历史支持 augmented tag
- feat (usage)：扩展分析视图、速率限制展示、价格数据和服务健康视图
- refactor (ui)：重建共享组件、Sheet 表格、DataStatusCard、stores 和路由
- chore (build)：升级 Vite、TypeScript、CI workflow 和依赖
- docs：更新 README 和 ignore 规则

## v1.10.1-aug.4 - 2026-05-27

### What's Changed

- fix (system): Force-refresh release metadata on update checks so stale cache does not show outdated version
  information

---

### 更新内容

- fix (system)：检查更新时强制刷新 release 元数据，避免缓存显示过期版本信息

## v1.10.1-aug.3 - 2026-05-27

### What's Changed

- fix (system): Correctly parse and display augmented patch tag formats in version history

---

### 更新内容

- fix (system)：版本历史正确解析并展示 augmented patch tag 格式

## v1.10.1-aug.2 - 2026-05-27

### What's Changed

- fix (system): Render release notes with proper formatting and line breaks in the system panel

---

### 更新内容

- fix (system)：系统面板中的更新说明正确渲染格式和换行

## v1.10.1-aug.1 - 2026-05-27

### Release Basis

- Upstream: v1.10.1
- Local release: v1.10.1-aug.1

### What's Changed

- feat (system): Add inline version history, one-click update checks, and augmented-tag release note viewing
- feat (logs): Match request logs by path and model, and refactor log parsing into composable hooks
- feat (config): Add source-preserving visual YAML editing, redesigned diff modal, and config reload fixes
- feat (usage): Expand per-model and per-credential stats, health grid, pricing data, and rate-limit display
- feat (credentials): Add backend-driven quota management, auth-file inline viewer, Codex WebSocket toggle, and health
  cleanup
- feat (providers): Add floating action controls, trace refresh, and xAI/Grok OAuth/model discovery scaffolding
- refactor (ui): Rebuild shared layout, presentation components, Sheet table, and DataStatusCard

---

### 版本依据

- 上游版本：v1.10.1
- 本地发布版本：v1.10.1-aug.1

### 更新内容

- feat (system)：新增内联版本历史、一键检查更新和 augmented tag release notes 查看
- feat (logs)：按路径和模型匹配请求日志，日志解析重构为可组合 hooks
- feat (config)：新增保留源 YAML 的可视化编辑、重设计 diff 弹窗和配置重载修复
- feat (usage)：扩展按模型/凭证统计、健康网格、价格数据和速率限制展示
- feat (credentials)：新增后端驱动的 quota 管理、Auth file 内联查看、Codex WebSocket 开关和健康状态清理
- feat (providers)：新增浮动操作控件、trace 刷新和 xAI/Grok OAuth/模型发现框架
- refactor (ui)：重建共享布局、展示组件、Sheet 表格和 DataStatusCard

## v1.7.16-aug.1 - 2026-05-27

### Release Basis

- Upstream: v1.7.16
- Local release: v1.7.16-aug.1

### What's Changed

- feat (usage): Add dashboard panels for request trends, token breakdown, model and credential stats, time-range
  filtering, and CSV export
- feat (pricing): Fetch model prices from the server API with localStorage fallback and a visual editor
- feat (security): Add AES-256-GCM credential storage, sessionStorage migration, and XSS hardening
- feat (credentials): Consolidate provider management with a unified editor layout, modal forms, and redesigned
  credential cards
- refactor (ui): Rebuild the component library, visual config editor, and layout system
- refactor (styles): Extract SCSS mixins, deduplicate global styles, and add font linting
- chore (build): Upgrade Vite, TypeScript, ESLint config, and dependencies

---

### 版本依据

- 上游版本：v1.7.16
- 本地发布版本：v1.7.16-aug.1

### 更新内容

- feat (usage)：新增请求趋势、token 分布、模型/凭证统计、时间范围筛选和 CSV 导出面板
- feat (pricing)：从服务端 API 拉取模型价格，带 localStorage fallback 和可视化编辑器
- feat (security)：新增 AES-256-GCM 凭证存储、sessionStorage 迁移和 XSS 加固
- feat (credentials)：用统一编辑器布局、弹窗表单和重设计凭证卡片整合 provider 管理
- refactor (ui)：重建组件库、可视化配置编辑器和布局系统
- refactor (styles)：抽取 SCSS mixins、去重全局样式并增加字体 lint
- chore (build)：升级 Vite、TypeScript、ESLint 配置和依赖
