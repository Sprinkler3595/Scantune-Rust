//! Exports CSV / Excel / PDF — port de `ExportService`.

use anyhow::{Context, Result};
use chrono::Local;
use rust_xlsxwriter::{Color, Format, Workbook};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::BufWriter;

use crate::models::{EntraUser, IntuneDevice};

const BYTES_PER_GB: f64 = 1_073_741_824.0;

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn fmt_gb(bytes: i64) -> String {
    if bytes > 0 {
        round1(bytes as f64 / BYTES_PER_GB).to_string()
    } else {
        String::new()
    }
}

fn csv_escape(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    if value.contains(';') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

// --- CSV ---

pub fn export_csv(devices: &[IntuneDevice], path: &str) -> Result<()> {
    let mut out = String::new();
    out.push_str("Nom;Utilisateur;OS;Version;Modèle;Fabricant;N° Série;Compliance;Dernière sync;Enrollment;Stockage total (Go);Stockage libre (Go);Notes\n");

    for d in devices {
        let last_sync = d
            .last_sync_date_time
            .map(|t| t.format("%d/%m/%Y %H:%M").to_string())
            .unwrap_or_default();
        let enrolled = d
            .enrolled_date_time
            .map(|t| t.format("%d/%m/%Y").to_string())
            .unwrap_or_default();
        let notes = d.notes.replace('\r', " ").replace('\n', " ");

        let cols = [
            csv_escape(&d.device_name),
            csv_escape(&d.user_display_name),
            csv_escape(&d.operating_system),
            csv_escape(&d.os_version),
            csv_escape(&d.model),
            csv_escape(&d.manufacturer),
            csv_escape(&d.serial_number),
            csv_escape(&d.compliance_state),
            last_sync,
            enrolled,
            fmt_gb(d.total_storage_space_in_bytes),
            fmt_gb(d.free_storage_space_in_bytes),
            csv_escape(&notes),
        ];
        out.push_str(&cols.join(";"));
        out.push('\n');
    }

    // UTF-8 avec BOM (comme le C#) pour qu'Excel détecte l'encodage.
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(out.as_bytes());
    std::fs::write(path, bytes).context("Écriture CSV")?;
    Ok(())
}

// --- Excel : appareils ---

pub fn export_devices_xlsx(devices: &[IntuneDevice], path: &str) -> Result<()> {
    let mut wb = Workbook::new();

    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0xE8EAF6));
    let red = Format::new().set_font_color(Color::RGB(0xFF0000));
    let orange = Format::new().set_font_color(Color::RGB(0xFF4500));

    // Feuille 1 — Inventaire
    let ws = wb.add_worksheet();
    ws.set_name("Inventaire Devices")?;

    let headers = [
        "Nom", "Utilisateur", "UPN", "OS", "Version", "Modèle", "Fabricant",
        "N° Série", "Compliance", "Dernière sync", "Enrollment",
        "Stockage total (Go)", "Stockage libre (Go)", "Jours sans sync",
        "Agent", "Catégorie", "Notes",
    ];
    for (c, h) in headers.iter().enumerate() {
        ws.write_with_format(0, c as u16, *h, &header_fmt)?;
    }

    for (i, d) in devices.iter().enumerate() {
        let row = (i + 1) as u32;
        ws.write(row, 0, &d.device_name)?;
        ws.write(row, 1, &d.user_display_name)?;
        ws.write(row, 2, &d.user_principal_name)?;
        ws.write(row, 3, &d.operating_system)?;
        ws.write(row, 4, &d.os_version)?;
        ws.write(row, 5, &d.model)?;
        ws.write(row, 6, &d.manufacturer)?;
        ws.write(row, 7, &d.serial_number)?;
        if d.is_compliant() {
            ws.write(row, 8, &d.compliance_state)?;
        } else {
            ws.write_with_format(row, 8, &d.compliance_state, &red)?;
        }
        ws.write(
            row,
            9,
            d.last_sync_date_time
                .map(|t| t.format("%d/%m/%Y %H:%M").to_string())
                .unwrap_or_default(),
        )?;
        ws.write(
            row,
            10,
            d.enrolled_date_time
                .map(|t| t.format("%d/%m/%Y").to_string())
                .unwrap_or_default(),
        )?;
        ws.write(row, 11, round1(d.total_storage_space_in_bytes as f64 / BYTES_PER_GB))?;
        ws.write(row, 12, round1(d.free_storage_space_in_bytes as f64 / BYTES_PER_GB))?;
        let days = d.days_since_last_sync();
        if days > 30 {
            ws.write_with_format(row, 13, days as f64, &orange)?;
        } else {
            ws.write(row, 13, days as f64)?;
        }
        ws.write(row, 14, &d.management_agent)?;
        ws.write(row, 15, &d.device_category_display_name)?;
        ws.write(row, 16, &d.notes)?;
    }
    ws.autofit();

    // Feuille 2 — Résumé
    let summary = wb.add_worksheet();
    summary.set_name("Résumé")?;
    let title_fmt = Format::new().set_bold().set_font_size(14.0);
    summary.write_with_format(0, 0, "Résumé de l'inventaire", &title_fmt)?;

    let compliant = devices.iter().filter(|d| d.is_compliant()).count();
    let non_compliant = devices.len() - compliant;
    let stale = devices.iter().filter(|d| d.days_since_last_sync() > 30).count();

    summary.write(2, 0, "Total devices")?;
    summary.write(2, 1, devices.len() as u32)?;
    summary.write(3, 0, "Compliant")?;
    summary.write(3, 1, compliant as u32)?;
    summary.write(4, 0, "Non-compliant")?;
    summary.write(4, 1, non_compliant as u32)?;
    summary.write(5, 0, "Sans sync > 30j")?;
    summary.write(5, 1, stale as u32)?;

    summary.write_with_format(7, 0, "Répartition par OS", &Format::new().set_bold())?;
    let mut by_os: BTreeMap<String, u32> = BTreeMap::new();
    for d in devices {
        *by_os.entry(d.operating_system.clone()).or_default() += 1;
    }
    let mut os_sorted: Vec<_> = by_os.into_iter().collect();
    os_sorted.sort_by(|a, b| b.1.cmp(&a.1));
    let mut srow = 8u32;
    for (os, count) in os_sorted {
        summary.write(srow, 0, &os)?;
        summary.write(srow, 1, count)?;
        srow += 1;
    }
    summary.autofit();

    wb.save(path).context("Sauvegarde XLSX")?;
    Ok(())
}

// --- Excel : utilisateurs ---

pub fn export_users_xlsx(users: &[EntraUser], path: &str) -> Result<()> {
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name("Utilisateurs")?;

    let header_fmt = Format::new().set_bold().set_background_color(Color::RGB(0xE8EAF6));
    let red = Format::new().set_font_color(Color::RGB(0xFF0000));

    let headers = [
        "Nom", "UPN", "Email", "Poste", "Département", "Société",
        "Téléphone", "Compte actif", "Nb devices",
    ];
    for (c, h) in headers.iter().enumerate() {
        ws.write_with_format(0, c as u16, *h, &header_fmt)?;
    }

    for (i, u) in users.iter().enumerate() {
        let row = (i + 1) as u32;
        ws.write(row, 0, &u.display_name)?;
        ws.write(row, 1, &u.user_principal_name)?;
        ws.write(row, 2, &u.mail)?;
        ws.write(row, 3, &u.job_title)?;
        ws.write(row, 4, &u.department)?;
        ws.write(row, 5, &u.company_name)?;
        ws.write(row, 6, &u.mobile_phone)?;
        if u.account_enabled {
            ws.write(row, 7, "Oui")?;
        } else {
            ws.write_with_format(row, 7, "Non", &red)?;
        }
        ws.write(row, 8, u.device_count() as u32)?;
    }
    ws.autofit();
    wb.save(path).context("Sauvegarde XLSX utilisateurs")?;
    Ok(())
}

// --- PDF : rapport d'inventaire ---

pub fn generate_inventory_report(devices: &[IntuneDevice], path: &str) -> Result<()> {
    use printpdf::*;

    let now = Local::now();
    let compliant = devices.iter().filter(|d| d.is_compliant()).count();
    let non_compliant = devices.len() - compliant;
    let stale = devices.iter().filter(|d| d.days_since_last_sync() > 30).count();
    let total = devices.len();

    let (doc, page1, layer1) =
        PdfDocument::new("Inventaire IT", Mm(210.0), Mm(297.0), "Layer 1");
    let font = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)?;

    // Page de couverture
    let cover = doc.get_page(page1).get_layer(layer1);
    cover.use_text("Inventaire IT", 34.0, Mm(60.0), Mm(200.0), &font_bold);
    cover.use_text(
        now.format("%d/%m/%Y").to_string(),
        16.0,
        Mm(60.0),
        Mm(185.0),
        &font,
    );
    cover.use_text(
        format!("{total} appareils gérés"),
        14.0,
        Mm(60.0),
        Mm(165.0),
        &font,
    );
    cover.use_text(
        "ScanTune — Rapport généré automatiquement",
        10.0,
        Mm(60.0),
        Mm(150.0),
        &font,
    );

    // Page résumé
    let (p2, l2) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
    let s = doc.get_page(p2).get_layer(l2);
    let mut y = 270.0;
    s.use_text("Résumé", 22.0, Mm(20.0), Mm(y), &font_bold);
    y -= 18.0;
    let pct = if total > 0 {
        round1(compliant as f64 / total as f64 * 100.0)
    } else {
        0.0
    };
    let rows = [
        ("Total devices".to_string(), total.to_string()),
        ("Compliant".to_string(), format!("{compliant} ({pct}%)")),
        ("Non-compliant".to_string(), non_compliant.to_string()),
        ("Sans sync > 30 jours".to_string(), stale.to_string()),
    ];
    for (label, value) in rows {
        s.use_text(&label, 11.0, Mm(20.0), Mm(y), &font);
        s.use_text(&value, 11.0, Mm(150.0), Mm(y), &font_bold);
        y -= 9.0;
    }

    y -= 10.0;
    s.use_text("Répartition par OS", 16.0, Mm(20.0), Mm(y), &font_bold);
    y -= 10.0;
    let mut by_os: BTreeMap<String, u32> = BTreeMap::new();
    for d in devices {
        *by_os.entry(d.operating_system.clone()).or_default() += 1;
    }
    let mut os_sorted: Vec<_> = by_os.into_iter().collect();
    os_sorted.sort_by(|a, b| b.1.cmp(&a.1));
    for (os, count) in os_sorted {
        let label = if os.is_empty() { "(vide)".to_string() } else { os };
        let opct = if total > 0 {
            round1(count as f64 / total as f64 * 100.0)
        } else {
            0.0
        };
        s.use_text(&label, 11.0, Mm(20.0), Mm(y), &font);
        s.use_text(format!("{count} ({opct}%)"), 11.0, Mm(150.0), Mm(y), &font);
        y -= 8.0;
        if y < 20.0 {
            break;
        }
    }

    // Pages liste des appareils
    let new_device_page = |doc: &PdfDocumentReference| -> (PdfPageIndex, PdfLayerIndex) {
        doc.add_page(Mm(210.0), Mm(297.0), "Layer 1")
    };
    let (mut pd, mut ld) = new_device_page(&doc);
    let mut layer = doc.get_page(pd).get_layer(ld);
    let mut yy = 280.0;
    layer.use_text("Liste des appareils", 16.0, Mm(15.0), Mm(yy), &font_bold);
    yy -= 10.0;
    let header = |layer: &PdfLayerReference, font: &IndirectFontRef, y: f32| {
        layer.use_text("Nom", 8.0, Mm(15.0), Mm(y), font);
        layer.use_text("Utilisateur", 8.0, Mm(70.0), Mm(y), font);
        layer.use_text("OS", 8.0, Mm(120.0), Mm(y), font);
        layer.use_text("N° Série", 8.0, Mm(150.0), Mm(y), font);
        layer.use_text("Compl.", 8.0, Mm(185.0), Mm(y), font);
    };
    header(&layer, &font_bold, yy);
    yy -= 6.0;

    let truncate = |s: &str, n: usize| -> String {
        if s.chars().count() > n {
            s.chars().take(n).collect()
        } else {
            s.to_string()
        }
    };

    for d in devices {
        if yy < 15.0 {
            let (np, nl) = new_device_page(&doc);
            pd = np;
            ld = nl;
            layer = doc.get_page(pd).get_layer(ld);
            yy = 285.0;
            header(&layer, &font_bold, yy);
            yy -= 6.0;
        }
        layer.use_text(truncate(&d.device_name, 28), 7.0, Mm(15.0), Mm(yy), &font);
        layer.use_text(truncate(&d.user_display_name, 26), 7.0, Mm(70.0), Mm(yy), &font);
        layer.use_text(truncate(&d.operating_system, 14), 7.0, Mm(120.0), Mm(yy), &font);
        layer.use_text(truncate(&d.serial_number, 18), 7.0, Mm(150.0), Mm(yy), &font);
        layer.use_text(
            if d.is_compliant() { "OK" } else { "NON" },
            7.0,
            Mm(185.0),
            Mm(yy),
            &font,
        );
        yy -= 5.0;
    }

    // Page synthèse
    let (p4, l4) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
    let syn = doc.get_page(p4).get_layer(l4);
    let mut sy = 270.0;
    syn.use_text("Synthèse et observations", 22.0, Mm(20.0), Mm(sy), &font_bold);
    sy -= 18.0;
    if non_compliant > 0 {
        syn.use_text(
            format!("{non_compliant} appareil(s) non-conforme(s)"),
            13.0,
            Mm(20.0),
            Mm(sy),
            &font_bold,
        );
        sy -= 8.0;
        syn.use_text(
            "Action requise : vérifier les politiques de conformité.",
            10.0,
            Mm(20.0),
            Mm(sy),
            &font,
        );
        sy -= 14.0;
    }
    if stale > 0 {
        syn.use_text(
            format!("{stale} appareil(s) sans sync depuis plus de 30 jours"),
            13.0,
            Mm(20.0),
            Mm(sy),
            &font_bold,
        );
        sy -= 8.0;
        syn.use_text(
            "Action requise : vérifier que ces appareils sont encore en service.",
            10.0,
            Mm(20.0),
            Mm(sy),
            &font,
        );
        sy -= 14.0;
    }
    if non_compliant == 0 && stale == 0 {
        syn.use_text(
            "Tous les appareils sont conformes et synchronisés.",
            13.0,
            Mm(20.0),
            Mm(sy),
            &font_bold,
        );
        sy -= 14.0;
    }
    syn.use_text(
        format!("Rapport généré le {}", now.format("%d/%m/%Y à %H:%M")),
        10.0,
        Mm(20.0),
        Mm(sy - 6.0),
        &font,
    );

    doc.save(&mut BufWriter::new(
        File::create(path).context("Création du fichier PDF")?,
    ))
    .context("Sauvegarde PDF")?;
    Ok(())
}
