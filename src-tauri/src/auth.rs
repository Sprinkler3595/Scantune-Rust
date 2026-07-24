//! Authentification Azure AD — remplace MSAL (Windows-only) par un flux
//! OAuth2 « Authorization Code + PKCE » avec redirection loopback, qui
//! fonctionne sur Windows, macOS et Linux.
//!
//! - Connexion interactive : ouverture d'une fenêtre popup interne (WebView de
//!   l'app, indépendante du navigateur système) + petit serveur HTTP local qui
//!   capture le `code` renvoyé par Azure AD.
//! - Le refresh token est conservé dans le trousseau de l'OS (keyring) :
//!   Windows Credential Manager / macOS Keychain / Linux Secret Service.
//! - Les requêtes suivantes rafraîchissent silencieusement l'access token.

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::config::AppConfig;

const KEYRING_SERVICE: &str = "ScanTune";
const KEYRING_USER: &str = "azuread-refresh-token";

/// Label de la fenêtre popup de connexion (WebView interne).
const AUTH_WINDOW_LABEL: &str = "scantune-auth";

/// État d'authentification partagé, protégé par un mutex (sérialise les
/// acquisitions de token comme le `SemaphoreSlim` du C#).
#[derive(Default)]
pub struct AuthState {
    inner: Mutex<TokenCache>,
    /// Handle Tauri injecté au démarrage : permet d'ouvrir la connexion dans
    /// une popup interne (WebView) plutôt que dans le navigateur système.
    app_handle: Mutex<Option<tauri::AppHandle>>,
}

#[derive(Default)]
struct TokenCache {
    access_token: Option<String>,
    expires_at: Option<Instant>,
    user_name: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub is_authenticated: bool,
    pub user_name: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: u64,
    #[serde(default)]
    id_token: Option<String>,
}

impl AuthState {
    /// Injecte le handle Tauri (appelé une fois au démarrage de l'app).
    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.lock().unwrap() = Some(handle);
    }

    pub fn status(&self) -> AuthStatus {
        let cache = self.inner.lock().unwrap();
        let valid = cache
            .expires_at
            .map(|e| e > Instant::now())
            .unwrap_or(false);
        AuthStatus {
            is_authenticated: valid && cache.access_token.is_some(),
            user_name: cache.user_name.clone(),
        }
    }

    /// Renvoie un access token valide : depuis le cache mémoire, via refresh
    /// token, ou via une connexion interactive en dernier recours.
    pub async fn get_access_token(&self, cfg: &AppConfig) -> Result<String> {
        if cfg.client_id.is_empty() || cfg.tenant_id.is_empty() {
            bail!("Configuration Azure AD manquante (TenantId / ClientId).");
        }

        // 1) Token en cache mémoire encore valide ?
        {
            let cache = self.inner.lock().unwrap();
            if let (Some(tok), Some(exp)) = (&cache.access_token, cache.expires_at) {
                if exp > Instant::now() + Duration::from_secs(60) {
                    return Ok(tok.clone());
                }
            }
        }

        // 2) Refresh token stocké dans le trousseau ?
        if let Some(rt) = load_refresh_token() {
            if let Ok(resp) = self.refresh(cfg, &rt).await {
                return Ok(resp);
            }
        }

        // 3) Connexion interactive.
        self.interactive_login(cfg).await
    }

    async fn refresh(&self, cfg: &AppConfig, refresh_token: &str) -> Result<String> {
        let scope = build_scope(cfg);
        let params = [
            ("client_id", cfg.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", scope.as_str()),
        ];
        let resp = http_token_request(cfg, &params).await?;
        self.store(&resp);
        Ok(resp.access_token)
    }

    async fn interactive_login(&self, cfg: &AppConfig) -> Result<String> {
        // Serveur loopback sur un port libre.
        let server = tiny_http::Server::http("127.0.0.1:0")
            .map_err(|e| anyhow!("Impossible de démarrer le serveur loopback: {e}"))?;
        let port = server
            .server_addr()
            .to_ip()
            .map(|a| a.port())
            .ok_or_else(|| anyhow!("Adresse loopback inattendue"))?;
        let redirect_uri = format!("http://localhost:{port}");

        // PKCE.
        let verifier = random_url_safe(64);
        let challenge = {
            let digest = Sha256::digest(verifier.as_bytes());
            URL_SAFE_NO_PAD.encode(digest)
        };
        let state = random_url_safe(24);
        let scope = build_scope(cfg);

        let auth_url = format!(
            "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize\
             ?client_id={client}&response_type=code&redirect_uri={redirect}\
             &response_mode=query&scope={scope}&state={state}\
             &code_challenge={challenge}&code_challenge_method=S256&prompt=select_account",
            tenant = cfg.tenant_id,
            client = cfg.client_id,
            redirect = urlencode(&redirect_uri),
            scope = urlencode(&scope),
            state = state,
            challenge = challenge,
        );

        // Deux modes :
        // - Popup interne (WebView de l'app) : on capture le `code` directement
        //   dans la navigation de la WebView, sans dépendre du serveur loopback
        //   (la WebView n'a pas besoin de réussir à joindre 127.0.0.1).
        // - Repli navigateur système (si le handle Tauri est indisponible) : on
        //   garde le serveur loopback qui reçoit la redirection.
        let handle = self.app_handle.lock().unwrap().clone();
        let code = match &handle {
            Some(h) => {
                // Le serveur loopback ne sert qu'à réserver le port du
                // redirect_uri ; il n'est pas lu dans ce mode.
                drop(server);
                login_via_webview(h, &auth_url, &redirect_uri, &state)?
            }
            None => {
                open::that(&auth_url).context("Ouverture du navigateur")?;
                let cancelled = Arc::new(AtomicBool::new(false));
                wait_for_code(&server, &state, Duration::from_secs(300), &cancelled)?
            }
        };

        // Échange code → tokens.
        let params = [
            ("client_id", cfg.client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", verifier.as_str()),
            ("scope", scope.as_str()),
        ];
        let resp = http_token_request(cfg, &params).await?;
        self.store(&resp);
        Ok(resp.access_token)
    }

    fn store(&self, resp: &TokenResponse) {
        if let Some(rt) = &resp.refresh_token {
            let _ = save_refresh_token(rt);
        }
        let mut cache = self.inner.lock().unwrap();
        cache.access_token = Some(resp.access_token.clone());
        cache.expires_at = Some(Instant::now() + Duration::from_secs(resp.expires_in));
        if let Some(id) = &resp.id_token {
            if let Some(name) = name_from_id_token(id) {
                cache.user_name = name;
            }
        }
    }

    pub fn sign_out(&self) {
        let _ = delete_refresh_token();
        let mut cache = self.inner.lock().unwrap();
        *cache = TokenCache::default();
    }
}

async fn http_token_request(cfg: &AppConfig, params: &[(&str, &str)]) -> Result<TokenResponse> {
    let url = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        cfg.tenant_id
    );
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("User-Agent", "ScanTune/1.0")
        .form(params)
        .send()
        .await
        .context("Requête token Azure AD")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!("Échec de l'authentification ({status}): {body}");
    }
    resp.json::<TokenResponse>()
        .await
        .context("Décodage de la réponse token")
}

/// Bloque jusqu'à recevoir la redirection loopback portant le `code`.
/// S'interrompt aussi si `cancelled` passe à true (popup fermée par l'utilisateur).
fn wait_for_code(
    server: &tiny_http::Server,
    state: &str,
    timeout: Duration,
    cancelled: &Arc<AtomicBool>,
) -> Result<String> {
    let deadline = Instant::now() + timeout;
    loop {
        if cancelled.load(Ordering::SeqCst) {
            bail!("Fenêtre de connexion fermée avant la fin de l'authentification.");
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            bail!("Délai d'authentification dépassé.");
        }
        // Réveil régulier pour pouvoir détecter une fermeture de la popup.
        let poll = remaining.min(Duration::from_millis(300));
        match server.recv_timeout(poll)? {
            None => continue,
            Some(request) => {
                let full = format!("http://localhost{}", request.url());
                let parsed = url::Url::parse(&full).ok();
                let mut code = None;
                let mut got_state = None;
                let mut err = None;
                if let Some(u) = &parsed {
                    for (k, v) in u.query_pairs() {
                        match k.as_ref() {
                            "code" => code = Some(v.to_string()),
                            "state" => got_state = Some(v.to_string()),
                            "error_description" => err = Some(v.to_string()),
                            _ => {}
                        }
                    }
                }

                let (body, result) = if let Some(e) = err {
                    (format!("Échec de la connexion : {e}"), Err(anyhow!(e)))
                } else if got_state.as_deref() != Some(state) {
                    (
                        "Paramètre 'state' invalide.".to_string(),
                        Err(anyhow!("state invalide (CSRF)")),
                    )
                } else if let Some(c) = code {
                    (
                        "Connexion réussie. Cette fenêtre va se fermer automatiquement."
                            .to_string(),
                        Ok(c),
                    )
                } else {
                    (
                        "Aucun code reçu.".to_string(),
                        Err(anyhow!("aucun code dans la redirection")),
                    )
                };

                let html = format!(
                    "<!doctype html><html lang=fr><head><meta charset=utf-8>\
                     <title>ScanTune</title></head><body style='font-family:sans-serif;\
                     text-align:center;padding-top:80px'><h2>{body}</h2></body></html>"
                );
                let response = tiny_http::Response::from_string(html).with_header(
                    "Content-Type: text/html; charset=utf-8"
                        .parse::<tiny_http::Header>()
                        .unwrap(),
                );
                let _ = request.respond(response);

                return result;
            }
        }
    }
}

fn build_scope(cfg: &AppConfig) -> String {
    // offline_access => refresh token ; openid/profile => nom d'utilisateur.
    let mut scopes = vec![
        "openid".to_string(),
        "profile".to_string(),
        "offline_access".to_string(),
    ];
    scopes.extend(cfg.scopes.iter().cloned());
    scopes.join(" ")
}

/// Décode (sans vérifier la signature, simple lecture) le claim `name` du JWT id_token.
fn name_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    json.get("name")
        .or_else(|| json.get("preferred_username"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn random_url_safe(byte_len: usize) -> String {
    let mut buf = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

// --- Fenêtre de connexion (popup interne) ---

/// Ouvre la page d'autorisation Azure AD dans une petite fenêtre WebView de
/// l'application (indépendante du navigateur système) et capture le `code`
/// directement dans la navigation, sans dépendre du serveur loopback.
/// La construction de la fenêtre doit avoir lieu sur le thread principal.
fn login_via_webview(
    handle: &tauri::AppHandle,
    auth_url: &str,
    redirect_uri: &str,
    state: &str,
) -> Result<String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

    let url: tauri::Url = auth_url
        .parse()
        .context("URL d'authentification invalide")?;
    let redirect_prefix = redirect_uri.trim_end_matches('/').to_string();
    let expected_state = state.to_string();

    let cancelled = Arc::new(AtomicBool::new(false));
    // Résultat de la construction de la fenêtre (sur le thread principal).
    let (build_tx, build_rx) = std::sync::mpsc::channel::<std::result::Result<(), String>>();
    // Résultat de l'authentification, déposé par le handler de navigation.
    let (code_tx, code_rx) = std::sync::mpsc::channel::<std::result::Result<String, String>>();

    let inner = handle.clone();
    let cancel_for_event = cancelled.clone();

    handle
        .run_on_main_thread(move || {
            // Referme une éventuelle fenêtre de connexion précédente.
            if let Some(w) = inner.get_webview_window(AUTH_WINDOW_LABEL) {
                let _ = w.close();
            }
            let built =
                WebviewWindowBuilder::new(&inner, AUTH_WINDOW_LABEL, WebviewUrl::External(url))
                    .title("Connexion Microsoft")
                    .inner_size(480.0, 660.0)
                    .min_inner_size(400.0, 520.0)
                    .center()
                    .focused(true)
                    .on_navigation(move |target| {
                        log_auth(&format!("navigation -> {}", redact_url(target)));
                        // Redirection finale vers le redirect_uri : on extrait
                        // le code (ou l'erreur) et on bloque le chargement de
                        // localhost (inutile dans la WebView).
                        if target.as_str().starts_with(&redirect_prefix) {
                            let _ = code_tx.send(parse_redirect(target, &expected_state));
                            return false;
                        }
                        true
                    })
                    .build();
            match built {
                Ok(win) => {
                    // Si la popup se ferme (utilisateur ou page), on annule l'attente.
                    win.on_window_event(move |event| {
                        if matches!(
                            event,
                            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                        ) {
                            cancel_for_event.store(true, Ordering::SeqCst);
                        }
                    });
                    let _ = build_tx.send(Ok(()));
                }
                Err(e) => {
                    let _ = build_tx.send(Err(e.to_string()));
                }
            }
        })
        .context("Dispatch de l'ouverture de la fenêtre de connexion")?;

    // Vérifie que la fenêtre s'est bien ouverte.
    match build_rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => bail!("Échec d'ouverture de la fenêtre de connexion : {e}"),
        Err(_) => bail!("La fenêtre de connexion n'a pas pu s'ouvrir (délai dépassé)."),
    }

    // Attend : code capturé / erreur / fermeture de la popup / timeout (5 min).
    let deadline = Instant::now() + Duration::from_secs(300);
    let outcome = loop {
        if cancelled.load(Ordering::SeqCst) {
            break Err(anyhow!(
                "Fenêtre de connexion fermée avant la fin de l'authentification."
            ));
        }
        match code_rx.recv_timeout(Duration::from_millis(300)) {
            Ok(Ok(code)) => break Ok(code),
            Ok(Err(e)) => break Err(anyhow!(e)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if Instant::now() >= deadline {
                    break Err(anyhow!("Délai d'authentification dépassé."));
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                break Err(anyhow!("Canal d'authentification interrompu."));
            }
        }
    };

    close_auth_window(handle);
    outcome
}

/// Extrait le `code` d'autorisation d'une redirection, en vérifiant le `state`.
fn parse_redirect(url: &tauri::Url, expected_state: &str) -> std::result::Result<String, String> {
    let mut code = None;
    let mut got_state = None;
    let mut err = None;
    let mut err_desc = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => got_state = Some(v.into_owned()),
            "error" => err = Some(v.into_owned()),
            "error_description" => err_desc = Some(v.into_owned()),
            _ => {}
        }
    }
    if let Some(e) = err {
        let detail = err_desc.map(|d| format!(" : {d}")).unwrap_or_default();
        return Err(format!("Refus Azure AD ({e}){detail}"));
    }
    if got_state.as_deref() != Some(expected_state) {
        return Err("Paramètre 'state' invalide (CSRF).".to_string());
    }
    code.ok_or_else(|| "Aucun code d'autorisation dans la redirection.".to_string())
}

/// Journalise une ligne dans `%TEMP%/scantune-auth.log` (et sur stderr en dev),
/// pour diagnostiquer le flux de connexion.
fn log_auth(msg: &str) {
    use std::io::Write;
    eprintln!("[scantune-auth] {msg}");
    let path = std::env::temp_dir().join("scantune-auth.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{msg}");
    }
}

/// Représentation d'une URL pour le journal, SANS les valeurs sensibles
/// (code/token) : on ne garde que l'origine, le chemin et les noms de paramètres.
fn redact_url(url: &tauri::Url) -> String {
    let mut s = format!(
        "{}://{}{}",
        url.scheme(),
        url.host_str().unwrap_or(""),
        url.path()
    );
    let keys: Vec<String> = url.query_pairs().map(|(k, _)| k.into_owned()).collect();
    if !keys.is_empty() {
        s.push_str(&format!("?[{}]", keys.join(",")));
    }
    s
}

/// Ferme la fenêtre popup de connexion si elle est encore ouverte.
fn close_auth_window(handle: &tauri::AppHandle) {
    use tauri::Manager;
    let inner = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(w) = inner.get_webview_window(AUTH_WINDOW_LABEL) {
            let _ = w.close();
        }
    });
}

// --- Trousseau OS ---

fn load_refresh_token() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    entry.get_password().ok()
}

fn save_refresh_token(token: &str) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    entry.set_password(token)?;
    Ok(())
}

fn delete_refresh_token() -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    let _ = entry.delete_credential();
    Ok(())
}
