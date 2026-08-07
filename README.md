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
| Frontend | React 19 + TypeScript + Vite 6 (routage : React Router 8) |
| Graphiques | Recharts |
| Auth | OAuth2 Authorization Code + PKCE (loopback `tiny_http`), refresh token dans le trousseau OS (`keyring`) |
| API | Microsoft Graph REST (`reqwest` + rustls) |
| QR codes | `qrcode` + `image` (PNG/JPEG) |
| Étiquettes | Rendu HTML/CSS côté frontend, impression via le pilote système |
| Excel | `rust_xlsxwriter` |
| PDF | `printpdf` (rapport d'inventaire) |

## Fonctionnalités

- **Dashboard** : statistiques du parc (OS, conformité, etc.) avec graphiques.
- **Appareils** : liste, recherche, filtres, fiche détaillée avec applications
  détectées et clés de récupération **BitLocker** (affichage à la demande).
- **Alerte de doublon de numéro de série** : la fiche appareil compare la série
  (normalisée) à tout le parc et signale les autres appareils qui portent le
  même numéro — symptôme classique d'un ré-enrôlement, d'un ré-imagage ou
  d'une erreur de saisie.
- **Utilisateurs** : liste, recherche, fiche détaillée Entra ID.
- **Inventaire** : exports CSV, Excel (appareils et utilisateurs) et rapport
  PDF.
- **QR / Étiquettes** : recherche, filtres OS/conformité/société, sélection
  multiple, aperçu, export PNG (unitaire et par lot) et impression
  d'étiquettes (voir ci-dessous).

## Étiquettes : éditeur de template + impression pilote

Le module d'étiquettes a été repensé par rapport au WPF (qui composait des
planches Avery en PDF) :

- **Éditeur de template visuel** (`src/components/LabelEditor.tsx`) : on pose
  librement des éléments — QR, champs de l'appareil, texte libre, images/logo —
  sur l'étiquette. Positions et tailles sont exprimées **en pourcentages** de
  la boîte étiquette : aucun pixel, DPI ni millimètre dans le modèle
  (`src-tauri/src/label_template.rs`).
- **Le pilote d'imprimante décide de la taille** (`@page { size: auto }`) :
  changer de rouleau ne demande ni migration ni recompilation. Le QR reste
  carré via `aspect-ratio: 1`, la police est en unités `cqh`.
- **Mire de calibration** (`src/components/PrintCalibration.tsx`) : page de
  test à imprimer avant de dessiner un template, pour vérifier que le pilote
  respecte le format, ne recadre pas, et que les unités `cqh` fonctionnent.
- **Réglages image** : contraste, luminosité et seuillage noir/blanc pur
  (adapté aux rubans résine), appliqués en filtres CSS — identiques à l'écran
  et à l'impression.
- **Portabilité** : le template (logo embarqué en data URI) s'exporte et
  s'importe en JSON.
- Le rendu écran (aperçu) et le rendu imprimé sont **le même composant**
  (`LabelRender`), monté hors de l'app via un portail (`PrintPortal`) pour
  l'impression.

> ℹ️ Le contenu JSON encodé dans le QR est **identique à la version WPF**
> (contrat figé à cinq clés) pour rester compatible avec ScanTune Mobile.

## Correspondance avec la version WPF

| WPF (C#) | Rust |
|----------|------|
| `ScanTune.Core/Models` | `src-tauri/src/models.rs` |
| `ConfigService` | `src-tauri/src/config.rs` |
| `AuthService` (MSAL) | `src-tauri/src/auth.rs` (PKCE loopback) |
| `GraphService` (SDK) | `src-tauri/src/graph.rs` (REST) |
| `QRService` (hors Zebra) | `src-tauri/src/qr.rs` (QR seul) + éditeur/rendu HTML côté frontend (`label_template.rs`, `LabelEditor`, `LabelRender`) |
| `ExportService` | `src-tauri/src/export.rs` |
| ~~`ZebraPrinterService`~~ | **retiré** — remplacé par l'impression via le pilote système |
| ViewModels | `src-tauri/src/commands.rs` + pages React |
| Views (XAML) | `src/pages/*.tsx` (Dashboard, Devices, DeviceDetail, Users, UserDetail, Inventory, QRCodes, Settings, Login) |

## Prérequis

- [Rust](https://rustup.rs) (toolchain stable, ≥ 1.77) — ✅ déjà installé
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
- Scopes (lecture seule, valeurs par défaut) :
  - `DeviceManagementManagedDevices.Read.All`
  - `User.Read.All`
  - `Directory.Read.All`
  - `DeviceManagementConfiguration.Read.All`

Les scopes `openid`, `profile` et `offline_access` (refresh token) sont
ajoutés automatiquement. Pour lire les clés BitLocker, l'App Registration
doit disposer des permissions Graph correspondantes
(`BitLockerKey.Read.All`).

> ⚠️ L'App Registration doit autoriser le **flux loopback** : ajoute
> `http://localhost` comme URI de redirection de type *Mobile and desktop
> applications* (Azure accepte n'importe quel port sur localhost pour ce type).

Le refresh token est conservé dans le trousseau de l'OS : Windows Credential
Manager / macOS Keychain / Linux Secret Service.

## Fichiers de configuration

Stockés dans le dossier de config utilisateur (`%APPDATA%\ScanTune\` sous
Windows, `~/.config/ScanTune/` sous Linux, `~/Library/Application Support/ScanTune/`
sous macOS) :

| Fichier | Contenu |
|---------|---------|
| `appsettings.json` | Tenant/Client ID, scopes |
| `label_template.json` | Template d'étiquette (fichier séparé, volontairement hors de la config : sauvegarder la config déconnecte l'utilisateur, pas le template) |

## État du portage

✅ Fondation complète : modèles, config, auth PKCE, client Graph, QR, exports
CSV/Excel/PDF, dashboard, toutes les pages.

✅ Module QR/Étiquettes : éditeur de template visuel, impression via le pilote
système (format libre), mire de calibration, export PNG unitaire et par lot,
import/export du template en JSON.

✅ Fiche appareil : applications détectées, clés BitLocker, alerte de doublon
de numéro de série.

❌ Pas d'impression Zebra (module retiré volontairement) : l'impression passe
par n'importe quelle imprimante d'étiquettes vue par l'OS, via son pilote.

🔜 Raffinements UI (police d'icônes, thème Material complet).
