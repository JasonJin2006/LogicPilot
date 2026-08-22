# LogicPilot Desktop

Tauri shell around the web IDE. The desktop client:

1. spawns the Node app server (`app/server.mjs`) — it serves the built
   frontend, mounts the AI endpoints, and manages a dedicated `lp-server`
   gateway on a free port,
2. reads the HTTP port from the server's stdout and opens a WebView2 window
   on the served frontend,
3. the frontend resolves the gateway URL through `/api/config` (falling back
   to `ws://127.0.0.1:8089/sim` in the vite dev server).

The window is frameless (`decorations: false`): minimize / maximize / close
live on the IDE's own top bar, which also doubles as the drag region.

## Build & run

普通用户请参阅[桌面客户端手册](../docs/guide/desktop.md)。以下内容面向开发者。

```powershell
# 自动加载 MSVC/Windows SDK，构建原生依赖
.\scripts\windows-build.ps1 -Preset windows-msvc-dev -Test

# 无安装包的 Tauri 开发构建（requires Rust + cargo）
$env:TAURI_CONFIG = Get-Content -Raw desktop/src-tauri/tauri.test.conf.json
cargo build --locked --manifest-path desktop/src-tauri/Cargo.toml
desktop/src-tauri/target/debug/logicpilot-desktop.exe
```

`cargo build`/`cargo test` without a staged runtime: tauri-build copies
`bundle.resources` (the `../../build/desktop-runtime/` tree) at compile time
and fails when it is absent — e.g. on a fresh checkout. For tests and plain
builds, merge the test-only config (which empties `bundle.resources`) via the
`TAURI_CONFIG` environment variable:

```powershell
$env:TAURI_CONFIG = Get-Content -Raw desktop/src-tauri/tauri.test.conf.json
cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml
```

The formal `tauri.conf.json` is untouched: packaging (`pnpm desktop:bundle`)
still requires the staged runtime, and a bundle attempted without it fails at
compile time. `tauri.test.conf.json` is a test-only merge patch — never pass
it to `tauri build`.

## Self-contained bundle runtime

The distributable does not use a machine-wide Node installation or repository
build directory. Stage its version-matched resources first:

```powershell
.\scripts\windows-build.ps1 -Preset windows-msvc-release -Clean -Test
pnpm desktop:stage
pnpm desktop:test-staged
```

`build/desktop-runtime` contains the Node executable, Release native
sidecars/DLLs, frontend and AI service modules plus `runtime-manifest.json`
with the byte size and SHA-256 of every bundled file. Tauri maps that directory
to the installer resource root. The staged smoke test restricts PATH to the
staged runtime and Windows system directories before exercising a real AI DES
compile/run; it also verifies every manifest size/hash. Build the NSIS installer
with `pnpm desktop:bundle` after the Release sidecars exist.

Environment overrides (development/debugging only):

- `LOGICPILOT_ROOT` — resource/repository root (auto-detected beside an
  installed executable or by walking upward in a development build).
- `LOGICPILOT_NODE` — Node binary (defaults to bundled Node, then system Node
  only in a development layout).
- `LP_SERVER` / `LPCLI` — native binary paths (default to bundled Release
  sidecars in an installed app).

The app server prints `LOGICPILOT_PORT <http>`, `LOGICPILOT_WS_PORT <ws>` and a
random `LOGICPILOT_SESSION_TOKEN` on stdout; it shuts its gateway down when the
desktop process exits. The token is passed to the Tauri page through
`app_config` and is required by both the HTTP API and WebSocket gateway.

## Local API security boundary

The Node app server binds only to `127.0.0.1`. Its HTTP API accepts only the
actual loopback `Host`, the Tauri/loopback origins and the per-process session
token; `OPTIONS` is subject to the same host/origin check. Unknown `/api/*`
paths return JSON 404 and static resources accept only GET/HEAD. Requests are
bounded by a 16 MiB body limit, a 120 second timeout and four concurrent API
operations; additional provider-specific limits may be stricter. Do not expose
the app server through a LAN bind, reverse proxy or port forward without adding
authentication, origin/CSRF protection, rate limiting and SSRF controls for
custom AI endpoints.
