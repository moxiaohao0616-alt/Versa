//! Tauri `#[command]` entry points. The frontend calls these via
//! `invoke('cloud_*', { ... })`.
//!
//! All payloads use serde rename rules so the wire format matches the
//! camelCase TS types in `src/cloud/`.

use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::auth::{self, PairingState};
use super::sync::{self, SyncItem};
use super::{CloudError, CloudState};

// ============================================================================
// Status
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub signed_in: bool,
    pub user: Option<UserInfo>,
    pub subscription: Option<SubscriptionInfo>,
    pub device: Option<DeviceInfo>,
    pub sync: SyncStateOut,
    pub base_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStateOut {
    pub in_flight: bool,
    pub last_synced_at_ms: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub github_id: Option<i64>,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionInfo {
    pub plan: String,
    pub status: String,
    pub current_period_end: Option<i64>,
    #[serde(default)]
    pub cancel_at_period_end: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
}

#[derive(Deserialize)]
struct MeResponse {
    user: UserInfo,
    subscription: SubscriptionInfo,
    device: DeviceInfo,
}

/// One-shot status snapshot. Returns `signed_in: false` and no user when the
/// keychain has no token; otherwise calls /v1/me to refresh user + plan.
#[tauri::command]
pub async fn cloud_status(state: State<'_, CloudState>) -> Result<CloudStatus, String> {
    let sync_state = {
        let rt = state.sync.read().expect("sync RwLock");
        SyncStateOut {
            in_flight: rt.in_flight,
            last_synced_at_ms: rt.last_synced_at_ms,
            last_error: rt.last_error.clone(),
        }
    };
    let base_url = state.base_url();

    let token = match auth::load_token() {
        Ok(Some(t)) => t,
        Ok(None) => {
            return Ok(CloudStatus {
                signed_in: false,
                user: None,
                subscription: None,
                device: None,
                sync: sync_state,
                base_url,
            });
        }
        Err(e) => return Err(e.to_string()),
    };

    match state
        .http
        .request::<(), MeResponse>(&base_url, Method::GET, "/v1/me", None, Some(&token))
        .await
    {
        Ok(me) => Ok(CloudStatus {
            signed_in: true,
            user: Some(me.user),
            subscription: Some(me.subscription),
            device: Some(me.device),
            sync: sync_state,
            base_url,
        }),
        Err(CloudError::Server { status: 401, .. }) => {
            // Token rejected — clean it out so the UI returns to signed-out.
            let _ = auth::delete_token();
            Ok(CloudStatus {
                signed_in: false,
                user: None,
                subscription: None,
                device: None,
                sync: sync_state,
                base_url,
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn cloud_set_base_url(state: State<'_, CloudState>, url: String) -> Result<(), String> {
    let mut w = state.base_url.write().map_err(|e| e.to_string())?;
    *w = url;
    Ok(())
}

// ============================================================================
// Sign-in (device pairing)
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SigninStartArgs {
    pub device_name: String,
    pub platform: String, // 'macos' | 'linux' | 'windows' | 'unknown'
    pub versa_version: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SigninStartResp {
    pub pair_code: String,
    pub verification_url: String,
    pub expires_in_seconds: u32,
    pub poll_interval_seconds: u32,
}

#[derive(Serialize)]
struct StartBody<'a> {
    name: &'a str,
    platform: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    versa_version: Option<&'a str>,
}

#[derive(Deserialize)]
struct ServerStartResp {
    pair_code: String,
    client_secret: String,
    verification_url: String,
    expires_in_seconds: u32,
    poll_interval_seconds: u32,
}

#[tauri::command]
pub async fn cloud_signin_start(
    state: State<'_, CloudState>,
    args: SigninStartArgs,
) -> Result<SigninStartResp, String> {
    let body = StartBody {
        name: &args.device_name,
        platform: &args.platform,
        versa_version: args.versa_version.as_deref(),
    };
    let res: ServerStartResp = state
        .http
        .request(
            &state.base_url(),
            Method::POST,
            "/v1/auth/device/start",
            Some(&body),
            None,
        )
        .await
        .map_err(|e| e.to_string())?;

    *state.pairing.write().map_err(|e| e.to_string())? = Some(PairingState {
        pair_code: res.pair_code.clone(),
        client_secret: res.client_secret,
    });

    Ok(SigninStartResp {
        pair_code: res.pair_code,
        verification_url: res.verification_url,
        expires_in_seconds: res.expires_in_seconds,
        poll_interval_seconds: res.poll_interval_seconds,
    })
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SigninPollResp {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "ok")]
    #[serde(rename_all = "camelCase")]
    Ok {
        device_id: String,
        expires_at: Option<i64>,
    },
    #[serde(rename = "expired")]
    Expired,
    #[serde(rename = "consumed")]
    Consumed,
}

#[derive(Serialize)]
struct PollBody<'a> {
    pair_code: &'a str,
    client_secret: &'a str,
}

#[derive(Deserialize)]
#[serde(tag = "status")]
enum ServerPollResp {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "ok")]
    Ok {
        device_id: String,
        device_token: String,
        #[serde(default)]
        expires_at: Option<i64>,
    },
    #[serde(rename = "expired")]
    Expired,
    #[serde(rename = "consumed")]
    Consumed,
}

#[tauri::command]
pub async fn cloud_signin_poll(state: State<'_, CloudState>) -> Result<SigninPollResp, String> {
    let (pair_code, client_secret) = {
        let p = state.pairing.read().map_err(|e| e.to_string())?;
        let p = p.as_ref().ok_or(CloudError::NoPendingPair).map_err(|e| e.to_string())?;
        (p.pair_code.clone(), p.client_secret.clone())
    };

    let body = PollBody {
        pair_code: &pair_code,
        client_secret: &client_secret,
    };
    let res: ServerPollResp = state
        .http
        .request(
            &state.base_url(),
            Method::POST,
            "/v1/auth/device/poll",
            Some(&body),
            None,
        )
        .await
        .map_err(|e| e.to_string())?;

    match res {
        ServerPollResp::Pending => Ok(SigninPollResp::Pending),
        ServerPollResp::Expired => {
            *state.pairing.write().map_err(|e| e.to_string())? = None;
            Ok(SigninPollResp::Expired)
        }
        ServerPollResp::Consumed => {
            *state.pairing.write().map_err(|e| e.to_string())? = None;
            Ok(SigninPollResp::Consumed)
        }
        ServerPollResp::Ok {
            device_id,
            device_token,
            expires_at,
        } => {
            // Persist before clearing pairing state, so a crash mid-storage
            // doesn't leave us with an orphaned token on the server.
            auth::store_token(&device_token).map_err(|e| e.to_string())?;
            auth::store_device_id(&device_id).map_err(|e| e.to_string())?;
            *state.pairing.write().map_err(|e| e.to_string())? = None;
            Ok(SigninPollResp::Ok {
                device_id,
                expires_at,
            })
        }
    }
}

#[tauri::command]
pub fn cloud_signin_cancel(state: State<'_, CloudState>) -> Result<(), String> {
    *state.pairing.write().map_err(|e| e.to_string())? = None;
    Ok(())
}

// ============================================================================
// Sign-out
// ============================================================================

#[tauri::command]
pub async fn cloud_signout(state: State<'_, CloudState>) -> Result<(), String> {
    // Tell the server first (best-effort; failure isn't fatal — we still
    // delete the local token so the user is signed-out from this device).
    if let Ok(Some(token)) = auth::load_token() {
        let _ = state
            .http
            .request::<(), serde_json::Value>(
                &state.base_url(),
                Method::POST,
                "/v1/auth/logout",
                None,
                Some(&token),
            )
            .await;
    }
    auth::delete_token().map_err(|e| e.to_string())?;
    // Clear in-memory sync state too.
    let mut rt = state.sync.write().map_err(|e| e.to_string())?;
    *rt = sync::SyncRuntime::default();
    Ok(())
}

// ============================================================================
// Devices
// ============================================================================

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRow {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub versa_version: Option<String>,
    pub last_seen_at: i64,
    pub created_at: i64,
    #[serde(default)]
    pub current: bool,
}

#[derive(Deserialize)]
struct DevicesResp {
    devices: Vec<DeviceRow>,
}

#[tauri::command]
pub async fn cloud_list_devices(state: State<'_, CloudState>) -> Result<Vec<DeviceRow>, String> {
    let token = require_token().map_err(|e| e.to_string())?;
    let res: DevicesResp = state
        .http
        .request::<(), _>(
            &state.base_url(),
            Method::GET,
            "/v1/devices",
            None,
            Some(&token),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.devices)
}

#[tauri::command]
pub async fn cloud_revoke_device(
    state: State<'_, CloudState>,
    device_id: String,
) -> Result<(), String> {
    let token = require_token().map_err(|e| e.to_string())?;
    let path = format!("/v1/devices/{}", device_id);
    let _: serde_json::Value = state
        .http
        .request::<(), _>(&state.base_url(), Method::DELETE, &path, None, Some(&token))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Sync
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPullResp {
    pub namespace: String,
    pub items: Vec<SyncItem>,
}

/// Pull a single namespace. Returns all items newer than the local
/// high-water mark (which is then advanced).
#[tauri::command]
pub async fn cloud_sync_pull(
    state: State<'_, CloudState>,
    namespace: String,
) -> Result<SyncPullResp, String> {
    let token = require_token().map_err(|e| e.to_string())?;
    sync::mark_in_flight(&state, true);
    match sync::pull(&state, &namespace, &token).await {
        Ok(items) => {
            sync::mark_synced(&state, now_ms());
            Ok(SyncPullResp { namespace, items })
        }
        Err(e) => {
            sync::mark_error(&state, e.to_string());
            Err(e.to_string())
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPushArgs {
    pub namespace: String,
    pub key: String,
    pub value: serde_json::Value,
    pub base_version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPushResp {
    pub version: i64,
}

/// PUT a single key. The frontend tracks base_version; we surface a CAS
/// conflict (409) as a structured Err string the UI can pattern-match.
#[tauri::command]
pub async fn cloud_sync_push(
    state: State<'_, CloudState>,
    args: SyncPushArgs,
) -> Result<SyncPushResp, String> {
    let token = require_token().map_err(|e| e.to_string())?;
    sync::mark_in_flight(&state, true);
    match sync::put_one(
        &state,
        &args.namespace,
        &args.key,
        &args.value,
        args.base_version,
        &token,
    )
    .await
    {
        Ok(version) => {
            // Advance high-water mark so the next pull doesn't re-emit our
            // own write back to us.
            state
                .sync
                .write()
                .map_err(|e| e.to_string())?
                .since
                .entry(args.namespace)
                .and_modify(|v| {
                    if version > *v {
                        *v = version;
                    }
                })
                .or_insert(version);
            sync::mark_synced(&state, now_ms());
            Ok(SyncPushResp { version })
        }
        Err(e) => {
            let msg = e.to_string();
            sync::mark_error(&state, msg.clone());
            Err(msg)
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn require_token() -> Result<String, CloudError> {
    auth::load_token()?.ok_or(CloudError::NotSignedIn)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
