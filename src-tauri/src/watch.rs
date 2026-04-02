use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, Wry};

#[derive(Default)]
struct TrackedFileMetadata {
    tracked_path: Option<PathBuf>,
    watched_directory: Option<PathBuf>,
    last_known_disk_content: Option<String>,
    suppress_events_until: Option<Instant>,
}

pub struct FileWatchState {
    metadata: Arc<Mutex<HashMap<String, TrackedFileMetadata>>>,
    watched_directories: Mutex<HashMap<PathBuf, usize>>,
    watcher: Mutex<RecommendedWatcher>,
}

impl FileWatchState {
    pub fn new(app_handle: AppHandle<Wry>) -> notify::Result<Self> {
        let metadata = Arc::new(Mutex::new(HashMap::new()));
        let callback_metadata = Arc::clone(&metadata);
        let callback_app_handle = app_handle.clone();

        let watcher = RecommendedWatcher::new(
            move |result: notify::Result<Event>| {
                if let Ok(event) = result {
                    handle_watch_event(&callback_app_handle, &callback_metadata, event);
                }
            },
            Config::default(),
        )?;

        Ok(Self {
            metadata,
            watched_directories: Mutex::new(HashMap::new()),
            watcher: Mutex::new(watcher),
        })
    }

    pub fn set_tracked_file(
        &self,
        window_label: &str,
        file_path: Option<&str>,
        content: Option<&str>,
    ) -> Result<(), String> {
        let next_path = file_path.map(PathBuf::from);
        let next_directory = next_path
            .as_ref()
            .and_then(|path| path.parent().map(Path::to_path_buf));

        let mut watcher = self
            .watcher
            .lock()
            .map_err(|_| "The file watcher is unavailable.".to_string())?;
        let mut watched_directories = self
            .watched_directories
            .lock()
            .map_err(|_| "The file watcher is unavailable.".to_string())?;
        let mut metadata = self
            .metadata
            .lock()
            .map_err(|_| "The file watcher is unavailable.".to_string())?;

        let entry = metadata.entry(window_label.to_string()).or_default();
        let previous_directory = entry.watched_directory.clone();

        if previous_directory != next_directory {
            if let Some(directory) = previous_directory.as_ref() {
                decrement_directory_watch(&mut watcher, &mut watched_directories, directory);
            }

            if let Some(directory) = next_directory.as_ref() {
                increment_directory_watch(&mut watcher, &mut watched_directories, directory)?;
            }

            entry.watched_directory = next_directory;
        }

        entry.tracked_path = next_path;
        entry.last_known_disk_content = content.map(str::to_string);
        entry.suppress_events_until = None;
        Ok(())
    }

    pub fn remove_window(&self, window_label: &str) -> Result<(), String> {
        let mut watcher = self
            .watcher
            .lock()
            .map_err(|_| "The file watcher is unavailable.".to_string())?;
        let mut watched_directories = self
            .watched_directories
            .lock()
            .map_err(|_| "The file watcher is unavailable.".to_string())?;
        let mut metadata = self
            .metadata
            .lock()
            .map_err(|_| "The file watcher is unavailable.".to_string())?;

        if let Some(removed) = metadata.remove(window_label) {
            if let Some(directory) = removed.watched_directory.as_ref() {
                decrement_directory_watch(&mut watcher, &mut watched_directories, directory);
            }
        }

        Ok(())
    }

    pub fn suppress_tracked_file_events_if_current(
        &self,
        window_label: &str,
        path: &str,
    ) -> Result<(), String> {
        let mut metadata = self
            .metadata
            .lock()
            .map_err(|_| "The file watcher is unavailable.".to_string())?;

        if let Some(entry) = metadata.get_mut(window_label) {
            if entry
                .tracked_path
                .as_ref()
                .map(|tracked_path| compare_paths_case_insensitive(tracked_path, Path::new(path)))
                .unwrap_or(false)
            {
                entry.suppress_events_until = Some(Instant::now() + Duration::from_millis(150));
            }
        }

        Ok(())
    }

    pub fn update_tracked_content_if_current(
        &self,
        window_label: &str,
        path: &str,
        content: &str,
    ) -> Result<(), String> {
        let mut metadata = self
            .metadata
            .lock()
            .map_err(|_| "The file watcher is unavailable.".to_string())?;

        if let Some(entry) = metadata.get_mut(window_label) {
            if entry
                .tracked_path
                .as_ref()
                .map(|tracked_path| compare_paths_case_insensitive(tracked_path, Path::new(path)))
                .unwrap_or(false)
            {
                entry.last_known_disk_content = Some(content.to_string());
            }
        }

        Ok(())
    }
}

fn increment_directory_watch(
    watcher: &mut RecommendedWatcher,
    watched_directories: &mut HashMap<PathBuf, usize>,
    directory: &Path,
) -> Result<(), String> {
    if let Some(count) = watched_directories.get_mut(directory) {
        *count += 1;
        return Ok(());
    }

    watcher
        .watch(directory, RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;
    watched_directories.insert(directory.to_path_buf(), 1);
    Ok(())
}

fn decrement_directory_watch(
    watcher: &mut RecommendedWatcher,
    watched_directories: &mut HashMap<PathBuf, usize>,
    directory: &Path,
) {
    let should_unwatch = match watched_directories.get_mut(directory) {
        Some(count) if *count > 1 => {
            *count -= 1;
            false
        }
        Some(_) => true,
        None => false,
    };

    if !should_unwatch {
        return;
    }

    watched_directories.remove(directory);
    let _ = watcher.unwatch(directory);
}

fn compare_paths_case_insensitive(left: &Path, right: &Path) -> bool {
    left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
}

fn handle_watch_event(
    app_handle: &AppHandle<Wry>,
    metadata: &Arc<Mutex<HashMap<String, TrackedFileMetadata>>>,
    event: Event,
) {
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }

    let tracked_windows = {
        let Ok(metadata) = metadata.lock() else {
            return;
        };

        metadata
            .iter()
            .filter_map(|(window_label, entry)| {
                entry
                    .tracked_path
                    .clone()
                    .map(|tracked_path| (window_label.clone(), tracked_path))
            })
            .collect::<Vec<_>>()
    };

    for (window_label, tracked_path) in tracked_windows {
        let Ok(content) = fs::read_to_string(&tracked_path) else {
            continue;
        };

        let should_emit = {
            let Ok(mut metadata) = metadata.lock() else {
                return;
            };
            let Some(entry) = metadata.get_mut(&window_label) else {
                continue;
            };

            if entry
                .tracked_path
                .as_ref()
                .map(|current_path| compare_paths_case_insensitive(current_path, &tracked_path))
                .unwrap_or(false)
                == false
            {
                continue;
            }

            if entry
                .suppress_events_until
                .map(|deadline| Instant::now() < deadline)
                .unwrap_or(false)
            {
                continue;
            }
            entry.suppress_events_until = None;

            if entry
                .last_known_disk_content
                .as_deref()
                .map(|previous_content| previous_content == content.as_str())
                .unwrap_or(false)
            {
                false
            } else {
                entry.last_known_disk_content = Some(content.clone());
                true
            }
        };

        if !should_emit {
            continue;
        }

        if let Some(window) = app_handle.get_webview_window(&window_label) {
            let _ = window.emit("file-changed", content);
        }
    }
}
