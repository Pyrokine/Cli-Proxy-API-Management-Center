# CLI Proxy API 管理中心

用于管理和排查 [CLI Proxy API](https://github.com/Pyrokine/CLIProxyAPI) 的 React 单文件 Web UI，通过 Management API
读取和修改后端状态

[English](README.md)

- 示例地址：https://remote.router-for.me/
- Management API 基础路径：`/v0/management`
- 最低兼容后端：CLIProxyAPI `v8.0.23-aug.1`

本仓库只提供管理面板，不转发模型流量

## 使用管理面板

### 使用 CLI Proxy API 管理的面板

CLI Proxy API 在以下地址提供面板：

<!--suppress HttpUrlsUsage -->

```text
http://<host>:<api_port>/management.html
```

打开页面后输入管理密钥，面板会根据当前 URL 推导 API 地址，也支持手动填写。远程登录使用 HTTPS

面板登录后使用独立的 30 分钟会话，刷新会复用当前会话，退出会撤销它。新版面板需要提供 `/v0/management/session` 的
CPA，先更新后端，再安装新版面板。原浏览器登录需要重新输入一次管理密钥

面板文件缺失时，CPA 可以从配置的发布来源下载。设置 `auto-check-update: true` 才会定期检查新版本

```yaml
remote-management:
  disable-control-panel: false
  disable-auto-update-panel: false
  auto-check-update: false
  panel-github-repository: "https://github.com/Pyrokine/Cli-Proxy-API-Management-Center"
```

需要固定版本时，手动安装面板并设置 `disable-auto-update-panel: true`。`disable-control-panel: true` 同时关闭面板文件下载和
`/management.html` 路由

### 手动安装或更新 `management.html`

从 GitHub Release 下载 `management.html`，或者构建 `dist/index.html` 后将其重命名。CLI Proxy API 按以下顺序确定管理面板文件位置：

1. 已设置的 `MANAGEMENT_STATIC_PATH`，该变量可以指向文件本身或所在目录
2. 后端存在可写数据目录时的 `<writable-data-dir>/static/management.html`
3. 其他情况下的 `<config-dir>/static/management.html`

替换该文件后，刷新页面即可获取新的 HTML

### 运行开发服务器

```bash
bun install --frozen-lockfile
bun run dev
```

打开 `http://localhost:5173`，然后连接到 CLI Proxy API 实例

### 构建单文件面板

```bash
bun install --frozen-lockfile
bun run build
```

构建产物是 `dist/index.html`。JavaScript、CSS、字体和其他构建资源由 `vite-plugin-singlefile` 内联，发布流程会将其重命名为
`management.html`

建议使用 `bun run preview` 预览。直接通过 `file://` 打开时，浏览器 CORS 规则可能阻止请求

## 连接 CLI Proxy API

面板接受以下地址格式：

<!--suppress HttpUrlsUsage -->

```text
localhost:8317
http://192.168.1.10:8317
https://example.com:8317
http://example.com:8317/v0/management
```

地址末尾的 `/v0/management` 会在归一化时移除

管理密钥按以下 Header 发送：

```http
Authorization: Bearer <MANAGEMENT_KEY>
```

管理密钥用于保护 Management API 请求，与面板中维护的代理客户端 `api-keys` 不同

从远程浏览器连接时，需要在后端允许远程管理：

```yaml
remote-management:
  allow-remote: true
```

完整认证规则和服务端限制见 [Management API 文档](https://help.router-for.me/cn/management/api)

## 退出与插件资源会话

退出立即清除本地认证与页面缓存，并使用退出前的连接请求 `DELETE /v0/resource/plugins/session`，撤销当前浏览器的插件资源
cookie 会话，其他浏览器的会话保持有效；同一主机的新登录等待既有撤销结束后继续，包括协议或端口变化的连接，等待和撤销共用 30
秒期限，支持 Web Locks 的浏览器同时协调同源标签页

撤销未返回 204 时显示原服务地址与失败原因，本地退出仍完成；旧后端缺少该接口时会显示失败提示，完整撤销需要后端提供该接口，静态管理密钥通过后端配置轮换撤销

## 功能

- 仪表盘：连接状态、后端版本与构建时间、数量概览和模型可用性
- 基础设置：调试模式、代理 URL、请求重试、配额回退、使用量收集、请求/文件日志和 WebSocket 鉴权
- API Keys：新增、编辑和删除代理客户端密钥
- AI 提供商：管理 Gemini、Codex、Claude、Vertex 和 OpenAI 兼容配置，包括 Base URL、代理、Headers、模型别名、排除模型、Prefix、多
  Key 与连接测试
- Claude Code 配置：当前选择仍有效时保持不变，否则依次选择 DeepSeek V4.1 Flash（`deepseek-flash`）、`deepseek-v4-pro`
  和配置列表中的第一个模型
- 认证文件：上传、下载、删除、筛选和搜索凭据，查看支持的模型与近期请求分桶，维护 OAuth 排除模型和模型别名
- OAuth：发起受支持的浏览器或设备码流程，轮询状态，按需提交回调 URL，并导入 iFlow Cookie
- 配额管理：查看各提供商配额，通过后端任务刷新状态，显示后端返回的主动重置可用次数与过期时间
- 模型管理：维护价格、别名和启用状态，按模型与渠道提供标准速度、Fast 或 Ultrafast 选择
- 使用统计：请求与 Token 图表、API/模型/凭证明细、RPM/TPM
  时间窗、服务健康状态、当前目录价格、请求时不可变价格凭据和历史重算状态；请求明细展示申请与返回速度、实际转发地址和模型，以及上游自报模型与渠道
- 配置文件：使用 YAML 高亮和搜索编辑、重载 `/config.yaml`
- 日志：增量轮询、刷新间隔、筛选、原始日志、清空操作和请求错误日志下载
- 系统信息：运行时模型、模型目录来源与刷新元数据、图片 artifact cache、plugin release、后端版本和发布历史

## 技术栈与工具链

- React 19.3.1
- TypeScript native 7.0.2 检查应用代码、测试和 Vite 配置的类型
- TypeScript 6 wrapper 供基于 AST 的测试和 `typescript-eslint` JavaScript 后端使用
- Vite 8.3 与 `vite-plugin-singlefile`
- Bun 1.4.4，作为包管理器和测试运行时
- ESLint 10、`typescript-eslint` 8.73 和 Stylelint 18
- Zustand、Axios、React Router 8.5、Chart.js、CodeMirror 6、SCSS Modules 和 i18next

根 TypeScript project 包含 `src` 与 `tests`，`vite.config.ts` 由 `tsconfig.node.json` 单独检查

构建目标是 `ES2020`。界面支持当前版本的 Chrome、Firefox、Safari 和 Edge，并提供手机与平板响应式布局

## 版本与发布行为

页脚版本在构建时按以下顺序确定：

1. `VERSION` 环境变量
2. `git describe`
3. 非 `0.0.0` 的 `package.json` version
4. `dev`

构建还会写入 `__COMPAT_MIN_SERVER__`，用于提示后端版本不兼容

匹配 `v*` 的 tag 会触发 `.github/workflows/release.yml`。流程会安装 frozen Bun lockfile，执行类型检查、ESLint、测试与构建，然后发布
`dist/management.html`

本地增强版本使用 `v<upstream>-aug.N`，基于新上游版本的首个本地版本从 `aug.1` 开始

面板依据当前后端声明的能力，按同一个 attempt 和目标版本查询安装结果；旧后端通过本次有效安装响应提供 attempt
ID，首次响应丢失时保留待确认状态
连续两分钟无法确认时显示“更新结果待确认”，重新查询只读取状态，不会再次安装
同一连接关闭再打开版本历史会保留提交关联，期间返回的有效安装响应仍可继续跟踪，连接改变时清除关联；整页刷新后只读取服务端保存的结果，不重建此前的提交关联，成功后刷新服务端版本
等待现有推理结束时显示对应进度，旧任务或其他连接的结果不作为本次成功证据
发行说明中“无需迁移”等否定表述不作为不兼容变更，明确的迁移要求与警告仍保留

Codex 卡片把订阅查询错误单独显示，保留已取得的额度和部分更新状态，凭证记录的订阅日期与实时查询日期分别标注来源
v1.26.0-aug.6 的重置流程在打开确认框前核查当前次数，确认时再次只读核查，后端在消费前重新检查；当前至少持有一次有效机会才允许消费，适用次数为
0 不替代持有次数
旧、未知或部分更新的配额快照可以启动只读核查，订阅查询失败不阻止该核查；过期或已消费的机会不作为有效次数，当前次数缺失、非法或冲突时停止消费，昨天查询成功不代替本次检查
取消、更换凭证或连接、重复确认均不自动重发消费，只有确认重置成功后才将旧次数字段标为未知并重新查询；缺少原生只读核查能力的旧后端不能通过新面板进入消费确认

## 安全说明

浏览器为面板所在来源生成随机、不可导出的 AES-256-GCM 密钥，保存在 IndexedDB；每次保存会话使用随机 IV，写入 `enc::v3::`
格式；单独复制 localStorage 或 sessionStorage 无法恢复会话，同源脚本仍能使用密钥；远程访问管理面板时，使用可信来源和 HTTPS

面板成功读取 `enc::v2::`、`enc::v1::` 或 `plain::` 后迁移旧值，迁移失败时要求重新登录；当前密钥无法读取时，面板会提示会话恢复失败；加密存储不可用时，刷新或关闭页面后需要重新登录

## 开发检查

```bash
bun install --frozen-lockfile
bun run type-check
bun run lint
bun run lint:css
bun test
bun run build
```

`bun run lint` 将 warning 视为失败

## 常见问题

- 无法连接或收到 401：检查 API 地址与管理密钥；远程访问还需要 `allow-remote: true`
- 反复认证失败：后端可能临时限制来源 IP 或凭证
- 日志页面不存在：在基础设置中启用文件日志
- 功能提示不支持：检查后端版本和对应 Management API 路由是否启用
- OpenAI 兼容提供商的浏览器测试失败：分别检查 Provider 网络与 CORS，不要把该结果直接等同于后端连接能力
- `/management.html` 返回 404：检查控制面板是否启用，并确认解析出的静态文件路径中存在 `management.html`

## 贡献

Issue 和 Pull Request 应包含后端版本、面板版本、复现步骤、视觉变化截图和相关开发检查输出

## 许可证

[MIT](LICENSE)
