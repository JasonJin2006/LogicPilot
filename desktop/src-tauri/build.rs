fn main() {
    tauri_build::build();
    // Re-embed the app icon when it changes: tauri-build does not watch the
    // icons directory, so without these cargo would keep the stale icon in
    // the exe resource.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
}
