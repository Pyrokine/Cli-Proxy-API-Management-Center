# Changelog

## v1.17.14-aug.1 - 2026-07-31

### Release Basis

- Upstream semantic basis: v1.17.14
- Previous local release: v1.17.10-aug.1
- Local release: v1.17.14-aug.1
- Required server: CLIProxyAPI v7.2.67-aug.1 or newer

### What's Changed

- feat(xai): Display xAI weekly billing periods, reset timing, and quota usage from the server
- feat(providers): Add provider quick-fill presets that update only the Base URL and preserve unsaved drafts while concurrent data refreshes complete
- feat(config): Manage image artifact cache settings through the visual configuration editor without overwriting concurrent server changes when those fields were not edited
- feat(plugins): Validate plugin releases, query private repositories through server-side store authentication, and allow an explicit release version to be selected before installation
- fix(models): Cancel stale model and API-key requests so older responses cannot replace newer selections
- fix(auth-files): Preserve explicit false values in credential mappings instead of treating them as missing
- fix(usage): Preserve multi-key filters, redact request-log data, load model prices only from the server, and poll background historical repricing to completion
- fix(compat): Require CLIProxyAPI v7.2.67-aug.1 and compare augmented versions independently from their semantic base

### Compatibility

- This panel requires CLIProxyAPI v7.2.67-aug.1 because it uses the new model-catalog, usage backup, artifact cache, plugin release, and asynchronous repricing management APIs
- Saving model prices returns before historical repricing finishes; the Usage page displays progress and refreshes totals after the server reports completion
- The release asset remains `management.html`; deployment paths do not change

---

### 版本依据

- 上游语义基线：v1.17.14
- 上一个本地版本：v1.17.10-aug.1
- 本地发布版本：v1.17.14-aug.1
- 要求的后端版本：CLIProxyAPI v7.2.67-aug.1 或更新

### 更新内容

- feat(xai)：展示后端返回的 xAI 周账期、重置时间和 quota 使用情况
- feat(providers)：新增只修改 Base URL 的 provider 快速填充预设，并在并发数据刷新期间保留未保存草稿
- feat(config)：通过可视化配置编辑器管理图片 artifact cache 配置，未编辑这些字段时保留服务端并发修改
- feat(plugins)：校验 plugin release，通过后端 store 认证查询私有仓库，并允许安装前明确选择 release 版本
- fix(models)：取消过期的模型和 API Key 请求，避免旧响应覆盖较新的选择
- fix(auth-files)：保留凭证映射中的显式 false 值，不再把它们当作缺失字段
- fix(usage)：保留多 API Key 筛选、对请求日志数据脱敏、只从后端加载模型价格，并轮询后台历史费用重算直到完成
- fix(compat)：最低后端版本提升到 CLIProxyAPI v7.2.67-aug.1，augmented 版本号独立于语义基线进行比较

### 兼容性

- 本面板要求 CLIProxyAPI v7.2.67-aug.1，因为使用了新的模型目录、使用量备份、artifact cache、plugin release 和异步费用重算管理 API
- 保存模型价格后不等待历史费用重算，Usage 页面会显示进度，并在后端报告完成后刷新统计结果
- release 资产仍为 `management.html`，部署路径不变

## v1.17.10-aug.1 - 2026-07-07

### Release Basis

- Upstream: v1.17.10
- Previous local release: v1.15.3-aug.1
- Local release: v1.17.10-aug.1
- Required server: CLIProxyAPI v7.2.50-aug.1 or newer

### What's Changed

- chore(deps): Upgrade frontend dependencies and keep the Bun/Vite single-file build current
- feat(plugins): Add plugin store and plugin resource pages with management API integration
- feat(config): Redesign the visual config editor with searchable indexed fields, collapsible sections, and expanded validation
- feat(credentials): Add provider health summaries, quota-aware credential cards, iFlow Cookie secret input, and richer account inspection states
- feat(logs): Add request-log cursor support, trace resolution, redacted table/filter/copy/raw/download output, and request detail improvements
- feat(system): Improve version history, update checks, notification dedupe, and security/quota notification handling
- refactor(ui): Update shared components, provider utilities, model tree handling, styles, and locale coverage
- refactor(ampcode): Remove Ampcode management UI, service client, type definitions, and icon

### Breaking Changes

- The panel now requires CLIProxyAPI v7.2.50-aug.1 or newer for the expanded management API surface
- Ampcode management UI is removed in this release
- The release asset remains `management.html`; deployment paths do not change

---

### 版本依据

- 上游版本：v1.17.10
- 上一个本地版本：v1.15.3-aug.1
- 本地发布版本：v1.17.10-aug.1
- 要求的后端版本：CLIProxyAPI v7.2.50-aug.1 或更新

### 更新内容

- chore(deps)：升级前端依赖，并保持 Bun/Vite 单文件构建链路更新
- feat(plugins)：新增插件商店和插件资源页面，并接入管理 API
- feat(config)：重设计可视化配置编辑器，新增可搜索字段索引、折叠分区和更完整校验
- feat(credentials)：新增 provider 健康汇总、quota 感知凭证卡片、iFlow Cookie 密文输入和更完整账号巡检状态
- feat(logs)：新增请求日志游标、trace 解析、表格/filter/copy/raw/download 脱敏和请求详情改进
- feat(system)：改进版本历史、更新检查、通知去重和安全/quota 通知处理
- refactor(ui)：更新共享组件、provider 工具、模型树处理、样式和多语言覆盖
- refactor(ampcode)：移除 Ampcode 管理界面、service client、类型定义和图标

### 不兼容变更

- 面板现在要求 CLIProxyAPI v7.2.50-aug.1 或更新，以使用扩展后的管理 API
- 本版本移除 Ampcode 管理界面
- release 资产仍为 `management.html`，部署路径不变

## v1.15.3-aug.1 - 2026-06-24

### Release Basis

- Upstream: v1.15.3 / 483dad6
- Previous local release: v1.12.0-aug.1
- Local release: v1.15.3-aug.1
- Required server: CLIProxyAPI v7.1.68-aug.1 or newer

### What's Changed

- chore(tooling): Switch release builds to Bun and make tag releases consume the matching changelog entry as release
  notes
- feat(management): Add model management and plugin management pages with routing and API clients
- feat(config): Expand the visual configuration editor, source configuration coverage, validation, and save/reload flows
- feat(credentials): Add account inspection, quota state handling, credential metadata editing, and provider-specific
  credential actions
- feat(usage): Improve request analytics, request event details, log parsing, token breakdown, model pricing, and usage
  filters
- docs: Update management-center copy and README content for the expanded panel behavior
- refactor(ui): Update shared components, table/status patterns, tabs, inputs, layout styles, and model tree utilities

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

- chore(tooling)：切换 release 构建到 Bun，tag release 使用对应 tag 段落作为 release notes
- feat(management)：新增模型管理页和插件管理页，包含路由和 API client
- feat(config)：扩展可视化配置编辑器、源码配置覆盖、校验和保存/重载流程
- feat(credentials)：新增账号巡检、quota 状态处理、凭证元数据编辑和 provider 相关凭证操作
- feat(usage)：改进请求分析、请求事件明细、日志解析、token 分布、模型价格和使用筛选
- docs：更新管理面板说明和 README 内容，覆盖扩展后的面板行为
- refactor(ui)：更新共享组件、表格/状态模式、tabs、inputs、布局样式和模型树工具

### 不兼容变更

- 面板现在要求 CLIProxyAPI v7.1.68-aug.1 或更新，以使用扩展后的管理 API
- release 资产仍为 `management.html`，部署路径不变

## v1.12.0-aug.1 - 2026-05-27

### Release Basis

- Upstream: v1.12.0
- Local release: v1.12.0-aug.1

### What's Changed

- feat(xai): Add xAI/Grok OAuth flow, vendor registry, quota registration, and model discovery pages
- feat(i18n): Add full Traditional Chinese locale across pages and components
- feat(credentials): Add prefix proxy editor modal for inline prefix/proxy_url editing
- feat(dashboard): Update logs, auth files, quota hooks, and dashboard views with new data flows
- feat(config): Improve the visual config editor with payload validation, stable item IDs, visual save, and reload flows
- feat(system): Replace version switcher with a unified version card and inline version history with augmented tag
  support
- feat(usage): Expand analytics, rate-limit display, pricing data, and service health views
- refactor(ui): Rebuild shared components, Sheet table, DataStatusCard, stores, and routing
- chore(build): Upgrade Vite, TypeScript, CI workflow, and dependencies
- docs: Update README and ignore rules

---

### 版本依据

- 上游版本：v1.12.0
- 本地发布版本：v1.12.0-aug.1

### 更新内容

- feat(xai)：新增 xAI/Grok OAuth 流程、vendor registry、quota 注册和模型发现页
- feat(i18n)：全站新增繁体中文语言包
- feat(credentials)：新增 prefix proxy 编辑弹窗，支持内联编辑 prefix/proxy_url
- feat(dashboard)：更新日志、Auth file、quota hooks 和 dashboard 视图的数据流
- feat(config)：改进可视化配置编辑器，覆盖参数值校验、稳定 item ID、可视化保存和重载流程
- feat(system)：统一版本卡片替换切换器，内联版本历史支持 augmented tag
- feat(usage)：扩展分析视图、速率限制展示、价格数据和服务健康视图
- refactor(ui)：重建共享组件、Sheet 表格、DataStatusCard、stores 和路由
- chore(build)：升级 Vite、TypeScript、CI workflow 和依赖
- docs：更新 README 和 ignore 规则

## v1.10.1-aug.4 - 2026-05-27

### What's Changed

- fix(system): Force-refresh release metadata on update checks so stale cache does not show outdated version information

---

### 更新内容

- fix(system)：检查更新时强制刷新 release 元数据，避免缓存显示过期版本信息

## v1.10.1-aug.3 - 2026-05-27

### What's Changed

- fix(system): Correctly parse and display augmented patch tag formats in version history

---

### 更新内容

- fix(system)：版本历史正确解析并展示 augmented patch tag 格式

## v1.10.1-aug.2 - 2026-05-27

### What's Changed

- fix(system): Render release notes with proper formatting and line breaks in the system panel

---

### 更新内容

- fix(system)：系统面板中的更新说明正确渲染格式和换行

## v1.10.1-aug.1 - 2026-05-27

### Release Basis

- Upstream: v1.10.1
- Local release: v1.10.1-aug.1

### What's Changed

- feat(system): Add inline version history, one-click update checks, and augmented-tag release note viewing
- feat(logs): Match request logs by path and model, and refactor log parsing into composable hooks
- feat(config): Add source-preserving visual YAML editing, redesigned diff modal, and config reload fixes
- feat(usage): Expand per-model and per-credential stats, health grid, pricing data, and rate-limit display
- feat(credentials): Add backend-driven quota management, auth-file inline viewer, Codex WebSocket toggle, and health
  cleanup
- feat(providers): Add floating action controls, trace refresh, and xAI/Grok OAuth/model discovery scaffolding
- refactor(ui): Rebuild shared layout, presentation components, Sheet table, and DataStatusCard

---

### 版本依据

- 上游版本：v1.10.1
- 本地发布版本：v1.10.1-aug.1

### 更新内容

- feat(system)：新增内联版本历史、一键检查更新和 augmented tag release notes 查看
- feat(logs)：按路径和模型匹配请求日志，日志解析重构为可组合 hooks
- feat(config)：新增保留源 YAML 的可视化编辑、重设计 diff 弹窗和配置重载修复
- feat(usage)：扩展按模型/凭证统计、健康网格、价格数据和速率限制展示
- feat(credentials)：新增后端驱动的 quota 管理、Auth file 内联查看、Codex WebSocket 开关和健康状态清理
- feat(providers)：新增浮动操作控件、trace 刷新和 xAI/Grok OAuth/模型发现框架
- refactor(ui)：重建共享布局、展示组件、Sheet 表格和 DataStatusCard

## v1.7.16-aug.1 - 2026-05-27

### Release Basis

- Upstream: v1.7.16
- Local release: v1.7.16-aug.1

### What's Changed

- feat(usage): Add dashboard panels for request trends, token breakdown, model and credential stats, time-range
  filtering, and CSV export
- feat(pricing): Fetch model prices from the server API with localStorage fallback and a visual editor
- feat(security): Add AES-256-GCM credential storage, sessionStorage migration, and XSS hardening
- feat(credentials): Consolidate provider management with a unified editor layout, modal forms, and redesigned
  credential cards
- refactor(ui): Rebuild the component library, visual config editor, and layout system
- refactor(styles): Extract SCSS mixins, deduplicate global styles, and add font linting
- chore(build): Upgrade Vite, TypeScript, ESLint config, and dependencies

---

### 版本依据

- 上游版本：v1.7.16
- 本地发布版本：v1.7.16-aug.1

### 更新内容

- feat(usage)：新增请求趋势、token 分布、模型/凭证统计、时间范围筛选和 CSV 导出面板
- feat(pricing)：从服务端 API 拉取模型价格，带 localStorage fallback 和可视化编辑器
- feat(security)：新增 AES-256-GCM 凭证存储、sessionStorage 迁移和 XSS 加固
- feat(credentials)：用统一编辑器布局、弹窗表单和重设计凭证卡片整合 provider 管理
- refactor(ui)：重建组件库、可视化配置编辑器和布局系统
- refactor(styles)：抽取 SCSS mixins、去重全局样式并增加字体 lint
- chore(build)：升级 Vite、TypeScript、ESLint 配置和依赖
