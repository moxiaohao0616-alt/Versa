//! Thin reqwest wrapper. Two responsibilities:
//!   1. Adopt the `Authorization: Bearer …` header from the keychain on
//!      every authenticated call (without surfacing the token to callers).
//!   2. Decode the server-side JSON error envelope
//!      (`{ "error": { "code", "message" } }`) into [`super::CloudError::Server`].

use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};

use super::CloudError;

pub struct HttpClient {
    client: Client,
}

impl HttpClient {
    pub fn new() -> Self {
        // reqwest reads HTTP(S)_PROXY env vars automatically. rustls is the
        // TLS backend chosen in Cargo.toml so we don't depend on system
        // OpenSSL on Linux.
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .user_agent(format!("versa/{}", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("reqwest Client build"),
        }
    }

    /// Make a request and decode the JSON response. Pass `auth_token: None`
    /// for anonymous endpoints (auth/device/start, /healthz, etc).
    pub async fn request<B: Serialize, R: for<'de> Deserialize<'de>>(
        &self,
        base_url: &str,
        method: Method,
        path: &str,
        body: Option<&B>,
        auth_token: Option<&str>,
    ) -> Result<R, CloudError> {
        let url = format!("{}{}", base_url.trim_end_matches('/'), path);
        let mut req = self.client.request(method, &url);
        if let Some(b) = body {
            req = req.json(b);
        }
        if let Some(t) = auth_token {
            req = req.bearer_auth(t);
        }
        let res = req
            .send()
            .await
            .map_err(|e| CloudError::Http(e.to_string()))?;
        let status = res.status();
        let bytes = res
            .bytes()
            .await
            .map_err(|e| CloudError::Http(e.to_string()))?;
        if !status.is_success() {
            let msg = match serde_json::from_slice::<ApiErrorEnvelope>(&bytes) {
                Ok(env) => format!("{}: {}", env.error.code, env.error.message),
                Err(_) => String::from_utf8_lossy(&bytes).into_owned(),
            };
            return Err(CloudError::Server {
                status: status.as_u16(),
                message: msg,
            });
        }
        serde_json::from_slice(&bytes).map_err(|e| {
            CloudError::Http(format!("Decode error: {} (body: {})", e, String::from_utf8_lossy(&bytes)))
        })
    }
}

#[derive(Debug, Deserialize)]
struct ApiErrorEnvelope {
    error: ApiErrorBody,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    code: String,
    message: String,
}
