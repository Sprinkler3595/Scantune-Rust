//! Template d'étiquette — modèle, persistance, chargement d'images.
//!
//! Aucun pixel, aucun DPI, aucun millimètre dans ce modèle : positions et
//! tailles sont des pourcentages de la boîte étiquette. Le rendu React les
//! coule dans une page dont la taille est décidée par le pilote d'imprimante
//! (`@page { size: auto }`). Changer de rouleau ne demande donc ni migration
//! ni recompilation.
//!
//! `preview_*_mm` est la seule exception, et ne sert qu'au ratio du canvas de
//! l'éditeur — ces valeurs ne sortent jamais dans le CSS d'impression.
//!
//! Le module est volontairement apatride : il ne touche ni `AppConfig`, ni le
//! cache, ni l'auth. `save_config` déconnecte l'utilisateur à chaque appel
//! (cf. `commands.rs`) ; router le template par là le déconnecterait à chaque
//! déplacement d'un élément. Fichier et commandes séparés rendent l'accident
//! impossible par construction.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ElementKind {
    Qr,
    Field,
    Text,
    Image,
}

/// Un élément posé sur l'étiquette.
///
/// Les champs inutiles au `kind` courant restent à leur valeur par défaut :
/// un modèle plat se sérialise en JSON lisible et se manipule sans union
/// discriminée côté TypeScript, pour un template qui tient en trois éléments.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelElement {
    pub id: String,
    pub kind: ElementKind,

    /// `kind: Field` — nom d'un champ d'`IntuneDevice` en camelCase.
    #[serde(default)]
    pub field: String,
    /// `kind: Text` — texte libre.
    #[serde(default)]
    pub text: String,
    /// `kind: Image` — data URI (l'image est embarquée, le template reste portable).
    #[serde(default)]
    pub image_data_url: String,

    /// Position et taille, en % de la boîte étiquette.
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub w: f32,
    /// Pour `kind: Qr`, `h` fait foi et la largeur suit en `aspect-ratio: 1` :
    /// des % sur les deux axes déformeraient le QR et le rendraient illisible.
    #[serde(default)]
    pub h: f32,

    /// Taille de police en % de la hauteur d'étiquette (rendu en unités `cqh`).
    #[serde(default = "default_font_pct")]
    pub font_pct: f32,
    #[serde(default)]
    pub bold: bool,
    /// `left` | `center` | `right`
    #[serde(default = "default_align")]
    pub align: String,

    /// Réglages image, appliqués en filtres CSS — donc identiques à l'écran et
    /// à l'impression, sans retraitement Rust.
    #[serde(default = "default_unit")]
    pub contrast: f32,
    #[serde(default = "default_unit")]
    pub brightness: f32,
    /// Noir et blanc pur. Ce que réclame un ruban résine sur polyester, dont le
    /// marquage est de toute façon binaire.
    #[serde(default)]
    pub threshold: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelTemplate {
    #[serde(default = "default_version")]
    pub version: u32,
    /// Ratio du canvas de l'éditeur uniquement — jamais imprimé.
    #[serde(default = "default_preview_w")]
    pub preview_width_mm: f32,
    #[serde(default = "default_preview_h")]
    pub preview_height_mm: f32,
    #[serde(default)]
    pub elements: Vec<LabelElement>,
}

fn default_version() -> u32 {
    1
}
/// Z-Ultimate 3000T 51×25 mm — le stock par défaut, à titre indicatif.
fn default_preview_w() -> f32 {
    51.0
}
fn default_preview_h() -> f32 {
    25.0
}
fn default_font_pct() -> f32 {
    16.0
}
fn default_align() -> String {
    "left".into()
}
fn default_unit() -> f32 {
    1.0
}

impl LabelElement {
    fn new(id: &str, kind: ElementKind) -> Self {
        Self {
            id: id.into(),
            kind,
            field: String::new(),
            text: String::new(),
            image_data_url: String::new(),
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 0.0,
            font_pct: default_font_pct(),
            bold: false,
            align: default_align(),
            contrast: 1.0,
            brightness: 1.0,
            threshold: false,
        }
    }
}

impl Default for LabelTemplate {
    /// Reproduit la disposition historique (QR à gauche, nom en gras, n° de
    /// série dessous) pour que l'app imprime quelque chose de sensé avant
    /// même que l'utilisateur ouvre l'éditeur.
    ///
    /// Les tailles de police sont calées sur ce que la zone de texte peut
    /// réellement absorber : ~29 mm de large sur une étiquette de 51 mm, soit
    /// au plus 14 % de la hauteur pour un nom NetBIOS de 15 caractères. Pour
    /// mémoire, le rendu Avery d'origine tournait autour de 10 %.
    fn default() -> Self {
        Self {
            version: default_version(),
            preview_width_mm: default_preview_w(),
            preview_height_mm: default_preview_h(),
            elements: vec![
                LabelElement {
                    x: 3.0,
                    y: 12.0,
                    h: 76.0,
                    ..LabelElement::new("qr", ElementKind::Qr)
                },
                LabelElement {
                    field: "deviceName".into(),
                    x: 42.0,
                    y: 28.0,
                    w: 55.0,
                    h: 20.0,
                    font_pct: 14.0,
                    bold: true,
                    ..LabelElement::new("name", ElementKind::Field)
                },
                LabelElement {
                    field: "serialNumber".into(),
                    x: 42.0,
                    y: 52.0,
                    w: 55.0,
                    h: 16.0,
                    font_pct: 11.0,
                    ..LabelElement::new("serial", ElementKind::Field)
                },
            ],
        }
    }
}

pub fn template_path() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("ScanTune");
    dir.push("label_template.json");
    dir
}

/// Ne échoue jamais : un template illisible retombe sur le défaut, comme
/// `config::load()`. Perdre sa mise en page est ennuyeux ; ne plus pouvoir
/// imprimer du tout le serait davantage.
pub fn load() -> LabelTemplate {
    let Ok(json) = std::fs::read_to_string(template_path()) else {
        return LabelTemplate::default();
    };
    serde_json::from_str(&json).unwrap_or_default()
}

fn write_to(path: &Path, t: &LabelTemplate) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(t)?)?;
    Ok(())
}

pub fn save(t: &LabelTemplate) -> Result<()> {
    write_to(&template_path(), t)
}

/// Exporte le template vers un fichier choisi, pour le rejouer sur une autre
/// installation.
///
/// Le fichier est autonome : les images sont embarquées en data URI dans le
/// modèle, pas référencées par chemin. Un template exporté depuis un poste
/// s'importe donc ailleurs sans traîner de dossier d'images à côté.
pub fn export_to(path: &str, t: &LabelTemplate) -> Result<()> {
    write_to(Path::new(path), t)
}

/// Importe un template depuis un fichier choisi. Strict, contrairement à
/// `load()`.
///
/// `load()` retombe sur le défaut quand le fichier de config est illisible :
/// c'est ce qu'on veut au démarrage. Ici l'utilisateur a désigné un fichier
/// précis, et lui rendre un template vide en annonçant que l'import a réussi
/// serait pire que de lui dire que le fichier ne convient pas.
///
/// D'où le contrôle des clés : tous les champs de `LabelTemplate` ayant une
/// valeur par défaut, n'importe quel JSON — `{}` compris — se désérialiserait
/// sinon en template vide sans la moindre erreur.
pub fn import_from(path: &str) -> Result<LabelTemplate> {
    let json = std::fs::read_to_string(path).with_context(|| format!("Lecture de {path}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&json).context("Ce fichier n'est pas du JSON valide")?;

    let looks_like_template = value
        .as_object()
        .is_some_and(|o| o.contains_key("version") && o.contains_key("elements"));
    if !looks_like_template {
        anyhow::bail!("Ce fichier n'est pas un template d'étiquette ScanTune");
    }

    serde_json::from_value(value)
        .context("Template illisible (exporté par une version incompatible ?)")
}

/// Côté long de l'image stockée, en pixels.
///
/// Plafond de stockage, pas une contrainte de mise en page : l'image est rendue
/// à la taille que lui donne le template. 600 px suffit largement pour une
/// vignette qui traverse une étiquette de quelques centimètres, et évite
/// d'embarquer un logo de 4000 px en base64 dans le JSON.
const IMAGE_MAX_PX: u32 = 600;

/// Lit une image du disque, la réduit et la rend en data URI PNG.
///
/// Passe par Rust parce que le frontend n'a aucun accès au système de fichiers :
/// `tauri-plugin-fs` n'est pas enregistré, et `plugin-dialog` ne rend qu'un
/// chemin.
pub fn load_image_data_url(path: &str) -> Result<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use image::ImageFormat;

    let img = image::open(path)?;
    let img = if img.width().max(img.height()) > IMAGE_MAX_PX {
        img.resize(
            IMAGE_MAX_PX,
            IMAGE_MAX_PX,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };

    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, ImageFormat::Png)?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(buf.into_inner())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_template_round_trips() {
        let t = LabelTemplate::default();
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(serde_json::from_str::<LabelTemplate>(&json).unwrap(), t);
    }

    #[test]
    fn serializes_in_camel_case() {
        let json = serde_json::to_string(&LabelTemplate::default()).unwrap();
        assert!(json.contains("previewWidthMm"));
        assert!(json.contains("fontPct"));
        assert!(json.contains("\"kind\":\"qr\""));
    }

    /// Un template écrit par une version future ne doit pas casser l'app.
    #[test]
    fn tolerates_missing_and_unknown_fields() {
        let json = r#"{
            "elements": [{ "id": "a", "kind": "text", "x": 1, "y": 2, "futureField": 42 }]
        }"#;
        let t: LabelTemplate = serde_json::from_str(json).unwrap();
        assert_eq!(t.version, 1);
        assert_eq!(t.preview_width_mm, 51.0);
        let e = &t.elements[0];
        assert_eq!(e.kind, ElementKind::Text);
        assert_eq!(e.align, "left");
        assert_eq!(e.contrast, 1.0);
    }

    #[test]
    fn corrupt_file_falls_back_to_default() {
        assert_eq!(
            serde_json::from_str::<LabelTemplate>("{ pas du json }").unwrap_or_default(),
            LabelTemplate::default()
        );
    }

    fn tmp(name: &str, body: &str) -> String {
        let p = std::env::temp_dir().join(name);
        std::fs::write(&p, body).unwrap();
        p.to_string_lossy().into_owned()
    }

    /// Un export doit pouvoir être réimporté à l'identique, image comprise.
    #[test]
    fn export_import_round_trip_keeps_the_image() {
        let mut t = LabelTemplate::default();
        t.elements.push(LabelElement {
            image_data_url: "data:image/png;base64,iVBORw0KGgo=".into(),
            threshold: true,
            brightness: 1.4,
            ..LabelElement::new("logo", ElementKind::Image)
        });

        let path = tmp("scantune_export_test.json", "");
        export_to(&path, &t).unwrap();
        assert_eq!(import_from(&path).unwrap(), t);
    }

    /// Le piège : tous les champs ayant un défaut, `{}` se désérialise en
    /// template vide. L'import doit refuser plutôt que d'effacer la mise en
    /// page de l'utilisateur en annonçant un succès.
    #[test]
    fn import_rejects_json_that_is_not_a_template() {
        for (name, body) in [
            ("scantune_empty.json", "{}"),
            (
                "scantune_other.json",
                r#"{"tenantId":"abc","clientId":"def"}"#,
            ),
            ("scantune_array.json", "[1, 2, 3]"),
        ] {
            let path = tmp(name, body);
            assert!(import_from(&path).is_err(), "{body} aurait dû être refusé");
        }
    }

    #[test]
    fn import_reports_broken_json() {
        let path = tmp("scantune_broken.json", "{ pas du json }");
        assert!(import_from(&path).is_err());
    }
}
