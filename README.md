# ScanTune (Rust / Tauri)

Réécriture **multiplateforme** (Windows / macOS / Linux) de ScanTune Desktop,
l'application de gestion d'inventaire IT connectée à Microsoft Intune.

> Version d'origine en WPF/.NET 8 : `../ScanTune-WPF-main` (conservée, non modifiée).
> Cette version vise les mêmes fonctionnalités avec un binaire natif léger, sans
> runtime .NET, et un backend en Rust.

## Stack

| Composant | Technologie |
|-----------|-------------|
| Coquille app | [Tauri 2](https://tauri.app) (backend Rust + WebView système) |
| Frontend | React 18 + TypeScript + Vite |
| Graphiques | Recharts |
| Auth | OAuth2 Authorization Code + PKCE (loopback), refresh token dans le trousseau OS |
| API | Microsoft Graph REST (reqwest) |
| QR codes / étiquettes | `qrcode` + `image` + `imageproc`/`ab_glyph` (texte) |
| Excel | `rust_xlsxwriter` |
| PDF | `printpdf` (rapports + planches d'étiquettes Avery) |

## Correspondance avec la version WPF

| WPF (C#) | Rust |
|----------|------|
| `ScanTune.Core/Models` | `src-tauri/src/models.rs` |
| `ConfigService` | `src-tauri/src/config.rs` |
| `AuthService` (MSAL) | `src-tauri/src/auth.rs` (PKCE loopback) |
| `GraphService` (SDK) | `src-tauri/src/graph.rs` (REST) |
| `QRService` (hors Zebra) | `src-tauri/src/qr.rs` |
| `ExportService` | `src-tauri/src/export.rs` |
| ~~`ZebraPrinterService`~~ | **retiré** (pas d'impression Zebra) |
| ViewModels | `src-tauri/src/commands.rs` + pages React |
| Views (XAML) | `src/pages/*.tsx` |

## Prérequis

- [Rust](https://rustup.rs) (toolchain stable) — ✅ déjà installé
- [Node.js](https://nodejs.org) 18+ — ✅ déjà installé
- WebView2 (Windows) — ✅ présent
- Dépendances système Tauri sous Linux : voir https://tauri.app/start/prerequisites/

> ⚠️ **npm bloqué** : le registre public npmjs.org est filtré par la politique
> réseau de l'entreprise. Configure un registre interne dans `.npmrc` avant
> `npm install` (voir section ci-dessous).

## Configuration npm (registre interne)

```ini
# .npmrc à la racine du projet
registry=https://<registre-interne-de-ta-boite>/
# + éventuel token d'authentification fourni par l'IT
```

## Installation & lancement

```bash
npm install          # nécessite l'accès au registre npm
npm run tauri dev    # lance l'app en mode développement
npm run tauri build  # produit un binaire natif (.exe / .app / .deb / .AppImage)
```

## Configuration Azure AD

Au premier lancement, va dans **Paramètres** et renseigne :
- Tenant ID, Client ID de ton App Registration
- Scopes (lecture seule) :
  - `DeviceManagementManagedDevices.Read.All`
  - `User.Read.All`
  - `Directory.Read.All`
  - `DeviceManagementConfiguration.Read.All`

> ⚠️ L'App Registration doit autoriser le **flux loopback** : ajoute
> `http://localhost` comme URI de redirection de type *Mobile and desktop
> applications* (Azure accepte n'importe quel port sur localhost pour ce type).

La config est stockée dans le dossier de config utilisateur
(`%APPDATA%\ScanTune\appsettings.json` sous Windows).

## État du portage

✅ Fondation complète : modèles, config, auth PKCE, client Graph, QR, exports
CSV/Excel/PDF, **planches d'étiquettes PDF Avery** (3421 / 6126 / Standard /
Petit) + export PNG (unitaire et par lot), dashboard, toutes les pages.

❌ Pas d'impression Zebra (module retiré volontairement). Le module
QR/Étiquettes reproduit celui du WPF : recherche, filtres OS/conformité/société,
sélection multiple, aperçu, et exports PDF/PNG.

🔜 Phase 2 : sélecteur de positions Avery (planche partiellement utilisée),
raffinements UI (police d'icônes, thème Material complet).
