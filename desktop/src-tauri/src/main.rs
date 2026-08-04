// LogicPilot desktop client: spawns the app server (Node) which in turn
// manages lp-server and the AI endpoints, then opens a window on the served
// frontend. The app server reports its HTTP port on stdout as
// `LOGICPILOT_PORT <n>`.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

fn repo_root() -> PathBuf {
    if let Ok(root) = std::env::var("LOGICPILOT_ROOT") {
        return PathBuf::from(root);
    }
    // Walk up from the executable looking for app/server.mjs (repo layout:
    // desktop/src-tauri/target/<profile>/logicpilot-desktop.exe).
    let mut dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    for _ in 0..6 {
        if dir.join("app").join("server.mjs").exists() {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }
    dir
}

fn main() {
    let root = repo_root();
    let node = std::env::var("LOGICPILOT_NODE").unwrap_or_else(|_| "node".to_string());
    let script = root.join("app").join("server.mjs");

    let mut app_server = Command::new(&node)
        .arg(&script)
        .env("LOGICPILOT_ROOT", &root)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to start the LogicPilot app server");

    // Wait for the app server to report its HTTP port, then open the window.
    let window_url = {
        let stdout = app_server.stdout.take().expect("app server stdout");
        let mut reader = BufReader::new(stdout);
        let mut url = None;
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
            if let Some(port) = line.trim().strip_prefix("LOGICPILOT_PORT ") {
                url = Some(format!("http://127.0.0.1:{}", port));
                break;
            }
        }
        // Keep reading the server's stdout on a background thread: the pipe
        // must stay open (the server treats a closed stdout as "parent died"
        // and shuts its gateway down) and the buffer must not fill.
        std::thread::spawn(move || {
            let mut rest = String::new();
            loop {
                rest.clear();
                if reader.read_line(&mut rest).unwrap_or(0) == 0 {
                    break;
                }
                let trimmed = rest.trim();
                if !trimmed.is_empty() {
                    println!("[app-server] {trimmed}");
                }
            }
        });
        url.unwrap_or_else(|| {
            eprintln!("app server did not report a port");
            std::process::exit(1);
        })
    };

    let app = tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(window_url.parse().expect("invalid window url")),
            )
            .title("LogicPilot")
            .inner_size(1440.0, 900.0)
            .min_inner_size(1024.0, 700.0)
            .decorations(false)
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the LogicPilot desktop app");
    app.run(move |_app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = app_server.kill();
        }
    });
}
