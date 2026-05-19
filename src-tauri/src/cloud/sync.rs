//! Cloud Sync state + push/pull primitives.
//!
//! v1 syncs three namespaces (`settings`, `prompts`, `keymap`). Each
//! `(namespace, key)` carries a monotonic `version` on the server. The
//! client keeps the last-seen version per key locally so it can do CAS
//! writes (PUT with `base_version`) and incremental pulls (`?since=`).
//!
//! Whitelisting which Zustand fields to sync is the frontend's job — this
//! file is provider-agnostic.

use std::collections::HashMap;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::{CloudError, CloudState};

/// In-process sync state. Not persisted across app restarts; on launch we
/// just refetch with `since=0` (every key) which is cheap (<10 KB total).
#[derive(Default)]
pub struct SyncRuntime {
    /// Highest version we've observed per namespace.
    pub since: HashMap<String, i64>,
    pub last_synced_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub in_flight: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncItem {
    pub key: String,
    /// Any JSON value (string, number, object). `null` when `deleted`.
    pub value: serde_json::Value,
    pub version: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub updated_by: Option<String>,
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Debug, Serialize)]
struct PutBody<'a> {
    value: &'a serde_json::Value,
    base_version: i64,
}

#[derive(Debug, Deserialize)]
struct PutOk {
    version: i64,
}

#[derive(Debug, Deserialize)]
struct PullResponse {
    items: Vec<SyncItem>,
    #[serde(default)]
    has_more: bool,
}

/// Pull all items in `namespace` newer than the local high-water mark.
/// Returns the items in version order so the caller can apply them
/// deterministically; updates the in-memory high-water mark on success.
pub async fn pull(
    state: &CloudState,
    namespace: &str,
    token: &str,
) -> Result<Vec<SyncItem>, CloudError> {
    let since = state
        .sync
        .read()
        .expect("sync RwLock")
        .since
        .get(namespace)
        .copied()
        .unwrap_or(0);

    let mut all = Vec::new();
    let mut cursor = since;
    loop {
        let path = format!("/v1/sync/{}?since={}", namespace, cursor);
        let res: PullResponse = state
            .http
            .request::<(), _>(&state.base_url(), Method::GET, &path, None, Some(token))
            .await?;
        for item in &res.items {
            if item.version > cursor {
                cursor = item.version;
            }
        }
        all.extend(res.items);
        if !res.has_more {
            break;
        }
    }
    if cursor > since {
        state
            .sync
            .write()
            .expect("sync RwLock")
            .since
            .insert(namespace.to_string(), cursor);
    }
    Ok(all)
}

/// PUT a single key with CAS. Returns the new version on success.
/// Surfaces a [`CloudError::SyncConflict`] on 409 so the frontend can
/// react (re-pull + merge).
pub async fn put_one(
    state: &CloudState,
    namespace: &str,
    key: &str,
    value: &serde_json::Value,
    base_version: i64,
    token: &str,
) -> Result<i64, CloudError> {
    let path = format!("/v1/sync/{}/{}", namespace, key);
    match state
        .http
        .request::<_, PutOk>(
            &state.base_url(),
            Method::PUT,
            &path,
            Some(&PutBody {
                value,
                base_version,
            }),
            Some(token),
        )
        .await
    {
        Ok(ok) => Ok(ok.version),
        Err(CloudError::Server { status: 409, .. }) => Err(CloudError::SyncConflict {
            namespace: namespace.to_string(),
            key: key.to_string(),
        }),
        Err(e) => Err(e),
    }
}

/// Set the in-flight flag (UI shows the spinner) and clear the last error.
pub fn mark_in_flight(state: &CloudState, in_flight: bool) {
    let mut rt = state.sync.write().expect("sync RwLock");
    rt.in_flight = in_flight;
    if in_flight {
        rt.last_error = None;
    }
}

/// Record a successful sync (updates timestamp; the UI shows "Synced N min
/// ago" relative to this).
pub fn mark_synced(state: &CloudState, now_ms: i64) {
    let mut rt = state.sync.write().expect("sync RwLock");
    rt.last_synced_at_ms = Some(now_ms);
    rt.last_error = None;
    rt.in_flight = false;
}

pub fn mark_error(state: &CloudState, msg: String) {
    let mut rt = state.sync.write().expect("sync RwLock");
    rt.last_error = Some(msg);
    rt.in_flight = false;
}
