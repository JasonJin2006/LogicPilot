// On-disk project I/O: name sanitization, relative-path validation and file
// writing used by the create_project_dir / write_project_files commands.
// Kept free of Tauri types so the path-safety rules are unit-testable.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static SAVE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const MAX_PROJECT_TEXT_FILES: usize = 10_000;
const MAX_PROJECT_TEXT_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PROJECT_TEXT_BYTES: u64 = 64 * 1024 * 1024;

fn canonical_project_root(root: &Path) -> Result<PathBuf, String> {
    if !root.is_absolute() {
        return Err("the project directory must be an absolute path".to_string());
    }
    let metadata = std::fs::symlink_metadata(root)
        .map_err(|error| format!("cannot inspect '{}': {}", root.display(), error))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "project directory '{}' must not be a symbolic link or junction",
            root.display()
        ));
    }
    if !metadata.is_dir() {
        return Err(format!("'{}' is not a folder", root.display()));
    }
    std::fs::canonicalize(root)
        .map_err(|error| format!("cannot resolve '{}': {}", root.display(), error))
}

fn reject_reparse_components(root: &Path, rel: &Path) -> Result<(), String> {
    let mut current = root.to_path_buf();
    for component in rel.components() {
        current.push(component.as_os_str());
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "project path '{}' contains a symbolic link or junction",
                    rel.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(format!("cannot inspect '{}': {}", current.display(), error));
            }
        }
    }
    Ok(())
}

fn unique_sibling(root: &Path, label: &str) -> PathBuf {
    let sequence = SAVE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("project");
    root.with_file_name(format!(
        ".{}.logicpilot-{}-{}-{}",
        name,
        label,
        std::process::id(),
        sequence
    ))
}

fn copy_project_tree(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target)
        .map_err(|error| format!("cannot create '{}': {}", target.display(), error))?;
    for entry in std::fs::read_dir(source)
        .map_err(|error| format!("cannot read '{}': {}", source.display(), error))?
    {
        let entry =
            entry.map_err(|error| format!("cannot read '{}': {}", source.display(), error))?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        let metadata = std::fs::symlink_metadata(&from)
            .map_err(|error| format!("cannot inspect '{}': {}", from.display(), error))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "project contains a symbolic link or junction: '{}'",
                from.display()
            ));
        }
        if metadata.is_dir() {
            copy_project_tree(&from, &to)?;
        } else if metadata.is_file() {
            std::fs::copy(&from, &to)
                .map_err(|error| format!("cannot copy '{}': {}", from.display(), error))?;
        }
    }
    Ok(())
}

pub fn sanitize_project_name(name: &str) -> Result<String, String> {
    if name.ends_with(['.', ' ']) {
        return Err("project name must not end with a dot or space".to_string());
    }
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("project name is empty".to_string());
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains(['/', '\\']) {
        return Err("project name must not contain path separators".to_string());
    }
    if trimmed.ends_with(['.', ' ']) {
        return Err("project name must not end with a dot or space".to_string());
    }
    let base_name = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    if matches!(base_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((base_name.starts_with("COM") || base_name.starts_with("LPT"))
            && base_name[3..]
                .parse::<u8>()
                .is_ok_and(|number| (1..=9).contains(&number)))
    {
        return Err(format!("project name '{}' is reserved by Windows", trimmed));
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
    let root = canonical_project_root(project_dir)?;
    let mut validated = Vec::with_capacity(files.len());
    for (rel, content) in files {
        let rel_path = validate_relative_path(rel)?;
        reject_reparse_components(&root, &rel_path)?;
        validated.push((rel_path, content));
    }

    // Stage a complete copy beside the project. This preserves unrelated files
    // and makes a save all-or-nothing even if one write or the process fails.
    let staged = unique_sibling(&root, "save");
    if staged.exists() {
        return Err(format!(
            "temporary save path already exists: '{}'",
            staged.display()
        ));
    }
    if let Err(error) = copy_project_tree(&root, &staged) {
        let _ = std::fs::remove_dir_all(&staged);
        return Err(error);
    }
    let write_result = (|| -> Result<(), String> {
        for (rel_path, content) in validated {
            let target = staged.join(&rel_path);
            reject_reparse_components(&staged, &rel_path)?;
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("cannot create '{}': {}", parent.display(), error))?;
            }
            std::fs::write(&target, content)
                .map_err(|error| format!("cannot write '{}': {}", target.display(), error))?;
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_dir_all(&staged);
        return Err(error);
    }

    // Keep the old complete tree as a recoverable sibling snapshot. It is
    // deliberately not deleted automatically; recovery is preferable to
    // silently discarding the last known-good project.
    let backup = unique_sibling(&root, "backup");
    std::fs::rename(&root, &backup).map_err(|error| {
        let _ = std::fs::remove_dir_all(&staged);
        format!(
            "cannot create project snapshot '{}': {}",
            backup.display(),
            error
        )
    })?;
    if let Err(error) = std::fs::rename(&staged, &root) {
        let _ = std::fs::rename(&backup, &root);
        let _ = std::fs::remove_dir_all(&staged);
        return Err(format!("cannot activate staged project: {}", error));
    }
    Ok(())
}

// Read an on-disk project directory back into the bundle envelope: the raw
// logicpilot.json manifest plus every file under the project except the
// derived build/ and results/ folders. Paths are `/`-separated relative to
// the project root.
pub fn read_project_dir(dir: &str) -> Result<(String, HashMap<String, String>), String> {
    let root = canonical_project_root(Path::new(dir))?;
    let manifest_path = root.join("logicpilot.json");
    if !manifest_path.is_file() {
        return Err(format!("'{}' has no logicpilot.json", dir));
    }
    let manifest_json = std::fs::read_to_string(&manifest_path)
        .map_err(|error| format!("cannot read '{}': {}", manifest_path.display(), error))?;
    let mut files = HashMap::new();
    let mut budget = ReadBudget::default();
    collect_project_files(&root, &root, &mut files, &mut budget)?;
    Ok((manifest_json, files))
}

// List every file under the project as `/`-separated relative paths (the
// Explorer's real on-disk file tree). Unlike the bundle read, derived
// folders are kept (build/, results/) so the tree matches the folder; only
// VCS/dependency noise is skipped. No file contents are read here.
pub fn collect_project_tree(root: &Path) -> Result<Vec<String>, String> {
    let root = canonical_project_root(root)?;
    let mut paths = Vec::new();
    collect_tree_paths(&root, &root, &mut paths)?;
    Ok(paths)
}

fn collect_tree_paths(root: &Path, dir: &Path, paths: &mut Vec<String>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("cannot inspect '{}': {}", path.display(), error))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "project contains a symbolic link or junction: '{}'",
                path.display()
            ));
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if metadata.is_dir() {
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
    let root = canonical_project_root(root)?;
    let rel_path = validate_relative_path(rel)?;
    reject_reparse_components(&root, &rel_path)?;
    let target = root.join(&rel_path);
    if !target.is_file() {
        return Err(format!("'{}' is not a file", target.display()));
    }
    std::fs::read_to_string(&target)
        .map_err(|error| format!("cannot read '{}': {}", target.display(), error))
}

// Write (or overwrite) one project file; parent directories are created.
pub fn write_project_file_impl(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let root = canonical_project_root(root)?;
    let rel_path = validate_relative_path(rel)?;
    reject_reparse_components(&root, &rel_path)?;
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
    let root = canonical_project_root(root)?;
    let rel_path = validate_relative_path(rel)?;
    reject_reparse_components(&root, &rel_path)?;
    let target = root.join(&rel_path);
    std::fs::create_dir_all(&target)
        .map_err(|error| format!("cannot create '{}': {}", target.display(), error))
}

// Rename or move a file/folder inside the project (both paths validated so
// the move can never leave the project root).
pub fn rename_project_entry_impl(root: &Path, old_rel: &str, new_rel: &str) -> Result<(), String> {
    let root = canonical_project_root(root)?;
    let old_path = validate_relative_path(old_rel)?;
    let new_path = validate_relative_path(new_rel)?;
    reject_reparse_components(&root, &old_path)?;
    reject_reparse_components(&root, &new_path)?;
    let from = root.join(old_path);
    let to = root.join(new_path);
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
    let root = canonical_project_root(root)?;
    let rel_path = validate_relative_path(rel)?;
    reject_reparse_components(&root, &rel_path)?;
    let target = root.join(rel_path);
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
    let root = canonical_project_root(root)?;
    let mut hashes = HashMap::new();
    collect_hashes_in(&root, &root, &mut hashes)?;
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
        let entry = entry.map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("cannot inspect '{}': {}", path.display(), error))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "project contains a symbolic link or junction: '{}'",
                path.display()
            ));
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if metadata.is_dir() {
            if matches!(name.as_str(), ".git" | "node_modules" | "target") {
                continue;
            }
            if matches!(name.as_str(), "build" | "results") {
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

#[derive(Default)]
struct ReadBudget {
    file_count: usize,
    total_bytes: u64,
}

fn collect_project_files(
    root: &Path,
    dir: &Path,
    files: &mut HashMap<String, String>,
    budget: &mut ReadBudget,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("cannot read '{}': {}", dir.display(), error))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("cannot inspect '{}': {}", path.display(), error))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "project contains a symbolic link or junction: '{}'",
                path.display()
            ));
        }
        if metadata.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "build" || name == "results" {
                continue;
            }
            collect_project_files(root, &path, files, budget)?;
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
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("cannot read '{}': {}", path.display(), error))?;
        if bytes.len() as u64 > MAX_PROJECT_TEXT_FILE_BYTES {
            return Err(format!(
                "project file '{}' exceeds the {} MiB text-file limit",
                rel,
                MAX_PROJECT_TEXT_FILE_BYTES / (1024 * 1024)
            ));
        }
        budget.file_count += 1;
        budget.total_bytes += bytes.len() as u64;
        if budget.file_count > MAX_PROJECT_TEXT_FILES {
            return Err(format!(
                "project contains more than {} text files",
                MAX_PROJECT_TEXT_FILES
            ));
        }
        if budget.total_bytes > MAX_PROJECT_TEXT_BYTES {
            return Err(format!(
                "project text exceeds the {} MiB total limit",
                MAX_PROJECT_TEXT_BYTES / (1024 * 1024)
            ));
        }
        // Binary attachments remain valid on disk; they are simply not part
        // of the text-only bundle returned to the IDE.
        if let Ok(content) = String::from_utf8(bytes) {
            files.insert(rel, content);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_dangerous_project_names() {
        for bad in [
            "", ".", "..", "a/b", "a\\b", "a:b", "a*b", "a<b", "a|b", "a?b", "a\"b", "CON",
            "nul.txt", "COM1", "LPT9", "name.", "name ",
        ] {
            assert!(
                sanitize_project_name(bad).is_err(),
                "name '{}' should be rejected",
                bad
            );
        }
        assert_eq!(sanitize_project_name("  My Factory").unwrap(), "My Factory");
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
        std::fs::create_dir_all(&dir).unwrap();
        let mut files = HashMap::new();
        files.insert("model/main.lp".to_string(), "model Test {}".to_string());
        files.insert("nested/deep/x.txt".to_string(), "hi".to_string());
        write_project_files_impl(&dir, &files).expect("write should succeed");
        assert_eq!(
            std::fs::read_to_string(dir.join("model/main.lp")).unwrap(),
            "model Test {}"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("nested/deep/x.txt")).unwrap(),
            "hi"
        );

        let mut escaping = HashMap::new();
        escaping.insert("../escape.txt".to_string(), "x".to_string());
        assert!(write_project_files_impl(&dir, &escaping).is_err());
        assert!(!dir.parent().unwrap().join("escape.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_save_keeps_previous_tree_and_leaves_a_snapshot() {
        let dir = std::env::temp_dir().join(format!("lp_atomic_save_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("model")).unwrap();
        std::fs::write(dir.join("model/main.lp"), "old").unwrap();
        std::fs::write(dir.join("notes.txt"), "unrelated").unwrap();

        let mut files = HashMap::new();
        files.insert("model/main.lp".to_string(), "new".to_string());
        files.insert("model/extra.lp".to_string(), "extra".to_string());
        write_project_files_impl(&dir, &files).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.join("model/main.lp")).unwrap(),
            "new"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("notes.txt")).unwrap(),
            "unrelated"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("model/extra.lp")).unwrap(),
            "extra"
        );
        let parent = dir.parent().unwrap();
        let snapshots: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with(".lp_atomic_save_test_")
                            && name.contains("logicpilot-backup")
                    })
            })
            .collect();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(
            std::fs::read_to_string(snapshots[0].join("model/main.lp")).unwrap(),
            "old"
        );

        let _ = std::fs::remove_dir_all(&dir);
        for snapshot in snapshots {
            let _ = std::fs::remove_dir_all(snapshot);
        }
    }

    #[test]
    fn reads_a_project_directory_back() {
        let dir = std::env::temp_dir().join(format!("lp_project_dir_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("model")).unwrap();
        std::fs::create_dir_all(dir.join("build")).unwrap();
        std::fs::write(
            dir.join("logicpilot.json"),
            r#"{"schema":"logicpilot.project","name":"Demo","model":"model/main.lp","modelParts":["model/resources.lp"],"presentation":"presentation/main.canvas.json"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("model/main.lp"), "model Demo {\n}\n").unwrap();
        std::fs::write(dir.join("thumbnail.bin"), [0, 159, 146, 150]).unwrap();
        std::fs::write(
            dir.join("model/resources.lp"),
            "  resource Server {\n    capacity = 1\n  }\n",
        )
        .unwrap();
        std::fs::write(dir.join("build/main.lpir"), "binary").unwrap();

        let (manifest, files) = read_project_dir(&dir.to_string_lossy()).unwrap_or_else(|error| {
            panic!("read_project_dir failed: {} ({})", error, dir.display())
        });
        assert!(manifest.contains("logicpilot.project"));
        assert!(files.contains_key("model/main.lp"));
        assert!(files.contains_key("model/resources.lp"));
        assert!(!files.contains_key("thumbnail.bin"));
        // Derived folders are skipped.
        assert!(!files.contains_key("build/main.lpir"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tree_lists_every_file_including_derived_folders() {
        let dir = std::env::temp_dir().join(format!("lp_tree_test_{}", std::process::id()));
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
        let dir = std::env::temp_dir().join(format!("lp_read_test_{}", std::process::id()));
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
        let dir = std::env::temp_dir().join(format!("lp_mutate_test_{}", std::process::id()));
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
        let dir = std::env::temp_dir().join(format!("lp_hashes_test_{}", std::process::id()));
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

    #[test]
    fn reads_the_examples_call_center_project() {
        let root = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let dir = Path::new(&root)
            .join("..")
            .join("..")
            .join("examples")
            .join("call-center");
        let dir_text = dir.to_string_lossy().into_owned();
        let (manifest, files) = match read_project_dir(&dir_text) {
            Ok(result) => result,
            Err(error) => panic!("read_project_dir('{}') failed: {}", dir_text, error),
        };
        assert!(manifest.contains("CallCenter"));
        assert!(files.contains_key("model/main.lp"));
        assert!(files["model/main.lp"].starts_with("//"));
        // Agent-centric: the flow lives flat under the model root (no
        // process container scene file).
        assert!(!files.keys().any(|path| path.starts_with("model/scenes/")));
        assert!(files["model/main.lp"].contains("source Incoming"));
        assert!(files["model/main.lp"].contains("couple Incoming.out -> Wait.in"));
        assert!(files.contains_key("presentation/main.canvas.json"));
    }
}
