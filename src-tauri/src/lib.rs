use tauri::Manager;

pub mod ssh;
pub mod deploy;
pub mod credentials;
pub mod storage;
pub mod subscription;
pub mod remote_subscription;
pub mod scripts;
pub mod commands;
pub mod events;
pub mod error;
pub mod control;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("nodes.db");
            let storage = storage::Storage::open(&db_path)?;
            app.manage(commands::AppState {
                storage,
                ssh_pool: control::ssh_pool::SshPool::new(),
            });

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
            commands::forget_orphan_vps_profiles,
            control::connect_vps,
            control::disconnect_vps,
            control::get_connection_status,
            control::get_system_status,
            control::get_network_stats,
            control::get_service_status,
            control::get_all_service_statuses,
            control::start_service,
            control::stop_service,
            control::restart_service,
            control::get_service_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
