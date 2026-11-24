use crate::settings::Settings;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub visited_at: i64,
    #[serde(default)]
    pub visit_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
    #[serde(default)]
    pub active_index: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SitePermission {
    pub origin: String,
    pub permission: String, // notifications|geolocation|camera|microphone|popups
    pub allow: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrowserData {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub bookmarks: Vec<Bookmark>,
    #[serde(default)]
    pub history: Vec<HistoryEntry>,
    #[serde(default)]
    pub session: SessionState,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub site_permissions: Vec<SitePermission>,
}

pub struct JsonStore {
    path: PathBuf,
}

impl JsonStore {
    pub fn new(path: PathBuf) -> Self { Self { path } }
    pub fn load<T: DeserializeOwned + Default>(&self) -> T {
        match fs::read_to_string(&self.path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => T::default(),
        }
    }
    pub fn save<T: Serialize>(&self, value: &T) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let data = serde_json::to_string_pretty(value).map_err(|e| format!("serialize failed: {e}"))?;
        fs::write(&tmp, data).map_err(|e| format!("write tmp failed: {e}"))?;
        fs::rename(&tmp, &self.path).map_err(|e| format!("rename failed: {e}"))?;
        Ok(())
    }
}

pub struct StorageState {
    pub store: JsonStore,
    pub data: BrowserData,
}

impl StorageState {
    pub fn new(path: PathBuf) -> Self {
        let store = JsonStore::new(path);
        let mut data = store.load::<BrowserData>();
        if data.schema_version == 0 {
            data.schema_version = 1;
            // Best-effort: persist upgraded schema; ignore errors on first load.
            let _ = store.save(&data);
        }
        Self { store, data }
    }
    pub fn save(&self) -> Result<(), String> {
        // Keep a simple backup for recovery.
        if self.store.path.exists() {
            let bak = self.store.path.with_extension("json.bak");
            let _ = fs::copy(&self.store.path, bak);
        }
        self.store.save(&self.data)
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}-{}", now_ms(), std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp(name: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("nadir-test-{name}-{nanos}.json"))
    }

    #[test]
    fn json_store_roundtrip() {
        let path = tmp("roundtrip");
        let store = JsonStore::new(path.clone());
        let data = BrowserData { schema_version: 1, ..Default::default() };
        store.save(&data).unwrap();
        let loaded: BrowserData = store.load();
        assert_eq!(loaded.schema_version, 1);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn storage_state_sets_schema_version() {
        let path = tmp("schema");
        let state = StorageState::new(path.clone());
        assert_eq!(state.data.schema_version, 1);
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(path.with_extension("json.bak"));
    }
}
