use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    App, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, State, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent, Wry,
};

use crate::{commands::OpenedFileData, watch::FileWatchState};

const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_LABEL_PREFIX: &str = "window-";
const WINDOW_STATE_FILE_NAME: &str = "window-state.json";
const DEFAULT_WINDOW_WIDTH: f64 = 960.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 720.0;
const MIN_WINDOW_WIDTH: f64 = 600.0;
const MIN_WINDOW_HEIGHT: f64 = 400.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct PersistedWindowState {
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
    #[serde(default)]
    is_maximized: bool,
}

#[derive(Clone)]
struct WindowSessionState {
    file_path: Option<String>,
    is_dirty: bool,
    is_renderer_ready: bool,
    pending_opened_file: Option<OpenedFileData>,
    zoom_factor: f64,
}

impl Default for WindowSessionState {
    fn default() -> Self {
        Self {
            file_path: None,
            is_dirty: false,
            is_renderer_ready: false,
            pending_opened_file: None,
            zoom_factor: 1.0,
        }
    }
}

#[derive(Clone, Copy)]
pub enum ZoomAction {
    Reset,
    In,
    Out,
}

#[derive(Default)]
pub struct WindowRuntimeState {
    next_window_index: Mutex<u32>,
    sessions: Mutex<HashMap<String, WindowSessionState>>,
}

impl WindowRuntimeState {
    pub fn register_window(&self, label: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        sessions.entry(label.to_string()).or_default();
        Ok(())
    }

    pub fn remove_window(&self, label: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        sessions.remove(label);
        Ok(())
    }

    pub fn set_window_file_state(
        &self,
        label: &str,
        file_path: Option<String>,
        is_dirty: bool,
    ) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        let session = sessions.entry(label.to_string()).or_default();
        session.is_dirty = is_dirty;

        // A freshly created window may receive an early "Untitled" title sync
        // before the renderer consumes its pending opened file payload.
        if file_path.is_none() && session.pending_opened_file.is_some() {
            return Ok(());
        }

        session.file_path = file_path;
        Ok(())
    }

    pub fn queue_opened_file(
        &self,
        label: &str,
        opened_file: OpenedFileData,
    ) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        let session = sessions.entry(label.to_string()).or_default();
        session.file_path = Some(opened_file.path.clone());
        session.is_dirty = false;
        session.pending_opened_file = Some(opened_file);
        Ok(())
    }

    pub fn set_renderer_ready(&self, label: &str, is_ready: bool) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        let session = sessions.entry(label.to_string()).or_default();
        session.is_renderer_ready = is_ready;
        Ok(())
    }

    pub fn take_pending_opened_file(&self, label: &str) -> Result<Option<OpenedFileData>, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        let session = sessions.entry(label.to_string()).or_default();
        Ok(session.pending_opened_file.take())
    }

    pub fn is_renderer_ready(&self, label: &str) -> Result<bool, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        Ok(sessions
            .get(label)
            .map(|session| session.is_renderer_ready)
            .unwrap_or(false))
    }

    pub fn find_window_label_for_file(&self, file_path: &str) -> Result<Option<String>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;

        Ok(sessions.iter().find_map(|(label, session)| {
            session
                .file_path
                .as_deref()
                .filter(|tracked_path| compare_paths_case_insensitive(tracked_path, file_path))
                .map(|_| label.clone())
        }))
    }

    pub fn find_reusable_untitled_window_label(&self) -> Result<Option<String>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;

        Ok(sessions.iter().find_map(|(label, session)| {
            if session.file_path.is_none() && !session.is_dirty {
                Some(label.clone())
            } else {
                None
            }
        }))
    }

    pub fn next_window_label(&self) -> Result<String, String> {
        let mut next_window_index = self
            .next_window_index
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        *next_window_index += 1;
        Ok(format!("{WINDOW_LABEL_PREFIX}{next_window_index}"))
    }

    pub fn update_zoom_factor(&self, label: &str, action: ZoomAction) -> Result<f64, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "The window state is unavailable.".to_string())?;
        let session = sessions.entry(label.to_string()).or_default();

        session.zoom_factor = match action {
            ZoomAction::Reset => 1.0,
            ZoomAction::In => (session.zoom_factor + 0.2).min(5.0),
            ZoomAction::Out => (session.zoom_factor - 0.2).max(0.2),
        };

        Ok(session.zoom_factor)
    }
}

fn compare_paths_case_insensitive(left: &str, right: &str) -> bool {
    left.to_lowercase() == right.to_lowercase()
}

fn round_window_measurement(value: f64) -> Option<f64> {
    if value.is_finite() {
        Some(value.round())
    } else {
        None
    }
}

fn parse_persisted_window_state(state: PersistedWindowState) -> Option<PersistedWindowState> {
    let width = round_window_measurement(state.width)?;
    let height = round_window_measurement(state.height)?;
    let x = state.x.and_then(round_window_measurement);
    let y = state.y.and_then(round_window_measurement);

    if width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT {
        return None;
    }

    Some(PersistedWindowState {
        x,
        y,
        width,
        height,
        is_maximized: state.is_maximized,
    })
}

fn do_rectangles_intersect(
    first_x: f64,
    first_y: f64,
    first_width: f64,
    first_height: f64,
    second_x: f64,
    second_y: f64,
    second_width: f64,
    second_height: f64,
) -> bool {
    first_x < second_x + second_width
        && first_x + first_width > second_x
        && first_y < second_y + second_height
        && first_y + first_height > second_y
}

fn logical_monitor_work_area(monitor: &Monitor) -> (f64, f64, f64, f64) {
    let scale_factor = monitor.scale_factor();
    let work_area = monitor.work_area();

    (
        f64::from(work_area.position.x) / scale_factor,
        f64::from(work_area.position.y) / scale_factor,
        f64::from(work_area.size.width) / scale_factor,
        f64::from(work_area.size.height) / scale_factor,
    )
}

fn has_visible_window_position(app_handle: &AppHandle<Wry>, state: &PersistedWindowState) -> bool {
    let (Some(x), Some(y)) = (state.x, state.y) else {
        return false;
    };

    let Ok(monitors) = app_handle.available_monitors() else {
        return false;
    };

    monitors.into_iter().any(|monitor| {
        let (monitor_x, monitor_y, monitor_width, monitor_height) =
            logical_monitor_work_area(&monitor);

        do_rectangles_intersect(
            x,
            y,
            state.width,
            state.height,
            monitor_x,
            monitor_y,
            monitor_width,
            monitor_height,
        )
    })
}

fn window_state_path(app_handle: &AppHandle<Wry>) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|dir| dir.join(WINDOW_STATE_FILE_NAME))
        .map_err(|error| error.to_string())
}

fn load_window_state(app_handle: &AppHandle<Wry>) -> Option<PersistedWindowState> {
    let path = window_state_path(app_handle).ok()?;
    let contents = fs::read_to_string(path).ok()?;
    let state = serde_json::from_str::<PersistedWindowState>(&contents).ok()?;
    parse_persisted_window_state(state)
}

fn default_window_state(app_handle: &AppHandle<Wry>) -> PersistedWindowState {
    let window_config = main_window_config(app_handle).ok();

    let width = window_config
        .as_ref()
        .and_then(|config| round_window_measurement(config.width))
        .filter(|width| *width >= MIN_WINDOW_WIDTH)
        .unwrap_or(DEFAULT_WINDOW_WIDTH);
    let height = window_config
        .as_ref()
        .and_then(|config| round_window_measurement(config.height))
        .filter(|height| *height >= MIN_WINDOW_HEIGHT)
        .unwrap_or(DEFAULT_WINDOW_HEIGHT);

    PersistedWindowState {
        x: None,
        y: None,
        width,
        height,
        is_maximized: window_config
            .map(|config| config.maximized)
            .unwrap_or(false),
    }
}

fn persist_window_state(
    app_handle: &AppHandle<Wry>,
    state: &PersistedWindowState,
) -> Result<(), String> {
    let path = window_state_path(app_handle)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let contents = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn capture_window_state(window: &WebviewWindow<Wry>) -> Result<PersistedWindowState, String> {
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale_factor);
    let position = window
        .outer_position()
        .ok()
        .map(|position| position.to_logical::<f64>(scale_factor));
    let width = round_window_measurement(size.width)
        .ok_or_else(|| "The window width is unavailable.".to_string())?;
    let height = round_window_measurement(size.height)
        .ok_or_else(|| "The window height is unavailable.".to_string())?;

    if width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT {
        return Err("The window bounds are invalid.".to_string());
    }

    Ok(PersistedWindowState {
        x: position
            .as_ref()
            .and_then(|position| round_window_measurement(position.x)),
        y: position
            .as_ref()
            .and_then(|position| round_window_measurement(position.y)),
        width,
        height,
        is_maximized: false,
    })
}

fn persist_current_window_state(window: &WebviewWindow<Wry>) {
    let app_handle = window.app_handle();
    let is_maximized = match window.is_maximized() {
        Ok(value) => value,
        Err(_) => return,
    };

    if is_maximized {
        let mut state =
            load_window_state(&app_handle).unwrap_or_else(|| default_window_state(&app_handle));
        state.is_maximized = true;
        let _ = persist_window_state(&app_handle, &state);
        return;
    }

    let Ok(mut state) = capture_window_state(window) else {
        return;
    };

    state.is_maximized = false;
    let _ = persist_window_state(&app_handle, &state);
}

fn apply_saved_window_state_to_config(
    app_handle: &AppHandle<Wry>,
    window_config: &mut tauri::utils::config::WindowConfig,
) {
    let Some(state) = load_window_state(app_handle) else {
        return;
    };

    window_config.width = state.width;
    window_config.height = state.height;
    window_config.maximized = state.is_maximized;

    if has_visible_window_position(app_handle, &state) {
        window_config.x = state.x;
        window_config.y = state.y;
        window_config.center = false;
        return;
    }

    window_config.x = None;
    window_config.y = None;
    window_config.center = !state.is_maximized;
}

fn restore_existing_window_state(window: &WebviewWindow<Wry>) {
    let app_handle = window.app_handle();
    let Some(state) = load_window_state(&app_handle) else {
        return;
    };

    let _ = window.set_size(LogicalSize::new(state.width, state.height));

    if has_visible_window_position(&app_handle, &state) {
        if let (Some(x), Some(y)) = (state.x, state.y) {
            let _ = window.set_position(LogicalPosition::new(x, y));
        }
    } else if !state.is_maximized {
        let _ = window.center();
    }

    if state.is_maximized {
        let _ = window.maximize();
    }
}

fn show_and_focus_window(window: &WebviewWindow<Wry>) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn attach_window_lifecycle(window: &WebviewWindow<Wry>) {
    let app_handle = window.app_handle().clone();
    let label = window.label().to_string();
    let window_handle = window.clone();

    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::CloseRequested { .. }
                | WindowEvent::Destroyed
        ) {
            persist_current_window_state(&window_handle);
        }

        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }

        let window_state = app_handle.state::<WindowRuntimeState>();
        let _ = window_state.remove_window(&label);

        let watch_state = app_handle.state::<FileWatchState>();
        let _ = watch_state.remove_window(&label);
    });
}

fn register_window(window: &WebviewWindow<Wry>) -> Result<(), String> {
    let label = window.label().to_string();
    let window_state = window.app_handle().state::<WindowRuntimeState>();
    window_state.register_window(&label)?;
    attach_window_lifecycle(window);
    Ok(())
}

fn main_window_config(
    app_handle: &AppHandle<Wry>,
) -> Result<tauri::utils::config::WindowConfig, String> {
    app_handle
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or_else(|| "The main window configuration is unavailable.".to_string())
}

fn build_window(
    app_handle: &AppHandle<Wry>,
    label: String,
    pending_opened_file: Option<OpenedFileData>,
) -> Result<WebviewWindow<Wry>, String> {
    let mut window_config = main_window_config(app_handle)?;
    window_config.label = label.clone();
    apply_saved_window_state_to_config(app_handle, &mut window_config);

    let window_state = app_handle.state::<WindowRuntimeState>();
    window_state.register_window(&label)?;
    window_state.set_renderer_ready(&label, false)?;

    if let Some(opened_file) = pending_opened_file.clone() {
        window_state.queue_opened_file(&label, opened_file)?;
    }

    let window = match WebviewWindowBuilder::from_config(app_handle, &window_config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())
    {
        Ok(window) => window,
        Err(error) => {
            let _ = window_state.remove_window(&label);
            return Err(error);
        }
    };

    attach_window_lifecycle(&window);
    Ok(window)
}

fn create_window_for_opened_file(
    app_handle: &AppHandle<Wry>,
    opened_file: OpenedFileData,
) -> Result<WebviewWindow<Wry>, String> {
    if app_handle.webview_windows().is_empty() {
        return build_window(app_handle, MAIN_WINDOW_LABEL.to_string(), Some(opened_file));
    }

    let window_state = app_handle.state::<WindowRuntimeState>();
    let label = window_state.next_window_label()?;
    build_window(app_handle, label, Some(opened_file))
}

fn load_opened_file(path: PathBuf) -> Result<OpenedFileData, String> {
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;

    Ok(OpenedFileData {
        path: path.to_string_lossy().into_owned(),
        content,
    })
}

fn deliver_opened_file_to_window(
    app_handle: &AppHandle<Wry>,
    label: &str,
    opened_file: OpenedFileData,
) -> Result<(), String> {
    let window_state = app_handle.state::<WindowRuntimeState>();
    let is_renderer_ready = window_state.is_renderer_ready(label)?;

    if is_renderer_ready {
        window_state.set_window_file_state(label, Some(opened_file.path.clone()), false)?;
    } else {
        window_state.queue_opened_file(label, opened_file.clone())?;
    }

    if let Some(window) = app_handle.get_webview_window(label) {
        if is_renderer_ready {
            let _ = window.emit("file-opened", opened_file);
        }

        show_and_focus_window(&window);
    }

    Ok(())
}

fn focus_existing_window(app_handle: &AppHandle<Wry>, label: &str) -> bool {
    if let Some(window) = app_handle.get_webview_window(label) {
        show_and_focus_window(&window);
        return true;
    }

    false
}

pub fn initialize_main_window(app: &App<Wry>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        restore_existing_window_state(&window);
        let _ = register_window(&window);
    }
}

pub fn ensure_main_window(app_handle: &AppHandle<Wry>) -> Result<WebviewWindow<Wry>, String> {
    if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
        return Ok(window);
    }

    build_window(app_handle, MAIN_WINDOW_LABEL.to_string(), None)
}

pub fn create_empty_window(app_handle: &AppHandle<Wry>) -> Result<WebviewWindow<Wry>, String> {
    if app_handle.webview_windows().is_empty() {
        return ensure_main_window(app_handle);
    }

    let window_state = app_handle.state::<WindowRuntimeState>();
    let label = window_state.next_window_label()?;
    build_window(app_handle, label, None)
}

pub fn restore_window_on_reopen(app_handle: &AppHandle<Wry>) {
    if let Some(window) = app_handle.webview_windows().into_values().next() {
        show_and_focus_window(&window);
        return;
    }

    if let Ok(window) = ensure_main_window(app_handle) {
        show_and_focus_window(&window);
    }
}

pub fn show_window(window: &WebviewWindow<Wry>) {
    show_and_focus_window(window);
}

pub fn apply_zoom_action(window: &WebviewWindow<Wry>, action: ZoomAction) -> Result<(), String> {
    let label = window.label().to_string();
    let window_state = window.app_handle().state::<WindowRuntimeState>();
    let zoom_factor = window_state.update_zoom_factor(&label, action)?;
    window
        .set_zoom(zoom_factor)
        .map_err(|error| error.to_string())
}

pub fn handle_open_path(app_handle: &AppHandle<Wry>, path: PathBuf) {
    let Ok(opened_file) = load_opened_file(path) else {
        return;
    };

    let window_state = app_handle.state::<WindowRuntimeState>();

    if let Ok(Some(existing_label)) = window_state.find_window_label_for_file(&opened_file.path) {
        if focus_existing_window(app_handle, &existing_label) {
            return;
        }
    }

    if let Ok(Some(reusable_label)) = window_state.find_reusable_untitled_window_label() {
        if deliver_opened_file_to_window(app_handle, &reusable_label, opened_file.clone()).is_ok() {
            return;
        }
    }

    if let Ok(window) = create_window_for_opened_file(app_handle, opened_file) {
        show_and_focus_window(&window);
    }
}

pub fn handle_open_paths<I>(app_handle: &AppHandle<Wry>, paths: I)
where
    I: IntoIterator<Item = PathBuf>,
{
    for path in paths.into_iter().filter(|path| path.is_file()) {
        handle_open_path(app_handle, path);
    }
}

#[tauri::command]
pub fn renderer_ready(
    window: Window,
    window_state: State<'_, WindowRuntimeState>,
) -> Result<Option<OpenedFileData>, String> {
    let label = window.label().to_string();
    window_state.set_renderer_ready(&label, true)?;
    window_state.take_pending_opened_file(&label)
}
