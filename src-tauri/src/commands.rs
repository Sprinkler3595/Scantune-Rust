//! Couche commandes Tauri : pont entre le frontend React et les services Rust.
//! Joue le rôle des ViewModels WPF (orchestration + cache).

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

use crate::auth::{AuthState, AuthStatus};
use crate::config::{self, AppConfig};
use crate::export;
use crate::graph::GraphClient;
use crate::label_template::{self, LabelTemplate};
use crate::models::{BitLockerRecoveryKey, DetectedApp, EntraUser, IntuneDevice, IntuneDeviceView};
use crate::qr;

const CACHE_TTL: Duration = Duration::from_secs(300); // 5 min, comme le C#

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub auth: AuthState,
    pub cache: Mutex<Cache>,
    /// Client HTTP partagé : réutilisé pour toutes les requêtes Graph afin de
    /// conserver les connexions TLS (keep-alive) et éviter une poignée de main
    /// à chaque action. `reqwest::Client` est un handle léger (clone = Arc).
    pub http: reqwest::Client,
}

#[derive(Default)]
pub struct Cache {
    devices: Option<(Instant, Vec<IntuneDevice>)>,
    users: Option<(Instant, Vec<EntraUser>)>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(config::load()),
            auth: AuthState::default(),
            cache: Mutex::new(Cache::default()),
            http: build_http_client(),
        }
    }

    fn config_snapshot(&self) -> AppConfig {
        self.config.lock().unwrap().clone()
    }
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Construit le client HTTP partagé (keep-alive + timeouts raisonnables).
fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("ScanTune/1.0")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

// --- Config ---

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppConfig {
    state.config_snapshot()
}

#[tauri::command]
pub fn save_config(state: State<AppState>, config: AppConfig) -> CmdResult<()> {
    config::save(&config).map_err(err)?;
    *state.config.lock().unwrap() = config;
    // La config a changé → on vide le cache et la session.
    *state.cache.lock().unwrap() = Cache::default();
    state.auth.sign_out();
    Ok(())
}

// --- Auth ---

#[tauri::command]
pub fn auth_status(state: State<AppState>) -> AuthStatus {
    state.auth.status()
}

#[tauri::command]
pub async fn sign_in(state: State<'_, AppState>) -> CmdResult<AuthStatus> {
    let cfg = state.config_snapshot();
    state.auth.get_access_token(&cfg).await.map_err(err)?;
    Ok(state.auth.status())
}

#[tauri::command]
pub fn sign_out(state: State<AppState>) -> CmdResult<()> {
    state.auth.sign_out();
    *state.cache.lock().unwrap() = Cache::default();
    Ok(())
}

#[tauri::command]
pub async fn current_user_name(state: State<'_, AppState>) -> CmdResult<String> {
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    client.current_user_name().await.map_err(err)
}

// --- Appareils ---

async fn load_devices(state: &AppState, force: bool) -> Result<Vec<IntuneDevice>, String> {
    if !force {
        if let Some((ts, devices)) = &state.cache.lock().unwrap().devices {
            if ts.elapsed() < CACHE_TTL {
                return Ok(devices.clone());
            }
        }
    }
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    let devices = client.all_devices().await.map_err(err)?;
    state.cache.lock().unwrap().devices = Some((Instant::now(), devices.clone()));
    Ok(devices)
}

#[tauri::command]
pub async fn get_devices(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> CmdResult<Vec<IntuneDeviceView>> {
    let devices = load_devices(&state, force.unwrap_or(false)).await?;
    Ok(devices.iter().map(|d| d.enrich()).collect())
}

#[tauri::command]
pub async fn get_device(state: State<'_, AppState>, id: String) -> CmdResult<Option<IntuneDeviceView>> {
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    let d = client.device_by_id(&id).await.map_err(err)?;
    Ok(d.map(|d| d.enrich()))
}

#[tauri::command]
pub async fn search_devices(
    state: State<'_, AppState>,
    query: String,
) -> CmdResult<Vec<IntuneDeviceView>> {
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    let devices = client.search_devices(&query).await.map_err(err)?;
    Ok(devices.iter().map(|d| d.enrich()).collect())
}

// --- Utilisateurs ---

async fn load_users(state: &AppState, force: bool) -> Result<Vec<EntraUser>, String> {
    if !force {
        if let Some((ts, users)) = &state.cache.lock().unwrap().users {
            if ts.elapsed() < CACHE_TTL {
                return Ok(users.clone());
            }
        }
    }
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    let users = client.all_users().await.map_err(err)?;
    state.cache.lock().unwrap().users = Some((Instant::now(), users.clone()));
    Ok(users)
}

#[tauri::command]
pub async fn get_users(state: State<'_, AppState>, force: Option<bool>) -> CmdResult<Vec<EntraUser>> {
    load_users(&state, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn get_user(state: State<'_, AppState>, id: String) -> CmdResult<Option<EntraUser>> {
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    let user = client.user_by_id(&id).await.map_err(err)?;
    let Some(mut user) = user else {
        return Ok(None);
    };
    user.devices = client.user_devices(&id).await.unwrap_or_default();
    Ok(Some(user))
}

#[tauri::command]
pub async fn search_users(state: State<'_, AppState>, query: String) -> CmdResult<Vec<EntraUser>> {
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    client.search_users(&query).await.map_err(err)
}

// --- Applications détectées ---

#[tauri::command]
pub async fn get_device_apps(
    state: State<'_, AppState>,
    device_id: String,
) -> CmdResult<Vec<DetectedApp>> {
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    client.detected_apps_for_device(&device_id).await.map_err(err)
}

// --- BitLocker ---

#[tauri::command]
pub async fn get_bitlocker_keys(
    state: State<'_, AppState>,
    azure_ad_device_id: String,
) -> CmdResult<Vec<BitLockerRecoveryKey>> {
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    client
        .bitlocker_keys_for_device(&azure_ad_device_id)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn get_bitlocker_key_value(
    state: State<'_, AppState>,
    recovery_key_id: String,
) -> CmdResult<Option<String>> {
    let cfg = state.config_snapshot();
    let client = GraphClient::new(&state.auth, &cfg, state.http.clone());
    client.bitlocker_key_value(&recovery_key_id).await.map_err(err)
}

// --- Dashboard ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountPair {
    pub label: String,
    pub count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub total: usize,
    pub compliant: usize,
    pub non_compliant: usize,
    pub stale: usize,
    pub compliance_rate: f64,
    pub by_os: Vec<CountPair>,
    pub by_compliance: Vec<CountPair>,
    pub recently_enrolled: Vec<IntuneDeviceView>,
    pub stale_devices: Vec<IntuneDeviceView>,
}

fn group_count(devices: &[IntuneDevice], key: impl Fn(&IntuneDevice) -> String) -> Vec<CountPair> {
    use std::collections::HashMap;
    let mut map: HashMap<String, usize> = HashMap::new();
    for d in devices {
        *map.entry(key(d)).or_default() += 1;
    }
    let mut v: Vec<CountPair> = map
        .into_iter()
        .map(|(label, count)| CountPair { label, count })
        .collect();
    v.sort_by(|a, b| b.count.cmp(&a.count));
    v
}

#[tauri::command]
pub async fn dashboard_stats(state: State<'_, AppState>, force: Option<bool>) -> CmdResult<DashboardStats> {
    let devices = load_devices(&state, force.unwrap_or(false)).await?;
    let total = devices.len();
    let compliant = devices.iter().filter(|d| d.is_compliant()).count();
    let non_compliant = total - compliant;
    let stale = devices.iter().filter(|d| d.days_since_last_sync() > 30).count();
    let compliance_rate = if total > 0 {
        ((compliant as f64 / total as f64 * 1000.0).round()) / 10.0
    } else {
        0.0
    };

    let by_os = group_count(&devices, |d| {
        if d.operating_system.is_empty() {
            "(inconnu)".into()
        } else {
            d.operating_system.clone()
        }
    });
    let by_compliance = group_count(&devices, |d| {
        if d.compliance_state.is_empty() {
            "(vide)".into()
        } else {
            d.compliance_state.clone()
        }
    });

    let mut recent: Vec<&IntuneDevice> = devices.iter().collect();
    recent.sort_by(|a, b| b.enrolled_date_time.cmp(&a.enrolled_date_time));
    let recently_enrolled = recent
        .iter()
        .take(10)
        .map(|d| d.enrich())
        .collect();

    let stale_devices = devices
        .iter()
        .filter(|d| d.days_since_last_sync() > 30)
        .take(20)
        .map(|d| d.enrich())
        .collect();

    Ok(DashboardStats {
        total,
        compliant,
        non_compliant,
        stale,
        compliance_rate,
        by_os,
        by_compliance,
        recently_enrolled,
        stale_devices,
    })
}

// --- QR ---

#[tauri::command]
pub async fn generate_qr_data_url(state: State<'_, AppState>, device_id: String) -> CmdResult<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let devices = load_devices(&state, false).await?;
    let device = devices
        .iter()
        .find(|d| d.id == device_id)
        .ok_or_else(|| "Appareil introuvable".to_string())?;
    let png = qr::generate_qr_png(device, 8).map_err(err)?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

#[tauri::command]
pub async fn export_qr_png(
    state: State<'_, AppState>,
    device_id: String,
    path: String,
) -> CmdResult<()> {
    let devices = load_devices(&state, false).await?;
    let device = devices
        .iter()
        .find(|d| d.id == device_id)
        .ok_or_else(|| "Appareil introuvable".to_string())?;
    let png = qr::generate_qr_png(device, 10).map_err(err)?;
    std::fs::write(&path, png).map_err(err)
}

// --- Exports ---

async fn devices_for_scope(state: &AppState, scope: &str) -> Result<Vec<IntuneDevice>, String> {
    let all = load_devices(state, false).await?;
    Ok(match scope {
        "compliant" => all.into_iter().filter(|d| d.is_compliant()).collect(),
        "noncompliant" => all.into_iter().filter(|d| !d.is_compliant()).collect(),
        "stale" => all
            .into_iter()
            .filter(|d| d.days_since_last_sync() > 30)
            .collect(),
        _ => all,
    })
}

#[tauri::command]
pub async fn export_csv(state: State<'_, AppState>, path: String, scope: String) -> CmdResult<()> {
    let devices = devices_for_scope(&state, &scope).await?;
    export::export_csv(&devices, &path).map_err(err)
}

#[tauri::command]
pub async fn export_devices_xlsx(
    state: State<'_, AppState>,
    path: String,
    scope: String,
) -> CmdResult<()> {
    let devices = devices_for_scope(&state, &scope).await?;
    export::export_devices_xlsx(&devices, &path).map_err(err)
}

#[tauri::command]
pub async fn export_users_xlsx(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let users = load_users(&state, false).await?;
    export::export_users_xlsx(&users, &path).map_err(err)
}

#[tauri::command]
pub async fn export_inventory_pdf(
    state: State<'_, AppState>,
    path: String,
    scope: String,
) -> CmdResult<()> {
    let devices = devices_for_scope(&state, &scope).await?;
    export::generate_inventory_report(&devices, &path).map_err(err)
}

// --- Impression ---

/// Ouvre le dialogue d'impression natif du système.
///
/// Passe par l'API Rust et non par `window.print()` côté JS : sur macOS, Tauri
/// remplace `window.print` par un appel à la commande interne
/// `plugin:webview|print`, que notre ACL n'autorise pas (`allow-print` n'est pas
/// dans `core:webview:default`). L'appel échouerait dans une promesse rejetée
/// que personne n'observe, `window.print()` étant typé `void`. Ici on récupère
/// un vrai `Result` affichable.
///
/// Aucune permission à ajouter : l'ACL ne filtre que les commandes intégrées.
#[tauri::command]
pub fn print_labels(window: tauri::WebviewWindow) -> CmdResult<()> {
    window.print().map_err(err)
}

// --- Template d'étiquette ---
//
// Volontairement à l'écart d'`AppConfig` : `save_config` vide le cache et
// déconnecte l'utilisateur (voir plus haut). Le template a son propre fichier
// et ses propres commandes, pour qu'enregistrer une mise en page ne coûte
// jamais une reconnexion.

#[tauri::command]
pub fn get_label_template() -> LabelTemplate {
    label_template::load()
}

#[tauri::command]
pub fn save_label_template(template: LabelTemplate) -> CmdResult<()> {
    label_template::save(&template).map_err(err)
}

#[tauri::command]
pub fn reset_label_template() -> CmdResult<LabelTemplate> {
    let t = LabelTemplate::default();
    label_template::save(&t).map_err(err)?;
    Ok(t)
}

/// Exporte le template vers un fichier choisi (autonome : image comprise).
#[tauri::command]
pub fn export_label_template(template: LabelTemplate, path: String) -> CmdResult<()> {
    label_template::export_to(&path, &template).map_err(err)
}

/// Importe un template depuis un fichier choisi.
#[tauri::command]
pub fn import_label_template(path: String) -> CmdResult<LabelTemplate> {
    label_template::import_from(&path).map_err(err)
}

/// Importe une image depuis le disque et la rend en data URI.
///
/// Le frontend ne peut pas lire de fichier lui-même : `tauri-plugin-fs` n'est
/// pas enregistré et `plugin-dialog` ne rend qu'un chemin.
#[tauri::command]
pub fn load_template_image(path: String) -> CmdResult<String> {
    label_template::load_image_data_url(&path).map_err(err)
}

/// QR de plusieurs appareils, en data URI SVG, dans l'ordre des `device_ids`.
///
/// En lot : imprimer 40 étiquettes ne doit pas coûter 40 allers-retours IPC.
#[tauri::command]
pub async fn generate_qr_svgs(
    state: State<'_, AppState>,
    device_ids: Vec<String>,
) -> CmdResult<Vec<String>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let all = load_devices(&state, false).await?;
    device_ids
        .iter()
        .map(|id| {
            let device = all
                .iter()
                .find(|d| &d.id == id)
                .ok_or_else(|| format!("Appareil introuvable : {id}"))?;
            let svg = qr::generate_qr_svg(device).map_err(err)?;
            Ok(format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg)))
        })
        .collect()
}
