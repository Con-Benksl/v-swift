use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use crate::error::{AppError, AppResult};
use crate::scripts::{DETECT_OS, PROTOCOL_DEPLOYMENT_TRANSACTION};
use crate::ssh::SshSession;

use self::hysteria2::Hysteria2Deployer;
use self::vless_reality::VlessRealityDeployer;
use crate::ssh::VpsCredential;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsInfo {
    pub distro: String,
    pub version: String,
    pub arch: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProtocolId {
    VlessReality,
    Hysteria2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployParams {
    pub vps_profile_id: Option<String>,
    pub vps_name: String,
    pub credential: Option<VpsCredential>,
    pub protocol: ProtocolId,
    pub port: u16,
    pub node_name: String,
    pub sni: Option<String>,
    /// 仅由后端根据本地旧节点记录注入，用于安全迁移早期版本的远端所有权标记。
    #[serde(skip)]
    pub legacy_ownership_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRecord {
    pub id: String,
    pub vps_id: String,
    pub vps_name: String,
    pub name: String,
    pub host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub protocol: ProtocolId,
    pub protocol_params: serde_json::Value,
    pub status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VpsProfileSummary {
    pub id: String,
    pub name: String,
    pub host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub created_at: i64,
    pub node_count: i64,
    pub credential_available: bool,
}

pub trait ProgressSink: Send + Sync {
    fn step(&self, step: &str, label: &str);
    fn log(&self, line: &str);
}

#[async_trait]
pub trait Deployer: Send + Sync {
    fn protocol_id(&self) -> ProtocolId;
    fn validate_os(&self, os: &OsInfo) -> AppResult<()>;
    async fn install(
        &self,
        ssh: &SshSession,
        params: &DeployParams,
        progress: &dyn ProgressSink,
    ) -> AppResult<NodeRecord>;
    async fn uninstall(&self, ssh: &SshSession, node: &NodeRecord) -> AppResult<()>;
}

pub mod hysteria2;
pub mod vless_reality;

pub async fn detect_os(ssh: &SshSession) -> AppResult<OsInfo> {
    struct SilentProgress;

    impl ProgressSink for SilentProgress {
        fn step(&self, _step: &str, _label: &str) {}
        fn log(&self, _line: &str) {}
    }

    let output = run_script(ssh, "detect_os", DETECT_OS, &[], &SilentProgress).await?;
    let parsed = parse_results(&output);

    Ok(OsInfo {
        distro: parsed.get("distro").cloned().unwrap_or_default(),
        version: parsed.get("version").cloned().unwrap_or_default(),
        arch: parsed.get("arch").cloned().unwrap_or_default(),
    })
}

pub(crate) async fn validate_transaction_capabilities(
    ssh: &SshSession,
    protocol: ProtocolId,
    legacy_ownership_hash: Option<&str>,
    progress: &dyn ProgressSink,
) -> AppResult<()> {
    let check_id = uuid::Uuid::new_v4().to_string();
    let legacy_ownership_hash = legacy_ownership_hash.unwrap_or("");
    run_script(
        ssh,
        "deployment_transaction_check",
        PROTOCOL_DEPLOYMENT_TRANSACTION,
        &[
            "check",
            protocol_script_id(protocol),
            check_id.as_str(),
            legacy_ownership_hash,
        ],
        progress,
    )
    .await
    .map(|_| ())
}

pub(crate) fn parse_results(stdout: &str) -> HashMap<String, String> {
    let mut results = HashMap::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let payload = match trimmed.strip_prefix("::result::") {
            Some(rest) => rest.trim(),
            None => continue,
        };

        if let Some((key, value)) = payload.split_once('=') {
            results.insert(key.trim().to_lowercase(), value.trim().to_string());
        } else if let Some((key, value)) = payload.split_once(':') {
            results.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }

    results
}

pub(crate) async fn run_script(
    ssh: &SshSession,
    name: &str,
    script: &str,
    args: &[&str],
    progress: &dyn ProgressSink,
) -> AppResult<String> {
    let remote_path = format!("/tmp/vps-node-deployer-{name}-{}.sh", uuid::Uuid::new_v4());
    progress.step(name, name);
    ssh.upload(&remote_path, script.as_bytes(), 0o755).await?;

    let command = build_script_command(&remote_path, args);

    let collected = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let last_stderr = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let collected_for_cb = collected.clone();
    let stderr_for_cb = last_stderr.clone();

    let exit_code = ssh
        .exec_stream(&command, move |line| {
            if let Some(stripped) = line.strip_prefix("[stderr] ") {
                if let Some(safe_line) = sanitize_script_log_line(stripped) {
                    progress.log(&format!("[stderr] {safe_line}"));
                    if let Ok(mut buf) = stderr_for_cb.lock() {
                        buf.push_str(&safe_line);
                        buf.push('\n');
                    }
                }
            } else {
                // Structured result lines must remain available to the parser, but may contain
                // client credentials (UUID/password). Never forward those lines to the UI log.
                if let Ok(mut buf) = collected_for_cb.lock() {
                    buf.push_str(line);
                    buf.push('\n');
                }
                if let Some(safe_line) = sanitize_script_log_line(line) {
                    progress.log(&safe_line);
                }
            }
        })
        .await?;

    let stdout = collected
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let stderr = last_stderr
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();

    // best-effort cleanup of the remote temp script; ignore errors
    let _ = ssh
        .exec(&format!("rm -f {}", shell_single_quote(&remote_path)))
        .await;

    if exit_code != 0 {
        let stderr_trimmed = stderr.trim();
        let message = if !stderr_trimmed.is_empty() {
            stderr_trimmed.to_string()
        } else {
            let tail: Vec<String> = stdout
                .lines()
                .filter_map(sanitize_script_log_line)
                .rev()
                .take(8)
                .collect();
            let tail_text = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
            if tail_text.trim().is_empty() {
                format!("script exited with code {} (no output)", exit_code)
            } else {
                format!(
                    "script exited with code {}. last output:\n{}",
                    exit_code, tail_text
                )
            }
        };
        return Err(AppError::DeployStepFailed {
            step: name.to_string(),
            message,
        });
    }

    Ok(stdout)
}

/// Keep operational diagnostics useful without exposing credentials through progress events or
/// error messages. Raw stdout is still retained privately for `::result::` parsing.
fn sanitize_script_log_line(line: &str) -> Option<String> {
    if line.trim_start().starts_with("::result::") {
        return None;
    }

    let lower = line.to_ascii_lowercase();
    const SENSITIVE_MARKERS: &[&str] = &[
        "private key",
        "privatekey",
        "private_key",
        "password:",
        "password=",
        "\"password\"",
        "sub_token=",
        "token=",
        "secret=",
    ];
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
    {
        Some("[已隐藏敏感部署输出]".to_string())
    } else {
        Some(line.to_string())
    }
}

pub fn deployer_for(protocol: ProtocolId) -> Box<dyn Deployer> {
    match protocol {
        ProtocolId::VlessReality => Box::new(VlessRealityDeployer),
        ProtocolId::Hysteria2 => Box::new(Hysteria2Deployer),
    }
}

fn protocol_script_id(protocol: ProtocolId) -> &'static str {
    match protocol {
        ProtocolId::VlessReality => "vless-reality",
        ProtocolId::Hysteria2 => "hysteria2",
    }
}

pub(crate) async fn begin_deployment_transaction(
    ssh: &SshSession,
    protocol: ProtocolId,
    attempt_id: &str,
    legacy_ownership_hash: Option<&str>,
    progress: &dyn ProgressSink,
) -> AppResult<()> {
    let legacy_ownership_hash = legacy_ownership_hash.unwrap_or("");
    run_script(
        ssh,
        "deployment_transaction_begin",
        PROTOCOL_DEPLOYMENT_TRANSACTION,
        &[
            "begin",
            protocol_script_id(protocol),
            attempt_id,
            legacy_ownership_hash,
        ],
        progress,
    )
    .await
    .map(|_| ())
}

pub(crate) async fn rollback_deployment_transaction(
    ssh: &SshSession,
    protocol: ProtocolId,
    attempt_id: &str,
    progress: &dyn ProgressSink,
) -> AppResult<()> {
    run_script(
        ssh,
        "deployment_transaction_rollback",
        PROTOCOL_DEPLOYMENT_TRANSACTION,
        &["rollback", protocol_script_id(protocol), attempt_id, ""],
        progress,
    )
    .await
    .map(|_| ())
}

pub(crate) async fn finalize_deployment_transaction(
    ssh: &SshSession,
    protocol: ProtocolId,
    attempt_id: &str,
    progress: &dyn ProgressSink,
) -> AppResult<()> {
    run_script(
        ssh,
        "deployment_transaction_finalize",
        PROTOCOL_DEPLOYMENT_TRANSACTION,
        &["finalize", protocol_script_id(protocol), attempt_id, ""],
        progress,
    )
    .await
    .map(|_| ())
}

pub(crate) fn ownership_secret_hash(node: &NodeRecord) -> Option<String> {
    let secret = match node.protocol {
        ProtocolId::VlessReality => node.protocol_params.get("uuid")?.as_str()?,
        ProtocolId::Hysteria2 => node.protocol_params.get("password")?.as_str()?,
    };
    if secret.trim().is_empty() {
        return None;
    }
    Some(hex::encode(Sha256::digest(secret.as_bytes())))
}

fn build_script_command(remote_path: &str, args: &[&str]) -> String {
    let mut command = format!("bash {}", shell_single_quote(remote_path));
    for arg in args {
        command.push(' ');
        command.push_str(&shell_single_quote(arg));
    }
    command
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub(crate) fn validated_sni(value: Option<&str>, default: &str) -> AppResult<String> {
    let candidate = value.unwrap_or(default).trim();
    let labels: Vec<&str> = candidate.split('.').collect();
    let valid = !candidate.is_empty()
        && candidate.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|label| {
            let bytes = label.as_bytes();
            !bytes.is_empty()
                && bytes.len() <= 63
                && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
                && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
                && bytes
                    .iter()
                    .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
        });

    if !valid {
        return Err(AppError::Other(
            "SNI 必须是有效域名，例如 www.microsoft.com。".to_string(),
        ));
    }

    Ok(candidate.to_string())
}

pub(crate) fn validate_deploy_params(params: &DeployParams) -> AppResult<()> {
    if params.port == 0 {
        return Err(AppError::Other(
            "监听端口必须是 1–65535 之间的整数。".to_string(),
        ));
    }
    if params.vps_name.trim().is_empty() {
        return Err(AppError::Other("VPS 名称不能为空。".to_string()));
    }
    if params.node_name.trim().is_empty() {
        return Err(AppError::Other("节点名称不能为空。".to_string()));
    }
    if params.node_name.trim().chars().count() > 80 {
        return Err(AppError::Other("节点名称不能超过 80 个字符。".to_string()));
    }

    let default_sni = match params.protocol {
        ProtocolId::VlessReality => "www.microsoft.com",
        ProtocolId::Hysteria2 => "www.bing.com",
    };
    validated_sni(params.sni.as_deref(), default_sni)?;

    if params
        .credential
        .as_ref()
        .is_some_and(|credential| credential.port == 0)
    {
        return Err(AppError::Other(
            "SSH 端口必须是 1–65535 之间的整数。".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_script_command, ownership_secret_hash, sanitize_script_log_line,
        validate_deploy_params, validated_sni, DeployParams, NodeRecord, ProtocolId,
    };

    #[test]
    fn script_command_quotes_every_argument_as_one_shell_word() {
        let command = build_script_command(
            "/tmp/deploy script.sh",
            &["443", "www.example.com; touch /tmp/pwn", "a'b"],
        );

        assert_eq!(
            command,
            "bash '/tmp/deploy script.sh' '443' 'www.example.com; touch /tmp/pwn' 'a'\"'\"'b'"
        );
    }

    #[test]
    fn sni_validation_accepts_domains_and_rejects_shell_syntax() {
        assert_eq!(
            validated_sni(Some("  www.microsoft.com  "), "example.com").expect("valid SNI"),
            "www.microsoft.com"
        );
        assert!(validated_sni(Some("www.example.com; touch /tmp/pwn"), "example.com").is_err());
        assert!(validated_sni(Some("$(touch /tmp/pwn).example.com"), "example.com").is_err());
        assert!(validated_sni(Some("www.example.com\nnext"), "example.com").is_err());
        assert!(validated_sni(Some("localhost"), "example.com").is_err());
        assert!(validated_sni(Some("-bad.example.com"), "example.com").is_err());
    }

    #[test]
    fn deploy_params_are_rejected_before_remote_work() {
        let valid = DeployParams {
            vps_profile_id: Some("vps-1".to_string()),
            vps_name: "Test VPS".to_string(),
            credential: None,
            protocol: ProtocolId::VlessReality,
            port: 443,
            node_name: "Test Node".to_string(),
            sni: Some("www.microsoft.com".to_string()),
            legacy_ownership_hash: None,
        };
        assert!(validate_deploy_params(&valid).is_ok());

        let mut invalid_port = valid.clone();
        invalid_port.port = 0;
        assert!(validate_deploy_params(&invalid_port).is_err());

        let mut invalid_sni = valid.clone();
        invalid_sni.sni = Some("localhost".to_string());
        assert!(validate_deploy_params(&invalid_sni).is_err());

        let mut missing_name = valid;
        missing_name.node_name = "  ".to_string();
        assert!(validate_deploy_params(&missing_name).is_err());
    }

    #[test]
    fn deployment_logs_hide_structured_results_and_secret_values() {
        assert_eq!(
            sanitize_script_log_line("::result:: password=super-secret"),
            None
        );
        assert_eq!(
            sanitize_script_log_line("Private key: super-secret"),
            Some("[已隐藏敏感部署输出]".to_string())
        );
        assert_eq!(
            sanitize_script_log_line("password: \"super-secret\""),
            Some("[已隐藏敏感部署输出]".to_string())
        );
        assert_eq!(
            sanitize_script_log_line("request failed: password authentication rejected"),
            Some("request failed: password authentication rejected".to_string())
        );
        assert_eq!(
            sanitize_script_log_line("Xray 服务已启动。"),
            Some("Xray 服务已启动。".to_string())
        );
    }

    #[test]
    fn ownership_hash_uses_the_protocol_client_secret() {
        let node = NodeRecord {
            id: "node-1".to_string(),
            vps_id: "vps-1".to_string(),
            vps_name: "Test VPS".to_string(),
            name: "Test Node".to_string(),
            host: "203.0.113.10".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol: ProtocolId::VlessReality,
            protocol_params: serde_json::json!({ "uuid": "legacy-secret" }),
            status: "active".to_string(),
            created_at: 1,
        };

        assert_eq!(
            ownership_secret_hash(&node).as_deref(),
            Some("fdcbc807d80f60c6f15ef644d5c372ac92760bd5f414cc3d48c3b320d9d1e689")
        );
    }
}
