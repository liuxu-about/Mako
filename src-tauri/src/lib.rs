use tauri::Manager;

mod commands;
mod menu;
mod watch;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_text_file,
            commands::write_text_file,
            commands::export_pdf,
            commands::set_app_language,
            commands::set_window_title_state,
            commands::set_tracked_file_state,
            commands::read_workspace_directory,
            commands::search_workspace,
            commands::rename_workspace_file,
            commands::delete_workspace_file,
            commands::create_workspace_note,
            window::renderer_ready
        ])
        .setup(|app| {
            menu::install_menu(app, menu::AppLanguage::ZhCn)?;
            let watch_state = watch::FileWatchState::new(app.handle().clone())
                .unwrap_or_else(|error| panic!("failed to create file watcher: {error}"));
            app.manage(watch_state);
            app.manage(window::WindowRuntimeState::default());
            window::initialize_main_window(app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let startup_paths = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();

    if !startup_paths.is_empty() {
        window::handle_open_paths(app.handle(), startup_paths);
    }

    app.run(|app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .collect::<Vec<_>>();
            window::handle_open_paths(app_handle, paths);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if has_visible_windows {
                return;
            }

            window::restore_window_on_reopen(app_handle);
        }
        _ => {}
    });
}
