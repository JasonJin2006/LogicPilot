// LogicPilot desktop client: spawns the app server (Node) which in turn
// manages lp-server and the AI endpoints, then opens a window on the bundled
// frontend (tauri://localhost, so the window controls' IPC is allowed). The
// app server reports its ports on stdout; a command hands them to the page.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

static APP_ENDPOINTS: OnceLock<AppEndpoints> = OnceLock::new();

#[derive(Clone, Serialize)]
struct AppEndpoints {
    api_base: String,
    ws_url: String,
}

#[tauri::command]
fn app_config() -> AppEndpoints {
    APP_ENDPOINTS
        .get()
        .cloned()
        .expect("app endpoints not set")
}

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

    // Wait for the app server to report its ports, then hand them to the
    // frontend through the app_config command.
    let endpoints = {
        let stdout = app_server.stdout.take().expect("app server stdout");
        let mut reader = BufReader::new(stdout);
        let mut http_port = None;
        let mut ws_port = None;
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
            let trimmed = line.trim();
            if let Some(port) = trimmed.strip_prefix("LOGICPILOT_PORT ") {
                http_port = Some(port.to_string());
            } else if let Some(port) = trimmed.strip_prefix("LOGICPILOT_WS_PORT ") {
                ws_port = Some(port.to_string());
            }
            if http_port.is_some() && ws_port.is_some() {
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
        match (http_port, ws_port) {
            (Some(http_port), Some(ws_port)) => AppEndpoints {
                api_base: format!("http://127.0.0.1:{}", http_port),
                ws_url: format!("ws://127.0.0.1:{}/sim", ws_port),
            },
            _ => {
                eprintln!("app server did not report its ports");
                std::process::exit(1);
            }
        }
    };
    let _ = APP_ENDPOINTS.set(endpoints.clone());

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_config])
        .setup(move |app| {
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
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
