//! Modèles de données — port de `ScanTune.Core.Models`.
//! Les propriétés calculées du C# (StorageUsedPercent, DaysSinceLastSync, …)
//! sont exposées au frontend via `enrich()` qui produit un `IntuneDeviceView`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Appareil géré Intune (brut, tel que mappé depuis Graph).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntuneDevice {
    pub id: String,
    pub device_name: String,
    pub managed_device_owner_type: String,
    pub operating_system: String,
    pub os_version: String,
    pub compliance_state: String,
    pub model: String,
    pub manufacturer: String,
    pub serial_number: String,
    pub user_principal_name: String,
    pub user_display_name: String,
    pub enrolled_date_time: Option<DateTime<Utc>>,
    pub last_sync_date_time: Option<DateTime<Utc>>,
    pub total_storage_space_in_bytes: i64,
    pub free_storage_space_in_bytes: i64,
    pub management_agent: String,
    pub device_registration_state: String,
    #[serde(rename = "azureADDeviceId")]
    pub azure_ad_device_id: String,
    pub device_category_display_name: String,
    pub notes: String,
}

impl IntuneDevice {
    pub fn storage_used_percent(&self) -> f64 {
        if self.total_storage_space_in_bytes <= 0 {
            return 0.0;
        }
        let used = self.total_storage_space_in_bytes - self.free_storage_space_in_bytes;
        let pct = used as f64 / self.total_storage_space_in_bytes as f64 * 100.0;
        (pct * 10.0).round() / 10.0
    }

    /// -1 si jamais synchronisé.
    pub fn days_since_last_sync(&self) -> i64 {
        match self.last_sync_date_time {
            None => -1,
            Some(ts) => (Utc::now() - ts).num_days(),
        }
    }

    pub fn is_compliant(&self) -> bool {
        self.compliance_state.eq_ignore_ascii_case("compliant")
    }

    pub fn display_status(&self) -> &'static str {
        if !self.is_compliant() {
            return "NonCompliant";
        }
        match self.days_since_last_sync() {
            d if d > 30 => "Stale",
            d if d > 7 => "Warning",
            _ => "Healthy",
        }
    }

    pub fn sync_status(&self) -> &'static str {
        match self.days_since_last_sync() {
            d if d < 0 => "Unknown",
            d if d <= 1 => "Fresh",
            d if d <= 7 => "Recent",
            d if d <= 30 => "Warning",
            _ => "Stale",
        }
    }

    pub fn storage_status(&self) -> &'static str {
        if self.total_storage_space_in_bytes <= 0 {
            return "Unknown";
        }
        let pct = self.storage_used_percent();
        if pct >= 90.0 {
            "Critical"
        } else if pct >= 75.0 {
            "Warning"
        } else {
            "Healthy"
        }
    }

    pub fn intune_portal_url(&self) -> String {
        if self.id.is_empty() {
            String::new()
        } else {
            format!(
                "https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsMenuBlade/~/overview/mdmDeviceId/{}",
                self.id
            )
        }
    }

    /// Produit la vue enrichie envoyée au frontend (champs + propriétés calculées).
    pub fn enrich(&self) -> IntuneDeviceView {
        IntuneDeviceView {
            device: self.clone(),
            storage_used_percent: self.storage_used_percent(),
            days_since_last_sync: self.days_since_last_sync(),
            is_compliant: self.is_compliant(),
            display_status: self.display_status().to_string(),
            sync_status: self.sync_status().to_string(),
            storage_status: self.storage_status().to_string(),
            intune_portal_url: self.intune_portal_url(),
        }
    }
}

/// Vue à plat pour le frontend : l'appareil + ses propriétés calculées.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntuneDeviceView {
    #[serde(flatten)]
    pub device: IntuneDevice,
    pub storage_used_percent: f64,
    pub days_since_last_sync: i64,
    pub is_compliant: bool,
    pub display_status: String,
    pub sync_status: String,
    pub storage_status: String,
    pub intune_portal_url: String,
}

/// Utilisateur Entra ID — port de `EntraUser`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntraUser {
    pub id: String,
    pub display_name: String,
    pub user_principal_name: String,
    pub mail: String,
    pub job_title: String,
    pub department: String,
    pub office_location: String,
    pub company_name: String,
    pub mobile_phone: String,
    pub account_enabled: bool,
    #[serde(default)]
    pub devices: Vec<IntuneDevice>,
}

impl EntraUser {
    pub fn device_count(&self) -> usize {
        self.devices.len()
    }
}

/// Application détectée sur un appareil (endpoint Graph `detectedApps`).
/// « Détectée » = tout logiciel découvert sur l'appareil, pas seulement les
/// applications déployées par Intune. Sérialisé tel quel vers le frontend.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedApp {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub publisher: String,
    pub size_in_byte: i64,
    pub device_count: i64,
}

/// Clé de récupération BitLocker — port de `BitLockerRecoveryKey`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitLockerRecoveryKey {
    pub id: String,
    pub device_id: String,
    pub volume_type: String,
    pub created_date_time: Option<DateTime<Utc>>,
    pub key: String,
}
