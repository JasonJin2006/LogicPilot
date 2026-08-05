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
}
