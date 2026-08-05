// LogicPilot desktop client: spawns the app server (Node) which in turn
// manages lp-server and the AI endpoints, then opens a window on the bundled
// frontend (tauri://localhost, so the window controls' IPC is allowed). The
// app server reports its ports on stdout; a command hands them to the page.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

mod project_fs;
use project_fs::{sanitize_project_name, write_project_files_impl};

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

#[derive(Serialize)]
struct ProjectDirRead {
    manifest_json: String,
    files: HashMap<String, String>,
}

// ---------------------------------------------------------------------------
// Project directory I/O commands: create_project_dir materializes the blank
// *.lpproj structure on disk (logicpilot.json + model/main.lp +
// presentation/main.canvas.json + build/ + results/); write_project_files
// updates an existing project directory (File > Save). Paths come from the
// native folder picker or a previously created project; path-safety lives in
// project_fs.rs.

// Create <base_dir>/<name> with the blank project structure and the given
// files. Returns the absolute project directory on success.
#[tauri::command]
fn create_project_dir(
    base_dir: String,
    name: String,
    files: HashMap<String, String>,
) -> Result<String, String> {
    let name = sanitize_project_name(&name)?;
    let base = PathBuf::from(&base_dir);
    if !base.is_absolute() {
        return Err("the project folder must be an absolute path".to_string());
    }
    if !base.is_dir() {
        return Err(format!("'{}' is not a folder", base.display()));
    }
    let project_dir = base.join(&name);
    std::fs::create_dir_all(&project_dir)
        .map_err(|error| format!("cannot create '{}': {}", project_dir.display(), error))?;
    write_project_files_impl(&project_dir, &files)?;
    // Blank-project structure: derived artifacts and run results folders.
    let _ = std::fs::create_dir_all(project_dir.join("build"));
    let _ = std::fs::create_dir_all(project_dir.join("results"));
    // Container scene files (one per container node) live under model/scenes/.
    let _ = std::fs::create_dir_all(project_dir.join("model").join("scenes"));
    Ok(project_dir.to_string_lossy().into_owned())
}

// Write the current source files into an existing project directory
// (File > Save). Returns the project directory on success.
#[tauri::command]
fn write_project_files(
    project_dir: String,
    files: HashMap<String, String>,
) -> Result<String, String> {
    let dir = PathBuf::from(&project_dir);
    if !dir.is_absolute() {
        return Err("the project directory must be an absolute path".to_string());
    }
    if !dir.is_dir() {
        return Err(format!("'{}' is not a folder", dir.display()));
    }
    write_project_files_impl(&dir, &files)?;
    Ok(project_dir)
}

// Read an on-disk project directory back into the bundle envelope: the raw
// logicpilot.json manifest plus every project file (build/ and results/ are
// derived artifacts and are skipped). The frontend wraps this into a bundle
// for File > Open Project Folder.
#[tauri::command]
fn read_project_dir(project_dir: String) -> Result<ProjectDirRead, String> {
    let (manifest_json, files) = project_fs::read_project_dir(&project_dir)?;
    Ok(ProjectDirRead {
        manifest_json,
        files,
    })
}

// The Explorer's real file tree: every project file as a relative path.
#[tauri::command]
fn read_project_tree(project_dir: String) -> Result<Vec<String>, String> {
    project_fs::collect_project_tree(&PathBuf::from(&project_dir))
}

// Read one on-disk file as text (viewing disk files outside the bundle).
#[tauri::command]
fn read_project_file(project_dir: String, rel: String) -> Result<String, String> {
    project_fs::read_project_file(&PathBuf::from(&project_dir), &rel)
}

#[tauri::command]
fn write_project_file(project_dir: String, rel: String, content: String) -> Result<(), String> {
    project_fs::write_project_file_impl(&PathBuf::from(&project_dir), &rel, &content)
}

#[tauri::command]
fn create_directory(project_dir: String, rel: String) -> Result<(), String> {
    project_fs::create_project_dir_impl(&PathBuf::from(&project_dir), &rel)
}

#[tauri::command]
fn rename_project_entry(project_dir: String, old_rel: String, new_rel: String) -> Result<(), String> {
    project_fs::rename_project_entry_impl(&PathBuf::from(&project_dir), &old_rel, &new_rel)
}

#[tauri::command]
fn delete_project_entry(project_dir: String, rel: String) -> Result<(), String> {
    project_fs::delete_project_entry_impl(&PathBuf::from(&project_dir), &rel)
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_config,
            create_project_dir,
            write_project_files,
            read_project_dir,
            read_project_tree,
            read_project_file,
            write_project_file,
            create_directory,
            rename_project_entry,
            delete_project_entry
        ])
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
            // Match the app's dark surface so a pre-paint frame is never a
            // black flash before the webview draws its first frame.
            .background_color(tauri::window::Color(10, 14, 20, 255))
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the LogicPilot desktop app");
    app.run(move |_app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            // Kill the app server AND its gateway child. A plain kill()
            // terminates Node without letting it shut lp-server down,
            // orphaning the console-subsystem gateway (and its terminal
            // window) next to the closed app.
            #[cfg(windows)]
            {
                let pid = app_server.id().to_string();
                let _ = Command::new("taskkill")
                    .arg("/PID")
                    .arg(&pid)
                    .arg("/T")
                    .arg("/F")
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            #[cfg(not(windows))]
            {
                let _ = app_server.kill();
            }
        }
    });
}
