//! Gestion de la configuration — port de `ConfigService`.
//! Le fichier `appsettings.json` est stocké dans le dossier de config de
//! l'utilisateur (multiplateforme) plutôt qu'à côté de l'exécutable.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::models::DEFAULT_PASSWORD_MAX_AGE_DAYS;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub tenant_id: String,
    pub client_id: String,
    pub scopes: Vec<String>,
    pub read_only_mode: bool,
    /// Ancienneté maximale d'un mot de passe (en jours) avant alerte.
    /// 180 j ≈ 6 mois par défaut, conformément à la politique interne.
    pub password_max_age_days: i64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            tenant_id: String::new(),
            client_id: String::new(),
            scopes: vec![
                "DeviceManagementManagedDevices.Read.All".into(),
                "User.Read.All".into(),
                "Directory.Read.All".into(),
                "DeviceManagementConfiguration.Read.All".into(),
            ],
            read_only_mode: true,
            password_max_age_days: DEFAULT_PASSWORD_MAX_AGE_DAYS,
        }
    }
}

/// Format de fichier identique au C# : { "azureAd": {...}, "app": {...} }.
#[derive(Debug, Default, Serialize, Deserialize)]
struct ConfigFile {
    #[serde(rename = "azureAd", default)]
    azure_ad: AzureAdSection,
    #[serde(default)]
    app: AppSection,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AzureAdSection {
    #[serde(rename = "tenantId", default)]
    tenant_id: String,
    #[serde(rename = "clientId", default)]
    client_id: String,
    #[serde(default)]
    scopes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AppSection {
    #[serde(rename = "readOnlyMode", default = "default_true")]
    read_only_mode: bool,
    #[serde(rename = "passwordMaxAgeDays", default = "default_password_max_age")]
    password_max_age_days: i64,
}

impl Default for AppSection {
    fn default() -> Self {
        Self {
            read_only_mode: true,
            password_max_age_days: DEFAULT_PASSWORD_MAX_AGE_DAYS,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_password_max_age() -> i64 {
    DEFAULT_PASSWORD_MAX_AGE_DAYS
}

pub fn config_path() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("ScanTune");
    dir.push("appsettings.json");
    dir
}

pub fn load() -> AppConfig {
    let path = config_path();
    let Ok(json) = std::fs::read_to_string(&path) else {
        return AppConfig::default();
    };
    let Ok(file) = serde_json::from_str::<ConfigFile>(&json) else {
        return AppConfig::default();
    };

    let mut cfg = AppConfig {
        tenant_id: file.azure_ad.tenant_id,
        client_id: file.azure_ad.client_id,
        scopes: file
            .azure_ad
            .scopes
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect(),
        read_only_mode: file.app.read_only_mode,
        password_max_age_days: file.app.password_max_age_days,
    };
    if cfg.scopes.is_empty() {
        cfg.scopes = AppConfig::default().scopes;
    }
    // Un seuil nul ou négatif désactiverait toute alerte sans le dire :
    // on retombe sur la valeur par défaut.
    if cfg.password_max_age_days <= 0 {
        cfg.password_max_age_days = DEFAULT_PASSWORD_MAX_AGE_DAYS;
    }
    cfg
}

pub fn save(cfg: &AppConfig) -> Result<()> {
    let file = ConfigFile {
        azure_ad: AzureAdSection {
            tenant_id: cfg.tenant_id.clone(),
            client_id: cfg.client_id.clone(),
            scopes: cfg.scopes.clone(),
        },
        app: AppSection {
            read_only_mode: cfg.read_only_mode,
            password_max_age_days: cfg.password_max_age_days,
        },
    };
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&file)?)?;
    Ok(())
}
