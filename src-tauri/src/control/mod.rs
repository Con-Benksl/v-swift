use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub cpu_percent: f64,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_free: u64,
    pub memory_available: u64,
    pub disk_total: u64,
    pub disk_used: u64,
    pub disk_available: u64,
    pub disk_usage_percent: f64,
    pub uptime_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    pub bytes_received: u64,
    pub bytes_sent: u64,
    pub packets_received: u64,
    pub packets_sent: u64,
}

pub mod commands;
pub mod monitor;
pub mod service;
pub mod ssh_pool;

pub use commands::*;
pub use service::ServiceStatus;
pub use ssh_pool::SshPool;
