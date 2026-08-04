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

Environment overrides:
- `LOGICPILOT_ROOT` — repo root (auto-detected by walking up from the exe).
- `LOGICPILOT_NODE` — node binary (default `node`).
- `LP_SERVER` — lp-server binary path (auto-detected from `build/`).

The app server prints `LOGICPILOT_PORT <http>` / `LOGICPILOT_WS_PORT <ws>` on
stdout; it shuts its gateway down when the desktop process exits.
