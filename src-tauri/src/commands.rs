use std::fs::File;
use std::time::{SystemTime, UNIX_EPOCH};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, MutexGuard};
use tokio::time::{sleep, timeout, Duration};

use crate::control::ssh_pool::SshPool;
use crate::credentials;
use crate::deploy::{
    self, DeployParams, NodeRecord, OsInfo, ProgressSink, ProtocolId, VpsProfileSummary,
};
use crate::error::{AppError, AppResult};
use crate::events::{DeployEventPayload, TauriProgressSink};
use crate::remote_subscription;
use crate::ssh::{canonicalize_host, socket_address, ExpectedHostKey, SshSession, VpsCredential};
use crate::storage::{DeploymentAttemptRecord, Storage, VpsProfileRecord};
use crate::subscription;

pub struct AppState {
    pub storage: Storage,
    pub ssh_pool: SshPool,
    pub remote_mutation_lock: Mutex<()>,
    pub remote_mutation_file: File,
}

pub(crate) struct RemoteMutationGuard<'a> {
    _local_guard: MutexGuard<'a, ()>,
    lock_file: &'a File,
}

impl Drop for RemoteMutationGuard<'_> {
    fn drop(&mut self) {
        if let Err(err) = FileExt::unlock(self.lock_file) {
            log::error!("failed to release cross-process remote mutation lock: {err}");
        }
    }
}

impl AppState {
    pub(crate) fn try_begin_remote_mutation(&self) -> AppResult<RemoteMutationGuard<'_>> {
        let local_guard = self.remote_mutation_lock.try_lock().map_err(|_| {
            AppError::Other("已有远端变更任务正在进行，请等待当前操作完成后再试。".to_string())
        })?;
        FileExt::try_lock_exclusive(&self.remote_mutation_file).map_err(|err| {
            if err.kind() == std::io::ErrorKind::WouldBlock {
                AppError::Other(
                    "另一个 V-Swift 窗口正在执行远端变更，请等待其完成后再试。".to_string(),
                )
            } else {
                AppError::Other(format!("无法取得跨进程远端变更锁：{err}"))
            }
        })?;
        Ok(RemoteMutationGuard {
            _local_guard: local_guard,
            lock_file: &self.remote_mutation_file,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTarget {
    pub vps_profile_id: Option<String>,
    pub credential: Option<VpsCredential>,
    #[serde(default)]
    pub accept_new_host_key: bool,
    pub expected_host_key: Option<ExpectedHostKey>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionDto {
    pub uri: String,
    pub qr_svg: String,
    pub managed_uri: Option<String>,
    pub managed_qr_svg: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallOutcome {
    pub warnings: Vec<String>,
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
    let accept_new_host_key = target.accept_new_host_key;
    let expected_host_key = target.expected_host_key.clone();
    let credential = resolve_connection_target(&state.storage, target)?;
    let ssh = SshSession::connect_with_host_key_acceptance(
        &credential,
        accept_new_host_key,
        expected_host_key,
    )
    .await?;
    let exec_result = ssh.exec("true").await;
    let close_result = ssh.close().await;
    let result = exec_result?;
    if let Err(err) = close_result {
        log::warn!("test_connection: SSH close failed after successful probe: {err}");
    }

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
    if let Err(err) = close_result {
        log::warn!("detect_os: SSH close failed after successful detection: {err}");
    }
    Ok(os)
}

#[tauri::command]
pub async fn deploy_node(
    app: AppHandle,
    state: State<'_, AppState>,
    params: DeployParams,
    deployment_id: String,
) -> AppResult<NodeRecord> {
    let progress = TauriProgressSink::new(app, &deployment_id)?;
    let result = match state.try_begin_remote_mutation() {
        Ok(_mutation_guard) => deploy_node_inner(&progress, &state.storage, params).await,
        Err(err) => Err(err),
    };

    match result {
        Ok(node) => {
            if let Err(err) = progress.emit(DeployEventPayload::Done { node: node.clone() }) {
                log::warn!("failed to emit final deploy event: {err}");
            }
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
        let record = state.storage.get_vps_profile(&profile.id)?;
        profile.credential_available = credentials::exists(&record.credential_key)?;
    }

    Ok(profiles)
}

#[tauri::command]
pub async fn update_vps_profile_host(
    state: State<'_, AppState>,
    id: String,
    host: String,
) -> AppResult<()> {
    let host = canonicalize_host(&host)?;
    let _mutation_guard = state.try_begin_remote_mutation()?;
    recover_pending_deployments_for_profile(&state.storage, &id).await?;
    // 从清空旧缓存到提交新 host 全程阻止新建池化连接，避免旧 host 会话回填。
    let _connection_guard = state.ssh_pool.lock_new_connections().await;

    let profile = state.storage.get_vps_profile(&id)?;
    let duplicate_target = state
        .storage
        .list_vps_profiles()?
        .into_iter()
        .any(|existing| {
            existing.id != id
                && existing.ssh_port == profile.ssh_port
                && existing.ssh_user == profile.ssh_user
                && canonicalize_host(&existing.host).ok().as_deref() == Some(host.as_str())
        });
    if duplicate_target {
        return Err(AppError::Other(
            "该 IP / 域名、SSH 端口和用户名已属于另一条 VPS 档案，已在远端变更前拒绝合并。"
                .to_string(),
        ));
    }
    let mut nodes_for_refresh = retarget_active_nodes_for_vps(state.storage.list()?, &id, &host);

    if let Err(err) = state.ssh_pool.disconnect(&id).await {
        log::warn!(
            "update_vps_profile_host: failed to close cached SSH session for {}: {}",
            id,
            err
        );
    }

    let auth = load_saved_auth(&profile)?;
    let credential = credential_for_profile_host_update(&profile, &host, auth);

    // Host updates are identity migrations, not first-use enrollment. Always connect—even
    // when there are no active nodes—so an unknown destination cannot be written silently.
    // `connect` keeps unknown keys strict while the old profile host lets the same pinned
    // server key migrate to its new address.
    let ssh = SshSession::connect(&credential).await?;
    let refresh_result = if nodes_for_refresh.is_empty() {
        Ok(None)
    } else {
        remote_subscription::install_for_nodes(&ssh, &host, &nodes_for_refresh, &SilentProgress)
            .await
            .map(Some)
    };
    let close_result = ssh.close().await;

    let managed = match refresh_result {
        Ok(managed) => {
            if let Err(err) = close_result {
                log::warn!(
                    "update_vps_profile_host: SSH close failed after successful host verification for {}: {}",
                    id,
                    err
                );
            }
            managed
        }
        Err(err) => {
            if let Err(close_err) = close_result {
                log::warn!(
                    "update_vps_profile_host: SSH close failed after managed subscription refresh error for {}: {}",
                    id,
                    close_err
                );
            }
            return Err(err);
        }
    };

    if let Some(managed) = &managed {
        for node in &mut nodes_for_refresh {
            remote_subscription::apply_managed_subscription(node, managed);
        }
    }
    state
        .storage
        .update_vps_profile_host_and_nodes(&id, &host, &nodes_for_refresh)?;

    Ok(())
}

#[tauri::command]
pub fn get_node(state: State<'_, AppState>, id: String) -> AppResult<NodeRecord> {
    state.storage.get(&id)
}

#[tauri::command]
pub fn forget_vps_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _mutation_guard = state.try_begin_remote_mutation()?;
    ensure_profiles_have_no_pending_deployments(&state.storage, std::slice::from_ref(&id))?;
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
pub fn forget_orphan_vps_profiles(
    state: State<'_, AppState>,
    profile_ids: Vec<String>,
) -> AppResult<u32> {
    let _mutation_guard = state.try_begin_remote_mutation()?;
    let mut seen = std::collections::HashSet::new();
    let mut confirmed_missing = Vec::new();
    for profile_id in profile_ids {
        if !seen.insert(profile_id.clone()) {
            continue;
        }
        let record = state.storage.get_vps_profile(&profile_id)?;
        if credential_is_confirmed_missing(credentials::exists(&record.credential_key))? {
            confirmed_missing.push((profile_id, record.credential_key));
        }
    }

    let confirmed_ids: Vec<_> = confirmed_missing
        .iter()
        .map(|(profile_id, _)| profile_id.clone())
        .collect();
    ensure_profiles_have_no_pending_deployments(&state.storage, &confirmed_ids)?;
    state.storage.delete_vps_profiles(&confirmed_ids)?;
    for (_, credential_key) in &confirmed_missing {
        let _ = credentials::delete(credential_key);
    }

    Ok(confirmed_missing.len() as u32)
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
pub async fn uninstall_node(state: State<'_, AppState>, id: String) -> AppResult<UninstallOutcome> {
    let _mutation_guard = state.try_begin_remote_mutation()?;
    let pending_target = state.storage.get(&id)?;
    recover_pending_deployments_for_profile(&state.storage, &pending_target.vps_id).await?;
    let node = state.storage.get(&id)?;
    let managed = remote_subscription::extract_managed_subscription(&node);
    ensure_current_protocol_owner(&state.storage, &node)?;
    let profile = state.storage.get_vps_profile(&node.vps_id)?;
    let auth = load_saved_auth(&profile)?;
    let credential = VpsCredential {
        host: profile.host,
        port: profile.ssh_port,
        user: profile.ssh_user,
        auth,
        host_key_aliases: Vec::new(),
    };

    let ssh = SshSession::connect(&credential).await?;
    // Persist a retryable state before the first destructive remote step. If the process or
    // subscription reconciliation fails later, the node remains visible and can be retried.
    if let Err(err) = state.storage.update_node_status(&id, "unknown") {
        let _ = ssh.close().await;
        return Err(err);
    }
    let remaining_nodes =
        managed_nodes_for_vps_excluding(&state.storage, &node.vps_id, Some(&node.id));
    let remaining_nodes = match remaining_nodes {
        Ok(nodes) => nodes,
        Err(err) => {
            let _ = ssh.close().await;
            return Err(err);
        }
    };
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

    if let Err(err) = reconcile_managed_subscription(
        &SilentProgress,
        &state.storage,
        &ssh,
        &node.host,
        remaining_nodes,
        managed.as_ref().map(|item| item.token.as_str()),
    )
    .await
    {
        log::warn!(
            "uninstall_node: protocol for {} was removed, but managed subscription reconciliation failed: {}",
            node.id,
            err
        );
        let close_result = ssh.close().await;
        if let Err(close_err) = close_result {
            log::warn!(
                "uninstall_node: SSH close failed after subscription error for {}: {}",
                node.id,
                close_err
            );
        }
        return Err(AppError::Other(format!(
            "节点协议服务已卸载，但远程托管订阅清理失败；本地记录已保留为未知状态，可再次点击卸载重试：{err}"
        )));
    }

    if let Err(err) = state.storage.delete(&id) {
        let close_result = ssh.close().await;
        if let Err(close_err) = close_result {
            log::warn!(
                "uninstall_node: SSH close failed after local delete error for {}: {}",
                node.id,
                close_err
            );
        }
        return Err(AppError::Other(format!(
            "远端节点与托管订阅已卸载，但本地记录删除失败；记录已保留为未知状态，可再次点击卸载重试：{err}"
        )));
    }

    let mut warnings = Vec::new();
    if let Err(err) = ssh.close().await {
        log::warn!(
            "uninstall_node: SSH close failed after committed uninstall for {}: {}",
            node.id,
            err
        );
        warnings.push(format!("节点已卸载，但 SSH 连接关闭时出现警告：{err}"));
    }
    Ok(UninstallOutcome { warnings })
}

async fn deploy_node_inner(
    progress: &TauriProgressSink,
    storage: &Storage,
    params: DeployParams,
) -> AppResult<NodeRecord> {
    deploy::validate_deploy_params(&params)?;
    if let Some(profile_id) = deployment_profile_id_for_recovery(storage, &params)? {
        recover_pending_deployments_for_profile(storage, &profile_id).await?;
    }
    let resolved = resolve_deploy_target(storage, &params)?;
    if resolved.credential.port == 0 {
        return Err(AppError::Other(
            "SSH 端口必须是 1–65535 之间的整数。".to_string(),
        ));
    }
    let mut effective_params = params.clone();
    effective_params.vps_profile_id = Some(resolved.profile.id.clone());
    effective_params.vps_name = resolved.profile.name.clone();
    effective_params.credential = Some(resolved.credential.clone());
    let existing_nodes = storage.list()?;
    effective_params.legacy_ownership_hash = existing_nodes
        .iter()
        .filter(|existing| {
            existing.vps_id == resolved.profile.id
                && existing.protocol == effective_params.protocol
                && existing.status != "uninstalled"
                && canonicalize_host(&existing.host).ok().as_deref()
                    == Some(resolved.credential.host.as_str())
        })
        .max_by_key(|existing| existing.created_at)
        .and_then(deploy::ownership_secret_hash);

    let ssh = SshSession::connect(&resolved.credential).await?;
    let deployer = deploy::deployer_for(effective_params.protocol);
    let preflight_result = async {
        let os = deploy::detect_os(&ssh).await?;
        deployer.validate_os(&os)?;
        deploy::validate_transaction_capabilities(
            &ssh,
            effective_params.protocol,
            effective_params.legacy_ownership_hash.as_deref(),
            progress,
        )
        .await
    }
    .await;
    if let Err(err) = preflight_result {
        let _ = ssh.close().await;
        return Err(err);
    }
    let previous_auth = if resolved.should_save_credential {
        match credentials::load_optional(&resolved.profile.credential_key) {
            Ok(auth) => auth,
            Err(err) => {
                let _ = ssh.close().await;
                return Err(err);
            }
        }
    } else {
        None
    };
    let attempt = DeploymentAttemptRecord {
        id: uuid::Uuid::new_v4().to_string(),
        profile: resolved.profile.clone(),
        protocol: effective_params.protocol,
        phase: "preparing_credentials".to_string(),
        had_previous_credential: previous_auth.is_some(),
        should_restore_credential: resolved.should_save_credential,
        created_at: unix_now(),
    };
    if let Err(err) = storage.begin_deployment_attempt(&attempt) {
        let _ = ssh.close().await;
        return Err(err);
    }

    if let Some(previous_auth) = &previous_auth {
        if let Err(err) = credentials::save(
            &deployment_credential_backup_key(&attempt.id),
            previous_auth,
        ) {
            let _ = storage.delete_deployment_attempt(&attempt.id);
            let _ = ssh.close().await;
            return Err(err);
        }
    }
    if resolved.should_save_credential {
        if let Err(err) =
            credentials::save(&resolved.profile.credential_key, &resolved.credential.auth)
        {
            let err =
                cleanup_failed_deployment_attempt(storage, &attempt, &ssh, progress, false, err)
                    .await;
            let _ = ssh.close().await;
            return Err(err);
        }
    }
    if let Err(err) = storage.transition_deployment_attempt_phase(
        &attempt.id,
        "preparing_credentials",
        "remote_starting",
    ) {
        let err =
            cleanup_failed_deployment_attempt(storage, &attempt, &ssh, progress, false, err).await;
        let _ = ssh.close().await;
        return Err(err);
    }
    if let Err(err) = deploy::begin_deployment_transaction(
        &ssh,
        effective_params.protocol,
        &attempt.id,
        effective_params.legacy_ownership_hash.as_deref(),
        progress,
    )
    .await
    {
        let err =
            cleanup_failed_deployment_attempt(storage, &attempt, &ssh, progress, true, err).await;
        let _ = ssh.close().await;
        return Err(err);
    }

    let install_result = deployer.install(&ssh, &effective_params, progress).await;

    let mut node = match install_result {
        Ok(node) => node,
        Err(err) => {
            progress.log("部署失败，正在回滚远端事务...");
            let err =
                cleanup_failed_deployment_attempt(storage, &attempt, &ssh, progress, true, err)
                    .await;
            let close_result = ssh.close().await;
            if let Err(close_err) = close_result {
                progress.log(&format!("SSH 关闭时出现警告：{close_err}"));
            }
            return Err(err);
        }
    };

    node.vps_id = resolved.profile.id.clone();
    node.vps_name = resolved.profile.name.clone();

    if let Some(existing_managed) = existing_nodes
        .iter()
        .filter(|existing| existing.vps_id == node.vps_id)
        .find_map(remote_subscription::extract_managed_subscription)
    {
        // 同 VPS 协议替换时沿用订阅 token，避免已导入客户端的 URL 突然 403。
        remote_subscription::apply_managed_subscription(&mut node, &existing_managed);
    }

    let replaced_count = match storage.commit_deployment(&resolved.profile, &node, &attempt.id) {
        Ok(replaced_count) => replaced_count,
        Err(commit_error) => match storage.get_deployment_attempt_phase(&attempt.id) {
            Ok(Some(phase))
                if matches!(phase.as_str(), "local_committed" | "local_commit_confirmed") =>
            {
                // Visibility proves rollback is unsafe, but not yet that an uncertain COMMIT is
                // durable. `finalize_committed_deployment_attempt` first performs a second SQLite
                // phase commit as a durability barrier before deleting the remote snapshot.
                log::warn!(
                    "deployment commit for {} returned an error but its visible phase forbids rollback: {}",
                    attempt.id,
                    commit_error
                );
                0
            }
            Ok(Some(phase)) if phase == "remote_starting" => {
                progress.log("本地持久化未提交，正在恢复部署前的远端配置...");
                let err = cleanup_failed_deployment_attempt(
                    storage,
                    &attempt,
                    &ssh,
                    progress,
                    true,
                    commit_error,
                )
                .await;
                let _ = ssh.close().await;
                return Err(err);
            }
            Ok(current_phase) => {
                let _ = ssh.close().await;
                return Err(AppError::DeployStepFailed {
                    step: "persist".to_string(),
                    message: format!(
                        "本地提交结果无法安全判定（事务 {}，当前阶段 {}）：{}。为避免把已提交节点回滚成旧配置，远端事务与本地日志均已保留，重启客户端后会按日志恢复。",
                        attempt.id,
                        current_phase.as_deref().unwrap_or("missing"),
                        commit_error
                    ),
                });
            }
            Err(inspect_error) => {
                let _ = ssh.close().await;
                return Err(AppError::DeployStepFailed {
                    step: "persist".to_string(),
                    message: format!(
                        "本地提交返回错误且无法复核事务 {} 的结果：{}；复核错误：{}。为避免破坏可能已提交的节点，未执行远端回滚，事务日志已保留。",
                        attempt.id, commit_error, inspect_error
                    ),
                });
            }
        },
    };
    if let Err(err) = finalize_committed_deployment_attempt(storage, &attempt, &ssh, progress).await
    {
        log::warn!(
            "deploy_node: local commit succeeded but durable finalization is still pending for {}: {}",
            attempt.id,
            err
        );
        let _ = progress.emit(crate::events::DeployEventPayload::Warning {
            step: "finalize".to_string(),
            message: format!(
                "节点已保存并运行，但事务 {} 的安全清理尚未完成；本地恢复日志已保留，下次对该 VPS 操作或重启客户端时会重试：{}",
                attempt.id, err
            ),
        });
    }
    if replaced_count > 0 {
        progress.log(&format!(
            "已原子替换同一 VPS 下的 {replaced_count} 条旧 {} 节点记录。",
            match node.protocol {
                ProtocolId::VlessReality => "VLESS Reality",
                ProtocolId::Hysteria2 => "Hysteria2",
            }
        ));
    }

    let reachability_result = verify_public_reachability(progress, &node).await;
    if let Err(err) = &reachability_result {
        node.status = "unknown".to_string();
        if let Err(storage_err) = storage.update_node_status(&node.id, &node.status) {
            log::warn!(
                "deploy_node: node {} is unreachable and status persistence failed: {}",
                node.id,
                storage_err
            );
            let _ = progress.emit(crate::events::DeployEventPayload::Warning {
                step: "reachability".to_string(),
                message: format!(
                    "公网验证未通过，且本地状态更新失败；节点配置已保存，请刷新后重新检查：{storage_err}"
                ),
            });
        }
        progress.log(&format!(
            "公网连通性验证未通过，节点配置和凭据已保存，状态标记为 unknown：{err}"
        ));
        let _ = progress.emit(crate::events::DeployEventPayload::Warning {
            step: "reachability".to_string(),
            message: format!("公网连通性验证未通过，节点已保存但标记为 unknown：{err}"),
        });
    }

    match refresh_managed_subscription(progress, storage, &ssh, &node.vps_id, &node.host).await {
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

    progress.log("部署动作执行完毕，正在关闭 SSH 连接...");
    let close_result = ssh.close().await;
    match &close_result {
        Ok(()) => progress.log("SSH 连接已主动断开。"),
        Err(err) => progress.log(&format!("SSH 关闭时出现警告（不影响节点运行）：{err}")),
    }
    Ok(node)
}

fn resolve_connection_target(
    storage: &Storage,
    target: ConnectionTarget,
) -> AppResult<VpsCredential> {
    let credential = match (target.vps_profile_id, target.credential) {
        (_, Some(credential)) => credential,
        (Some(profile_id), None) => {
            let profile = storage.get_vps_profile(&profile_id)?;
            let auth = load_saved_auth(&profile)?;
            VpsCredential {
                host: profile.host,
                port: profile.ssh_port,
                user: profile.ssh_user,
                auth,
                host_key_aliases: Vec::new(),
            }
        }
        (None, None) => {
            return Err(AppError::Other(
                "missing VPS credential or saved VPS profile".to_string(),
            ))
        }
    };
    canonicalize_credential(credential)
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
                let credential = canonicalize_credential(credential.clone())?;
                profile.host = credential.host.clone();
                profile.ssh_port = credential.port;
                profile.ssh_user = credential.user.clone();
                credential
            }
            None => {
                let auth = load_saved_auth(&profile)?;
                let raw_host = profile.host.trim().to_string();
                profile.host = canonicalize_host(&profile.host)?;
                let host_key_aliases = if raw_host != profile.host {
                    vec![raw_host]
                } else {
                    Vec::new()
                };
                VpsCredential {
                    host: profile.host.clone(),
                    port: profile.ssh_port,
                    user: profile.ssh_user.clone(),
                    auth,
                    host_key_aliases,
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
    let credential = canonicalize_credential(credential)?;

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

fn deployment_profile_id_for_recovery(
    storage: &Storage,
    params: &DeployParams,
) -> AppResult<Option<String>> {
    if let Some(profile_id) = &params.vps_profile_id {
        return Ok(Some(profile_id.clone()));
    }

    let Some(credential) = &params.credential else {
        return Ok(None);
    };
    let host = canonicalize_host(&credential.host)?;
    Ok(storage
        .find_vps_profile_by_connection(&host, credential.port, &credential.user)?
        .map(|profile| profile.id))
}

fn deploy_error_details(err: &AppError) -> (String, String) {
    match err {
        AppError::DeployStepFailed { step, message } => (step.clone(), message.clone()),
        other => ("deploy".to_string(), other.to_string()),
    }
}

fn canonicalize_credential(mut credential: VpsCredential) -> AppResult<VpsCredential> {
    let raw_host = credential.host.trim().to_string();
    credential.host = canonicalize_host(&credential.host)?;
    if raw_host != credential.host
        && !credential
            .host_key_aliases
            .iter()
            .any(|alias| alias == &raw_host)
    {
        credential.host_key_aliases.push(raw_host);
    }
    Ok(credential)
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
            let target = socket_address(&node.host, port);
            let addresses = tokio::net::lookup_host(target.as_str())
                .await
                .map_err(|err| AppError::DeployStepFailed {
                    step: "reachability".to_string(),
                    message: format!(
                        "could not resolve public UDP target {}:{}: {err}",
                        node.host, port
                    ),
                })?
                .collect::<Vec<_>>();
            if addresses.is_empty() {
                return Err(AppError::DeployStepFailed {
                    step: "reachability".to_string(),
                    message: format!(
                        "public UDP target {}:{} resolved to no addresses",
                        node.host, port
                    ),
                });
            }

            let mut last_error = None;
            for address in addresses {
                let bind_address = if address.is_ipv6() {
                    "[::]:0"
                } else {
                    "0.0.0.0:0"
                };
                let sock = match UdpSocket::bind(bind_address).await {
                    Ok(sock) => sock,
                    Err(err) => {
                        last_error = Some(format!("failed to bind {bind_address}: {err}"));
                        continue;
                    }
                };
                if let Err(err) = sock.connect(address).await {
                    last_error = Some(format!("failed to connect to {address}: {err}"));
                    continue;
                }
                if let Err(err) = sock.send(&[0u8; 4]).await {
                    last_error = Some(format!("failed to send UDP probe to {address}: {err}"));
                    continue;
                }

                // A closed UDP port normally reports ConnectionRefused. Hysteria2 silently drops
                // malformed datagrams, so a timeout is the expected positive signal here.
                let mut buf = [0u8; 4];
                match timeout(Duration::from_millis(1500), sock.recv(&mut buf)).await {
                    Err(_) => {
                        progress.log(&format!(
                            "UDP {port} 未收到拒绝信号，推测端口已放行（Hysteria2 对非法包静默丢弃，此为正常表现）。"
                        ));
                        return Ok(());
                    }
                    Ok(Ok(_)) => {
                        progress.log(&format!("UDP {port} 收到响应，公网探测通过。"));
                        return Ok(());
                    }
                    Ok(Err(err)) => {
                        last_error = Some(format!("UDP probe to {address} failed: {err}"));
                    }
                }
            }

            Err(AppError::DeployStepFailed {
                step: "reachability".to_string(),
                message: format!(
                    "public UDP probe to {}:{} failed: {}. Check DNS, the cloud security group, and the VPS firewall.",
                    node.host,
                    port,
                    last_error.unwrap_or_else(|| "unknown error".to_string())
                ),
            })
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

fn managed_nodes_for_vps(storage: &Storage, vps_id: &str) -> AppResult<Vec<NodeRecord>> {
    managed_nodes_for_vps_excluding(storage, vps_id, None)
}

fn managed_nodes_for_vps_excluding(
    storage: &Storage,
    vps_id: &str,
    excluded_node_id: Option<&str>,
) -> AppResult<Vec<NodeRecord>> {
    Ok(storage
        .list()?
        .into_iter()
        .filter(|node| {
            node.vps_id == vps_id
                && node.status != "uninstalled"
                && excluded_node_id != Some(node.id.as_str())
        })
        .collect())
}

fn retarget_active_nodes_for_vps(
    nodes: Vec<NodeRecord>,
    vps_id: &str,
    host: &str,
) -> Vec<NodeRecord> {
    nodes
        .into_iter()
        .filter(|node| {
            node.vps_id == vps_id && matches!(node.status.as_str(), "active" | "unknown")
        })
        .map(|mut node| {
            node.host = host.to_string();
            node
        })
        .collect()
}

async fn refresh_managed_subscription(
    progress: &dyn ProgressSink,
    storage: &Storage,
    ssh: &SshSession,
    vps_id: &str,
    host: &str,
) -> AppResult<Option<remote_subscription::ManagedSubscription>> {
    let nodes = managed_nodes_for_vps(storage, vps_id)?;
    reconcile_managed_subscription(progress, storage, ssh, host, nodes, None).await
}

async fn reconcile_managed_subscription(
    progress: &dyn ProgressSink,
    storage: &Storage,
    ssh: &SshSession,
    host: &str,
    mut nodes: Vec<NodeRecord>,
    legacy_token: Option<&str>,
) -> AppResult<Option<remote_subscription::ManagedSubscription>> {
    if nodes.is_empty() {
        remote_subscription::remove_from_vps(ssh, legacy_token, progress).await?;
        return Ok(None);
    }

    let managed = remote_subscription::install_for_nodes(ssh, host, &nodes, progress).await?;
    for node in &mut nodes {
        remote_subscription::apply_managed_subscription(node, &managed);
    }
    storage.update_nodes_protocol_params(&nodes)?;

    Ok(Some(managed))
}

fn ensure_current_protocol_owner(storage: &Storage, node: &NodeRecord) -> AppResult<()> {
    let has_newer_or_ambiguous_owner = storage.list()?.into_iter().any(|candidate| {
        candidate.id != node.id
            && candidate.vps_id == node.vps_id
            && candidate.protocol == node.protocol
            && candidate.status != "uninstalled"
            && candidate.created_at >= node.created_at
    });

    if has_newer_or_ambiguous_owner {
        return Err(AppError::Other(
            "该节点记录已被同协议的新部署替代，拒绝从旧记录卸载当前远端服务。请刷新节点列表后操作最新记录。"
                .to_string(),
        ));
    }

    Ok(())
}

fn deployment_credential_backup_key(attempt_id: &str) -> String {
    format!("deployment-backup:{attempt_id}")
}

fn restore_attempt_credential(
    attempt: &DeploymentAttemptRecord,
    allow_missing_backup: bool,
) -> AppResult<()> {
    if !attempt.should_restore_credential {
        return Ok(());
    }

    if attempt.had_previous_credential {
        let backup_key = deployment_credential_backup_key(&attempt.id);
        match credentials::load_optional(&backup_key)? {
            Some(previous_auth) => {
                credentials::save(&attempt.profile.credential_key, &previous_auth)?;
            }
            None if allow_missing_backup => {}
            None => {
                return Err(AppError::Other(format!(
                    "部署事务 {} 缺少旧凭据备份，已保留事务以便人工恢复。",
                    attempt.id
                )))
            }
        }
    } else {
        credentials::delete(&attempt.profile.credential_key)?;
    }

    Ok(())
}

fn finish_attempt_local_cleanup(
    storage: &Storage,
    attempt: &DeploymentAttemptRecord,
) -> AppResult<()> {
    if attempt.had_previous_credential {
        credentials::delete(&deployment_credential_backup_key(&attempt.id))?;
    }
    storage.delete_deployment_attempt(&attempt.id)
}

fn restore_and_finish_attempt(
    storage: &Storage,
    attempt: &DeploymentAttemptRecord,
    expected_phase: &str,
    allow_missing_backup: bool,
) -> AppResult<()> {
    restore_attempt_credential(attempt, allow_missing_backup)?;
    storage.transition_deployment_attempt_phase(
        &attempt.id,
        expected_phase,
        "credential_restored",
    )?;
    finish_attempt_local_cleanup(storage, attempt)
}

fn deployment_recovery_failure(
    attempt: &DeploymentAttemptRecord,
    action: &str,
    original: &AppError,
    recovery_error: &AppError,
) -> AppError {
    AppError::DeployStepFailed {
        step: "rollback".to_string(),
        message: format!(
            "部署失败（{original}），且事务 {} 的{action}失败：{recovery_error}。已保留本地事务与凭据备份；请勿手动覆盖远端服务，重启客户端后会再次尝试恢复。",
            attempt.id
        ),
    }
}

fn mark_attempt_remote_rolled_back(
    storage: &Storage,
    attempt: &DeploymentAttemptRecord,
    remote_may_have_started: bool,
) -> AppResult<()> {
    let current = storage
        .get_deployment_attempt_phase(&attempt.id)?
        .ok_or_else(|| {
            AppError::Storage(format!("deployment attempt not found: {}", attempt.id))
        })?;
    if current == "remote_rolled_back" {
        return Ok(());
    }
    let allowed = current == "remote_starting"
        || (!remote_may_have_started && current == "preparing_credentials");
    if !allowed {
        return Err(AppError::Storage(format!(
            "refused to mark deployment attempt {} rolled back from phase {}",
            attempt.id, current
        )));
    }
    storage.transition_deployment_attempt_phase(&attempt.id, &current, "remote_rolled_back")
}

async fn cleanup_failed_deployment_attempt(
    storage: &Storage,
    attempt: &DeploymentAttemptRecord,
    ssh: &SshSession,
    progress: &dyn ProgressSink,
    remote_may_have_started: bool,
    original: AppError,
) -> AppError {
    if remote_may_have_started {
        if let Err(err) =
            deploy::rollback_deployment_transaction(ssh, attempt.protocol, &attempt.id, progress)
                .await
        {
            return deployment_recovery_failure(attempt, "远端回滚", &original, &err);
        }
    }

    // Record that no further SSH access is required before restoring the old credential.
    // A crash after credential restoration must not retry SSH with credentials that no longer
    // belong to the attempted destination.
    if let Err(err) = mark_attempt_remote_rolled_back(storage, attempt, remote_may_have_started) {
        return deployment_recovery_failure(attempt, "回滚阶段持久化", &original, &err);
    }
    if let Err(err) = restore_and_finish_attempt(storage, attempt, "remote_rolled_back", false) {
        return deployment_recovery_failure(attempt, "旧凭据恢复与本地清理", &original, &err);
    }

    original
}

async fn finalize_committed_deployment_attempt(
    storage: &Storage,
    attempt: &DeploymentAttemptRecord,
    ssh: &SshSession,
    progress: &dyn ProgressSink,
) -> AppResult<()> {
    confirm_local_commit(storage, &attempt.id)?;
    deploy::finalize_deployment_transaction(ssh, attempt.protocol, &attempt.id, progress).await?;
    storage.transition_deployment_attempt_phase(
        &attempt.id,
        "local_commit_confirmed",
        "remote_finalized",
    )?;
    finish_attempt_local_cleanup(storage, attempt)
}

fn confirm_local_commit(storage: &Storage, attempt_id: &str) -> AppResult<()> {
    storage.confirm_deployment_commit(attempt_id)
}

fn recovery_credential(attempt: &DeploymentAttemptRecord) -> AppResult<VpsCredential> {
    let current_auth = credentials::load_optional(&attempt.profile.credential_key)?;
    let backup_auth = if attempt.had_previous_credential {
        credentials::load_optional(&deployment_credential_backup_key(&attempt.id))?
    } else {
        None
    };
    let auth = current_auth.or(backup_auth).ok_or_else(|| {
        AppError::Other(format!(
            "待恢复部署事务 {} 缺少可用 SSH 凭据，已保留事务。",
            attempt.id
        ))
    })?;
    Ok(VpsCredential {
        host: attempt.profile.host.clone(),
        port: attempt.profile.ssh_port,
        user: attempt.profile.ssh_user.clone(),
        auth,
        host_key_aliases: Vec::new(),
    })
}

async fn recover_remote_attempt(
    storage: &Storage,
    attempt: &DeploymentAttemptRecord,
    finalize: bool,
) -> AppResult<()> {
    if finalize {
        // A second successful SQLite transaction is the durability barrier for a prior COMMIT
        // whose return value may have been uncertain. Never discard the remote snapshot before
        // this phase is durably visible.
        confirm_local_commit(storage, &attempt.id)?;
    }
    let credential = recovery_credential(attempt)?;
    let ssh = SshSession::connect(&credential).await.map_err(|err| {
        AppError::Other(format!("无法连接 VPS 以恢复部署事务 {}：{err}", attempt.id))
    })?;
    let remote_result = if finalize {
        deploy::finalize_deployment_transaction(
            &ssh,
            attempt.protocol,
            &attempt.id,
            &SilentProgress,
        )
        .await
    } else {
        deploy::rollback_deployment_transaction(
            &ssh,
            attempt.protocol,
            &attempt.id,
            &SilentProgress,
        )
        .await
    };
    if let Err(err) = ssh.close().await {
        log::warn!(
            "recover_pending_deployments: SSH close failed for {}: {}",
            attempt.id,
            err
        );
    }
    remote_result?;

    if finalize {
        storage.transition_deployment_attempt_phase(
            &attempt.id,
            "local_commit_confirmed",
            "remote_finalized",
        )?;
        finish_attempt_local_cleanup(storage, attempt)?;
        log::warn!(
            "recovered committed deployment attempt {} by finalizing its remote transaction",
            attempt.id
        );
    } else {
        storage.transition_deployment_attempt_phase(
            &attempt.id,
            "remote_starting",
            "remote_rolled_back",
        )?;
        restore_and_finish_attempt(storage, attempt, "remote_rolled_back", false)?;
        log::warn!(
            "recovered interrupted deployment attempt {} by rolling back its remote transaction",
            attempt.id
        );
    }

    Ok(())
}

async fn recover_deployment_attempt(
    storage: &Storage,
    attempt: &DeploymentAttemptRecord,
) -> AppResult<()> {
    match attempt.phase.as_str() {
        "preparing_credentials" => {
            restore_and_finish_attempt(storage, attempt, "preparing_credentials", true)
        }
        "remote_starting" => recover_remote_attempt(storage, attempt, false).await,
        "remote_rolled_back" => {
            restore_and_finish_attempt(storage, attempt, "remote_rolled_back", false)
        }
        "credential_restored" | "remote_finalized" => {
            finish_attempt_local_cleanup(storage, attempt)
        }
        "local_committed" | "local_commit_confirmed" => {
            recover_remote_attempt(storage, attempt, true).await
        }
        phase => Err(AppError::Other(format!(
            "部署事务 {} 处于未知阶段 {phase}，已拒绝自动处理。",
            attempt.id
        ))),
    }
}

pub(crate) async fn recover_pending_deployments_for_profile(
    storage: &Storage,
    profile_id: &str,
) -> AppResult<()> {
    for attempt in storage
        .list_deployment_attempts()?
        .into_iter()
        .filter(|attempt| attempt.profile.id == profile_id)
    {
        recover_deployment_attempt(storage, &attempt).await?;
    }
    Ok(())
}

pub(crate) async fn recover_pending_deployments(storage: &Storage) -> AppResult<()> {
    let mut seen = std::collections::HashSet::new();
    let profile_ids = storage
        .list_deployment_attempts()?
        .into_iter()
        .filter_map(|attempt| {
            seen.insert(attempt.profile.id.clone())
                .then_some(attempt.profile.id)
        })
        .collect::<Vec<_>>();
    let mut failures = Vec::new();
    for profile_id in profile_ids {
        if let Err(err) = recover_pending_deployments_for_profile(storage, &profile_id).await {
            log::error!(
                "failed to recover interrupted deployments for VPS {}: {}",
                profile_id,
                err
            );
            failures.push(format!("{profile_id}: {err}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(AppError::Other(format!(
            "部分 VPS 的部署事务仍待恢复：{}",
            failures.join("；")
        )))
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn credential_is_confirmed_missing(availability: AppResult<bool>) -> AppResult<bool> {
    availability.map(|exists| !exists)
}

fn ensure_profiles_have_no_pending_deployments(
    storage: &Storage,
    profile_ids: &[String],
) -> AppResult<()> {
    if storage
        .list_deployment_attempts()?
        .iter()
        .any(|attempt| profile_ids.contains(&attempt.profile.id))
    {
        return Err(AppError::Other(
            "VPS 仍有待恢复的部署事务，已拒绝删除档案；请保持网络可达并重启客户端完成自动回滚。"
                .to_string(),
        ));
    }
    Ok(())
}

fn credential_for_profile_host_update(
    profile: &VpsProfileRecord,
    host: &str,
    auth: crate::ssh::AuthMethod,
) -> VpsCredential {
    VpsCredential {
        host: host.to_string(),
        port: profile.ssh_port,
        user: profile.ssh_user.clone(),
        auth,
        host_key_aliases: vec![profile.host.clone()],
    }
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn node(id: &str, vps_id: &str, host: &str, status: &str) -> NodeRecord {
        NodeRecord {
            id: id.to_string(),
            vps_id: vps_id.to_string(),
            vps_name: "Test VPS".to_string(),
            name: id.to_string(),
            host: host.to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol: ProtocolId::VlessReality,
            protocol_params: json!({
                "uuid": "123e4567-e89b-12d3-a456-426614174000",
                "public_key": "pub",
                "short_id": "abcd",
                "port": 443,
                "sni": "example.com"
            }),
            status: status.to_string(),
            created_at: 0,
        }
    }

    #[test]
    fn retarget_active_and_unknown_nodes_for_vps_uses_new_host_and_ignores_inactive_nodes() {
        let nodes = vec![
            node("active-target", "vps-1", "198.51.100.10", "active"),
            node("unknown-target", "vps-1", "198.51.100.10", "unknown"),
            node("inactive-target", "vps-1", "198.51.100.10", "uninstalled"),
            node("other-vps", "vps-2", "198.51.100.20", "active"),
        ];

        let retargeted = retarget_active_nodes_for_vps(nodes, "vps-1", "203.0.113.99");

        assert_eq!(retargeted.len(), 2);
        assert_eq!(retargeted[0].id, "active-target");
        assert_eq!(retargeted[1].id, "unknown-target");
        assert!(retargeted.iter().all(|node| node.host == "203.0.113.99"));

        let yaml = remote_subscription::build_mihomo_config(&retargeted)
            .expect("managed subscription config should build from retargeted nodes");
        assert!(yaml.contains("server: \"203.0.113.99\""));
        assert!(!yaml.contains("server: \"198.51.100.10\""));
    }

    #[test]
    fn orphan_cleanup_requires_confirmed_missing_credential() {
        assert!(credential_is_confirmed_missing(Ok(false)).expect("missing credential"));
        assert!(!credential_is_confirmed_missing(Ok(true)).expect("existing credential"));

        let error = credential_is_confirmed_missing(Err(AppError::Keychain(
            "secure storage locked".to_string(),
        )))
        .expect_err("keychain errors must abort cleanup");
        assert!(error.to_string().contains("secure storage locked"));
    }

    #[test]
    fn profile_host_update_preserves_old_host_as_known_hosts_alias() {
        let profile = VpsProfileRecord {
            id: "vps-1".to_string(),
            name: "Test VPS".to_string(),
            host: "198.51.100.10".to_string(),
            ssh_port: 2222,
            ssh_user: "deploy".to_string(),
            credential_key: "vps-1".to_string(),
            created_at: 0,
        };
        let credential = credential_for_profile_host_update(
            &profile,
            "203.0.113.99",
            crate::ssh::AuthMethod::Password {
                password: "test-only".to_string(),
            },
        );

        assert_eq!(credential.host, "203.0.113.99");
        assert_eq!(credential.port, 2222);
        assert_eq!(credential.user, "deploy");
        assert_eq!(credential.host_key_aliases, vec!["198.51.100.10"]);
    }
}
