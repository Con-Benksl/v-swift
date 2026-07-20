use crate::commands::AppState;
use crate::control::{self, ConnectionStatus, NetworkStats, ServiceStatus, SystemStatus};
use crate::deploy::{self, NodeRecord, ProtocolId};
use crate::error::{AppError, AppResult};
use tauri::State;

#[tauri::command]
pub async fn connect_vps(state: State<'_, AppState>, vps_id: String) -> AppResult<()> {
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    let first_probe = probe_session(&session).await;
    if first_probe.is_ok() {
        return Ok(());
    }

    drop(session);
    invalidate_failed_session(&state, &vps_id).await;

    let retry_session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    let retry_probe = probe_session(&retry_session).await;
    if retry_probe.is_err() {
        drop(retry_session);
        invalidate_failed_session(&state, &vps_id).await;
    }
    retry_probe
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
    let result = control::monitor::get_system_status(&session).await;
    finish_session_operation(&state, &vps_id, result).await
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
    let result = control::monitor::get_network_stats(&session).await;
    finish_session_operation(&state, &vps_id, result).await
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
    let result = control::service::get_service_status(&session, &protocol).await;
    finish_session_operation(&state, &vps_id, result).await
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
        let result = control::service::get_service_status(&session, protocol_str).await;
        match finish_session_operation(&state, &vps_id, result).await {
            Ok(service) => services.push(service),
            Err(err) => return Err(err),
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
    let _mutation_guard = state.try_begin_remote_mutation()?;
    crate::commands::recover_pending_deployments_for_profile(&state.storage, &vps_id).await?;
    let ownership_hash = current_node_ownership_hash(&state.storage.list()?, &vps_id, &protocol)?;
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    let result = control::service::start_service(&session, &protocol, &ownership_hash).await;
    finish_session_operation(&state, &vps_id, result).await
}

#[tauri::command]
pub async fn stop_service(
    state: State<'_, AppState>,
    vps_id: String,
    protocol: String,
) -> AppResult<()> {
    let _mutation_guard = state.try_begin_remote_mutation()?;
    crate::commands::recover_pending_deployments_for_profile(&state.storage, &vps_id).await?;
    let ownership_hash = current_node_ownership_hash(&state.storage.list()?, &vps_id, &protocol)?;
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    let result = control::service::stop_service(&session, &protocol, &ownership_hash).await;
    finish_session_operation(&state, &vps_id, result).await
}

#[tauri::command]
pub async fn restart_service(
    state: State<'_, AppState>,
    vps_id: String,
    protocol: String,
) -> AppResult<()> {
    let _mutation_guard = state.try_begin_remote_mutation()?;
    crate::commands::recover_pending_deployments_for_profile(&state.storage, &vps_id).await?;
    let ownership_hash = current_node_ownership_hash(&state.storage.list()?, &vps_id, &protocol)?;
    let session = state
        .ssh_pool
        .get_or_connect(&vps_id, &state.storage)
        .await?;
    let result = control::service::restart_service(&session, &protocol, &ownership_hash).await;
    finish_session_operation(&state, &vps_id, result).await
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
    let result = control::service::get_service_logs(&session, &protocol, 50).await;
    finish_session_operation(&state, &vps_id, result).await
}

async fn probe_session(session: &crate::ssh::SshSession) -> AppResult<()> {
    let output = session.exec("true").await?;
    if output.exit_code == 0 {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "SSH 会话探活失败，退出码 {}",
            output.exit_code
        )))
    }
}

async fn invalidate_failed_session(state: &AppState, vps_id: &str) {
    if let Err(err) = state.ssh_pool.disconnect(vps_id).await {
        log::warn!("failed to invalidate SSH session for {}: {}", vps_id, err);
    }
}

async fn finish_session_operation<T>(
    state: &AppState,
    vps_id: &str,
    result: AppResult<T>,
) -> AppResult<T> {
    if matches!(
        &result,
        Err(AppError::NetworkTimeout)
            | Err(AppError::HostUnreachable(_))
            | Err(AppError::SshTransport(_))
    ) {
        invalidate_failed_session(state, vps_id).await;
    }
    result
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

fn current_node_ownership_hash(
    nodes: &[NodeRecord],
    vps_id: &str,
    protocol: &str,
) -> AppResult<String> {
    let protocol_id = control::service::protocol_id(protocol)?;
    let candidates = nodes
        .iter()
        .filter(|node| {
            node.vps_id == vps_id
                && node.protocol == protocol_id
                && matches!(node.status.as_str(), "active" | "unknown")
        })
        .collect::<Vec<_>>();

    let node = match candidates.as_slice() {
        [node] => *node,
        [] => {
            return Err(AppError::Other(
                "本地没有可确认所有权的当前节点，已拒绝执行远端服务控制。".to_string(),
            ))
        }
        _ => {
            return Err(AppError::Other(
                "本地存在多个同协议节点记录，无法安全确认远端服务所有权。".to_string(),
            ))
        }
    };

    deploy::ownership_secret_hash(node).ok_or_else(|| {
        AppError::Other("本地当前节点缺少所有权凭据，已拒绝执行远端服务控制。".to_string())
    })
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
        let protocol_params = match protocol {
            ProtocolId::VlessReality => serde_json::json!({ "uuid": "legacy-secret" }),
            ProtocolId::Hysteria2 => serde_json::json!({ "password": "hy2-secret" }),
        };
        NodeRecord {
            id: id.to_string(),
            vps_id: vps_id.to_string(),
            vps_name: "Test VPS".to_string(),
            name: name.to_string(),
            host: "203.0.113.10".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol,
            protocol_params,
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

    #[test]
    fn control_ownership_uses_exactly_one_current_local_node() {
        let nodes = vec![node("1", "vps-a", "a-vless", ProtocolId::VlessReality)];
        let hash = current_node_ownership_hash(&nodes, "vps-a", "xray").unwrap();
        assert_eq!(
            hash,
            "fdcbc807d80f60c6f15ef644d5c372ac92760bd5f414cc3d48c3b320d9d1e689"
        );

        assert!(current_node_ownership_hash(&nodes, "vps-b", "xray").is_err());
        assert!(current_node_ownership_hash(&nodes, "vps-a", "xray; reboot").is_err());
    }

    #[test]
    fn control_ownership_rejects_stale_and_ambiguous_records() {
        let mut stale = node("1", "vps-a", "stale", ProtocolId::VlessReality);
        stale.status = "uninstalled".to_string();
        assert!(current_node_ownership_hash(&[stale], "vps-a", "xray").is_err());

        let duplicate_nodes = vec![
            node("1", "vps-a", "first", ProtocolId::VlessReality),
            node("2", "vps-a", "second", ProtocolId::VlessReality),
        ];
        assert!(current_node_ownership_hash(&duplicate_nodes, "vps-a", "xray").is_err());
    }
}
