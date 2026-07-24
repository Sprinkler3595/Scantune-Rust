//! Génération de QR codes — port de `QRService`.
//!
//! Le contenu encodé est identique à la version WPF (même JSON) pour rester
//! compatible avec ScanTune Mobile.
//!
//! La composition d'étiquettes a quitté ce module : elle se fait désormais en
//! HTML/CSS côté frontend, où l'éditeur de template et le rendu imprimé sont
//! le même composant, et où c'est le pilote d'imprimante qui décide de la
//! taille. Ne subsiste ici que le QR lui-même.

use anyhow::{Context, Result};
use chrono::Local;
use image::{ImageFormat, Luma};
use qrcode::QrCode;
use std::io::Cursor;

use crate::models::IntuneDevice;

/// Charge utile JSON encodée dans le QR — identique au C#.
///
/// Contrat figé avec ScanTune Mobile : la forme à cinq clés et leurs noms ne
/// doivent pas changer, sous peine de rendre illisibles par l'app mobile tous
/// les QR déjà collés sur le parc. Verrouillé par `payload_shape_is_frozen`.
pub fn qr_payload(device: &IntuneDevice) -> String {
    serde_json::json!({
        "id": device.id,
        "name": device.device_name,
        "serial": device.serial_number,
        "source": "intune",
        "generated": Local::now().format("%Y-%m-%d").to_string(),
    })
    .to_string()
}

fn qr_code(device: &IntuneDevice) -> Result<QrCode> {
    QrCode::new(qr_payload(device).as_bytes()).context("Création du QR code")
}

/// PNG du QR seul (modules noirs sur fond blanc), pour l'affichage et l'export
/// à l'unité depuis la fiche d'un appareil.
pub fn generate_qr_png(device: &IntuneDevice, scale: u32) -> Result<Vec<u8>> {
    let code = qr_code(device)?;
    let scale = scale.max(1);
    let img = code
        .render::<Luma<u8>>()
        .min_dimensions(scale * 21, scale * 21)
        .module_dimensions(scale, scale)
        .build();
    let mut bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .context("Encodage PNG du QR")?;
    Ok(bytes)
}

/// QR vectoriel (SVG), pour les étiquettes.
///
/// Vectoriel et non bitmap, parce que l'imprimante le rastérise alors à sa
/// résolution native (300 dpi sur la ZD421t) : les modules ressortent tous
/// rigoureusement de la même largeur. Un PNG subirait un rééchantillonnage
/// vers la taille réelle de l'étiquette et donnerait des modules inégaux —
/// un QR que les lecteurs peinent à décoder.
///
/// `module_dimensions(1, 1)` fait compter le `viewBox` en modules : la taille
/// finale vient du CSS, et aucun pixel n'entre dans la chaîne. La zone de
/// silence réglementaire est ajoutée par défaut par le moteur de rendu.
pub fn generate_qr_svg(device: &IntuneDevice) -> Result<String> {
    use qrcode::render::svg;
    Ok(qr_code(device)?
        .render::<svg::Color>()
        .module_dimensions(1, 1)
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> IntuneDevice {
        IntuneDevice {
            id: "dev-1".into(),
            device_name: "PC-001".into(),
            serial_number: "SN123".into(),
            ..Default::default()
        }
    }

    /// Contrat avec ScanTune Mobile. Si ce test casse, les QR déjà collés sur
    /// le parc deviennent illisibles : c'est le test qu'il ne faut pas « faire
    /// passer », mais dont il faut annuler la cause.
    #[test]
    fn payload_shape_is_frozen() {
        let v: serde_json::Value = serde_json::from_str(&qr_payload(&device())).unwrap();
        let obj = v.as_object().expect("le payload doit être un objet JSON");

        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, ["generated", "id", "name", "serial", "source"]);

        assert_eq!(obj["id"], "dev-1");
        assert_eq!(obj["name"], "PC-001");
        assert_eq!(obj["serial"], "SN123");
        assert_eq!(obj["source"], "intune");
        // Date locale du jour : on en vérifie la forme, pas la valeur.
        assert_eq!(obj["generated"].as_str().unwrap().len(), "2026-07-16".len());
    }

    #[test]
    fn svg_is_scalable_and_crisp() {
        let svg = generate_qr_svg(&device()).unwrap();
        // Un viewBox sans dimension en pixels : c'est le CSS qui décide.
        assert!(svg.contains("viewBox="));
        // Sans cet attribut, le rastériseur lisse les bords des modules.
        assert!(svg.contains(r#"shape-rendering="crispEdges""#));
        assert!(svg.ends_with("</svg>"));
    }

    #[test]
    fn png_still_renders() {
        let png = generate_qr_png(&device(), 8).unwrap();
        assert_eq!(&png[1..4], b"PNG");
    }
}
