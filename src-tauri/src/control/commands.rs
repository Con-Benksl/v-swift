use tauri::State;
use crate::control::{self, ConnectionStatus, NetworkStats, ServiceStatus, SystemStatus};
use crate::commands::AppState;
use crate::error::AppResult;

#[tauri::command]
pub async fn connect_vps(state: State<'_, AppState>, vps_id: String) -> AppResult<()> {
    let _ = state.ssh_pool.get_or_connect(&vps_id, &state.storage).await?;
    Ok(())
}

#[tauri::command]
pub async fn disconnect_vps(state: State<'_, AppState>, vps_id: String) -> AppResult<()> {
    state.ssh_pool.disconnect(&vps_id).await
}

#[tauri::command]
pub fn get_connection_status(state: State<'_, AppState>, vps_id: String) -> ConnectionStatus {
    state.ssh_pool.get_status(&vps_id)
}

#[tauri::command]
pub async fn get_system_status(state: State<'_, AppState>, vps_id: String) -> AppResult<SystemStatus> {
    let session = state.ssh_pool.get_or_connect(&vps_id, &state.storage).await?;
    control::monitor::get_system_status(&session).await
}

#[tauri::command]
pub async fn get_network_stats(state: State<'_, AppState>, vps_id: String) -> AppResult<NetworkStats> {
    let session = state.ssh_pool.get_or_connect(&vps_id, &state.storage).await?;
    control::monitor::get_network_stats(&session).await
}

#[tauri::command]
pub async fn get_service_status(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<ServiceStatus> {
    let session = state.ssh_pool.get_or_connect(&vps_id, &state.storage).await?;
    control::service::get_service_status(&session, &protocol).await
}

#[tauri::command]
pub async fn start_service(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<()> {
    let session = state.ssh_pool.get_or_connect(&vps_id, &state.storage).await?;
    control::service::start_service(&session, &protocol).await
}

#[tauri::command]
pub async fn stop_service(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<()> {
    let session = state.ssh_pool.get_or_connect(&vps_id, &state.storage).await?;
    control::service::stop_service(&session, &protocol).await
}

#[tauri::command]
pub async fn restart_service(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<()> {
    let session = state.ssh_pool.get_or_connect(&vps_id, &state.storage).await?;
    control::service::restart_service(&session, &protocol).await
}

#[tauri::command]
pub async fn get_service_logs(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<Vec<String>> {
    let session = state.ssh_pool.get_or_connect(&vps_id, &state.storage).await?;
    control::service::get_service_logs(&session, &protocol, 50).await
}
