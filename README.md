# CLI Proxy API Management Center

A single-file React Web UI for operating and troubleshooting [CLI Proxy API](https://github.com/Pyrokine/CLIProxyAPI)
through its Management API

[中文文档](README_CN.md)

- Example: https://remote.router-for.me/
- Management API base path: `/v0/management`
- Minimum compatible backend: CLIProxyAPI `v8.0.23-aug.1`

The panel manages the backend. It does not proxy model traffic

## Use the panel

### Panel managed by CLI Proxy API

CLI Proxy API serves the panel at:

<!--suppress HttpUrlsUsage -->

```text
http://<host>:<api_port>/management.html
```

Enter the management key after opening the page. The panel derives the API address from the current URL and also accepts
a manual address. Use HTTPS for remote sign-in.

After sign-in, the panel uses a separate 30-minute session. Reloading reuses the session, and signing out revokes it.
The new panel requires CPA to provide `/v0/management/session`. Update the backend before installing the new panel,
then enter the management key again.

When the panel file is missing, CPA can download it from the configured release source. Set `auto-check-update: true`
to check for new versions periodically.

```yaml
remote-management:
  disable-control-panel: false
  disable-auto-update-panel: false
  auto-check-update: false
  panel-github-repository: "https://github.com/Pyrokine/Cli-Proxy-API-Management-Center"
```

To pin the panel version, install it manually and set `disable-auto-update-panel: true`. Set
`disable-control-panel: true`
to disable both the asset download and `/management.html` route.

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

<!--suppress HttpUrlsUsage -->

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

## Logout and plugin resource sessions

Logout clears local authentication and page caches immediately. It uses the previous connection to call
`DELETE /v0/resource/plugins/session`, revoking the current browser's plugin resource cookie session while leaving other
browsers' sessions active. A new login to the same hostname waits for an outstanding revocation to finish, including
connections using a different scheme or port. Lock acquisition and revocation share a 30-second deadline. Browsers with
Web Locks also coordinate tabs on the same origin

A response other than 204 displays the previous server address and the failure reason. Local logout still completes.
Older backends without this endpoint display that warning; server-side revocation requires backend support for the
endpoint. Revoke a static management key by rotating it in the backend configuration

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
- Models: prices, aliases, enabled state, and channel-specific Standard, Fast, or Ultrafast selection for supported
  models
- Usage: request and token charts, API/model/credential breakdowns, RPM/TPM windows, service health, current catalog
  prices, immutable request-time pricing receipts, and historical repricing status; request details show requested and
  returned speed, the forwarded URL and model, and the upstream-reported model and provider
- Config: edit and reload `/config.yaml` with YAML highlighting and search
- Logs: incremental polling, refresh interval controls, filtering, raw log view, clear actions, and request-error file
  downloads
- System: runtime models, catalog source and refresh metadata, image artifact cache settings, plugin releases, backend
  versions, and release history

## Technology and toolchain

- React 19.3.1
- TypeScript native 7.0.2 for type checking application code, tests, and Vite configuration
- TypeScript 6 wrapper for AST-based tests and the `typescript-eslint` JavaScript backend
- Vite 8.3 with `vite-plugin-singlefile`
- Bun 1.4.4 as the package manager and test runtime
- ESLint 10, `typescript-eslint` 8.73, and Stylelint 18
- Zustand, Axios, React Router 8.5, Chart.js, CodeMirror 6, SCSS Modules, and i18next

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
Older backends supply their attempt ID in a validated installation acknowledgement; a lost initial acknowledgement
leaves that update unconfirmed
After two minutes without confirmation, the panel shows an unconfirmed result; checking again only reads status and does
not reinstall
Closing and reopening version history in the same connection retains the submitted attempt, including a late
acknowledgement; changing connections clears that association
A full page reload reads the server's persisted result without reconstructing the previous submission, and a successful
result refreshes the server version
The panel shows progress while active inference finishes; an older attempt or another connection cannot confirm the
current installation
Negated statements such as “no schema migration” do not mark a release as breaking; explicit migration requirements and
warnings remain visible

Codex cards show subscription query failures separately while retaining available quota data and the partial-update
state.
Credential-recorded and live subscription dates keep distinct source labels.
The v1.26.0-aug.6 reset flow checks current owned credits before opening confirmation and again on confirmation.
The backend must check before consumption. At least one currently valid owned credit is required; an applicable
count of zero does not replace the owned count.
Old, unknown, and partial quota snapshots can start a read-only eligibility check. A subscription error does not disable
that check. Expired or consumed credits do not establish eligibility; missing, invalid, or conflicting current counts
block consumption. A query from yesterday never substitutes for a current check
Cancellation, changed credentials or connections, and repeated confirmation callbacks do not replay consumption. Counts
are invalidated only after a confirmed reset and then refreshed. An older backend without the native read-only check
cannot authorize a reset through this panel

## Security

Remembered sessions use `enc::v3::` with AES-256-GCM and a new random IV for each write. The browser generates a random,
non-exportable key and keeps it in IndexedDB for the panel's origin. A copy of localStorage or sessionStorage alone
cannot restore a session. Scripts running on the panel's origin can use the key, so serve the management panel from a
trusted origin and use HTTPS for remote access

The panel converts `enc::v2::`, `enc::v1::` and `plain::` values after a successful read. If a legacy value cannot be
migrated safely, the panel discards it and asks for a new sign-in. If the current key is missing or unreadable, the
panel reports that it could not restore the session. When protected storage is unavailable, a new sign-in lasts only
until the page is reloaded or closed

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
