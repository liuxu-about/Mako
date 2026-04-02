use std::cmp::Ordering;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State, Window, Wry};

use crate::{
    menu::{self, AppLanguage},
    watch::FileWatchState,
    window::WindowRuntimeState,
};

const WORKSPACE_SEARCH_RESULT_LIMIT: usize = 80;
const EXCLUDED_WORKSPACE_DIRECTORIES: &[&str] = &[".git", "node_modules"];
const SUPPORTED_WORKSPACE_EXTENSIONS: &[&str] = &[".md", ".markdown", ".mdown", ".mkd", ".txt"];

#[derive(Clone, Serialize)]
pub struct OpenedFileData {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Serialize)]
pub struct WorkspaceEntryData {
    name: String,
    path: String,
    kind: &'static str,
}

#[derive(Serialize)]
pub struct WorkspaceDirectoryResult {
    entries: Vec<WorkspaceEntryData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
pub struct WorkspaceRenameResult {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    path: String,
    name: String,
    relative_path: String,
    excerpt: Option<String>,
    line_number: Option<usize>,
}

fn format_window_title(file_path: Option<&str>, is_dirty: bool, language: &str) -> String {
    let file_name = file_path
        .and_then(|path| Path::new(path).file_name())
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(if language == "en" { "Untitled" } else { "未命名" });
    let dirty_suffix = if is_dirty { " *" } else { "" };

    format!("{file_name}{dirty_suffix} — Mako")
}

fn compare_paths_case_insensitive(left: &Path, right: &Path) -> bool {
    left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
}

fn is_supported_workspace_file(name: &str) -> bool {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_lowercase()));

    extension
        .as_deref()
        .map(|value| SUPPORTED_WORKSPACE_EXTENSIONS.contains(&value))
        .unwrap_or(false)
}

fn should_include_workspace_entry(path: &Path, file_name: &str, is_directory: bool) -> bool {
    if file_name.starts_with('.') {
        return false;
    }

    if is_directory {
        return !EXCLUDED_WORKSPACE_DIRECTORIES.contains(&file_name);
    }

    path.is_file() && is_supported_workspace_file(file_name)
}

#[cfg(target_os = "macos")]
fn send_pdf_export_result(
    sender: &std::sync::Arc<
        std::sync::Mutex<Option<std::sync::mpsc::Sender<Result<Vec<u8>, String>>>>,
    >,
    result: Result<Vec<u8>, String>,
) {
    if let Ok(mut guard) = sender.lock() {
        if let Some(sender) = guard.take() {
            let _ = sender.send(result);
        }
    }
}

#[cfg(target_os = "macos")]
async fn export_pdf_bytes(window: Window) -> Result<Vec<u8>, String> {
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;

    use block2::RcBlock;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::WKWebView;

    let webview_window = window
        .app_handle()
        .get_webview_window(window.label())
        .ok_or_else(|| "Could not resolve the active editor webview.".to_string())?;

    let (sender, receiver) = mpsc::channel::<Result<Vec<u8>, String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));

    webview_window
        .with_webview({
            let sender = Arc::clone(&sender);
            move |webview| unsafe {
                let view: &WKWebView = &*webview.inner().cast();
                let callback_sender = Arc::clone(&sender);
                let completion_handler =
                    RcBlock::new(move |pdf_data: *mut NSData, error: *mut NSError| {
                        let result = if !error.is_null() {
                            let error = &*error;
                            Err(error.to_string())
                        } else if pdf_data.is_null() {
                            Err("WebKit returned no PDF data.".into())
                        } else {
                            Ok((&*pdf_data).to_vec())
                        };

                        send_pdf_export_result(&callback_sender, result);
                    });

                view.createPDFWithConfiguration_completionHandler(None, &completion_handler);
            }
        })
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| {
                "Timed out while waiting for WebKit to finish exporting the PDF.".to_string()
            })?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn export_pdf_bytes(_window: Window) -> Result<Vec<u8>, String> {
    Err("PDF export is currently only implemented in the macOS Tauri shell.".into())
}

fn compare_workspace_entries(left: &WorkspaceEntryData, right: &WorkspaceEntryData) -> Ordering {
    if left.kind != right.kind {
        return if left.kind == "directory" {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }

    left.name.to_lowercase().cmp(&right.name.to_lowercase())
}

fn create_workspace_search_excerpt(line: &str, query: &str) -> String {
    let normalized_line = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized_line.is_empty() {
        return String::new();
    }

    if normalized_line.is_ascii() {
        if let Some(query_index) = normalized_line.to_lowercase().find(query) {
            let context_padding = 36;
            let excerpt_start = query_index.saturating_sub(context_padding);
            let excerpt_end =
                (query_index + query.len() + context_padding).min(normalized_line.len());
            let prefix = if excerpt_start > 0 { "…" } else { "" };
            let suffix = if excerpt_end < normalized_line.len() {
                "…"
            } else {
                ""
            };
            return format!(
                "{prefix}{}{suffix}",
                &normalized_line[excerpt_start..excerpt_end]
            );
        }
    }

    let mut excerpt = normalized_line.chars().take(140).collect::<String>();
    if normalized_line.chars().count() > 140 {
        excerpt.push('…');
    }
    excerpt
}

fn is_path_within_directory(root_path: &Path, target_path: &Path) -> bool {
    target_path
        .strip_prefix(root_path)
        .map(|_| true)
        .unwrap_or(false)
}

fn read_workspace_entries_internal(
    directory_path: &Path,
) -> Result<Vec<WorkspaceEntryData>, String> {
    let directory = fs::read_dir(directory_path).map_err(|error| error.to_string())?;
    let mut entries = Vec::new();

    for entry_result in directory {
        let entry = entry_result.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if !should_include_workspace_entry(&path, name, metadata.is_dir()) {
            continue;
        }

        entries.push(WorkspaceEntryData {
            name: name.to_string(),
            path: path.to_string_lossy().into_owned(),
            kind: if metadata.is_dir() {
                "directory"
            } else {
                "file"
            },
        });
    }

    entries.sort_by(compare_workspace_entries);
    Ok(entries)
}

fn search_workspace_directory(
    workspace_root: &Path,
    directory_path: &Path,
    normalized_query: &str,
    results: &mut Vec<WorkspaceSearchResult>,
) {
    if results.len() >= WORKSPACE_SEARCH_RESULT_LIMIT {
        return;
    }

    let Ok(entries) = read_workspace_entries_internal(directory_path) else {
        return;
    };

    for entry in entries {
        if results.len() >= WORKSPACE_SEARCH_RESULT_LIMIT {
            return;
        }

        let entry_path = PathBuf::from(&entry.path);
        if entry.kind == "directory" {
            search_workspace_directory(workspace_root, &entry_path, normalized_query, results);
            continue;
        }

        let name_matches = entry.name.to_lowercase().contains(normalized_query);
        let mut excerpt = None;
        let mut line_number = None;

        if let Ok(content) = fs::read_to_string(&entry_path) {
            for (index, line) in content.lines().enumerate() {
                if !line.to_lowercase().contains(normalized_query) {
                    continue;
                }

                excerpt = Some(create_workspace_search_excerpt(line, normalized_query));
                line_number = Some(index + 1);
                break;
            }
        }

        if !name_matches && excerpt.is_none() {
            continue;
        }

        let relative_path = entry_path
            .strip_prefix(workspace_root)
            .ok()
            .map(|value| value.to_string_lossy().into_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| entry.name.clone());

        results.push(WorkspaceSearchResult {
            path: entry.path,
            name: entry.name,
            relative_path,
            excerpt,
            line_number,
        });
    }
}

fn resolve_workspace_rename_target(
    file_path: &Path,
    requested_name: &str,
) -> Result<PathBuf, String> {
    let trimmed_name = requested_name.trim();
    if trimmed_name.is_empty() {
        return Err("The file name cannot be empty.".into());
    }

    if trimmed_name.contains('/') || trimmed_name.contains('\\') {
        return Err("The file name must stay within the current folder.".into());
    }

    let current_extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let next_name = if Path::new(trimmed_name).extension().is_some() {
        trimmed_name.to_string()
    } else {
        format!("{trimmed_name}{current_extension}")
    };

    if !is_supported_workspace_file(&next_name) {
        return Err("The renamed file must keep a supported Markdown or text extension.".into());
    }

    Ok(file_path.with_file_name(next_name))
}

fn ensure_workspace_rename_target_available(
    source_path: &Path,
    target_path: &Path,
) -> Result<(), String> {
    if compare_paths_case_insensitive(source_path, target_path) {
        return Ok(());
    }

    match fs::metadata(target_path) {
        Ok(_) => Err(format!(
            "{} already exists.",
            target_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("The target file")
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn ensure_workspace_file_deletable(
    window: &Window,
    window_state: &WindowRuntimeState,
    file_path: &str,
) -> Result<(), String> {
    if let Some(existing_label) = window_state.find_window_label_for_file(file_path)? {
        if existing_label != window.label() {
            let file_name = Path::new(file_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("The file");
            return Err(format!("{file_name} is already open in another window."));
        }
    }

    let file_path = Path::new(file_path);
    if file_path.is_dir() {
        return Err("Only files can be deleted from the workspace.".into());
    }

    Ok(())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_text_file(
    window: Window,
    path: String,
    content: String,
    watch_state: State<'_, FileWatchState>,
) -> Result<(), String> {
    watch_state.suppress_tracked_file_events_if_current(window.label(), &path)?;
    fs::write(&path, &content).map_err(|error| error.to_string())?;
    watch_state.update_tracked_content_if_current(window.label(), &path, &content)?;
    Ok(())
}

#[tauri::command]
pub async fn export_pdf(window: Window, output_path: String) -> Result<(), String> {
    if output_path.trim().is_empty() {
        return Err("The PDF export path is missing.".into());
    }

    let pdf_data = export_pdf_bytes(window).await?;
    fs::write(output_path, pdf_data).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_window_title_state(
    window: Window,
    file_path: Option<String>,
    is_dirty: bool,
    language: Option<String>,
    window_state: State<'_, WindowRuntimeState>,
) -> Result<(), String> {
    window_state.set_window_file_state(window.label(), file_path.clone(), is_dirty)?;
    let language = language.unwrap_or_else(|| "zh-CN".to_string());
    window
        .set_title(&format_window_title(file_path.as_deref(), is_dirty, &language))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_app_language(app_handle: AppHandle<Wry>, language: String) -> Result<(), String> {
    menu::update_menu(&app_handle, AppLanguage::from_tag(&language)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_tracked_file_state(
    window: Window,
    file_path: Option<String>,
    content: Option<String>,
    watch_state: State<'_, FileWatchState>,
) -> Result<(), String> {
    watch_state.set_tracked_file(window.label(), file_path.as_deref(), content.as_deref())
}

#[tauri::command]
pub fn read_workspace_directory(directory_path: String) -> WorkspaceDirectoryResult {
    match read_workspace_entries_internal(Path::new(&directory_path)) {
        Ok(entries) => WorkspaceDirectoryResult {
            entries,
            error: None,
        },
        Err(error) => WorkspaceDirectoryResult {
            entries: Vec::new(),
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn search_workspace(workspace_root: String, query: String) -> Vec<WorkspaceSearchResult> {
    let normalized_query = query.trim().to_lowercase();
    if normalized_query.is_empty() {
        return Vec::new();
    }

    let workspace_root = PathBuf::from(workspace_root);
    let mut results = Vec::new();
    search_workspace_directory(
        &workspace_root,
        &workspace_root,
        &normalized_query,
        &mut results,
    );
    results
}

#[tauri::command]
pub fn rename_workspace_file(
    file_path: String,
    requested_name: String,
) -> Result<WorkspaceRenameResult, String> {
    let source_path = PathBuf::from(&file_path);
    let target_path = resolve_workspace_rename_target(&source_path, &requested_name)?;

    if source_path == target_path {
        return Ok(WorkspaceRenameResult { path: file_path });
    }

    ensure_workspace_rename_target_available(&source_path, &target_path)?;
    fs::rename(&source_path, &target_path).map_err(|error| error.to_string())?;

    Ok(WorkspaceRenameResult {
        path: target_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn delete_workspace_file(
    window: Window,
    file_path: String,
    window_state: State<'_, WindowRuntimeState>,
) -> Result<(), String> {
    if file_path.trim().is_empty() {
        return Err("The file path is missing.".into());
    }

    ensure_workspace_file_deletable(&window, window_state.inner(), &file_path)?;
    fs::remove_file(&file_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_workspace_note(
    workspace_root: String,
    preferred_directory: Option<String>,
) -> Result<OpenedFileData, String> {
    if workspace_root.trim().is_empty() {
        return Err("The workspace root is missing.".into());
    }

    let workspace_root = PathBuf::from(workspace_root);
    let preferred_directory = preferred_directory.map(PathBuf::from);
    let target_directory = preferred_directory
        .filter(|path| is_path_within_directory(&workspace_root, path))
        .unwrap_or_else(|| workspace_root.clone());

    for index in 0..1000 {
        let file_name = if index == 0 {
            "untitled.md".to_string()
        } else {
            format!("untitled-{}.md", index + 1)
        };
        let file_path = target_directory.join(&file_name);

        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file_path)
        {
            Ok(_) => {
                return Ok(OpenedFileData {
                    path: file_path.to_string_lossy().into_owned(),
                    content: String::new(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Could not find an available name for a new note in this folder.".into())
}
