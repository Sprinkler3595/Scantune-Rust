//! Client Microsoft Graph (REST) — port de `GraphService`.
//! Pagination via @odata.nextLink, projection via $select, recherche via
//! $filter, exactement comme la version WPF mais en appels HTTP directs
//! (pas de SDK Graph, qui n'existe pas en Rust).

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::auth::AuthState;
use crate::config::AppConfig;
use crate::models::{BitLockerRecoveryKey, DetectedApp, EntraUser, IntuneDevice};

const GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";
/// La navigation `managedDevices/{id}/detectedApps` n'existe pas en v1.0
/// (renvoie « Resource not found for the segment 'detectedApps' ») : elle n'est
/// exposée que sur l'endpoint beta. Réservé à cet appel précis.
const GRAPH_BETA: &str = "https://graph.microsoft.com/beta";

const DEVICE_SELECT: &str = "id,deviceName,managedDeviceOwnerType,operatingSystem,osVersion,\
complianceState,model,manufacturer,serialNumber,userPrincipalName,userDisplayName,\
enrolledDateTime,lastSyncDateTime,totalStorageSpaceInBytes,freeStorageSpaceInBytes,\
managementAgent,deviceRegistrationState,azureADDeviceId,deviceCategoryDisplayName,notes";

const USER_SELECT: &str = "id,displayName,userPrincipalName,mail,jobTitle,department,\
officeLocation,companyName,mobilePhone,accountEnabled";

/// Enveloppe de collection OData.
#[derive(Deserialize)]
struct ODataPage<T> {
    #[serde(default = "Vec::new")]
    value: Vec<T>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}

// --- Structs de désérialisation Graph (tolérantes aux null) ---

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct GraphDevice {
    id: Option<String>,
    device_name: Option<String>,
    managed_device_owner_type: Option<String>,
    operating_system: Option<String>,
    os_version: Option<String>,
    compliance_state: Option<String>,
    model: Option<String>,
    manufacturer: Option<String>,
    serial_number: Option<String>,
    user_principal_name: Option<String>,
    user_display_name: Option<String>,
    enrolled_date_time: Option<DateTime<Utc>>,
    last_sync_date_time: Option<DateTime<Utc>>,
    total_storage_space_in_bytes: Option<i64>,
    free_storage_space_in_bytes: Option<i64>,
    management_agent: Option<String>,
    device_registration_state: Option<String>,
    #[serde(rename = "azureADDeviceId")]
    azure_ad_device_id: Option<String>,
    device_category_display_name: Option<String>,
    notes: Option<String>,
}

impl From<GraphDevice> for IntuneDevice {
    fn from(d: GraphDevice) -> Self {
        IntuneDevice {
            id: d.id.unwrap_or_default(),
            device_name: d.device_name.unwrap_or_default(),
            managed_device_owner_type: d.managed_device_owner_type.unwrap_or_default(),
            operating_system: d.operating_system.unwrap_or_default(),
            os_version: d.os_version.unwrap_or_default(),
            compliance_state: d.compliance_state.unwrap_or_default(),
            model: d.model.unwrap_or_default(),
            manufacturer: d.manufacturer.unwrap_or_default(),
            serial_number: d.serial_number.unwrap_or_default(),
            user_principal_name: d.user_principal_name.unwrap_or_default(),
            user_display_name: d.user_display_name.unwrap_or_default(),
            enrolled_date_time: d.enrolled_date_time,
            last_sync_date_time: d.last_sync_date_time,
            total_storage_space_in_bytes: d.total_storage_space_in_bytes.unwrap_or(0),
            free_storage_space_in_bytes: d.free_storage_space_in_bytes.unwrap_or(0),
            management_agent: d.management_agent.unwrap_or_default(),
            device_registration_state: d.device_registration_state.unwrap_or_default(),
            azure_ad_device_id: d.azure_ad_device_id.unwrap_or_default(),
            device_category_display_name: d.device_category_display_name.unwrap_or_default(),
            notes: d.notes.unwrap_or_default(),
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct GraphUser {
    id: Option<String>,
    display_name: Option<String>,
    user_principal_name: Option<String>,
    mail: Option<String>,
    job_title: Option<String>,
    department: Option<String>,
    office_location: Option<String>,
    company_name: Option<String>,
    mobile_phone: Option<String>,
    account_enabled: Option<bool>,
}

impl From<GraphUser> for EntraUser {
    fn from(u: GraphUser) -> Self {
        EntraUser {
            id: u.id.unwrap_or_default(),
            display_name: u.display_name.unwrap_or_default(),
            user_principal_name: u.user_principal_name.unwrap_or_default(),
            mail: u.mail.unwrap_or_default(),
            job_title: u.job_title.unwrap_or_default(),
            department: u.department.unwrap_or_default(),
            office_location: u.office_location.unwrap_or_default(),
            company_name: u.company_name.unwrap_or_default(),
            mobile_phone: u.mobile_phone.unwrap_or_default(),
            account_enabled: u.account_enabled.unwrap_or(false),
            devices: Vec::new(),
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct GraphBitlockerKey {
    id: Option<String>,
    device_id: Option<String>,
    volume_type: Option<String>,
    created_date_time: Option<DateTime<Utc>>,
    key: Option<String>,
}

impl From<GraphBitlockerKey> for BitLockerRecoveryKey {
    fn from(k: GraphBitlockerKey) -> Self {
        BitLockerRecoveryKey {
            id: k.id.unwrap_or_default(),
            device_id: k.device_id.unwrap_or_default(),
            volume_type: k.volume_type.unwrap_or_default(),
            created_date_time: k.created_date_time,
            key: k.key.unwrap_or_default(),
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct GraphDetectedApp {
    id: Option<String>,
    display_name: Option<String>,
    version: Option<String>,
    publisher: Option<String>,
    size_in_byte: Option<i64>,
    device_count: Option<i64>,
}

impl From<GraphDetectedApp> for DetectedApp {
    fn from(a: GraphDetectedApp) -> Self {
        DetectedApp {
            id: a.id.unwrap_or_default(),
            display_name: a.display_name.unwrap_or_default(),
            version: a.version.unwrap_or_default(),
            publisher: a.publisher.unwrap_or_default(),
            size_in_byte: a.size_in_byte.unwrap_or(0),
            device_count: a.device_count.unwrap_or(0),
        }
    }
}

/// Client Graph : récupère un token frais avant chaque requête.
pub struct GraphClient<'a> {
    auth: &'a AuthState,
    cfg: &'a AppConfig,
    http: reqwest::Client,
}

impl<'a> GraphClient<'a> {
    pub fn new(auth: &'a AuthState, cfg: &'a AppConfig, http: reqwest::Client) -> Self {
        Self { auth, cfg, http }
    }

    async fn get_json<T: for<'de> Deserialize<'de>>(&self, url: &str) -> Result<T> {
        let token = self.auth.get_access_token(self.cfg).await?;
        let resp = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("User-Agent", "ScanTune/1.0")
            .send()
            .await
            .context("Requête Graph")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Erreur Graph ({status}): {body}");
        }
        resp.json::<T>().await.context("Décodage JSON Graph")
    }

    /// Récupère toutes les pages d'une collection en suivant nextLink.
    async fn get_all<G, M>(&self, first_url: String) -> Result<Vec<M>>
    where
        G: for<'de> Deserialize<'de> + Into<M>,
    {
        let mut out = Vec::new();
        let mut url = Some(first_url);
        while let Some(u) = url {
            let page: ODataPage<G> = self.get_json(&u).await?;
            out.extend(page.value.into_iter().map(Into::into));
            url = page.next_link;
        }
        Ok(out)
    }

    // --- Connexion ---

    pub async fn current_user_name(&self) -> Result<String> {
        #[derive(Deserialize)]
        struct Me {
            #[serde(rename = "displayName")]
            display_name: Option<String>,
        }
        let me: Me = self.get_json(&format!("{GRAPH_BASE}/me")).await?;
        Ok(me
            .display_name
            .unwrap_or_else(|| "Utilisateur inconnu".into()))
    }

    // --- Appareils Intune ---

    pub async fn all_devices(&self) -> Result<Vec<IntuneDevice>> {
        let url = format!(
            "{GRAPH_BASE}/deviceManagement/managedDevices?$select={DEVICE_SELECT}&$top=100"
        );
        self.get_all::<GraphDevice, IntuneDevice>(url).await
    }

    pub async fn device_by_id(&self, id: &str) -> Result<Option<IntuneDevice>> {
        let url =
            format!("{GRAPH_BASE}/deviceManagement/managedDevices/{id}?$select={DEVICE_SELECT}");
        let d: GraphDevice = self.get_json(&url).await?;
        Ok(Some(d.into()))
    }

    pub async fn search_devices(&self, query: &str) -> Result<Vec<IntuneDevice>> {
        if query.trim().is_empty() {
            return self.all_devices().await;
        }
        let escaped = query.replace('\'', "''");
        let filter = format!(
            "contains(deviceName,'{e}') or contains(serialNumber,'{e}') or contains(userDisplayName,'{e}')",
            e = escaped
        );
        let url = format!(
            "{GRAPH_BASE}/deviceManagement/managedDevices?$select={DEVICE_SELECT}&$top=100&$filter={}",
            urlencode(&filter)
        );
        self.get_all::<GraphDevice, IntuneDevice>(url).await
    }

    // --- Utilisateurs Entra ID ---

    pub async fn all_users(&self) -> Result<Vec<EntraUser>> {
        let url = format!("{GRAPH_BASE}/users?$select={USER_SELECT}&$top=100");
        self.get_all::<GraphUser, EntraUser>(url).await
    }

    pub async fn user_by_id(&self, id: &str) -> Result<Option<EntraUser>> {
        let url = format!("{GRAPH_BASE}/users/{id}?$select={USER_SELECT}");
        let u: GraphUser = self.get_json(&url).await?;
        Ok(Some(u.into()))
    }

    pub async fn user_devices(&self, user_id: &str) -> Result<Vec<IntuneDevice>> {
        let url = format!("{GRAPH_BASE}/users/{user_id}/managedDevices?$top=100");
        self.get_all::<GraphDevice, IntuneDevice>(url).await
    }

    pub async fn search_users(&self, query: &str) -> Result<Vec<EntraUser>> {
        if query.trim().is_empty() {
            return self.all_users().await;
        }
        let escaped = query.replace('\'', "''");
        let filter = format!(
            "startsWith(displayName,'{e}') or startsWith(userPrincipalName,'{e}') or startsWith(department,'{e}')",
            e = escaped
        );
        let url = format!(
            "{GRAPH_BASE}/users?$select={USER_SELECT}&$top=100&$filter={}",
            urlencode(&filter)
        );
        self.get_all::<GraphUser, EntraUser>(url).await
    }

    // --- Applications détectées ---

    /// Toutes les applications détectées sur un appareil géré.
    /// Pas de `$select` : les propriétés sélectionnables de `detectedApp`
    /// diffèrent entre v1.0 et beta, et un `$select` invalide renverrait une
    /// 400. On désérialise tolérant (champs `Option`) et on trie par nom.
    pub async fn detected_apps_for_device(
        &self,
        managed_device_id: &str,
    ) -> Result<Vec<DetectedApp>> {
        if managed_device_id.trim().is_empty() {
            return Ok(Vec::new());
        }
        let url = format!(
            "{GRAPH_BETA}/deviceManagement/managedDevices/{managed_device_id}/detectedApps?$top=100"
        );
        let mut apps = self.get_all::<GraphDetectedApp, DetectedApp>(url).await?;
        apps.sort_by(|a, b| {
            a.display_name
                .to_lowercase()
                .cmp(&b.display_name.to_lowercase())
        });
        Ok(apps)
    }

    // --- Clés BitLocker ---

    pub async fn bitlocker_keys_for_device(
        &self,
        azure_ad_device_id: &str,
    ) -> Result<Vec<BitLockerRecoveryKey>> {
        if azure_ad_device_id.trim().is_empty() {
            return Ok(Vec::new());
        }
        let escaped = azure_ad_device_id.replace('\'', "''");
        let filter = format!("deviceId eq '{escaped}'");
        let url = format!(
            "{GRAPH_BASE}/informationProtection/bitlocker/recoveryKeys?$filter={}",
            urlencode(&filter)
        );
        self.get_all::<GraphBitlockerKey, BitLockerRecoveryKey>(url)
            .await
    }

    pub async fn bitlocker_key_value(&self, recovery_key_id: &str) -> Result<Option<String>> {
        if recovery_key_id.trim().is_empty() {
            return Ok(None);
        }
        // La lecture de la valeur génère une entrée d'audit dans Entra ID.
        let url = format!(
            "{GRAPH_BASE}/informationProtection/bitlocker/recoveryKeys/{recovery_key_id}?$select=key"
        );
        let k: GraphBitlockerKey = self.get_json(&url).await?;
        Ok(k.key)
    }
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}
