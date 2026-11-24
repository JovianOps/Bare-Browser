use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TabKind {
    Tab,
    Pinned,
}

impl Default for TabKind {
    fn default() -> Self {
        TabKind::Tab
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub label: String,
    pub title: String,
    pub url: String,
    pub favicon: String,
    pub loading: bool,
    pub progress: f64, // 0.0..1.0
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub pinned: bool,
}

impl TabInfo {
    pub fn new(label: String, url: String) -> Self {
        let title = title_from_url(&url);
        Self {
            label,
            title,
            url,
            favicon: String::new(),
            loading: true,
            progress: 0.1,
            can_go_back: false,
            can_go_forward: false,
            pinned: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedTab {
    pub url: String,
    pub title: String,
    pub pinned: bool,
}

#[derive(Default)]
pub struct BrowserState {
    pub tabs: HashMap<String, TabInfo>,
    pub active_tab: Option<String>,
    pub tab_order: Vec<String>,
    pub next_tab_id: u64,
    pub closed_tabs: Vec<ClosedTab>,
    pub last_bounds: Option<(f64, f64, f64, f64)>,
}

impl BrowserState {
    pub fn ordered_tabs(&self) -> Vec<TabInfo> {
        self.tab_order
            .iter()
            .filter_map(|l| self.tabs.get(l).cloned())
            .collect()
    }

    pub fn push_closed(&mut self, closed: ClosedTab) {
        self.closed_tabs.push(closed);
        if self.closed_tabs.len() > 50 {
            let drain = self.closed_tabs.len() - 50;
            self.closed_tabs.drain(0..drain);
        }
    }

    pub fn pop_closed(&mut self) -> Option<ClosedTab> {
        self.closed_tabs.pop()
    }
}

pub fn title_from_url(url: &str) -> String {
    if url.is_empty() || url == "about:blank" {
        return "New Tab".to_string();
    }
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            return host.to_string();
        }
    }
    url.to_string()
}

pub fn favicon_for_url(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        if parsed.scheme() == "http" || parsed.scheme() == "https" {
            if let Some(host) = parsed.host_str() {
                return format!("{}://{}/favicon.ico", parsed.scheme(), host);
            }
        }
    }
    String::new()
}
