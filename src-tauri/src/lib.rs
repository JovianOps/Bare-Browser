mod commands;
mod downloads;
mod settings;
mod storage;
mod tabs;

use std::sync::Mutex;
use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl};
use tauri::webview::WebviewBuilder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(tabs::BrowserState::default()))
        .manage(Mutex::new(downloads::DownloadState::default()))
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
            let storage_path = data_dir.join("nadir.json");
            app.manage(Mutex::new(storage::StorageState::new(storage_path)));

            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("Nadir")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .resizable(true)
                .build()?;

            let _chrome = window.add_child(
                WebviewBuilder::new("chrome", WebviewUrl::App("index.html".into())).auto_resize(),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1200.0, 800.0),
            )?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::browser_create_tab,
            commands::browser_close_tab,
            commands::browser_switch_tab,
            commands::browser_navigate_tab,
            commands::browser_tab_back,
            commands::browser_tab_forward,
            commands::browser_tab_reload,
            commands::browser_set_tab_bounds,
            commands::browser_get_tabs,
            commands::browser_reorder_tab,
            commands::browser_pin_tab,
            commands::browser_duplicate_tab,
            commands::browser_close_others,
            commands::browser_close_right,
            commands::browser_reopen_closed,
            commands::browser_tab_state,
            commands::storage_get_data,
            commands::storage_save_bookmarks,
            commands::storage_save_history,
            commands::storage_save_settings,
            commands::storage_save_session,
            commands::storage_clear_browsing_data,
            commands::storage_export_bookmarks_html,
            commands::storage_import_bookmarks_html,
            commands::browser_set_zoom,
            commands::browser_open_devtools,
            commands::browser_print_page,
            commands::browser_eval_js,
            commands::browser_download_list,
            commands::browser_download_cancel,
            commands::browser_download_open,
            commands::browser_download_show,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nadir");
}
