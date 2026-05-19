//! Versa Cloud client: device-token-based auth against api.versago.app,
//! local token storage in the OS keychain, and the sync state machine.
//!
//! Layout:
//!   * [`auth`] — keyring read/write of the device token.
//!   * [`http`] — thin reqwest wrapper that injects bearer auth and
//!     surfaces server-side error envelopes as Rust errors.
//!   * [`sync`] — push/pull/reconcile for the settings/prompts/keymap
//!     sync namespaces.
//!   * [`commands`] — Tauri `#[command]` entrypoints exposed to the
//!     frontend (`invoke('cloud_*')`).
//!
//! All cloud features are opt-in: nothing in here is touched unless the
//! user has signed in. A local Versa install can operate forever without
//! ever creating a `CloudState` entry beyond its empty default.

pub mod auth;
pub mod commands;
pub mod http;
pub mod sync;

use std::sync::RwLock;

/// The default Versa Cloud base URL. Overridden in dev via
/// `cloud_set_base_url('http://localhost:8787')` so devs can point at a
/// local `wrangler dev` without changing code.
pub const DEFAULT_BASE_URL: &str = "https://api.versago.app";

#[derive(Debug, thiserror::Error)]
pub enum CloudError {
    #[error("Not signed in")]
    NotSignedIn,
    #[error("Pairing flow is not active")]
    NoPendingPair,
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("Keychain error: {0}")]
    Keychain(String),
    #[error("Server error ({status}): {message}")]
    Server { status: u16, message: String },
    #[error("Sync CAS conflict on {namespace}/{key}")]
    SyncConflict { namespace: String, key: String },
}

impl From<CloudError> for String {
    fn from(e: CloudError) -> String {
        e.to_string()
    }
}

/// Per-app cloud state. Held inside a `tauri::State` so all commands share
/// it. Designed to survive page reloads — the only persistent piece is the
/// device token in the OS keychain.
pub struct CloudState {
    /// Base URL of the Versa Cloud API. RwLock so a dev command can swap it
    /// at runtime without restarting Versa.
    pub base_url: RwLock<String>,

    /// In-flight pairing flow (alive between `cloud_signin_start` and the
    /// final `cloud_signin_poll` that mints a token).
    pub pairing: RwLock<Option<auth::PairingState>>,

    /// HTTP client used by every command. Reused so reqwest's connection
    /// pool stays warm.
    pub http: http::HttpClient,

    /// Local sync runtime: in-memory map of last-synced versions per
    /// (namespace, key), plus the last-error message we surface in the UI.
    pub sync: RwLock<sync::SyncRuntime>,
}

impl Default for CloudState {
    fn default() -> Self {
        Self {
            base_url: RwLock::new(DEFAULT_BASE_URL.to_string()),
            pairing: RwLock::new(None),
            http: http::HttpClient::new(),
            sync: RwLock::new(sync::SyncRuntime::default()),
        }
    }
}

impl CloudState {
    pub fn base_url(&self) -> String {
        self.base_url.read().expect("base_url RwLock poisoned").clone()
    }
}
