use crate::error::{AppError, AppResult};
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

fn protocol_to_service(protocol: &str) -> AppResult<&'static str> {
    let normalized = protocol.to_lowercase();
    match normalized.as_str() {
        "vless-reality" | "vlessreality" | "vless" | "xray" | "reality" => Ok("xray"),
        "hysteria2" | "hy2" | "hysteria" => Ok("hysteria2"),
        _ => Err(AppError::Other(format!(
            "unsupported service protocol: {protocol}"
        ))),
    }
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
                .map(|s| s.trim().split_whitespace().next())
                .flatten()
                .unwrap_or("");
            main_pid = pid_str.parse().ok();
        }

        if line_lower.starts_with("memory:") {
            let mem_str = line_lower
                .strip_prefix("memory:")
                .map(|s| s.trim().split_whitespace().next())
                .flatten()
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

pub async fn start_service(ssh: &SshSession, protocol: &str) -> AppResult<()> {
    let service_name = protocol_to_service(protocol)?;

    let output = ssh
        .exec(&format!("sudo systemctl start {service_name}"))
        .await?;

    if output.exit_code != 0 {
        return Err(crate::error::AppError::Other(format!(
            "failed to start {}: {}",
            service_name,
            output.stderr.trim()
        )));
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    let status_output = ssh
        .exec(&format!("systemctl is-active {service_name}"))
        .await?;
    if status_output.stdout.trim() != "active" {
        return Err(crate::error::AppError::Other(format!(
            "{} started but is not active",
            service_name
        )));
    }

    Ok(())
}

pub async fn stop_service(ssh: &SshSession, protocol: &str) -> AppResult<()> {
    let service_name = protocol_to_service(protocol)?;

    let output = ssh
        .exec(&format!("sudo systemctl stop {service_name}"))
        .await?;

    if output.exit_code != 0 {
        return Err(crate::error::AppError::Other(format!(
            "failed to stop {}: {}",
            service_name,
            output.stderr.trim()
        )));
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    let status_output = ssh
        .exec(&format!("systemctl is-active {service_name}"))
        .await?;
    if status_output.stdout.trim() == "active" {
        return Err(crate::error::AppError::Other(format!(
            "{} stopped but is still active",
            service_name
        )));
    }

    Ok(())
}

pub async fn restart_service(ssh: &SshSession, protocol: &str) -> AppResult<()> {
    let service_name = protocol_to_service(protocol)?;

    let output = ssh
        .exec(&format!("sudo systemctl restart {service_name}"))
        .await?;

    if output.exit_code != 0 {
        return Err(crate::error::AppError::Other(format!(
            "failed to restart {}: {}",
            service_name,
            output.stderr.trim()
        )));
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

    let status_output = ssh
        .exec(&format!("systemctl is-active {service_name}"))
        .await?;
    if status_output.stdout.trim() != "active" {
        return Err(crate::error::AppError::Other(format!(
            "{} restarted but is not active",
            service_name
        )));
    }

    Ok(())
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

    if output.exit_code != 0 {
        if output.stderr.contains("No entries") || output.stderr.contains("cannot allocate") {
            return Ok(vec![]);
        }
    }

    let logs: Vec<String> = output.stdout.lines().map(|line| line.to_string()).collect();

    Ok(logs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_to_service_rejects_unknown_protocols() {
        let err = protocol_to_service("xray; touch /tmp/pwn").unwrap_err();
        assert!(err.to_string().contains("unsupported service protocol"));
    }
}
