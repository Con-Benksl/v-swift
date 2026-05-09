use super::{NetworkStats, SystemStatus};
use crate::error::{AppError, AppResult};
use crate::ssh::{ExecOutput, SshSession};

pub async fn get_system_status(ssh: &SshSession) -> AppResult<SystemStatus> {
    let (cpu_result, mem_result, disk_result, uptime_result) = tokio::join!(
        ssh.exec("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"),
        ssh.exec("free -m | grep Mem"),
        ssh.exec("df -h / | tail -1"),
        ssh.exec("cat /proc/uptime | awk '{print $1}'"),
    );

    let cpu_percent = parse_cpu_usage(cpu_result?);
    let (memory_total, memory_used, memory_free, memory_available) = parse_memory(mem_result?);
    let (disk_total, disk_used, disk_available, disk_usage_percent) = parse_disk(disk_result?);
    let uptime_seconds = parse_uptime(uptime_result?);

    Ok(SystemStatus {
        cpu_percent,
        memory_total,
        memory_used,
        memory_free,
        memory_available,
        disk_total,
        disk_used,
        disk_available,
        disk_usage_percent,
        uptime_seconds,
    })
}

pub async fn get_network_stats(ssh: &SshSession) -> AppResult<NetworkStats> {
    let output = ssh.exec("cat /proc/net/dev").await?;
    if output.exit_code != 0 {
        return Err(AppError::Other(format!(
            "failed to read /proc/net/dev: {}",
            output.stderr.trim()
        )));
    }

    let mut total_received: u64 = 0;
    let mut total_sent: u64 = 0;
    let mut packets_received: u64 = 0;
    let mut packets_sent: u64 = 0;

    for line in output.stdout.lines().skip(2) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 10 {
            continue;
        }

        let interface = parts[0].trim_end_matches(':');
        if interface == "lo" {
            continue;
        }

        if let (Ok(bytes_recv), Ok(packets_recv), Ok(bytes_sent), Ok(packets_sent_val)) = (
            parts[1].parse::<u64>(),
            parts[2].parse::<u64>(),
            parts[9].parse::<u64>(),
            parts[10].parse::<u64>(),
        ) {
            total_received += bytes_recv;
            total_sent += bytes_sent;
            packets_received += packets_recv;
            packets_sent += packets_sent_val;
        }
    }

    Ok(NetworkStats {
        bytes_received: total_received,
        bytes_sent: total_sent,
        packets_received,
        packets_sent,
    })
}

fn parse_cpu_usage(result: ExecOutput) -> f64 {
    if result.exit_code != 0 {
        return 0.0;
    }
    result.stdout.trim().parse::<f64>().unwrap_or(0.0)
}

fn parse_memory(result: ExecOutput) -> (u64, u64, u64, u64) {
    if result.exit_code != 0 {
        return (0, 0, 0, 0);
    }

    let parts: Vec<&str> = result.stdout.split_whitespace().collect();
    if parts.len() < 7 {
        return (0, 0, 0, 0);
    }

    let total = parts[1].parse::<u64>().unwrap_or(0);
    let used = parts[2].parse::<u64>().unwrap_or(0);
    let free = parts[3].parse::<u64>().unwrap_or(0);
    let available = parts[6].parse::<u64>().unwrap_or(0);

    (total, used, free, available)
}

fn parse_disk(result: ExecOutput) -> (u64, u64, u64, f64) {
    if result.exit_code != 0 {
        return (0, 0, 0, 0.0);
    }

    let parts: Vec<&str> = result.stdout.split_whitespace().collect();
    if parts.len() < 6 {
        return (0, 0, 0, 0.0);
    }

    let total = parse_size_to_bytes(parts[1]);
    let used = parse_size_to_bytes(parts[2]);
    let available = parse_size_to_bytes(parts[3]);
    let usage_percent = parts[4].trim_end_matches('%').parse::<f64>().unwrap_or(0.0);

    (total, used, available, usage_percent)
}

fn parse_size_to_bytes(size_str: &str) -> u64 {
    let size_str = size_str.trim();
    if size_str.is_empty() {
        return 0;
    }

    let last_char = size_str.chars().last().unwrap_or('0');
    let numeric_str = &size_str[..size_str.len() - 1];
    let value: f64 = numeric_str.parse().unwrap_or(0.0);

    match last_char {
        'K' | 'k' => (value * 1024.0) as u64,
        'M' | 'm' => (value * 1024.0 * 1024.0) as u64,
        'G' | 'g' => (value * 1024.0 * 1024.0 * 1024.0) as u64,
        'T' | 't' => (value * 1024.0 * 1024.0 * 1024.0 * 1024.0) as u64,
        'P' | 'p' => (value * 1024.0 * 1024.0 * 1024.0 * 1024.0 * 1024.0) as u64,
        _ => numeric_str.parse::<u64>().unwrap_or(0),
    }
}

fn parse_uptime(result: ExecOutput) -> f64 {
    if result.exit_code != 0 {
        return 0.0;
    }
    result.stdout.trim().parse::<f64>().unwrap_or(0.0)
}
