use crate::deploy::ProtocolId;
use crate::error::{AppError, AppResult};
use crate::scripts::CONTROL_MANAGED_SERVICE;
use crate::ssh::SshSession;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub name: String,
    pub protocol: String,
    pub active: bool,
    pub running: bool,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub memory_usage: Option<String>,
    pub uptime: Option<String>,
    pub raw_status: String,
}

#[derive(Debug, Clone, Copy)]
struct ManagedService {
    service_name: &'static str,
    control_protocol: &'static str,
    protocol_id: ProtocolId,
}

#[derive(Debug, Clone, Copy)]
enum ServiceAction {
    Start,
    Stop,
    Restart,
}

impl ServiceAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
        }
    }
}

fn managed_service(protocol: &str) -> AppResult<ManagedService> {
    let normalized = protocol.to_lowercase();
    match normalized.as_str() {
        "vless-reality" | "vlessreality" | "vless" | "xray" | "reality" => Ok(ManagedService {
            service_name: "xray",
            control_protocol: "xray",
            protocol_id: ProtocolId::VlessReality,
        }),
        "hysteria2" | "hy2" | "hysteria" => Ok(ManagedService {
            service_name: "hysteria-server",
            control_protocol: "hysteria2",
            protocol_id: ProtocolId::Hysteria2,
        }),
        _ => Err(AppError::Other(format!(
            "unsupported service protocol: {protocol}"
        ))),
    }
}

fn protocol_to_service(protocol: &str) -> AppResult<&'static str> {
    Ok(managed_service(protocol)?.service_name)
}

pub(crate) fn protocol_id(protocol: &str) -> AppResult<ProtocolId> {
    Ok(managed_service(protocol)?.protocol_id)
}

pub async fn get_service_status(ssh: &SshSession, protocol: &str) -> AppResult<ServiceStatus> {
    let service_name = protocol_to_service(protocol)?;

    let is_active_output = ssh
        .exec(&format!("systemctl is-active {service_name}"))
        .await?;
    let active_state = is_active_output.stdout.trim().to_string();
    let is_active = active_state == "active";

    let status_output = ssh
        .exec(&format!("systemctl status {service_name} --no-pager"))
        .await?;
    let raw_status = if status_output.exit_code == 0 {
        status_output.stdout.clone()
    } else {
        format!("{}\n{}", status_output.stdout, status_output.stderr)
    };

    let mut is_running = false;
    let mut main_pid: Option<u32> = None;
    let mut memory_usage: Option<String> = None;
    let mut uptime: Option<String> = None;
    let mut port: Option<u16> = None;

    for line in status_output.stdout.lines() {
        let line_lower = line.to_lowercase();

        if line_lower.contains("active:") || line_lower.contains("active (") {
            is_running = line_lower.contains("active (running)");
        }

        if line_lower.starts_with("main pid:") {
            let pid_str = line_lower
                .strip_prefix("main pid:")
                .and_then(|s| s.split_whitespace().next())
                .unwrap_or("");
            main_pid = pid_str.parse().ok();
        }

        if line_lower.starts_with("memory:") {
            let mem_str = line_lower
                .strip_prefix("memory:")
                .and_then(|s| s.split_whitespace().next())
                .unwrap_or("");
            if !mem_str.is_empty() {
                memory_usage = Some(mem_str.to_string());
            }
        }

        if line_lower.contains("since") {
            if let Some(since_idx) = line_lower.find("since") {
                let uptime_str = line[since_idx..]
                    .trim_start_matches(|c: char| !c.is_ascii_lowercase() && c != ' ')
                    .trim();
                if !uptime_str.is_empty() {
                    uptime = Some(uptime_str.to_string());
                }
            }
        }

        if line_lower.contains("listen") || line_lower.contains("port") {
            for word in line.split_whitespace() {
                if word.parse::<u16>().is_ok() {
                    port = Some(word.parse().unwrap());
                    break;
                }
            }
        }
    }

    Ok(ServiceStatus {
        name: service_name.to_string(),
        protocol: protocol.to_string(),
        active: is_active,
        running: is_running,
        port,
        pid: main_pid,
        memory_usage,
        uptime,
        raw_status,
    })
}

pub async fn start_service(
    ssh: &SshSession,
    protocol: &str,
    expected_ownership_hash: &str,
) -> AppResult<()> {
    control_service(ssh, protocol, expected_ownership_hash, ServiceAction::Start).await
}

pub async fn stop_service(
    ssh: &SshSession,
    protocol: &str,
    expected_ownership_hash: &str,
) -> AppResult<()> {
    control_service(ssh, protocol, expected_ownership_hash, ServiceAction::Stop).await
}

pub async fn restart_service(
    ssh: &SshSession,
    protocol: &str,
    expected_ownership_hash: &str,
) -> AppResult<()> {
    control_service(
        ssh,
        protocol,
        expected_ownership_hash,
        ServiceAction::Restart,
    )
    .await
}

async fn control_service(
    ssh: &SshSession,
    protocol: &str,
    expected_ownership_hash: &str,
    action: ServiceAction,
) -> AppResult<()> {
    let service = managed_service(protocol)?;
    if !valid_ownership_hash(expected_ownership_hash) {
        return Err(AppError::Other(
            "本地节点缺少有效的所有权凭据，已拒绝执行远端服务控制。".to_string(),
        ));
    }

    // Validation and mutation intentionally live in one remote script. This keeps the fail-closed
    // ownership checks immediately adjacent to systemctl and avoids the former unconditional sudo
    // path (deployments require a root SSH user).
    let remote_path = format!(
        "/tmp/v-swift-control-managed-service-{}.sh",
        uuid::Uuid::new_v4()
    );
    ssh.upload(&remote_path, CONTROL_MANAGED_SERVICE.as_bytes(), 0o700)
        .await?;

    let command = format!(
        "bash {} {} {} {}",
        shell_single_quote(&remote_path),
        shell_single_quote(action.as_str()),
        shell_single_quote(service.control_protocol),
        shell_single_quote(expected_ownership_hash),
    );
    let result = ssh.exec(&command).await;
    let _ = ssh
        .exec(&format!("rm -f {}", shell_single_quote(&remote_path)))
        .await;

    let output = result?;
    if output.exit_code == 0 {
        return Ok(());
    }

    let details = if output.stderr.trim().is_empty() {
        "远端未返回诊断信息".to_string()
    } else {
        output.stderr.trim().to_string()
    };
    Err(AppError::Other(format!(
        "{} 服务安全校验或 {} 操作失败：{}",
        service.service_name,
        action.as_str(),
        details
    )))
}

fn valid_ownership_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub async fn get_service_logs(
    ssh: &SshSession,
    protocol: &str,
    lines: u32,
) -> AppResult<Vec<String>> {
    let service_name = protocol_to_service(protocol)?;

    let lines = if lines == 0 { 50 } else { lines.min(1000) };

    let output = ssh
        .exec(&format!(
            "journalctl -u {service_name} -n {lines} --no-pager"
        ))
        .await?;

    if output.exit_code != 0
        && (output.stderr.contains("No entries") || output.stderr.contains("cannot allocate"))
    {
        return Ok(vec![]);
    }

    let logs: Vec<String> = output.stdout.lines().map(|line| line.to_string()).collect();

    Ok(logs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_to_service_maps_hysteria2_aliases_to_systemd_unit() {
        for protocol in ["hysteria2", "hy2", "hysteria"] {
            assert_eq!(protocol_to_service(protocol).unwrap(), "hysteria-server");
            assert_eq!(protocol_id(protocol).unwrap(), ProtocolId::Hysteria2);
        }
    }

    #[test]
    fn protocol_to_service_rejects_unknown_protocols() {
        let err = protocol_to_service("xray; touch /tmp/pwn").unwrap_err();
        assert!(err.to_string().contains("unsupported service protocol"));
    }

    #[test]
    fn ownership_hash_must_be_canonical_sha256_hex() {
        assert!(valid_ownership_hash(
            "fdcbc807d80f60c6f15ef644d5c372ac92760bd5f414cc3d48c3b320d9d1e689"
        ));
        assert!(!valid_ownership_hash(""));
        assert!(!valid_ownership_hash(
            "FDCBC807D80F60C6F15EF644D5C372AC92760BD5F414CC3D48C3B320D9D1E689"
        ));
        assert!(!valid_ownership_hash(
            "zdcbc807d80f60c6f15ef644d5c372ac92760bd5f414cc3d48c3b320d9d1e689"
        ));
    }

    #[test]
    fn managed_control_script_requires_root_and_never_uses_sudo() {
        assert!(CONTROL_MANAGED_SERVICE.contains("root_required_for_service_control"));
        assert!(CONTROL_MANAGED_SERVICE.contains("systemctl \"${ACTION}\""));
        assert!(!CONTROL_MANAGED_SERVICE.contains("sudo systemctl"));
    }

    #[test]
    fn managed_control_script_only_migrates_legacy_marker_after_ownership_proof() {
        let ownership_proof = CONTROL_MANAGED_SERVICE
            .find("managed_${PROTOCOL}_config_no_longer_matches_local_node")
            .expect("ownership hash check should remain in the control script");
        let marker_migration = CONTROL_MANAGED_SERVICE
            .find("migrate_legacy_ownership_marker\nfi")
            .expect("legacy marker migration should remain in the control script");

        assert!(marker_migration > ownership_proof);
        assert!(CONTROL_MANAGED_SERVICE.contains("mkdir -m 700 -- \"${MARKER_DIR}\""));
        assert!(CONTROL_MANAGED_SERVICE.contains("chmod 600 \"${MARKER_TMP}\""));
        assert!(CONTROL_MANAGED_SERVICE.contains("ln -- \"${MARKER_TMP}\" \"${MARKER_FILE}\""));
    }
}
