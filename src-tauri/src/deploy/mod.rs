use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::{AppError, AppResult};
use crate::scripts::DETECT_OS;
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

pub mod vless_reality;
pub mod hysteria2;

pub async fn detect_os(ssh: &SshSession) -> AppResult<OsInfo> {
    struct SilentProgress;

    impl ProgressSink for SilentProgress {
        fn step(&self, _step: &str, _label: &str) {}
        fn log(&self, _line: &str) {}
    }

    let output = run_script(ssh, "detect_os", DETECT_OS, "", &SilentProgress).await?;
    let parsed = parse_results(&output);

    Ok(OsInfo {
        distro: parsed.get("distro").cloned().unwrap_or_default(),
        version: parsed.get("version").cloned().unwrap_or_default(),
        arch: parsed.get("arch").cloned().unwrap_or_default(),
    })
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
    args: &str,
    progress: &dyn ProgressSink,
) -> AppResult<String> {
    let remote_path = format!("/tmp/vps-node-deployer-{name}-{}.sh", uuid::Uuid::new_v4());
    progress.step(name, name);
    ssh.upload(&remote_path, script.as_bytes(), 0o755).await?;

    let command = if args.trim().is_empty() {
        format!("bash {}", shell_single_quote(&remote_path))
    } else {
        format!("bash {} {}", shell_single_quote(&remote_path), args)
    };

    let collected = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let last_stderr = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let collected_for_cb = collected.clone();
    let stderr_for_cb = last_stderr.clone();

    let exit_code = ssh
        .exec_stream(&command, move |line| {
            progress.log(line);
            if let Some(stripped) = line.strip_prefix("[stderr] ") {
                if let Ok(mut buf) = stderr_for_cb.lock() {
                    buf.push_str(stripped);
                    buf.push('\n');
                }
            } else if let Ok(mut buf) = collected_for_cb.lock() {
                buf.push_str(line);
                buf.push('\n');
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

    if exit_code != 0 {
        let stderr_trimmed = stderr.trim();
        let message = if !stderr_trimmed.is_empty() {
            stderr_trimmed.to_string()
        } else {
            let tail: Vec<&str> = stdout.lines().rev().take(8).collect();
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

pub fn deployer_for(protocol: ProtocolId) -> Box<dyn Deployer> {
    match protocol {
        ProtocolId::VlessReality => Box::new(VlessRealityDeployer),
        ProtocolId::Hysteria2 => Box::new(Hysteria2Deployer),
    }
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
