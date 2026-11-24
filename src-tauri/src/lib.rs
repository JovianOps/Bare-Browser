use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
};

#[derive(Default)]
struct BrowserState {
    tabs: HashMap<String, TabInfo>,
    active_tab: Option<String>,
    tab_order: Vec<String>,
    next_tab_id: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct TabInfo {
    label: String,
    title: String,
    url: String,
}

#[derive(Clone, Serialize)]
struct TabEventPayload {
    label: String,
    url: String,
    title: String,
}

fn with_state<T>(app: &AppHandle, f: impl FnOnce(&mut BrowserState) -> Result<T, String>) -> Result<T, String> {
    let state = app.state::<Mutex<BrowserState>>();
    let mut guard = state.lock().map_err(|e| format!("state lock poisoned: {e}"))?;
    f(&mut guard)
}

fn parse_url(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }

    // Accept explicit http/https URLs.
    if let Ok(url) = Url::parse(trimmed) {
        if url.scheme() == "http" || url.scheme() == "https" {
            return Ok(url);
        }
    }

    // If it looks like a host/path, prepend https://
    let with_scheme = format!("https://{trimmed}");
    if let Ok(url) = Url::parse(&with_scheme) {
        if url.host_str().is_some() && trimmed.contains('.') && !trimmed.contains(' ') {
            return Ok(url);
        }
    }

    // Fallback: treat as a search query.
    let query: String = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
    Url::parse(&format!("https://duckduckgo.com/?q={query}"))
        .map_err(|e| format!("invalid URL/search: {e}"))
}

fn emit_tabs_updated(app: &AppHandle, state: &BrowserState) {
    let tabs: Vec<TabInfo> = state
        .tab_order
        .iter()
        .filter_map(|l| state.tabs.get(l).cloned())
        .collect();
    let _ = app.emit(
        "tabs-updated",
        serde_json::json!({
            "tabs": tabs,
            "activeTab": state.active_tab,
        }),
    );
}

#[tauri::command]
fn browser_create_tab(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<TabInfo, String> {
    let parsed = parse_url(&url)?;
    let parsed_string = parsed.to_string();

    let (label, should_hide_others) = with_state(&app, |state| {
        let id = state.next_tab_id;
        state.next_tab_id += 1;
        let label = format!("tab-{id}");
        let info = TabInfo {
            label: label.clone(),
            title: parsed_string.clone(),
            url: parsed_string.clone(),
        };
        state.tab_order.push(label.clone());
        state.tabs.insert(label.clone(), info.clone());
        let prev_active = state.active_tab.clone();
        state.active_tab = Some(label.clone());
        Ok((label, prev_active))
    })?;

    let window = app
        .windows()
        .get("main")
        .cloned()
        .ok_or_else(|| "main window not found".to_string())?;

    let app_handle = app.clone();
    let label_for_nav = label.clone();
    let label_for_load = label.clone();
    let app_for_load = app.clone();

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .auto_resize(false)
        .on_navigation(move |nav_url: &Url| {
            let url_str = nav_url.to_string();
            let _ = app_handle.emit(
                "tab-navigated",
                TabEventPayload {
                    label: label_for_nav.clone(),
                    url: url_str.clone(),
                    title: url_str,
                },
            );
            // Update state URL
            let app2 = app_handle.clone();
            let label2 = label_for_nav.clone();
            let url2 = nav_url.to_string();
            let _ = with_state(&app2, |state| {
                if let Some(tab) = state.tabs.get_mut(&label2) {
                    tab.url = url2;
                }
                emit_tabs_updated(&app2, state);
                Ok(())
            });
            true
        })
        .on_page_load(move |_webview, payload| {
            let url_str = payload.url().to_string();
            let event_name = match payload.event() {
                PageLoadEvent::Started => "tab-loading",
                PageLoadEvent::Finished => "tab-loaded",
            };
            let _ = app_for_load.emit(
                event_name,
                serde_json::json!({
                    "label": label_for_load,
                    "url": url_str,
                }),
            );
        });

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|e| format!("failed to create tab webview: {e}"))?;

    // Hide previously active tab.
    if let Some(prev) = should_hide_others {
        if prev != label {
            if let Some(prev_wv) = app.get_webview(&prev) {
                let _ = prev_wv.hide();
            }
        }
    }

    let _ = webview.show();
    let _ = webview.set_focus();

    let info = with_state(&app, |state| {
        emit_tabs_updated(&app, state);
        state
            .tabs
            .get(&label)
            .cloned()
            .ok_or_else(|| "tab missing after creation".to_string())
    })?;

    Ok(info)
}

#[tauri::command]
fn browser_close_tab(app: AppHandle, label: String) -> Result<Option<String>, String> {
    let next_active = with_state(&app, |state| {
        if !state.tabs.contains_key(&label) {
            return Err("tab not found".to_string());
        }

        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.close();
        }

        state.tabs.remove(&label);
        state.tab_order.retain(|l| l != &label);

        if state.active_tab.as_deref() == Some(&label) {
            state.active_tab = state.tab_order.last().cloned();
        }

        let next = state.active_tab.clone();
        if let Some(ref next_label) = next {
            if let Some(wv) = app.get_webview(next_label) {
                let _ = wv.show();
                let _ = wv.set_focus();
            }
        }

        emit_tabs_updated(&app, state);
        Ok(next)
    })?;

    Ok(next_active)
}

#[tauri::command]
fn browser_switch_tab(app: AppHandle, label: String) -> Result<(), String> {
    with_state(&app, |state| {
        if !state.tabs.contains_key(&label) {
            return Err("tab not found".to_string());
        }
        let prev = state.active_tab.clone();
        state.active_tab = Some(label.clone());

        if let Some(prev_label) = prev {
            if prev_label != label {
                if let Some(wv) = app.get_webview(&prev_label) {
                    let _ = wv.hide();
                }
            }
        }
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.show();
            let _ = wv.set_focus();
        }

        emit_tabs_updated(&app, state);
        Ok(())
    })
}

#[tauri::command]
fn browser_navigate_tab(app: AppHandle, label: String, url: String) -> Result<String, String> {
    let parsed = parse_url(&url)?;
    let parsed_string = parsed.to_string();
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| "tab webview not found".to_string())?;
    wv.navigate(parsed.clone())
        .map_err(|e| format!("navigate failed: {e}"))?;

    with_state(&app, |state| {
        if let Some(tab) = state.tabs.get_mut(&label) {
            tab.url = parsed_string.clone();
        }
        emit_tabs_updated(&app, state);
        Ok(())
    })?;

    Ok(parsed_string)
}

#[tauri::command]
fn browser_tab_back(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| "tab webview not found".to_string())?;
    wv.eval("history.back()")
        .map_err(|e| format!("back failed: {e}"))
}

#[tauri::command]
fn browser_tab_forward(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| "tab webview not found".to_string())?;
    wv.eval("history.forward()")
        .map_err(|e| format!("forward failed: {e}"))
}

#[tauri::command]
fn browser_tab_reload(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| "tab webview not found".to_string())?;
    wv.eval("location.reload()")
        .map_err(|e| format!("reload failed: {e}"))
}

#[tauri::command]
fn browser_set_tab_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| "tab webview not found".to_string())?;
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("set_position failed: {e}"))?;
    wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
        .map_err(|e| format!("set_size failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn browser_get_tabs(app: AppHandle) -> Result<serde_json::Value, String> {
    with_state(&app, |state| {
        let tabs: Vec<TabInfo> = state
            .tab_order
            .iter()
            .filter_map(|l| state.tabs.get(l).cloned())
            .collect();
        Ok(serde_json::json!({
            "tabs": tabs,
            "activeTab": state.active_tab,
        }))
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(BrowserState::default()))
        .setup(|app| {
            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("Bare Browser")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .resizable(true)
                .build()?;

            // Chrome UI webview fills the full window. Tab content webviews are added
            // on top as children, positioned below the chrome toolbar by the frontend.
            let _chrome = window.add_child(
                WebviewBuilder::new("chrome", WebviewUrl::App("index.html".into()))
                    .auto_resize(),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1200.0, 800.0),
            )?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            browser_create_tab,
            browser_close_tab,
            browser_switch_tab,
            browser_navigate_tab,
            browser_tab_back,
            browser_tab_forward,
            browser_tab_reload,
            browser_set_tab_bounds,
            browser_get_tabs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bare Browser");
}
