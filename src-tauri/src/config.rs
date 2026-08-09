//! Gestion de la configuration — port de `ConfigService`.
//! Le fichier `appsettings.json` est stocké dans le dossier de config de
//! l'utilisateur (multiplateforme) plutôt qu'à côté de l'exécutable.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub tenant_id: String,
    pub client_id: String,
    pub scopes: Vec<String>,
    pub read_only_mode: bool,
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
}

impl Default for AppSection {
    fn default() -> Self {
        Self {
            read_only_mode: true,
        }
    }
}

fn default_true() -> bool {
    true
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
    };
    if cfg.scopes.is_empty() {
        cfg.scopes = AppConfig::default().scopes;
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
        },
    };
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&file)?)?;
    Ok(())
}
