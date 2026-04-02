use std::process::Command;

use serde::Serialize;
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{App, AppHandle, Emitter, Manager, WebviewWindow, Wry};

use crate::window::{self, ZoomAction};

const ABOUT_URL: &str = "https://github.com/marswaveai/colamd";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppLanguage {
    ZhCn,
    En,
}

impl AppLanguage {
    pub fn from_tag(value: &str) -> Self {
        if value == "en" {
            Self::En
        } else {
            Self::ZhCn
        }
    }
}

struct MenuStrings {
    settings: &'static str,
    root_file: &'static str,
    root_edit: &'static str,
    root_view: &'static str,
    root_theme: &'static str,
    root_help: &'static str,
    new_file: &'static str,
    open: &'static str,
    open_folder: &'static str,
    close_workspace: &'static str,
    refresh_workspace: &'static str,
    save: &'static str,
    save_as: &'static str,
    export_pdf: &'static str,
    toggle_sidebar: &'static str,
    show_outline: &'static str,
    toggle_source_mode: &'static str,
    actual_size: &'static str,
    zoom_in: &'static str,
    zoom_out: &'static str,
    application_theme: &'static str,
    document_theme: &'static str,
    system: &'static str,
    light: &'static str,
    dark: &'static str,
    default_theme: &'static str,
    elegant: &'static str,
    newsprint: &'static str,
    import_custom_theme: &'static str,
    about_mako: &'static str,
}

fn menu_strings(language: AppLanguage) -> MenuStrings {
    match language {
        AppLanguage::ZhCn => MenuStrings {
            settings: "设置…",
            root_file: "文件",
            root_edit: "编辑",
            root_view: "视图",
            root_theme: "主题",
            root_help: "帮助",
            new_file: "新建",
            open: "打开...",
            open_folder: "打开文件夹...",
            close_workspace: "关闭工作区",
            refresh_workspace: "刷新工作区",
            save: "保存",
            save_as: "另存为...",
            export_pdf: "导出 PDF...",
            toggle_sidebar: "切换侧边栏",
            show_outline: "显示大纲",
            toggle_source_mode: "切换源码模式",
            actual_size: "实际大小",
            zoom_in: "放大",
            zoom_out: "缩小",
            application_theme: "应用主题",
            document_theme: "文档主题",
            system: "跟随系统",
            light: "浅色",
            dark: "深色",
            default_theme: "默认",
            elegant: "典雅",
            newsprint: "报刊",
            import_custom_theme: "导入自定义主题...",
            about_mako: "关于 Mako",
        },
        AppLanguage::En => MenuStrings {
            settings: "Settings…",
            root_file: "File",
            root_edit: "Edit",
            root_view: "View",
            root_theme: "Theme",
            root_help: "Help",
            new_file: "New",
            open: "Open...",
            open_folder: "Open Folder...",
            close_workspace: "Close Workspace",
            refresh_workspace: "Refresh Workspace",
            save: "Save",
            save_as: "Save As...",
            export_pdf: "Export PDF...",
            toggle_sidebar: "Toggle Sidebar",
            show_outline: "Show Outline",
            toggle_source_mode: "Toggle Source Mode",
            actual_size: "Actual Size",
            zoom_in: "Zoom In",
            zoom_out: "Zoom Out",
            application_theme: "Application Theme",
            document_theme: "Document Theme",
            system: "System",
            light: "Light",
            dark: "Dark",
            default_theme: "Default",
            elegant: "Elegant",
            newsprint: "Newsprint",
            import_custom_theme: "Import Custom Theme...",
            about_mako: "About Mako",
        },
    }
}

fn focused_or_first_window(app: &AppHandle<Wry>) -> Option<WebviewWindow<Wry>> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| app.webview_windows().into_values().next())
}

fn emit_to_focused_window<S: Serialize + Clone>(app: &AppHandle<Wry>, event_name: &str, payload: S) {
    if let Some(window) = focused_or_first_window(app) {
        let _ = window.emit(event_name, payload.clone());
    }
}

fn open_about_link() {
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(ABOUT_URL).spawn();

    #[cfg(target_os = "linux")]
    let _ = Command::new("xdg-open").arg(ABOUT_URL).spawn();

    #[cfg(target_os = "windows")]
    let _ = Command::new("cmd")
        .args(["/C", "start", "", ABOUT_URL])
        .spawn();
}

fn build_menu<M>(app: &M, language: AppLanguage) -> tauri::Result<tauri::menu::Menu<Wry>>
where
    M: Manager<Wry>,
{
    let is_mac = cfg!(target_os = "macos");
    let strings = menu_strings(language);

    let settings_item =
        MenuItem::with_id(app, "open-settings", strings.settings, true, Some("CmdOrCtrl+,"))?;
    let new_file_item =
        MenuItem::with_id(app, "new-file", strings.new_file, true, Some("CmdOrCtrl+N"))?;
    let open_item = MenuItem::with_id(app, "menu-open", strings.open, true, Some("CmdOrCtrl+O"))?;
    let open_folder_item = MenuItem::with_id(
        app,
        "menu-open-folder",
        strings.open_folder,
        true,
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let close_workspace_item = MenuItem::with_id(
        app,
        "menu-close-workspace",
        strings.close_workspace,
        true,
        None::<&str>,
    )?;
    let refresh_workspace_item = MenuItem::with_id(
        app,
        "menu-refresh-workspace",
        strings.refresh_workspace,
        true,
        Some("F5"),
    )?;
    let save_item = MenuItem::with_id(app, "menu-save", strings.save, true, Some("CmdOrCtrl+S"))?;
    let save_as_item = MenuItem::with_id(
        app,
        "menu-save-as",
        strings.save_as,
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let export_pdf_item = MenuItem::with_id(
        app,
        "menu-export-pdf",
        strings.export_pdf,
        true,
        Some("CmdOrCtrl+P"),
    )?;
    let toggle_sidebar_item = MenuItem::with_id(
        app,
        "toggle-sidebar",
        strings.toggle_sidebar,
        true,
        Some("CmdOrCtrl+\\"),
    )?;
    let show_outline_item = MenuItem::with_id(
        app,
        "show-outline",
        strings.show_outline,
        true,
        Some("CmdOrCtrl+Shift+\\"),
    )?;
    let toggle_source_mode_item = MenuItem::with_id(
        app,
        "toggle-source-mode",
        strings.toggle_source_mode,
        true,
        Some("CmdOrCtrl+Shift+E"),
    )?;
    let reset_zoom_item =
        MenuItem::with_id(app, "view-reset-zoom", strings.actual_size, true, Some("CmdOrCtrl+0"))?;
    let zoom_in_item =
        MenuItem::with_id(app, "view-zoom-in", strings.zoom_in, true, Some("CmdOrCtrl+="))?;
    let zoom_out_item =
        MenuItem::with_id(app, "view-zoom-out", strings.zoom_out, true, Some("CmdOrCtrl+-"))?;
    let ui_theme_system_item =
        MenuItem::with_id(app, "ui-theme-system", strings.system, true, None::<&str>)?;
    let ui_theme_light_item =
        MenuItem::with_id(app, "ui-theme-light", strings.light, true, None::<&str>)?;
    let ui_theme_dark_item =
        MenuItem::with_id(app, "ui-theme-dark", strings.dark, true, None::<&str>)?;
    let doc_theme_default_item = MenuItem::with_id(
        app,
        "doc-theme-default",
        strings.default_theme,
        true,
        None::<&str>,
    )?;
    let doc_theme_elegant_item =
        MenuItem::with_id(app, "doc-theme-elegant", strings.elegant, true, None::<&str>)?;
    let doc_theme_newsprint_item =
        MenuItem::with_id(app, "doc-theme-newsprint", strings.newsprint, true, None::<&str>)?;
    let import_theme_item = MenuItem::with_id(
        app,
        "menu-import-theme",
        strings.import_custom_theme,
        true,
        None::<&str>,
    )?;

    let mut root_menu = MenuBuilder::new(app);

    if is_mac {
        let app_menu = SubmenuBuilder::new(app, "Mako")
            .about(None::<AboutMetadata<'_>>)
            .separator()
            .item(&settings_item)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        root_menu = root_menu.item(&app_menu);
    }

    let file_menu = SubmenuBuilder::new(app, strings.root_file)
        .item(&new_file_item)
        .item(&open_item)
        .item(&open_folder_item)
        .separator()
        .item(&close_workspace_item)
        .item(&refresh_workspace_item)
        .separator()
        .item(&save_item)
        .item(&save_as_item)
        .separator()
        .item(&export_pdf_item)
        .separator();

    let file_menu = if is_mac {
        file_menu.close_window().build()?
    } else {
        file_menu.quit().build()?
    };

    let mut edit_menu = SubmenuBuilder::new(app, strings.root_edit);
    if !is_mac {
        edit_menu = edit_menu.item(&settings_item).separator();
    }
    let edit_menu = edit_menu
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, strings.root_view)
        .item(&toggle_sidebar_item)
        .item(&show_outline_item)
        .item(&toggle_source_mode_item)
        .separator()
        .item(&reset_zoom_item)
        .item(&zoom_in_item)
        .item(&zoom_out_item)
        .separator()
        .fullscreen()
        .build()?;

    let app_theme_menu = SubmenuBuilder::new(app, strings.application_theme)
        .item(&ui_theme_system_item)
        .item(&ui_theme_light_item)
        .item(&ui_theme_dark_item)
        .build()?;

    let doc_theme_menu = SubmenuBuilder::new(app, strings.document_theme)
        .item(&doc_theme_default_item)
        .item(&doc_theme_elegant_item)
        .item(&doc_theme_newsprint_item)
        .separator()
        .item(&import_theme_item)
        .build()?;

    let theme_menu = SubmenuBuilder::new(app, strings.root_theme)
        .items(&[&app_theme_menu, &doc_theme_menu])
        .build()?;

    let help_menu = SubmenuBuilder::new(app, strings.root_help)
        .item(&MenuItem::with_id(
            app,
            "help-about-mako",
            strings.about_mako,
            true,
            None::<&str>,
        )?)
        .build()?;

    root_menu
        .items(&[&file_menu, &edit_menu, &view_menu, &theme_menu, &help_menu])
        .build()
}

pub fn install_menu(app: &App<Wry>, language: AppLanguage) -> tauri::Result<()> {
    let menu = build_menu(app, language)?;
    app.set_menu(menu)?;

    app.on_menu_event(|app_handle, event| match event.id().0.as_str() {
        "new-file" => {
            if let Ok(window) = window::create_empty_window(app_handle) {
                window::show_window(&window);
            }
        }
        "menu-open" => emit_to_focused_window(app_handle, "menu-open", ()),
        "menu-open-folder" => emit_to_focused_window(app_handle, "menu-open-folder", ()),
        "menu-close-workspace" => emit_to_focused_window(app_handle, "menu-close-workspace", ()),
        "menu-refresh-workspace" => emit_to_focused_window(app_handle, "menu-refresh-workspace", ()),
        "menu-save" => emit_to_focused_window(app_handle, "menu-save", ()),
        "menu-save-as" => emit_to_focused_window(app_handle, "menu-save-as", ()),
        "menu-export-pdf" => emit_to_focused_window(app_handle, "menu-export-pdf", ()),
        "open-settings" => emit_to_focused_window(app_handle, "open-settings", ()),
        "toggle-sidebar" => emit_to_focused_window(app_handle, "toggle-sidebar", ()),
        "show-outline" => emit_to_focused_window(app_handle, "show-outline", ()),
        "toggle-source-mode" => emit_to_focused_window(app_handle, "toggle-source-mode", ()),
        "view-reset-zoom" => {
            if let Some(window) = focused_or_first_window(app_handle) {
                let _ = window::apply_zoom_action(&window, ZoomAction::Reset);
            }
        }
        "view-zoom-in" => {
            if let Some(window) = focused_or_first_window(app_handle) {
                let _ = window::apply_zoom_action(&window, ZoomAction::In);
            }
        }
        "view-zoom-out" => {
            if let Some(window) = focused_or_first_window(app_handle) {
                let _ = window::apply_zoom_action(&window, ZoomAction::Out);
            }
        }
        "ui-theme-system" => emit_to_focused_window(app_handle, "set-ui-theme", "system"),
        "ui-theme-light" => emit_to_focused_window(app_handle, "set-ui-theme", "light"),
        "ui-theme-dark" => emit_to_focused_window(app_handle, "set-ui-theme", "dark"),
        "doc-theme-default" => emit_to_focused_window(app_handle, "set-doc-theme", "default"),
        "doc-theme-elegant" => emit_to_focused_window(app_handle, "set-doc-theme", "elegant"),
        "doc-theme-newsprint" => emit_to_focused_window(app_handle, "set-doc-theme", "newsprint"),
        "menu-import-theme" => emit_to_focused_window(app_handle, "menu-import-theme", ()),
        "help-about-mako" => open_about_link(),
        _ => {}
    });

    Ok(())
}

pub fn update_menu(app_handle: &AppHandle<Wry>, language: AppLanguage) -> tauri::Result<()> {
    let menu = build_menu(app_handle, language)?;
    app_handle.set_menu(menu)?;
    Ok(())
}
