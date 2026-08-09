Test-only frontendDist target: `tauri.test.conf.json` points `build.frontendDist`
here so `cargo test`/`cargo build` compile on a fresh checkout without the
built IDE. The formal `tauri.conf.json` keeps pointing at
`../../web/apps/ide/dist`; never pass this directory to `tauri build`.
