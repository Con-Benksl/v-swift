use std::fs::OpenOptions;

use tauri::{Emitter, Manager};

pub mod commands;
pub mod control;
pub mod credentials;
pub mod deploy;
pub mod error;
pub mod events;
pub mod remote_subscription;
pub mod scripts;
pub mod ssh;
pub mod storage;
pub mod subscription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("nodes.db");
            let storage = storage::Storage::open(&db_path)?;
            let remote_mutation_file = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(app_data_dir.join("remote-mutation.lock"))?;
            app.manage(commands::AppState {
                storage,
                ssh_pool: control::ssh_pool::SshPool::new(),
                remote_mutation_lock: tokio::sync::Mutex::new(()),
                remote_mutation_file,
            });

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<commands::AppState>();
                match state.try_begin_remote_mutation() {
                    Ok(_mutation_guard) => {
                        if let Err(err) = commands::recover_pending_deployments(&state.storage).await
                        {
                            log::error!(
                                "failed to recover interrupted deployment transaction: {err}"
                            );
                        }
                    }
                    Err(err) => {
                        log::info!(
                            "startup deployment recovery skipped because another process is mutating remote state: {err}"
                        );
                    }
                };
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::test_connection,
            commands::detect_os,
            commands::deploy_node,
            commands::list_nodes,
            commands::list_vps_profiles,
            commands::update_vps_profile_host,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            let mutation_active = app_handle
                .try_state::<commands::AppState>()
                .is_some_and(|state| state.remote_mutation_lock.try_lock().is_err());
            if mutation_active {
                api.prevent_close();
                let _ = app_handle.emit("remote-mutation-close-blocked", ());
            }
        }
        tauri::RunEvent::ExitRequested { api, .. } => {
            let mutation_active = app_handle
                .try_state::<commands::AppState>()
                .is_some_and(|state| state.remote_mutation_lock.try_lock().is_err());
            if mutation_active {
                api.prevent_exit();
                let _ = app_handle.emit("remote-mutation-close-blocked", ());
            }
        }
        _ => {}
    });
}
