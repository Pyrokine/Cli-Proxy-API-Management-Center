# CLI Proxy API Management Center

A single-file React Web UI for operating and troubleshooting [CLI Proxy API](https://github.com/Pyrokine/CLIProxyAPI)
through its Management API

[中文文档](README_CN.md)

- Example: https://remote.router-for.me/
- Management API base path: `/v0/management`
- Minimum compatible backend: CLIProxyAPI `v7.2.67-aug.2`

The panel manages the backend. It does not proxy model traffic

## Use the panel

### Panel managed by CLI Proxy API

CLI Proxy API serves the panel at:

```text
http://<host>:<api_port>/management.html
```

Enter the management key after opening the page. The panel derives the API address from the current URL and also accepts
a manual address

By default, CLI Proxy API downloads `management.html` from the latest release of this repository and periodically checks
for updates. The relevant backend settings are:

```yaml
remote-management:
  disable-control-panel: false
  disable-auto-update-panel: false
  panel-github-repository: "https://github.com/Pyrokine/Cli-Proxy-API-Management-Center"
```

Set `disable-auto-update-panel: true` when the deployed panel must remain fixed. Set `disable-control-panel: true` to
disable both the asset download and `/management.html` route

### Install or update `management.html` manually

Download `management.html` from a GitHub Release, or build `dist/index.html` and rename it. Place the file where CLI
Proxy API resolves its management asset:

1. `MANAGEMENT_STATIC_PATH`, when set. It may name the file itself or its containing directory
2. `<writable-data-dir>/static/management.html`, when the backend has a writable data directory
3. `<config-dir>/static/management.html` otherwise

Replacing that file updates the panel served by the backend. Reload the page to fetch the new HTML

### Run the development server

```bash
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:5173`, then connect to a CLI Proxy API instance

### Build the single-file panel

```bash
bun install --frozen-lockfile
bun run build
```

The output is `dist/index.html`. JavaScript, CSS, fonts, and other build assets are inlined by `vite-plugin-singlefile`.
The release workflow renames it to `management.html`

Use `bun run preview` instead of opening the file through `file://`, where browser CORS rules can block requests

## Connect to CLI Proxy API

The panel accepts addresses such as:

```text
localhost:8317
http://192.168.1.10:8317
https://example.com:8317
http://example.com:8317/v0/management
```

A trailing `/v0/management` is removed during normalization

The management key is sent as:

```http
Authorization: Bearer <MANAGEMENT_KEY>
```

This key protects Management API requests. It is separate from the proxy `api-keys` managed inside the panel

Remote browsers require the backend to allow remote management:

```yaml
remote-management:
  allow-remote: true
```

See the [Management API documentation](https://help.router-for.me/management/api) for authentication rules and
server-side limits

## Features

- Dashboard: connection state, backend version and build time, quick totals, and model availability
- Basic Settings: debug mode, proxy URL, retry behavior, quota fallback, usage collection, request/file logging, and
  WebSocket authentication
- API Keys: create, edit, and remove proxy client keys
- AI Providers: manage Gemini, Codex, Claude, Vertex, and OpenAI-compatible entries, including base URLs, proxies,
  headers, model aliases, excluded models, prefixes, multiple keys, and connection tests
- Claude Code configuration: keep a valid selected model; otherwise prefer DeepSeek V4.1 Flash (`deepseek-flash`), then
  `deepseek-v4-pro`, then the first configured model
- Auth Files: upload, download, delete, filter, search, inspect supported models and recent request buckets, and manage
  OAuth exclusions and model aliases
- OAuth: start supported browser or device flows, poll their state, submit callback URLs where required, and import
  iFlow cookies
- Quota Management: inspect provider quotas, refresh state through backend tasks, and view active-reset availability and
  expiration data supplied by the backend
- Usage: request and token charts, API/model/credential breakdowns, RPM/TPM windows, service health, current catalog
  prices, immutable request-time pricing receipts, and historical repricing status
- Config: edit and reload `/config.yaml` with YAML highlighting and search
- Logs: incremental polling, refresh interval controls, filtering, raw log view, clear actions, and request-error file
  downloads
- System: runtime models, catalog source and refresh metadata, image artifact cache settings, plugin releases, backend
  versions, and release history

## Technology and toolchain

- React 19.3
- TypeScript native 7.0.2 for application code, tests, type checking, and builds
- TypeScript 6 compatibility package for `typescript-eslint` only, retained until its supported compiler API includes
  TypeScript 7
- Vite 8.3 with `vite-plugin-singlefile`
- Bun 1.4.0 as the package manager and test runtime
- ESLint 10, `typescript-eslint` 8.70, and Stylelint 17
- Zustand, Axios, react-router-dom 7, Chart.js, CodeMirror 6, SCSS Modules, and i18next

The root TypeScript project includes `src` and `tests`. `vite.config.ts` is checked separately through
`tsconfig.node.json`

The build target is `ES2020`. The interface supports current Chrome, Firefox, Safari, and Edge releases, including
responsive mobile and tablet layouts

## Version and release behavior

The footer version is resolved at build time in this order:

1. `VERSION` environment variable
2. `git describe`
3. A `package.json` version other than `0.0.0`
4. `dev`

The build also embeds `__COMPAT_MIN_SERVER__`, which lets the panel report an incompatible backend

Tags matching `v*` trigger `.github/workflows/release.yml`. The workflow installs the frozen Bun lockfile, runs type
checking, ESLint, tests, and the build, then publishes `dist/management.html`

Local augmented releases use `v<upstream>-aug.N`; the first release based on a new upstream version uses `aug.1`

The panel tracks installation by attempt ID and target version, using the running backend's declared capabilities
Older backends supply their attempt ID in a validated installation acknowledgement; a lost initial acknowledgement leaves that update unconfirmed
After two minutes without confirmation, the panel shows an unconfirmed result; checking again only reads status and does not reinstall
Closing and reopening version history in the same connection retains the submitted attempt, including a late acknowledgement; changing connections clears that association
A full page reload reads the server's persisted result without reconstructing the previous submission, and a successful result refreshes the server version
The panel shows progress while active inference finishes; an older attempt or another connection cannot confirm the current installation
Negated statements such as “no schema migration” do not mark a release as breaking; explicit migration requirements and warnings remain visible

Codex cards show subscription query failures separately while retaining available quota data and the partial-update state
Credential-recorded and live subscription dates keep distinct source labels
The v1.26.0-aug.5 reset flow checks current owned credits before opening confirmation, checks again on confirmation, and requires the backend to check before consumption. At least one currently valid owned credit is required; an applicable count of zero does not replace the owned count
Old, unknown, and partial quota snapshots can start a read-only eligibility check. A subscription error does not disable that check. Expired or consumed credits do not establish eligibility; missing, invalid, or conflicting current counts block consumption. A query from yesterday never substitutes for a current check
Cancellation, changed credentials or connections, and repeated confirmation callbacks do not replay consumption. Counts are invalidated only after a confirmed reset and then refreshed. An older backend without the native read-only check cannot authorize a reset through this panel

## Security

Sensitive browser storage uses `enc::v2::` values protected with AES-256-GCM and a random 12-byte IV. The non-exportable
key is derived with PBKDF2-SHA-256 using 100,000 iterations and browser origin material

The browser security boundary still applies: same-origin scripts can access the page context and derive the same key
material. Protect the Management API, avoid untrusted scripts and extensions in the management profile, and use HTTPS
for remote access

Legacy `enc::v1::` and `plain::` values are migrated to `enc::v2::` after a successful read. If legacy data cannot be
decrypted, re-encrypted, or stored safely, the panel removes the unprotected value instead of writing plaintext. When
encrypted storage is unavailable, new sensitive values remain memory-only

## Development checks

```bash
bun install --frozen-lockfile
bun run type-check
bun run lint
bun run lint:css
bun test
bun run build
```

`bun run lint` treats warnings as failures

## Troubleshooting

- Cannot connect or receives 401: verify the API address and management key; remote access also requires
  `allow-remote: true`
- Repeated authentication failures: the backend may temporarily limit the source IP or credential
- Logs page is absent: enable file logging in Basic Settings
- A feature reports unsupported: check the backend version and whether the corresponding Management API route is enabled
- OpenAI-compatible provider test fails in the browser: verify provider network access and CORS separately from backend
  connectivity
- `/management.html` returns 404: verify that the control panel is enabled and that the resolved asset path contains
  `management.html`

## Contributing

Include the backend version, panel version, reproduction steps, screenshots for visual changes, and the relevant
development-check output in issues and pull requests

## License

[MIT](LICENSE)
