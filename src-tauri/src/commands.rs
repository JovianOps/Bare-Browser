use crate::tabs::{favicon_for_url, title_from_url, BrowserState, ClosedTab, TabInfo};
use crate::storage::{Bookmark, BrowserData, HistoryEntry, SessionState, StorageState, now_ms, new_id};
use crate::settings::Settings;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    webview::{DownloadEvent, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabsPayload {
    tabs: Vec<TabInfo>,
    active_tab: Option<String>,
}

fn emit_tabs_updated(app: &AppHandle, state: &BrowserState) {
    let _ = app.emit(
        "tabs-updated",
        TabsPayload {
            tabs: state.ordered_tabs(),
            active_tab: state.active_tab.clone(),
        },
    );
}

fn with_state<T>(
    state: &State<'_, Mutex<BrowserState>>,
    f: impl FnOnce(&mut BrowserState) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.lock().map_err(|e| format!("state lock poisoned: {e}"))?;
    f(&mut guard)
}

pub fn parse_url(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    if trimmed == "nadir://newtab" || trimmed == "nadir:newtab" {
        return Url::parse("nadir://newtab").map_err(|e| e.to_string());
    }
    if trimmed.starts_with("nadir://error") {
        return Url::parse(trimmed).or_else(|_| Url::parse("nadir://error")).map_err(|e| e.to_string());
    }

    if let Ok(url) = Url::parse(trimmed) {
        if matches!(url.scheme(), "http" | "https" | "nadir") {
            return Ok(url);
        }
    }

    let with_scheme = format!("https://{trimmed}");
    if let Ok(url) = Url::parse(&with_scheme) {
        if url.host_str().is_some() && trimmed.contains('.') && !trimmed.contains(' ') {
            return Ok(url);
        }
    }

    let query: String = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
    Url::parse(&format!("https://duckduckgo.com/?q={query}"))
        .map_err(|e| format!("invalid URL/search: {e}"))
}

fn webview_url_for(url: &Url) -> WebviewUrl {
    if url.scheme() == "nadir" {
        let page = match url.host_str() {
            Some("error") => "error.html",
            _ => "newtab.html",
        };
        WebviewUrl::App(page.into())
    } else {
        WebviewUrl::External(url.clone())
    }
}

fn build_tab_init_script(label: &str) -> String {
    // Injected into every tab webview. Reports title/favicon/url/nav state back to Rust.
    // Uses __TAURI_INTERNALS__.invoke which is available in Tauri v2 webviews.
    format!(
        r#"(function() {{
  if (window.__NADIR_BROWSER_INIT__) return;
  window.__NADIR_BROWSER_INIT__ = true;
  const LABEL = {label_json};
  function send(payload) {{
    try {{
      const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (inv) inv('browser_tab_state', {{ label: LABEL, ...payload }});
    }} catch (_) {{}}
  }}
  function icon() {{
    const link = document.querySelector('link[rel~="icon"]') || document.querySelector('link[rel="shortcut icon"]');
    if (link && link.href) return link.href;
    try {{ return location.origin + '/favicon.ico'; }} catch (_) {{ return ''; }}
  }}
  function report() {{
    send({{
      title: document.title || location.href,
      url: location.href,
      favicon: icon(),
      canGoBack: history.length > 1,
      canGoForward: false,
      loading: document.readyState !== 'complete'
    }});
  }}
  report();
  document.addEventListener('DOMContentLoaded', report, {{ once: true }});
  window.addEventListener('load', () => send({{ loading: false, progress: 1.0, title: document.title || location.href, url: location.href, favicon: icon() }}));
  const _ps = history.pushState; history.pushState = function() {{ _ps.apply(this, arguments); setTimeout(report, 0); }};
  const _rs = history.replaceState; history.replaceState = function() {{ _rs.apply(this, arguments); setTimeout(report, 0); }};
  window.addEventListener('popstate', () => setTimeout(report, 0));
  new MutationObserver(() => send({{ title: document.title || location.href, favicon: icon() }}))
    .observe(document.documentElement || document, {{ subtree: true, childList: true, characterData: true }});
  document.addEventListener('click', (e) => {{
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.href;
    if (!href || href.startsWith('javascript:')) return;
    const blank = a.target === '_blank';
    if (blank || e.ctrlKey || e.metaKey || e.button === 1) {{
      e.preventDefault();
      send({{ openUrl: href, background: !(!blank && !e.ctrlKey && !e.metaKey && e.button !== 1) ? true : true }});
    }}
  }}, true);
  document.addEventListener('auxclick', (e) => {{
    if (e.button !== 1) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !a.href) return;
    e.preventDefault();
    send({{ openUrl: a.href, background: true }});
  }}, true);
  window.open = function(u) {{ if (u) send({{ openUrl: String(u), background: false }}); return null; }};
}})();"#,
        label_json = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".to_string())
    )
}

fn create_webview_for_tab(
    app: &AppHandle,
    window: &tauri::Window,
    label: &str,
    url: Url,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let app_nav = app.clone();
    let app_load = app.clone();
    let app_new = app.clone();
    let label_nav = label.to_string();
    let label_load = label.to_string();
    let label_new = label.to_string();
    let init_script = build_tab_init_script(label);

    let builder = WebviewBuilder::new(label, webview_url_for(&url))
        .auto_resize(false)
        .initialization_script(&init_script)
        .on_navigation(move |nav_url: &Url| {
            let url_str = nav_url.to_string();
            let _ = app_nav.emit(
                "tab-navigated",
                serde_json::json!({
                    "label": label_nav,
                    "url": url_str,
                    "title": title_from_url(&url_str),
                    "favicon": favicon_for_url(&url_str),
                }),
            );
            let app2 = app_nav.clone();
            let label2 = label_nav.clone();
            let url2 = url_str.clone();
            if let Some(state) = app2.try_state::<Mutex<BrowserState>>() {
                if let Ok(mut guard) = state.lock() {
                    if let Some(tab) = guard.tabs.get_mut(&label2) {
                        tab.url = url2;
                        tab.loading = true;
                        tab.progress = 0.15;
                        if tab.title.is_empty() {
                            tab.title = title_from_url(&tab.url);
                        }
                        if tab.favicon.is_empty() {
                            tab.favicon = favicon_for_url(&tab.url);
                        }
                    }
                    emit_tabs_updated(&app2, &guard);
                }
            }
            true
        })
        .on_page_load(move |_webview, payload| {
            let url_str = payload.url().to_string();
            let is_start = matches!(payload.event(), PageLoadEvent::Started);
            let _ = app_load.emit(
                if is_start { "tab-loading" } else { "tab-loaded" },
                serde_json::json!({
                    "label": label_load,
                    "url": url_str,
                    "loading": is_start,
                    "progress": if is_start { 0.2 } else { 1.0 }
                }),
            );
            if let Some(state) = app_load.try_state::<Mutex<BrowserState>>() {
                if let Ok(mut guard) = state.lock() {
                    if let Some(tab) = guard.tabs.get_mut(&label_load) {
                        tab.url = url_str.clone();
                        tab.loading = is_start;
                        tab.progress = if is_start { 0.2 } else { 1.0 };
                        if !is_start {
                            if tab.title.is_empty() || tab.title == tab.url {
                                tab.title = title_from_url(&url_str);
                            }
                            if tab.favicon.is_empty() {
                                tab.favicon = favicon_for_url(&url_str);
                            }
                        }
                    }
                    emit_tabs_updated(&app_load, &guard);
                }
            }
        })
        .on_download({
            let app_dl = app.clone();
            move |_webview, event| {
                if let Some(state) = app_dl.try_state::<Mutex<crate::downloads::DownloadState>>() {
                    match &event {
                        DownloadEvent::Requested { url, destination } => {
                            let name = destination.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "download".to_string());
                            let item = crate::downloads::DownloadItem {
                                id: crate::storage::new_id("dl"),
                                url: url.to_string(),
                                file_name: name,
                                path: destination.to_string_lossy().to_string(),
                                total_bytes: None,
                                received_bytes: 0,
                                state: "downloading".to_string(),
                                speed_bps: 0,
                                started_at: crate::storage::now_ms(),
                                finished_at: None,
                                error: None,
                            };
                            if let Ok(mut g) = state.lock() { g.items.insert(0, item.clone()); }
                            let _ = app_dl.emit("download-updated", item);
                        }
                        DownloadEvent::Finished { url, path, success } => {
                            let _ = app_dl.emit("download-finished", serde_json::json!({"url": url.to_string(), "path": path.as_ref().map(|p| p.to_string_lossy().to_string()), "success": success}));
                        }
                        _ => {}
                    }
                }
                true
            }
        })
        .on_new_window(move |url, _features| {
            let _ = app_new.emit(
                "tab-open-request",
                serde_json::json!({
                    "from": label_new,
                    "url": url.to_string(),
                    "background": false
                }),
            );
            // Deny native popup window; chrome handles it as a tab.
            tauri::webview::NewWindowResponse::Deny
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|e| format!("failed to create tab webview: {e}"))?;
    Ok(())
}

fn show_only_active(app: &AppHandle, state: &BrowserState) {
    for (label, _) in &state.tabs {
        if let Some(wv) = app.get_webview(label) {
            if state.active_tab.as_deref() == Some(label.as_str()) {
                let _ = wv.show();
            } else {
                let _ = wv.hide();
            }
        }
    }
}

#[tauri::command]
pub fn browser_create_tab(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    background: Option<bool>,
) -> Result<TabInfo, String> {
    let parsed = parse_url(&url)?;
    let parsed_string = parsed.to_string();
    let bg = background.unwrap_or(false);

    let (label, prev_active) = with_state(&state, |s| {
        let id = s.next_tab_id;
        s.next_tab_id += 1;
        let label = format!("tab-{id}");
        let info = TabInfo::new(label.clone(), parsed_string.clone());
        s.tab_order.push(label.clone());
        s.tabs.insert(label.clone(), info);
        let prev = s.active_tab.clone();
        if !bg || prev.is_none() {
            s.active_tab = Some(label.clone());
        }
        Ok((label, prev))
    })?;

    let window = app
        .windows()
        .get("main")
        .cloned()
        .ok_or_else(|| "main window not found".to_string())?;

    create_webview_for_tab(&app, &window, &label, parsed, x, y, width, height)?;

    if bg {
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.hide();
        }
    } else {
        if let Some(prev) = prev_active {
            if prev != label {
                if let Some(wv) = app.get_webview(&prev) {
                    let _ = wv.hide();
                }
            }
        }
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.show();
            let _ = wv.set_focus();
        }
    }

    let info = with_state(&state, |s| {
        if let Some(b) = s.last_bounds { /* keep */ let _ = b; }
        s.last_bounds = Some((x, y, width, height));
        emit_tabs_updated(&app, s);
        s.tabs.get(&label).cloned().ok_or_else(|| "tab missing".to_string())
    })?;
    Ok(info)
}

#[tauri::command]
pub fn browser_close_tab(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    label: String,
) -> Result<Option<String>, String> {
    let next = with_state(&state, |s| {
        let tab = s.tabs.get(&label).cloned().ok_or_else(|| "tab not found".to_string())?;
        s.push_closed(ClosedTab { url: tab.url, title: tab.title, pinned: tab.pinned });
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.close();
        }
        s.tabs.remove(&label);
        s.tab_order.retain(|l| l != &label);
        if s.active_tab.as_deref() == Some(&label) {
            // pick neighbor: next in order, else previous, else last
            s.active_tab = s.tab_order.last().cloned();
        }
        show_only_active(&app, s);
        emit_tabs_updated(&app, s);
        Ok(s.active_tab.clone())
    })?;
    Ok(next)
}

#[tauri::command]
pub fn browser_switch_tab(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    label: String,
) -> Result<(), String> {
    with_state(&state, |s| {
        if !s.tabs.contains_key(&label) { return Err("tab not found".to_string()); }
        s.active_tab = Some(label.clone());
        show_only_active(&app, s);
        if let Some(wv) = app.get_webview(&label) { let _ = wv.show(); let _ = wv.set_focus(); }
        emit_tabs_updated(&app, s);
        Ok(())
    })
}

#[tauri::command]
pub fn browser_navigate_tab(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    label: String,
    url: String,
) -> Result<String, String> {
    let parsed = parse_url(&url)?;
    let parsed_string = parsed.to_string();
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    if parsed.scheme() == "nadir" {
        let page = match parsed.host_str() {
            Some("error") => {
                let q = parsed.query().unwrap_or("");
                if q.is_empty() { "error.html".to_string() } else { format!("error.html?{q}") }
            }
            _ => "newtab.html".to_string(),
        };
        let js = format!("window.location.replace('{}')", page.replace('\'', "\\'"));
        wv.eval(&js).map_err(|e| format!("navigate failed: {e}"))?;
    } else {
        wv.navigate(parsed.clone()).map_err(|e| format!("navigate failed: {e}"))?;
    }
    with_state(&state, |s| {
        if let Some(tab) = s.tabs.get_mut(&label) {
            tab.url = parsed_string.clone();
            tab.loading = true;
            tab.progress = 0.1;
        }
        emit_tabs_updated(&app, s);
        Ok(())
    })?;
    Ok(parsed_string)
}

#[tauri::command]
pub fn browser_tab_back(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    wv.eval("history.back()").map_err(|e| format!("back failed: {e}"))
}

#[tauri::command]
pub fn browser_tab_forward(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    wv.eval("history.forward()").map_err(|e| format!("forward failed: {e}"))
}

#[tauri::command]
pub fn browser_tab_reload(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    wv.eval("location.reload()").map_err(|e| format!("reload failed: {e}"))
}

#[tauri::command]
pub fn browser_set_tab_bounds(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    wv.set_position(LogicalPosition::new(x, y)).map_err(|e| format!("set_position failed: {e}"))?;
    wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0))).map_err(|e| format!("set_size failed: {e}"))?;
    with_state(&state, |s| { s.last_bounds = Some((x, y, width, height)); Ok(()) })?;
    Ok(())
}

#[tauri::command]
pub fn browser_get_tabs(state: State<'_, Mutex<BrowserState>>) -> Result<TabsPayload, String> {
    with_state(&state, |s| Ok(TabsPayload { tabs: s.ordered_tabs(), active_tab: s.active_tab.clone() }))
}

#[tauri::command]
pub fn browser_reorder_tab(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    label: String,
    to_index: usize,
) -> Result<(), String> {
    with_state(&state, |s| {
        let from = s.tab_order.iter().position(|l| l == &label).ok_or("tab not found")?;
        let item = s.tab_order.remove(from);
        let idx = to_index.min(s.tab_order.len());
        s.tab_order.insert(idx, item);
        emit_tabs_updated(&app, s);
        Ok(())
    })
}

#[tauri::command]
pub fn browser_pin_tab(app: AppHandle, state: State<'_, Mutex<BrowserState>>, label: String, pinned: bool) -> Result<(), String> {
    with_state(&state, |s| {
        if let Some(tab) = s.tabs.get_mut(&label) { tab.pinned = pinned; }
        else { return Err("tab not found".to_string()); }
        // Move pinned tabs to front
        s.tab_order.sort_by_key(|l| if s.tabs.get(l).map(|t| t.pinned).unwrap_or(false) { 0 } else { 1 });
        emit_tabs_updated(&app, s);
        Ok(())
    })
}

#[tauri::command]
pub fn browser_duplicate_tab(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    label: String,
    x: f64, y: f64, width: f64, height: f64,
) -> Result<TabInfo, String> {
    let url = with_state(&state, |s| s.tabs.get(&label).map(|t| t.url.clone()).ok_or("tab not found".to_string()))?;
    browser_create_tab(app, state, url, x, y, width, height, Some(false))
}

fn close_tab_label(app: &AppHandle, state: &State<'_, Mutex<BrowserState>>, label: &str) -> Result<Option<String>, String> {
    let next = with_state(state, |s| {
        let tab = s.tabs.get(label).cloned().ok_or_else(|| "tab not found".to_string())?;
        s.push_closed(ClosedTab { url: tab.url, title: tab.title, pinned: tab.pinned });
        if let Some(wv) = app.get_webview(label) { let _ = wv.close(); }
        s.tabs.remove(label);
        s.tab_order.retain(|l| l != label);
        if s.active_tab.as_deref() == Some(label) {
            s.active_tab = s.tab_order.last().cloned();
        }
        show_only_active(app, s);
        emit_tabs_updated(app, s);
        Ok(s.active_tab.clone())
    })?;
    Ok(next)
}

#[tauri::command]
pub fn browser_close_others(app: AppHandle, state: State<'_, Mutex<BrowserState>>, label: String) -> Result<(), String> {
    let to_close: Vec<String> = with_state(&state, |s| {
        Ok(s.tab_order.iter().filter(|l| *l != &label && !s.tabs.get(*l).map(|t| t.pinned).unwrap_or(false)).cloned().collect())
    })?;
    for l in to_close { let _ = close_tab_label(&app, &state, &l); }
    Ok(())
}

#[tauri::command]
pub fn browser_close_right(app: AppHandle, state: State<'_, Mutex<BrowserState>>, label: String) -> Result<(), String> {
    let to_close: Vec<String> = with_state(&state, |s| {
        let idx = s.tab_order.iter().position(|l| l == &label).ok_or("tab not found")?;
        Ok(s.tab_order.iter().skip(idx + 1).filter(|l| !s.tabs.get(*l).map(|t| t.pinned).unwrap_or(false)).cloned().collect())
    })?;
    for l in to_close { let _ = close_tab_label(&app, &state, &l); }
    Ok(())
}

#[tauri::command]
pub fn browser_reopen_closed(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    x: f64, y: f64, width: f64, height: f64,
) -> Result<Option<TabInfo>, String> {
    let closed = with_state(&state, |s| Ok(s.pop_closed()))?;
    if let Some(c) = closed {
        let info = browser_create_tab(app, state, c.url, x, y, width, height, Some(false))?;
        return Ok(Some(info));
    }
    Ok(None)
}

#[tauri::command]
pub fn browser_tab_state(
    app: AppHandle,
    state: State<'_, Mutex<BrowserState>>,
    label: String,
    title: Option<String>,
    url: Option<String>,
    favicon: Option<String>,
    loading: Option<bool>,
    progress: Option<f64>,
    can_go_back: Option<bool>,
    can_go_forward: Option<bool>,
    open_url: Option<String>,
    background: Option<bool>,
) -> Result<(), String> {
    if let Some(open) = open_url {
        let _ = app.emit("tab-open-request", serde_json::json!({
            "from": label,
            "url": open,
            "background": background.unwrap_or(true)
        }));
        return Ok(());
    }
    with_state(&state, |s| {
        if let Some(tab) = s.tabs.get_mut(&label) {
            if let Some(t) = title { if !t.is_empty() { tab.title = t; } }
            if let Some(u) = url { if !u.is_empty() { tab.url = u; } }
            if let Some(f) = favicon { tab.favicon = f; }
            if let Some(l) = loading { tab.loading = l; }
            if let Some(p) = progress { tab.progress = p.clamp(0.0, 1.0); }
            if let Some(b) = can_go_back { tab.can_go_back = b; }
            if let Some(fwd) = can_go_forward { tab.can_go_forward = fwd; }
        }
        emit_tabs_updated(&app, s);
        Ok(())
    })
}

fn with_storage<T>(state: &State<'_, Mutex<StorageState>>, f: impl FnOnce(&mut StorageState) -> Result<T, String>) -> Result<T, String> {
    let mut guard = state.lock().map_err(|e| format!("storage lock poisoned: {e}"))?;
    f(&mut guard)
}

#[tauri::command]
pub fn storage_get_data(state: State<'_, Mutex<StorageState>>) -> Result<BrowserData, String> {
    with_storage(&state, |s| Ok(s.data.clone()))
}

#[tauri::command]
pub fn storage_save_bookmarks(state: State<'_, Mutex<StorageState>>, bookmarks: Vec<Bookmark>) -> Result<(), String> {
    with_storage(&state, |s| { s.data.bookmarks = bookmarks; s.save() })
}

#[tauri::command]
pub fn storage_save_history(state: State<'_, Mutex<StorageState>>, history: Vec<HistoryEntry>) -> Result<(), String> {
    with_storage(&state, |s| { s.data.history = history; s.save() })
}

#[tauri::command]
pub fn storage_save_settings(state: State<'_, Mutex<StorageState>>, settings: Settings) -> Result<(), String> {
    with_storage(&state, |s| { s.data.settings = settings; s.save() })
}

#[tauri::command]
pub fn storage_save_session(state: State<'_, Mutex<StorageState>>, session: SessionState) -> Result<(), String> {
    with_storage(&state, |s| { s.data.session = session; s.save() })
}

#[tauri::command]
pub fn storage_clear_browsing_data(
    state: State<'_, Mutex<StorageState>>,
    history: bool,
    bookmarks: bool,
    sessions: bool,
) -> Result<BrowserData, String> {
    with_storage(&state, |s| {
        if history { s.data.history.clear(); }
        if bookmarks { s.data.bookmarks.clear(); }
        if sessions { s.data.session = SessionState::default(); }
        s.save()?;
        Ok(s.data.clone())
    })
}

#[tauri::command]
pub fn storage_export_bookmarks_html(state: State<'_, Mutex<StorageState>>) -> Result<String, String> {
    with_storage(&state, |s| {
        let mut out = String::from("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n");
        let mut folders: std::collections::BTreeMap<String, Vec<&Bookmark>> = std::collections::BTreeMap::new();
        for b in &s.data.bookmarks {
            folders.entry(b.folder.clone()).or_default().push(b);
        }
        if let Some(root) = folders.remove("") {
            for b in root { out.push_str(&format!("    <DT><A HREF=\"{}\">{}</A>\n", html_escape(&b.url), html_escape(&b.title))); }
        }
        for (folder, items) in folders {
            out.push_str(&format!("    <DT><H3>{}</H3>\n    <DL><p>\n", html_escape(&folder)));
            for b in items { out.push_str(&format!("        <DT><A HREF=\"{}\">{}</A>\n", html_escape(&b.url), html_escape(&b.title))); }
            out.push_str("    </DL><p>\n");
        }
        out.push_str("</DL><p>\n");
        Ok(out)
    })
}

#[tauri::command]
pub fn storage_import_bookmarks_html(state: State<'_, Mutex<StorageState>>, html: String) -> Result<Vec<Bookmark>, String> {
    with_storage(&state, |s| {
        let mut imported: Vec<Bookmark> = Vec::new();
        let mut current_folder = String::new();
        for line in html.lines() {
            let l = line.trim();
            if l.to_uppercase().contains("<H3") {
                current_folder = strip_tags(l);
            } else if l.to_uppercase().contains("<A ") {
                let url = extract_attr(l, "HREF").unwrap_or_default();
                let title = strip_tags(l);
                if !url.is_empty() {
                    imported.push(Bookmark {
                        id: new_id("bm"),
                        title: if title.is_empty() { url.clone() } else { title },
                        url,
                        folder: current_folder.clone(),
                        created_at: now_ms(),
                    });
                }
            } else if l.to_uppercase().contains("</DL>") {
                // leave folder scope (simple heuristic)
                // don't clear if we're at top level; simple parser
            }
        }
        for b in imported.clone() {
            if !s.data.bookmarks.iter().any(|x| x.url == b.url && x.folder == b.folder) {
                s.data.bookmarks.push(b);
            }
        }
        s.save()?;
        Ok(s.data.bookmarks.clone())
    })
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

fn extract_attr(line: &str, attr: &str) -> Option<String> {
    let upper = line.to_uppercase();
    let needle = format!("{}=\"", attr.to_uppercase());
    let idx = upper.find(&needle)?;
    let rest = &line[idx + needle.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

#[tauri::command]
pub fn browser_set_zoom(app: AppHandle, label: String, zoom: f64) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    wv.set_zoom(zoom).map_err(|e| format!("zoom failed: {e}"))
}

#[tauri::command]
pub fn browser_get_zoom(app: AppHandle, label: String) -> Result<f64, String> {
    let _wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    // Tauri v2 webview zoom getter may not be available on all platforms; return 1.0 as fallback.
    Ok(1.0)
}

#[tauri::command]
pub fn browser_open_devtools(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    // open_devtools is available on most desktop builds; gate if needed by platform.
    wv.open_devtools();
    Ok(())
}

#[tauri::command]
pub fn browser_print_page(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    wv.eval("window.print()").map_err(|e| format!("print failed: {e}"))
}

#[tauri::command]
pub fn browser_eval_js(app: AppHandle, label: String, js: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or_else(|| "tab webview not found".to_string())?;
    wv.eval(&js).map_err(|e| format!("eval failed: {e}"))
}

#[tauri::command]
pub fn browser_download_list(state: State<'_, Mutex<crate::downloads::DownloadState>>) -> Result<Vec<crate::downloads::DownloadItem>, String> {
    let g = state.lock().map_err(|e| format!("lock: {e}"))?;
    Ok(g.items.clone())
}

#[tauri::command]
pub fn browser_download_cancel(state: State<'_, Mutex<crate::downloads::DownloadState>>, id: String) -> Result<(), String> {
    let mut g = state.lock().map_err(|e| format!("lock: {e}"))?;
    if let Some(item) = g.items.iter_mut().find(|i| i.id == id) { item.state = "cancelled".to_string(); }
    Ok(())
}

#[tauri::command]
pub fn browser_download_open(_id: String) -> Result<(), String> { Ok(()) }

#[tauri::command]
pub fn browser_download_show(_id: String) -> Result<(), String> { Ok(()) }
