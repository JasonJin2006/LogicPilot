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

```text
# 1. build the frontend
pnpm --filter @logicpilot/ide build

# 2. build the Tauri shell (requires Rust + cargo)
cargo build --manifest-path desktop/src-tauri/Cargo.toml

# 3. run
desktop/src-tauri/target/debug/logicpilot-desktop.exe
```

## Self-contained bundle runtime

The distributable does not use a machine-wide Node installation or repository
build directory. Stage its version-matched resources first:

```text
cmake --preset windows-msvc-release
cmake --build --preset windows-msvc-release --target lpcli lp-server
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

The app server prints `LOGICPILOT_PORT <http>` / `LOGICPILOT_WS_PORT <ws>` on
stdout; it shuts its gateway down when the desktop process exits.
