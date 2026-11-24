use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub default_search_engine: String, // duckduckgo|google|brave|startpage|kagi|custom
    pub custom_search_url: String,     // contains %s
    pub startup_behavior: String,      // restore|newtab
    pub theme: String,                 // system|dark|light
    pub download_path: String,         // empty = OS default
    pub https_first: bool,
    pub tracker_blocking: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_search_engine: "duckduckgo".to_string(),
            custom_search_url: String::new(),
            startup_behavior: "newtab".to_string(),
            theme: "dark".to_string(),
            download_path: String::new(),
            https_first: true,
            tracker_blocking: false,
        }
    }
}

impl Settings {
    pub fn search_url(&self, query: &str) -> String {
        let q: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
        let template = match self.default_search_engine.as_str() {
            "google" => "https://www.google.com/search?q=%s",
            "brave" => "https://search.brave.com/search?q=%s",
            "startpage" => "https://www.startpage.com/sp/search?query=%s",
            "kagi" => "https://kagi.com/search?q=%s",
            "custom" if !self.custom_search_url.trim().is_empty() => self.custom_search_url.as_str(),
            _ => "https://duckduckgo.com/?q=%s",
        };
        template.replace("%s", &q)
    }
}
