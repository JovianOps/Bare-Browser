use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub path: String,
    pub total_bytes: Option<u64>,
    pub received_bytes: u64,
    pub state: String, // pending|downloading|completed|failed|cancelled
    pub speed_bps: u64,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct DownloadState {
    pub items: Vec<DownloadItem>,
}
