mod auth;
mod commands;
mod config;
mod export;
mod graph;
mod label_template;
mod models;
mod qr;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            use tauri::Manager;
            // Donne à l'état d'auth de quoi ouvrir la popup de connexion interne.
            app.state::<AppState>()
                .auth
                .set_app_handle(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::auth_status,
            commands::sign_in,
            commands::sign_out,
            commands::current_user_name,
            commands::get_devices,
            commands::get_device,
            commands::search_devices,
            commands::get_users,
            commands::get_user,
            commands::search_users,
            commands::password_alerts,
            commands::get_device_apps,
            commands::get_bitlocker_keys,
            commands::get_bitlocker_key_value,
            commands::dashboard_stats,
            commands::generate_qr_data_url,
            commands::export_qr_png,
            commands::export_csv,
            commands::export_devices_xlsx,
            commands::export_users_xlsx,
            commands::export_inventory_pdf,
            commands::print_labels,
            commands::get_label_template,
            commands::save_label_template,
            commands::reset_label_template,
            commands::export_label_template,
            commands::import_label_template,
            commands::load_template_image,
            commands::generate_qr_svgs,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de ScanTune");
}
