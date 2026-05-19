//! Token storage and the in-flight pairing state.
//!
//! Tokens live in the OS keychain:
//!   * macOS  → login Keychain, item "versa-cloud / device-token"
//!   * Linux  → Secret Service / GNOME keyring
//!   * Windows→ Credential Manager
//!
//! `client_secret` (the half of the pair flow that only the desktop client
//! knows) lives in memory only — it expires with the pair code in 10 min,
//! so persistence would only widen the attack surface.

use keyring::Entry;

use super::CloudError;

const SERVICE: &str = "versa-cloud";
const ACCOUNT_TOKEN: &str = "device-token";
const ACCOUNT_DEVICE_ID: &str = "device-id";

/// Held in [`super::CloudState`] only while a pairing flow is active.
/// `pair_code` is shown to the user (also stored on the server side);
/// `client_secret` proves to the server that this client is the one that
/// started the flow, so a third party who learns the pair_code from the
/// user's screen still can't pick up the minted token.
pub struct PairingState {
    pub pair_code: String,
    pub client_secret: String,
}

fn entry(account: &str) -> Result<Entry, CloudError> {
    Entry::new(SERVICE, account).map_err(|e| CloudError::Keychain(e.to_string()))
}

pub fn store_token(token: &str) -> Result<(), CloudError> {
    entry(ACCOUNT_TOKEN)?
        .set_password(token)
        .map_err(|e| CloudError::Keychain(e.to_string()))
}

pub fn load_token() -> Result<Option<String>, CloudError> {
    match entry(ACCOUNT_TOKEN)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(CloudError::Keychain(e.to_string())),
    }
}

pub fn delete_token() -> Result<(), CloudError> {
    delete_entry(ACCOUNT_TOKEN)?;
    // Also clean the device-id cache; it's tied to the token.
    delete_entry(ACCOUNT_DEVICE_ID)?;
    Ok(())
}

pub fn store_device_id(device_id: &str) -> Result<(), CloudError> {
    entry(ACCOUNT_DEVICE_ID)?
        .set_password(device_id)
        .map_err(|e| CloudError::Keychain(e.to_string()))
}

fn delete_entry(account: &str) -> Result<(), CloudError> {
    match entry(account)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(CloudError::Keychain(e.to_string())),
    }
}
