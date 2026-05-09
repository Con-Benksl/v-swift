use crate::commands::AppState;
use crate::control::{self, ConnectionStatus, NetworkStats, ServiceStatus, SystemStatus};
use crate::deploy::{NodeRecord, ProtocolId};
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
pub async fn connect_vps(state: State<'_, AppState>, vps_id: String) -> AppResult<()> {
    let _ = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn disconnect_vps(state: State<'_, AppState>, vps_id: String) -> AppResult<()> {
    state.ssh_pool.disconnect(&vps_id).await
}

#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, AppState>,
    vps_id: String,
) -> AppResult<ConnectionStatus> {
    Ok(state.ssh_pool.get_status(&vps_id).await)
}

#[tauri::command]
pub async fn get_system_status(
    state: State<'_, AppState>,
    vps_id: String,
) -> AppResult<SystemStatus> {
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    control::monitor::get_system_status(&session).await
}

#[tauri::command]
pub async fn get_network_stats(
    state: State<'_, AppState>,
    vps_id: String,
) -> AppResult<NetworkStats> {
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    control::monitor::get_network_stats(&session).await
}

#[tauri::command]
pub async fn get_service_status(
    state: State<'_, AppState>,
    vps_id: String,
    protocol: String,
) -> AppResult<ServiceStatus> {
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    control::service::get_service_status(&session, &protocol).await
}

#[tauri::command]
pub async fn get_all_service_statuses(
    state: State<'_, AppState>,
    vps_id: String,
) -> AppResult<Vec<ServiceStatus>> {
    let nodes = state.storage.list()?;
    let protocols = unique_protocols_for_vps(&nodes, &vps_id);

    if protocols.is_empty() {
        return Ok(vec![]);
    }

    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;

    let mut services = Vec::new();
    for protocol in protocols {
        let protocol_str = protocol_to_str(protocol);
        match control::service::get_service_status(&session, protocol_str).await {
            Ok(service) => services.push(service),
            Err(err) => {
                log::warn!("failed to get service status for {}: {}", protocol_str, err);
            }
        }
    }

    Ok(services)
}

#[tauri::command]
pub async fn start_service(
    state: State<'_, AppState>,
    vps_id: String,
    protocol: String,
) -> AppResult<()> {
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    control::service::start_service(&session, &protocol).await
}

#[tauri::command]
pub async fn stop_service(
    state: State<'_, AppState>,
    vps_id: String,
    protocol: String,
) -> AppResult<()> {
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    control::service::stop_service(&session, &protocol).await
}

#[tauri::command]
pub async fn restart_service(
    state: State<'_, AppState>,
    vps_id: String,
    protocol: String,
) -> AppResult<()> {
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    control::service::restart_service(&session, &protocol).await
}

#[tauri::command]
pub async fn get_service_logs(
    state: State<'_, AppState>,
    vps_id: String,
    protocol: String,
) -> AppResult<Vec<String>> {
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    control::service::get_service_logs(&session, &protocol, 50).await
}

fn unique_protocols_for_vps(nodes: &[NodeRecord], vps_id: &str) -> Vec<ProtocolId> {
    let mut protocols = Vec::new();
    for node in nodes.iter().filter(|node| node.vps_id == vps_id) {
        if !protocols.contains(&node.protocol) {
            protocols.push(node.protocol);
        }
    }
    protocols
}

fn protocol_to_str(protocol: ProtocolId) -> &'static str {
    match protocol {
        ProtocolId::VlessReality => "vless-reality",
        ProtocolId::Hysteria2 => "hysteria2",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, vps_id: &str, name: &str, protocol: ProtocolId) -> NodeRecord {
        NodeRecord {
            id: id.to_string(),
            vps_id: vps_id.to_string(),
            vps_name: "Test VPS".to_string(),
            name: name.to_string(),
            host: "203.0.113.10".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol,
            protocol_params: serde_json::json!({}),
            status: "active".to_string(),
            created_at: 0,
        }
    }

    #[test]
    fn unique_protocols_for_vps_deduplicates_protocols_and_preserves_order() {
        let nodes = vec![
            node("1", "vps-a", "a-vless-1", ProtocolId::VlessReality),
            node("2", "vps-a", "a-vless-2", ProtocolId::VlessReality),
            node("3", "vps-a", "a-hy2", ProtocolId::Hysteria2),
            node("4", "vps-b", "b-vless", ProtocolId::VlessReality),
        ];

        assert_eq!(
            unique_protocols_for_vps(&nodes, "vps-a"),
            vec![ProtocolId::VlessReality, ProtocolId::Hysteria2]
        );
    }
}
