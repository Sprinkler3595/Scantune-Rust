//! Modèles de données — port de `ScanTune.Core.Models`.
//! Les propriétés calculées du C# (StorageUsedPercent, DaysSinceLastSync, …)
//! sont exposées au frontend via `enrich()` qui produit un `IntuneDeviceView`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Ancienneté maximale d'un mot de passe avant alerte : 180 j ≈ 6 mois.
pub const DEFAULT_PASSWORD_MAX_AGE_DAYS: i64 = 180;
/// Nombre de jours avant le seuil où l'on passe déjà en avertissement,
/// pour laisser le temps de contacter l'utilisateur avant l'échéance.
pub const PASSWORD_WARNING_LEAD_DAYS: i64 = 30;

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
    /// Dernier changement de mot de passe (`lastPasswordChangeDateTime`).
    /// `None` = jamais renseigné par Entra ID (comptes synchronisés depuis un
    /// AD local, comptes de service, tenant qui ne remonte pas la propriété).
    pub last_password_change_date_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub devices: Vec<IntuneDevice>,
}

impl EntraUser {
    pub fn device_count(&self) -> usize {
        self.devices.len()
    }

    /// Ancienneté du mot de passe en jours ; -1 si la date est inconnue.
    pub fn days_since_password_change(&self) -> i64 {
        match self.last_password_change_date_time {
            None => -1,
            Some(ts) => (Utc::now() - ts).num_days().max(0),
        }
    }

    /// `Unknown` (date absente) | `Ok` | `Warning` (échéance proche) |
    /// `Alert` (seuil dépassé — il faut contacter l'utilisateur).
    pub fn password_status(&self, max_age_days: i64) -> &'static str {
        let max_age = if max_age_days > 0 {
            max_age_days
        } else {
            DEFAULT_PASSWORD_MAX_AGE_DAYS
        };
        let days = self.days_since_password_change();
        if days < 0 {
            return "Unknown";
        }
        if days >= max_age {
            "Alert"
        } else if days >= (max_age - PASSWORD_WARNING_LEAD_DAYS).max(0) {
            "Warning"
        } else {
            "Ok"
        }
    }

    /// Vrai quand le seuil est franchi : l'utilisateur doit être contacté.
    pub fn password_alert(&self, max_age_days: i64) -> bool {
        self.password_status(max_age_days) == "Alert"
    }

    /// Vue enrichie envoyée au frontend (champs + propriétés calculées),
    /// même principe que `IntuneDevice::enrich`.
    pub fn enrich(&self, max_age_days: i64) -> EntraUserView {
        EntraUserView {
            days_since_password_change: self.days_since_password_change(),
            password_status: self.password_status(max_age_days).to_string(),
            password_alert: self.password_alert(max_age_days),
            device_count: self.device_count(),
            user: self.clone(),
        }
    }
}

/// Vue à plat pour le frontend : l'utilisateur + ses propriétés calculées.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntraUserView {
    #[serde(flatten)]
    pub user: EntraUser,
    pub days_since_password_change: i64,
    pub password_status: String,
    pub password_alert: bool,
    pub device_count: usize,
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn user_with_password_age(days: i64) -> EntraUser {
        EntraUser {
            last_password_change_date_time: Some(Utc::now() - Duration::days(days)),
            ..Default::default()
        }
    }

    #[test]
    fn password_status_follows_threshold() {
        let max = DEFAULT_PASSWORD_MAX_AGE_DAYS; // 180 j ≈ 6 mois
        assert_eq!(user_with_password_age(10).password_status(max), "Ok");
        // 30 jours avant l'échéance : on prévient déjà.
        assert_eq!(user_with_password_age(155).password_status(max), "Warning");
        assert_eq!(user_with_password_age(181).password_status(max), "Alert");
        assert!(user_with_password_age(200).password_alert(max));
        assert!(!user_with_password_age(30).password_alert(max));
    }

    #[test]
    fn password_status_unknown_when_date_missing() {
        let u = EntraUser::default();
        assert_eq!(u.days_since_password_change(), -1);
        assert_eq!(u.password_status(DEFAULT_PASSWORD_MAX_AGE_DAYS), "Unknown");
        assert!(!u.password_alert(DEFAULT_PASSWORD_MAX_AGE_DAYS));
    }

    #[test]
    fn password_status_falls_back_on_invalid_threshold() {
        // Un seuil <= 0 ne doit pas rendre tout le parc « en alerte ».
        assert_eq!(user_with_password_age(10).password_status(0), "Ok");
        assert_eq!(user_with_password_age(365).password_status(-5), "Alert");
    }

    #[test]
    fn enrich_exposes_computed_fields() {
        let view = user_with_password_age(200).enrich(DEFAULT_PASSWORD_MAX_AGE_DAYS);
        assert_eq!(view.password_status, "Alert");
        assert!(view.password_alert);
        assert_eq!(view.days_since_password_change, 200);
    }
}
