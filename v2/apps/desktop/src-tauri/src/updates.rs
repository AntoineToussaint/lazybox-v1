//! Updates for an installed release: the Tauri updater reads a signed feed
//! (latest.json on the `v2-updates` GitHub release, RELEASING.md), and an
//! accepted update moves the Runner service to the new version before the
//! app restarts, so the two never run different versions for long. Agents
//! keep running across that Runner restart (SESSION_HOSTS.md).
//!
//! Only a release build carries an updater configuration
//! (packaging/release.tauri.json plus the public key the build adds); Dev
//! and Working update through stage and promote, and get none of this.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Whether this build can check for updates: a public key and only HTTPS
/// feeds. A build without them never registers the updater.
pub fn configured(config: &tauri::Config) -> bool {
    let Some(updater) = config.plugins.0.get("updater") else {
        return false;
    };
    let pubkey = updater.get("pubkey").and_then(|v| v.as_str()).unwrap_or("");
    let endpoints = updater
        .get("endpoints")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    !pubkey.trim().is_empty()
        && !endpoints.is_empty()
        && endpoints.iter().all(|e| {
            e.as_str()
                .and_then(|s| url::Url::parse(s).ok())
                .is_some_and(|u| u.scheme() == "https")
        })
}

/// The update found by the last check, kept so installing it does not fetch the feed again.
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Update>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    version: String,
    current: String,
    notes: String,
    date: String,
}

#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<Available>, String> {
    if !configured(app.config()) {
        return Err("This build of Lazybox does not update itself".into());
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Could not check for updates: {e}"))?;
    let found = update.as_ref().map(|u| Available {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        date: u.date.map(|d| d.to_string()).unwrap_or_default(),
    });
    *app.state::<Pending>().0.lock().map_err(|e| e.to_string())? = update;
    Ok(found)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    downloaded: u64,
    total: u64,
}

/// Downloads and installs the pending update, moves the Runner service to
/// it, and restarts the app. The download is verified against the build's
/// public key by the updater before anything is replaced.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, webview: Webview) -> Result<(), String> {
    let update = app
        .state::<Pending>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("No update to install; check for updates first")?;
    let mut downloaded = 0u64;
    let progress = webview.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit(
                    "update-progress",
                    Progress {
                        phase: "download",
                        downloaded,
                        total: total.unwrap_or(0),
                    },
                );
            },
            || (),
        )
        .await
        .map_err(|e| format!("Could not install the update: {e}"))?;
    let _ = webview.emit(
        "update-progress",
        Progress {
            phase: "runner",
            downloaded: 0,
            total: 0,
        },
    );
    // The bundle on disk is the new version now, and so is its CLI. If this
    // fails, the next launch updates the service anyway (release::prepare).
    if let Some(release) = crate::release::Release::detect(&app) {
        let result =
            tauri::async_runtime::spawn_blocking(move || release.json(&["service", "install"]))
                .await;
        if let Ok(Err(error)) | Err(error) = result.map_err(|e| e.to_string()) {
            eprintln!("Updating the Runner service after the app update: {error}");
        }
    }
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(plugins: serde_json::Value) -> tauri::Config {
        let mut config: tauri::Config = serde_json::from_value(serde_json::json!({
            "identifier": "ai.lazybox.test"
        }))
        .expect("config");
        config.plugins = serde_json::from_value(plugins).expect("plugins");
        config
    }

    #[test]
    fn only_a_signed_https_feed_enables_updates() {
        // Dev and Working: no updater section at all.
        assert!(!configured(&config(serde_json::json!({}))));
        let feed =
            "https://github.com/AntoineToussaint/lazybox/releases/download/v2-updates/latest.json";
        assert!(configured(&config(
            serde_json::json!({ "updater": { "pubkey": "dW50cnVzdGVk", "endpoints": [feed] } })
        )));
        // Without the public key the build adds, nothing can be verified.
        assert!(!configured(&config(
            serde_json::json!({ "updater": { "pubkey": "", "endpoints": [feed] } })
        )));
        assert!(!configured(&config(
            serde_json::json!({ "updater": { "pubkey": "k", "endpoints": [] } })
        )));
        assert!(!configured(&config(
            serde_json::json!({ "updater": { "pubkey": "k", "endpoints": ["http://example.com/latest.json"] } })
        )));
    }

    /// The committed configuration ships no updater: only a release build
    /// merges one in, with its public key (scripts/release/build.mjs).
    #[test]
    fn the_committed_configuration_does_not_update_itself() {
        let config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        assert!(!configured(&config));
    }

    /// The release overlay names an HTTPS feed and never a key: the public
    /// key is added at build time, and no private key is ever in the tree.
    #[test]
    fn the_release_overlay_has_a_feed_and_no_key() {
        let overlay: serde_json::Value =
            serde_json::from_str(include_str!("../../../../packaging/release.tauri.json"))
                .expect("release.tauri.json");
        let updater = &overlay["plugins"]["updater"];
        assert!(updater.get("pubkey").is_none());
        let endpoints = updater["endpoints"].as_array().expect("endpoints");
        assert!(!endpoints.is_empty());
        for endpoint in endpoints {
            assert!(
                endpoint
                    .as_str()
                    .expect("endpoint")
                    .starts_with("https://github.com/")
            );
        }
        assert_eq!(overlay["identifier"], "ai.lazybox.app");
        let mut merged = overlay.clone();
        merged["plugins"]["updater"]["pubkey"] = "dW50cnVzdGVk".into();
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        config.plugins = serde_json::from_value(merged["plugins"].clone()).expect("plugins");
        assert!(configured(&config));
    }
}
