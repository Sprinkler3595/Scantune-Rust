import { invoke } from "@tauri-apps/api/core";
import type { LabelTemplate } from "./labelTemplate";

// --- Types (miroir des structs Rust sérialisées en camelCase) ---

export interface IntuneDevice {
  id: string;
  deviceName: string;
  managedDeviceOwnerType: string;
  operatingSystem: string;
  osVersion: string;
  complianceState: string;
  model: string;
  manufacturer: string;
  serialNumber: string;
  userPrincipalName: string;
  userDisplayName: string;
  enrolledDateTime: string | null;
  lastSyncDateTime: string | null;
  totalStorageSpaceInBytes: number;
  freeStorageSpaceInBytes: number;
  managementAgent: string;
  deviceRegistrationState: string;
  azureADDeviceId: string;
  deviceCategoryDisplayName: string;
  notes: string;
  // propriétés calculées (enrich)
  storageUsedPercent: number;
  daysSinceLastSync: number;
  isCompliant: boolean;
  displayStatus: string;
  syncStatus: string;
  storageStatus: string;
  intunePortalUrl: string;
}

export interface EntraUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  mail: string;
  jobTitle: string;
  department: string;
  officeLocation: string;
  companyName: string;
  mobilePhone: string;
  accountEnabled: boolean;
  /** `lastPasswordChangeDateTime` — null si Entra ID ne la fournit pas. */
  lastPasswordChangeDateTime: string | null;
  devices: IntuneDevice[];
  // propriétés calculées (enrich)
  /** Ancienneté du mot de passe en jours ; -1 si date inconnue. */
  daysSincePasswordChange: number;
  /** "Unknown" | "Ok" | "Warning" | "Alert" */
  passwordStatus: PasswordStatus;
  /** Vrai quand le seuil est dépassé : contacter l'utilisateur. */
  passwordAlert: boolean;
  deviceCount: number;
}

export type PasswordStatus = "Unknown" | "Ok" | "Warning" | "Alert";

export interface PasswordAlertStats {
  maxAgeDays: number;
  total: number;
  alertCount: number;
  warningCount: number;
  unknownCount: number;
  /** Alertes puis avertissements, du mot de passe le plus ancien au plus récent. */
  users: EntraUser[];
}

export interface DetectedApp {
  id: string;
  displayName: string;
  version: string;
  publisher: string;
  sizeInByte: number;
  deviceCount: number;
}

export interface BitLockerRecoveryKey {
  id: string;
  deviceId: string;
  volumeType: string;
  createdDateTime: string | null;
  key: string;
}

export interface AppConfig {
  tenantId: string;
  clientId: string;
  scopes: string[];
  readOnlyMode: boolean;
  /** Ancienneté maximale d'un mot de passe avant alerte (180 j ≈ 6 mois). */
  passwordMaxAgeDays: number;
}

export interface AuthStatus {
  isAuthenticated: boolean;
  userName: string;
}

export interface CountPair {
  label: string;
  count: number;
}

export interface DashboardStats {
  total: number;
  compliant: number;
  nonCompliant: number;
  stale: number;
  complianceRate: number;
  byOs: CountPair[];
  byCompliance: CountPair[];
  recentlyEnrolled: IntuneDevice[];
  staleDevices: IntuneDevice[];
}

// --- Commandes ---

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),

  authStatus: () => invoke<AuthStatus>("auth_status"),
  signIn: () => invoke<AuthStatus>("sign_in"),
  signOut: () => invoke<void>("sign_out"),
  currentUserName: () => invoke<string>("current_user_name"),

  getDevices: (force = false) => invoke<IntuneDevice[]>("get_devices", { force }),
  getDevice: (id: string) => invoke<IntuneDevice | null>("get_device", { id }),
  searchDevices: (query: string) => invoke<IntuneDevice[]>("search_devices", { query }),

  getUsers: (force = false) => invoke<EntraUser[]>("get_users", { force }),
  getUser: (id: string) => invoke<EntraUser | null>("get_user", { id }),
  searchUsers: (query: string) => invoke<EntraUser[]>("search_users", { query }),
  passwordAlerts: (force = false) =>
    invoke<PasswordAlertStats>("password_alerts", { force }),

  getDeviceApps: (deviceId: string) =>
    invoke<DetectedApp[]>("get_device_apps", { deviceId }),

  getBitlockerKeys: (azureAdDeviceId: string) =>
    invoke<BitLockerRecoveryKey[]>("get_bitlocker_keys", { azureAdDeviceId }),
  getBitlockerKeyValue: (recoveryKeyId: string) =>
    invoke<string | null>("get_bitlocker_key_value", { recoveryKeyId }),

  dashboardStats: (force = false) =>
    invoke<DashboardStats>("dashboard_stats", { force }),

  generateQrDataUrl: (deviceId: string) =>
    invoke<string>("generate_qr_data_url", { deviceId }),
  exportQrPng: (deviceId: string, path: string) =>
    invoke<void>("export_qr_png", { deviceId, path }),

  exportCsv: (path: string, scope: string) =>
    invoke<void>("export_csv", { path, scope }),
  exportDevicesXlsx: (path: string, scope: string) =>
    invoke<void>("export_devices_xlsx", { path, scope }),
  exportUsersXlsx: (path: string) => invoke<void>("export_users_xlsx", { path }),
  exportInventoryPdf: (path: string, scope: string) =>
    invoke<void>("export_inventory_pdf", { path, scope }),

  // Passe par une commande Rust plutôt que window.print() : voir commands.rs.
  printLabels: () => invoke<void>("print_labels"),

  getLabelTemplate: () => invoke<LabelTemplate>("get_label_template"),
  saveLabelTemplate: (template: LabelTemplate) =>
    invoke<void>("save_label_template", { template }),
  resetLabelTemplate: () => invoke<LabelTemplate>("reset_label_template"),
  /// Fichier autonome : les images sont embarquées, rien à transporter à côté.
  exportLabelTemplate: (template: LabelTemplate, path: string) =>
    invoke<void>("export_label_template", { template, path }),
  importLabelTemplate: (path: string) =>
    invoke<LabelTemplate>("import_label_template", { path }),
  loadTemplateImage: (path: string) => invoke<string>("load_template_image", { path }),
  /// QR en SVG, dans l'ordre des identifiants fournis.
  generateQrSvgs: (deviceIds: string[]) =>
    invoke<string[]>("generate_qr_svgs", { deviceIds }),
};
