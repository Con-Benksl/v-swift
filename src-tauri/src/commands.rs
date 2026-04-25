use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::net::TcpStream;
use tokio::time::{sleep, timeout, Duration};

use crate::credentials;
use crate::deploy::{
    self, DeployParams, NodeRecord, OsInfo, ProgressSink, ProtocolId, VpsProfileSummary,
};
use crate::error::{AppError, AppResult};
use crate::events::{DeployEventPayload, TauriProgressSink};
use crate::remote_subscription;
use crate::ssh::{SshSession, VpsCredential};
use crate::storage::{Storage, VpsProfileRecord};
use crate::subscription;

pub struct AppState {
    pub storage: Storage,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTarget {
    pub vps_profile_id: Option<String>,
    pub credential: Option<VpsCredential>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionDto {
    pub uri: String,
    pub qr_svg: String,
    pub managed_uri: Option<String>,
    pub managed_qr_svg: Option<String>,
}

struct SilentProgress;

impl ProgressSink for SilentProgress {
    fn step(&self, _step: &str, _label: &str) {}
    fn log(&self, _line: &str) {}
}

struct ResolvedDeployTarget {
    profile: VpsProfileRecord,
    credential: VpsCredential,
    should_save_credential: bool,
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    target: ConnectionTarget,
) -> AppResult<()> {
    let credential = resolve_connection_target(&state.storage, target)?;
    let ssh = SshSession::connect(&credential).await?;
    let exec_result = ssh.exec("true").await;
    let close_result = ssh.close().await;
    let result = exec_result?;
    close_result?;

    if result.exit_code == 0 {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "connectivity check failed with exit code {}",
            result.exit_code
        )))
    }
}

#[tauri::command]
pub async fn detect_os(state: State<'_, AppState>, target: ConnectionTarget) -> AppResult<OsInfo> {
    let credential = resolve_connection_target(&state.storage, target)?;
    let ssh = SshSession::connect(&credential).await?;
    let detect_result = deploy::detect_os(&ssh).await;
    let close_result = ssh.close().await;
    let os = detect_result?;
    close_result?;
    Ok(os)
}

#[tauri::command]
pub async fn deploy_node(
    app: AppHandle,
    state: State<'_, AppState>,
    params: DeployParams,
) -> AppResult<NodeRecord> {
    let progress = TauriProgressSink::new(app);
    let result = deploy_node_inner(&progress, &state.storage, params).await;

    match result {
        Ok(node) => {
            progress.emit(DeployEventPayload::Done { node: node.clone() })?;
            Ok(node)
        }
        Err(err) => {
            let (step, message) = deploy_error_details(&err);
            let _ = progress.emit(DeployEventPayload::Error { step, message });
            Err(err)
        }
    }
}

#[tauri::command]
pub fn list_nodes(state: State<'_, AppState>) -> AppResult<Vec<NodeRecord>> {
    state.storage.list()
}

#[tauri::command]
pub fn list_vps_profiles(state: State<'_, AppState>) -> AppResult<Vec<VpsProfileSummary>> {
    let mut profiles = state.storage.list_vps_profiles()?;

    for profile in &mut profiles {
        profile.credential_available = match state.storage.get_vps_profile(&profile.id) {
            Ok(record) => match credentials::exists(&record.credential_key) {
                Ok(value) => value,
                Err(err) => {
                    log::warn!(
                        "failed to inspect keychain entry for VPS profile {}: {}",
                        profile.id,
                        err
                    );
                    false
                }
            },
            Err(err) => {
                log::warn!("failed to load VPS profile {}: {}", profile.id, err);
                false
            }
        };
    }

    Ok(profiles)
}

#[tauri::command]
pub fn get_node(state: State<'_, AppState>, id: String) -> AppResult<NodeRecord> {
    state.storage.get(&id)
}

#[tauri::command]
pub fn forget_vps_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let credential_key = state
        .storage
        .get_vps_profile(&id)
        .ok()
        .map(|record| record.credential_key);
    state.storage.delete_vps_profile(&id)?;
    if let Some(key) = credential_key {
        if let Err(err) = credentials::delete(&key) {
            log::warn!(
                "forget_vps_profile: failed to delete keychain entry {}: {}",
                key,
                err
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub fn forget_orphan_vps_profiles(state: State<'_, AppState>) -> AppResult<u32> {
    let profiles = state.storage.list_vps_profiles()?;
    let mut removed = 0u32;
    for profile in profiles {
        let record = match state.storage.get_vps_profile(&profile.id) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let available = credentials::exists(&record.credential_key).unwrap_or(false);
        if !available {
            state.storage.delete_vps_profile(&profile.id)?;
            let _ = credentials::delete(&record.credential_key);
            removed += 1;
        }
    }
    Ok(removed)
}

#[tauri::command]
pub fn get_subscription(state: State<'_, AppState>, id: String) -> AppResult<SubscriptionDto> {
    let node = state.storage.get(&id)?;
    let subscription = subscription::build(&node)?;
    let managed = remote_subscription::extract_managed_subscription(&node);
    let managed_qr_svg = managed
        .as_ref()
        .map(|item| subscription::qr_svg_for_uri(&item.url))
        .transpose()?;

    Ok(SubscriptionDto {
        uri: subscription.uri,
        qr_svg: subscription.qr_svg,
        managed_uri: managed.map(|item| item.url),
        managed_qr_svg,
    })
}

#[tauri::command]
pub async fn uninstall_node(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let node = state.storage.get(&id)?;
    let profile = state.storage.get_vps_profile(&node.vps_id)?;
    let auth = load_saved_auth(&profile)?;
    let credential = VpsCredential {
        host: profile.host,
        port: profile.ssh_port,
        user: profile.ssh_user,
        auth,
    };

    let ssh = SshSession::connect(&credential).await?;
    let deployer = deploy::deployer_for(node.protocol);
    let uninstall_result = deployer.uninstall(&ssh, &node).await;
    if let Err(err) = uninstall_result {
        let close_result = ssh.close().await;
        if let Err(close_err) = close_result {
            log::warn!(
                "uninstall_node: SSH close failed after uninstall error for {}: {}",
                node.id,
                close_err
            );
        }
        return Err(err);
    }

    state.storage.delete(&id)?;

    let remaining_nodes = active_nodes_for_vps(&state.storage, &node.vps_id)?;
    let subscription_result = if remaining_nodes.is_empty() {
        remote_subscription::remove_from_vps(&ssh, &SilentProgress).await
    } else {
        refresh_managed_subscription(
            &SilentProgress,
            &state.storage,
            &ssh,
            &node.vps_id,
            &node.host,
        )
        .await
        .map(|_| ())
    };
    if let Err(err) = subscription_result {
        log::warn!(
            "uninstall_node: node {} was removed, but managed subscription refresh failed: {}",
            node.id,
            err
        );
    }

    let close_result = ssh.close().await;
    close_result?;
    Ok(())
}

async fn deploy_node_inner(
    progress: &TauriProgressSink,
    storage: &Storage,
    params: DeployParams,
) -> AppResult<NodeRecord> {
    let resolved = resolve_deploy_target(storage, &params)?;
    let mut effective_params = params.clone();
    effective_params.vps_profile_id = Some(resolved.profile.id.clone());
    effective_params.vps_name = resolved.profile.name.clone();
    effective_params.credential = Some(resolved.credential.clone());

    let ssh = SshSession::connect(&resolved.credential).await?;
    let deployer = deploy::deployer_for(effective_params.protocol);
    let install_result = deployer.install(&ssh, &effective_params, progress).await;

    let mut node = match install_result {
        Ok(node) => node,
        Err(err) => {
            progress.log("部署失败，正在关闭 SSH 连接...");
            let close_result = ssh.close().await;
            if let Err(close_err) = close_result {
                progress.log(&format!("SSH 关闭时出现警告：{close_err}"));
            }
            return Err(err);
        }
    };

    node.vps_id = resolved.profile.id.clone();
    node.vps_name = resolved.profile.name.clone();

    if resolved.should_save_credential {
        credentials::save(&resolved.profile.credential_key, &resolved.credential.auth)?;
    }
    storage.upsert_vps_profile(&resolved.profile)?;
    storage.insert(&node)?;

    let reachability_result = verify_public_reachability(progress, &node).await;
    if let Err(err) = &reachability_result {
        node.status = "unknown".to_string();
        storage.update_node_status(&node.id, &node.status)?;
        progress.log(&format!(
            "公网连通性验证未通过，节点配置和凭据已保存，状态标记为 unknown：{err}"
        ));
        let _ = progress.emit(crate::events::DeployEventPayload::Warning {
            step: "reachability".to_string(),
            message: format!(
                "公网连通性验证未通过，节点已保存但标记为 unknown：{err}"
            ),
        });
    }

    if reachability_result.is_ok() {
        cleanup_replaced_nodes(progress, storage, &node);

        match refresh_managed_subscription(progress, storage, &ssh, &node.vps_id, &node.host).await
        {
            Ok(Some(managed)) => {
                remote_subscription::apply_managed_subscription(&mut node, &managed);
            }
            Ok(None) => {}
            Err(err) => {
                progress.log(&format!(
                    "远程多节点订阅服务安装失败，直接节点仍可使用：{err}"
                ));
                let _ = progress.emit(crate::events::DeployEventPayload::Warning {
                    step: "subscription".to_string(),
                    message: format!("远程多节点订阅服务安装失败：{err}"),
                });
            }
        }
    }

    progress.log("部署动作执行完毕，正在关闭 SSH 连接...");
    let close_result = ssh.close().await;
    match &close_result {
        Ok(()) => progress.log("SSH 连接已主动断开。"),
        Err(err) => progress.log(&format!("SSH 关闭时出现警告（不影响节点运行）：{err}")),
    }
    close_result?;

    Ok(node)
}

fn resolve_connection_target(
    storage: &Storage,
    target: ConnectionTarget,
) -> AppResult<VpsCredential> {
    match (target.vps_profile_id, target.credential) {
        (_, Some(credential)) => Ok(credential),
        (Some(profile_id), None) => {
            let profile = storage.get_vps_profile(&profile_id)?;
            let auth = load_saved_auth(&profile)?;
            Ok(VpsCredential {
                host: profile.host,
                port: profile.ssh_port,
                user: profile.ssh_user,
                auth,
            })
        }
        (None, None) => Err(AppError::Other(
            "missing VPS credential or saved VPS profile".to_string(),
        )),
    }
}

fn resolve_deploy_target(
    storage: &Storage,
    params: &DeployParams,
) -> AppResult<ResolvedDeployTarget> {
    let requested_name = params.vps_name.trim();

    if let Some(profile_id) = &params.vps_profile_id {
        let mut profile = storage.get_vps_profile(profile_id)?;
        if !requested_name.is_empty() {
            profile.name = requested_name.to_string();
        }

        let credential = match &params.credential {
            Some(credential) => {
                profile.host = credential.host.clone();
                profile.ssh_port = credential.port;
                profile.ssh_user = credential.user.clone();
                credential.clone()
            }
            None => {
                let auth = load_saved_auth(&profile)?;
                VpsCredential {
                    host: profile.host.clone(),
                    port: profile.ssh_port,
                    user: profile.ssh_user.clone(),
                    auth,
                }
            }
        };

        return Ok(ResolvedDeployTarget {
            profile,
            credential,
            should_save_credential: params.credential.is_some(),
        });
    }

    let credential = params
        .credential
        .clone()
        .ok_or_else(|| AppError::Other("missing VPS credential for deploy".to_string()))?;

    let mut profile = if let Some(existing) = storage.find_vps_profile_by_connection(
        &credential.host,
        credential.port,
        &credential.user,
    )? {
        existing
    } else {
        let profile_id = uuid::Uuid::new_v4().to_string();
        VpsProfileRecord {
            id: profile_id.clone(),
            name: requested_name.to_string(),
            host: credential.host.clone(),
            ssh_port: credential.port,
            ssh_user: credential.user.clone(),
            credential_key: profile_id,
            created_at: unix_now(),
        }
    };

    profile.name = if requested_name.is_empty() {
        profile.host.clone()
    } else {
        requested_name.to_string()
    };
    profile.host = credential.host.clone();
    profile.ssh_port = credential.port;
    profile.ssh_user = credential.user.clone();

    Ok(ResolvedDeployTarget {
        profile,
        credential,
        should_save_credential: true,
    })
}

fn deploy_error_details(err: &AppError) -> (String, String) {
    match err {
        AppError::DeployStepFailed { step, message } => (step.clone(), message.clone()),
        other => ("deploy".to_string(), other.to_string()),
    }
}

async fn verify_public_reachability(
    progress: &TauriProgressSink,
    node: &NodeRecord,
) -> AppResult<()> {
    let port = protocol_port(node)?;

    match node.protocol {
        ProtocolId::VlessReality => {
            progress.step("reachability", "public reachability");

            let mut last_error = None;
            for attempt in 1..=6 {
                progress.log(&format!(
                    "正在验证公网 TCP 连通性（第 {attempt}/6 次）：{}:{}",
                    node.host, port
                ));

                match timeout(
                    Duration::from_secs(3),
                    TcpStream::connect((node.host.as_str(), port)),
                )
                .await
                {
                    Ok(Ok(stream)) => {
                        drop(stream);
                        progress.log("公网 TCP 连通性验证通过。");
                        return Ok(());
                    }
                    Ok(Err(err)) => last_error = Some(err.to_string()),
                    Err(_) => last_error = Some("connection timed out".to_string()),
                }

                if attempt < 6 {
                    sleep(Duration::from_secs(2)).await;
                }
            }

            Err(AppError::DeployStepFailed {
                step: "reachability".to_string(),
                message: format!(
                    "public TCP connectivity to {}:{} failed after deploy: {}. The service was configured on the VPS, but it is not reachable from this machine. Check the cloud security group and confirm the node host is a public IP.",
                    node.host,
                    port,
                    last_error.unwrap_or_else(|| "unknown error".to_string())
                ),
            })
        }
        ProtocolId::Hysteria2 => {
            progress.step("reachability", "public reachability");

            use tokio::net::UdpSocket;
            let addr = format!("{}:{}", node.host, port);
            match UdpSocket::bind("0.0.0.0:0").await {
                Ok(sock) => {
                    if let Err(err) = sock.connect(&addr).await {
                        progress.log(&format!(
                            "UDP probe bind/connect 失败（非致命）：{err}。请手动确认云安全组已放行 UDP {port}。"
                        ));
                        return Ok(());
                    }
                    let _ = sock.send(&[0u8; 4]).await;
                    // If port is closed, we typically get ConnectionRefused on the next recv.
                    // If open, Hysteria2 silently drops malformed packets, so recv will timeout — treat as OK.
                    let mut buf = [0u8; 4];
                    match timeout(Duration::from_millis(1500), sock.recv(&mut buf)).await {
                        Ok(Err(err)) if err.kind() == std::io::ErrorKind::ConnectionRefused => {
                            return Err(AppError::DeployStepFailed {
                                step: "reachability".to_string(),
                                message: format!(
                                    "public UDP probe to {}:{} returned ConnectionRefused — the port is not reachable. Check the cloud security group and firewall.",
                                    node.host, port
                                ),
                            });
                        }
                        _ => {
                            progress.log(&format!(
                                "UDP {port} 未收到拒绝信号，推测端口已放行（Hysteria2 对非法包静默丢弃，此为正常表现）。"
                            ));
                            return Ok(());
                        }
                    }
                }
                Err(err) => {
                    progress.log(&format!(
                        "跳过 Hysteria2 UDP 主动探测（bind 失败：{err}）；请确认云安全组已放行 UDP {port}。"
                    ));
                    return Ok(());
                }
            }
        }
    }
}

fn protocol_port(node: &NodeRecord) -> AppResult<u16> {
    node.protocol_params
        .get("port")
        .and_then(|value| value.as_u64())
        .and_then(|value| u16::try_from(value).ok())
        .ok_or_else(|| AppError::Other("missing or invalid node port".to_string()))
}

fn active_nodes_for_vps(storage: &Storage, vps_id: &str) -> AppResult<Vec<NodeRecord>> {
    Ok(storage
        .list()?
        .into_iter()
        .filter(|node| node.vps_id == vps_id && node.status == "active")
        .collect())
}

async fn refresh_managed_subscription(
    progress: &dyn ProgressSink,
    storage: &Storage,
    ssh: &SshSession,
    vps_id: &str,
    host: &str,
) -> AppResult<Option<remote_subscription::ManagedSubscription>> {
    let mut nodes = active_nodes_for_vps(storage, vps_id)?;
    if nodes.is_empty() {
        remote_subscription::remove_from_vps(ssh, progress).await?;
        return Ok(None);
    }

    let managed = remote_subscription::install_for_nodes(ssh, host, &nodes, progress).await?;
    for node in &mut nodes {
        remote_subscription::apply_managed_subscription(node, &managed);
        storage.update_node_protocol_params(&node.id, &node.protocol_params)?;
    }

    Ok(Some(managed))
}

fn cleanup_replaced_nodes(progress: &TauriProgressSink, storage: &Storage, node: &NodeRecord) {
    let Ok(existing_nodes) = storage.list() else {
        return;
    };

    let replaced_nodes: Vec<_> = existing_nodes
        .into_iter()
        .filter(|existing| {
            existing.id != node.id
                && existing.vps_id == node.vps_id
                && existing.protocol == node.protocol
                && existing.status == "active"
        })
        .collect();

    if replaced_nodes.is_empty() {
        return;
    }

    progress.log(&format!(
        "检测到同一 VPS 下的旧 {} 节点记录，正在自动替换 {} 条。",
        match node.protocol {
            ProtocolId::VlessReality => "VLESS Reality",
            ProtocolId::Hysteria2 => "Hysteria2",
        },
        replaced_nodes.len()
    ));

    for existing in replaced_nodes {
        if let Err(err) = storage.delete(&existing.id) {
            log::warn!("failed to delete replaced node {}: {}", existing.id, err);
        }
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn load_saved_auth(profile: &VpsProfileRecord) -> AppResult<crate::ssh::AuthMethod> {
    match credentials::load_optional(&profile.credential_key)? {
        Some(auth) => Ok(auth),
        None => Err(AppError::Other(format!(
            "已保存的 VPS「{}」缺少系统安全存储中的登录凭据。请切换到“新建连接”重新输入一次 SSH 信息，程序会自动补回这条凭据。",
            profile.name
        ))),
    }
}
