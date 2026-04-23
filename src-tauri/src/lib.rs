use tauri::Manager;

pub mod ssh;
pub mod deploy;
pub mod credentials;
pub mod storage;
pub mod subscription;
pub mod scripts;
pub mod commands;
pub mod events;
pub mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("nodes.db");
            let storage = storage::Storage::open(&db_path)?;
            app.manage(commands::AppState { storage });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::test_connection,
            commands::detect_os,
            commands::deploy_node,
            commands::list_nodes,
            commands::list_vps_profiles,
            commands::get_node,
            commands::get_subscription,
            commands::uninstall_node,
            commands::forget_vps_profile,
            commands::forget_orphan_vps_profiles
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
