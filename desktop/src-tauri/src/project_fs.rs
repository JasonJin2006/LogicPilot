// On-disk project I/O: name sanitization, relative-path validation and file
// writing used by the create_project_dir / write_project_files commands.
// Kept free of Tauri types so the path-safety rules are unit-testable.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub fn sanitize_project_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("project name is empty".to_string());
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains(['/', '\\']) {
        return Err("project name must not contain path separators".to_string());
    }
    for c in trimmed.chars() {
        if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
            return Err(format!(
                "project name contains the character '{}' which is not allowed in file names",
                c
            ));
        }
    }
    Ok(trimmed.to_string())
}

// Reject absolute paths, parent references, drive prefixes, dot segments and
// empty segments so a caller can never write outside the project directory.
pub fn validate_relative_path(rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("project file path is empty".to_string());
    }
    let path = Path::new(rel);
    if path.is_absolute() {
        return Err(format!("project file path must be relative: '{}'", rel));
    }
    for segment in rel.split(['/', '\\']) {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(format!("invalid project file path '{}'", rel));
        }
        for c in segment.chars() {
            if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                return Err(format!("invalid project file path '{}'", rel));
            }
        }
    }
    Ok(PathBuf::from(rel))
}

pub fn write_project_files_impl(
    project_dir: &Path,
    files: &HashMap<String, String>,
) -> Result<(), String> {
    for (rel, content) in files {
        let rel_path = validate_relative_path(rel)?;
        let target = project_dir.join(&rel_path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create '{}': {}", parent.display(), error))?;
        }
        std::fs::write(&target, content)
            .map_err(|error| format!("cannot write '{}': {}", target.display(), error))?;
    }
    Ok(())
}

// Read an on-disk project directory back into the bundle envelope: the raw
// logicpilot.json manifest plus every file under the project except the
// derived build/ and results/ folders. Paths are `/`-separated relative to
// the project root.
pub fn read_project_dir(
    dir: &str,
) -> Result<(String, HashMap<String, String>), String> {
    let root = Path::new(dir);
    if !root.is_absolute() {
        return Err("the project directory must be an absolute path".to_string());
    }
    if !root.is_dir() {
        return Err(format!("'{}' is not a folder", dir));
    }
    let manifest_path = root.join("logicpilot.json");
    if !manifest_path.is_file() {
        return Err(format!("'{}' has no logicpilot.json", dir));
    }
    let manifest_json = std::fs::read_to_string(&manifest_path)
        .map_err(|error| format!("cannot read '{}': {}", manifest_path.display(), error))?;
    let mut files = HashMap::new();
    collect_project_files(root, root, &mut files)?;
    Ok((manifest_json, files))
}

// List every file under the project as `/`-separated relative paths (the
// Explorer's real on-disk file tree). Unlike the bundle read, derived
// folders are kept (build/, results/) so the tree matches the folder; only
// VCS/dependency noise is skipped. No file contents are read here.
pub fn collect_project_tree(root: &Path) -> Result<Vec<String>, String> {
    if !root.is_absolute() {
        return Err("the project directory must be an absolute path".to_string());
    }
    if !root.is_dir() {
        return Err(format!("'{}' is not a folder", root.display()));
    }
    let mut paths = Vec::new();
    collect_tree_paths(root, root, &mut paths)?;
    Ok(paths)
}

fn collect_tree_paths(
    root: &Path,
    dir: &Path,
    paths: &mut Vec<String>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if matches!(name.as_str(), ".git" | "node_modules" | "target") {
                continue;
            }
            collect_tree_paths(root, &path, paths)?;
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| format!("path outside project: {}", path.display()))?
            .to_string_lossy()
            .replace('\\', "/");
        paths.push(rel);
    }
    Ok(())
}

// Read one project file as text (viewing a disk file that is not part of
// the bundle, e.g. a build artifact or a hand-added file).
pub fn read_project_file(root: &Path, rel: &str) -> Result<String, String> {
    let rel_path = validate_relative_path(rel)?;
    let target = root.join(&rel_path);
    if !target.is_file() {
        return Err(format!("'{}' is not a file", target.display()));
    }
    std::fs::read_to_string(&target)
        .map_err(|error| format!("cannot read '{}': {}", target.display(), error))
}

// Write (or overwrite) one project file; parent directories are created.
pub fn write_project_file_impl(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let rel_path = validate_relative_path(rel)?;
    let target = root.join(&rel_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create '{}': {}", parent.display(), error))?;
    }
    std::fs::write(&target, content)
        .map_err(|error| format!("cannot write '{}': {}", target.display(), error))
}

// Create one directory entry inside the project.
pub fn create_project_dir_impl(root: &Path, rel: &str) -> Result<(), String> {
    let rel_path = validate_relative_path(rel)?;
    let target = root.join(&rel_path);
    std::fs::create_dir_all(&target)
        .map_err(|error| format!("cannot create '{}': {}", target.display(), error))
}

// Rename or move a file/folder inside the project (both paths validated so
// the move can never leave the project root).
pub fn rename_project_entry_impl(
    root: &Path,
    old_rel: &str,
    new_rel: &str,
) -> Result<(), String> {
    let from = root.join(validate_relative_path(old_rel)?);
    let to = root.join(validate_relative_path(new_rel)?);
    if !from.exists() {
        return Err(format!("'{}' does not exist", from.display()));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create '{}': {}", parent.display(), error))?;
    }
    std::fs::rename(&from, &to)
        .map_err(|error| format!("cannot rename '{}': {}", from.display(), error))
}

// Delete one file or folder (recursively for folders). The relative path is
// validated first, so the delete can never escape the project root.
pub fn delete_project_entry_impl(root: &Path, rel: &str) -> Result<(), String> {
    let target = root.join(validate_relative_path(rel)?);
    if !target.exists() {
        return Err(format!("'{}' does not exist", target.display()));
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target)
            .map_err(|error| format!("cannot delete '{}': {}", target.display(), error))
    } else {
        std::fs::remove_file(&target)
            .map_err(|error| format!("cannot delete '{}': {}", target.display(), error))
    }
}

// Cheap per-file content fingerprint (FNV-1a of the bytes) used to detect
// external edits before Save, so the IDE never silently overwrites a file
// that changed on disk (project-format-v2 LP5xxx sync conflicts). Content is
// used instead of mtime because filesystem timestamp granularity varies.
pub fn collect_project_hashes(root: &Path) -> Result<HashMap<String, String>, String> {
    if !root.is_dir() {
        return Err(format!("'{}' is not a folder", root.display()));
    }
    let mut hashes = HashMap::new();
    collect_hashes_in(root, root, &mut hashes)?;
    Ok(hashes)
}

fn content_hash(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn collect_hashes_in(
    root: &Path,
    dir: &Path,
    hashes: &mut HashMap<String, String>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if matches!(name.as_str(), ".git" | "node_modules" | "target") {
                continue;
            }
            collect_hashes_in(root, &path, hashes)?;
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| format!("path outside project: {}", path.display()))?
            .to_string_lossy()
            .replace('\\', "/");
        if let Ok(content) = std::fs::read(&path) {
            hashes.insert(rel, format!("{:016x}", content_hash(&content)));
        }
    }
    Ok(())
}

fn collect_project_files(
    root: &Path,
    dir: &Path,
    files: &mut HashMap<String, String>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "build" || name == "results" {
                continue;
            }
            collect_project_files(root, &path, files)?;
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| format!("path outside project: {}", path.display()))?
            .to_string_lossy()
            .replace('\\', "/");
        if rel == "logicpilot.json" {
            continue;
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|error| format!("cannot read '{}': {}", path.display(), error))?;
        files.insert(rel, content);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_dangerous_project_names() {
        for bad in ["", ".", "..", "a/b", "a\\b", "a:b", "a*b", "a<b", "a|b", "a?b", "a\"b"] {
            assert!(sanitize_project_name(bad).is_err(), "name '{}' should be rejected", bad);
        }
        assert_eq!(sanitize_project_name("  My Factory  ").unwrap(), "My Factory");
    }

    #[test]
    fn rejects_escaping_relative_paths() {
        for bad in ["../x", "a/../../x", "/abs", "C:/x", "a/./b"] {
            assert!(
                validate_relative_path(bad).is_err(),
                "path '{}' should be rejected",
                bad
            );
        }
        assert!(validate_relative_path("model/main.lp").is_ok());
        assert!(validate_relative_path("build/.gitkeep").is_ok());
    }

    #[test]
    fn writes_files_into_the_project_dir_only() {
        let dir = std::env::temp_dir().join(format!("lp_project_fs_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut files = HashMap::new();
        files.insert("model/main.lp".to_string(), "model Test {}".to_string());
        files.insert("nested/deep/x.txt".to_string(), "hi".to_string());
        write_project_files_impl(&dir, &files).expect("write should succeed");
        assert_eq!(
            std::fs::read_to_string(dir.join("model/main.lp")).unwrap(),
            "model Test {}"
        );
        assert_eq!(std::fs::read_to_string(dir.join("nested/deep/x.txt")).unwrap(), "hi");

        let mut escaping = HashMap::new();
        escaping.insert("../escape.txt".to_string(), "x".to_string());
        assert!(write_project_files_impl(&dir, &escaping).is_err());
        assert!(!dir.parent().unwrap().join("escape.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_a_project_directory_back() {
        let dir = std::env::temp_dir().join(format!(
            "lp_project_dir_test_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("model")).unwrap();
        std::fs::create_dir_all(dir.join("build")).unwrap();
        std::fs::write(
            dir.join("logicpilot.json"),
            r#"{"schema":"logicpilot.project","name":"Demo","model":"model/main.lp","modelParts":["model/resources.lp"],"presentation":"presentation/main.canvas.json"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("model/main.lp"), "model Demo {\n}\n").unwrap();
        std::fs::write(
            dir.join("model/resources.lp"),
            "  resource Server {\n    capacity = 1\n  }\n",
        )
        .unwrap();
        std::fs::write(dir.join("build/main.lpir"), "binary").unwrap();

        let (manifest, files) = read_project_dir(&dir.to_string_lossy()).unwrap();
        assert!(manifest.contains("logicpilot.project"));
        assert!(files.contains_key("model/main.lp"));
        assert!(files.contains_key("model/resources.lp"));
        // Derived folders are skipped.
        assert!(!files.contains_key("build/main.lpir"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tree_lists_every_file_including_derived_folders() {
        let dir = std::env::temp_dir().join(format!(
            "lp_tree_test_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("model")).unwrap();
        std::fs::create_dir_all(dir.join("build")).unwrap();
        std::fs::create_dir_all(dir.join("results")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("model/main.lp"), "model M {\n}\n").unwrap();
        std::fs::write(dir.join("build/main.lpir"), "binary").unwrap();
        std::fs::write(dir.join("results/summary.json"), "{}").unwrap();
        std::fs::write(dir.join(".git/config"), "[core]").unwrap();
        std::fs::write(dir.join("node_modules/x.js"), "x").unwrap();
        std::fs::write(dir.join("notes.md"), "# notes").unwrap();

        let mut paths = collect_project_tree(&dir).unwrap();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                "build/main.lpir".to_string(),
                "model/main.lp".to_string(),
                "notes.md".to_string(),
                "results/summary.json".to_string(),
            ]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_file_loads_text_and_rejects_escaping_paths() {
        let dir = std::env::temp_dir().join(format!(
            "lp_read_test_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("build")).unwrap();
        std::fs::write(dir.join("build/main.lpir"), "ir-bytes").unwrap();

        assert_eq!(
            read_project_file(&dir, "build/main.lpir").unwrap(),
            "ir-bytes"
        );
        assert!(read_project_file(&dir, "../outside.txt").is_err());
        assert!(read_project_file(&dir, "C:\\windows\\x").is_err());
        assert!(read_project_file(&dir, "missing.txt").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_rename_delete_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "lp_mutate_test_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        write_project_file_impl(&dir, "model/main.lp", "model M {\n}\n").unwrap();
        assert!(dir.join("model/main.lp").is_file());
        // Overwrite.
        write_project_file_impl(&dir, "model/main.lp", "model N {\n}\n").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("model/main.lp")).unwrap(),
            "model N {\n}\n"
        );

        create_project_dir_impl(&dir, "notes").unwrap();
        assert!(dir.join("notes").is_dir());

        rename_project_entry_impl(&dir, "model/main.lp", "model/renamed.lp").unwrap();
        assert!(!dir.join("model/main.lp").exists());
        assert!(dir.join("model/renamed.lp").is_file());
        assert!(rename_project_entry_impl(&dir, "missing", "x").is_err());

        delete_project_entry_impl(&dir, "model/renamed.lp").unwrap();
        delete_project_entry_impl(&dir, "notes").unwrap();
        assert!(!dir.join("model/renamed.lp").exists());
        assert!(!dir.join("notes").exists());

        // Escaping paths are rejected before touching the filesystem.
        assert!(write_project_file_impl(&dir, "../escape.txt", "x").is_err());
        assert!(delete_project_entry_impl(&dir, "../outside").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hashes_change_when_a_file_is_edited() {
        let dir = std::env::temp_dir().join(format!(
            "lp_hashes_test_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("model")).unwrap();
        std::fs::write(dir.join("model/main.lp"), "model M {\n}\n").unwrap();

        let before = collect_project_hashes(&dir).unwrap();
        assert!(before.contains_key("model/main.lp"));
        let first = before["model/main.lp"].clone();
        // Same content keeps the fingerprint stable (mtime may be equal).
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.join("model/main.lp"), "model M {\n}\n").unwrap();
        let after = collect_project_hashes(&dir).unwrap();
        assert_eq!(after["model/main.lp"], first);
        // A real edit changes it.
        std::fs::write(dir.join("model/main.lp"), "model N {\n}\n").unwrap();
        let edited = collect_project_hashes(&dir).unwrap();
        assert_ne!(edited["model/main.lp"], first);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
