use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::deploy::{parse_results, run_script, NodeRecord, ProgressSink, ProtocolId};
use crate::error::{AppError, AppResult};
use crate::scripts::{SETUP_FIREWALL, SETUP_SUBSCRIPTION_SERVICE, SUBSCRIPTION_SERVER_PY};
use crate::ssh::SshSession;

const MANAGED_SUBSCRIPTION_KEY: &str = "managed_subscription";
const DEFAULT_SUBSCRIPTION_PORT: u16 = 18080;
const CONFIG_PATH: &str = "/opt/vps-subscription/config.yaml";
const SERVER_PATH: &str = "/opt/vps-subscription/subscription_server.py";
const SERVICE_PATH: &str = "/etc/systemd/system/vps-subscription.service";
const TOTAL_BYTES: u64 = 3_000_000_000_000;
const EXPIRE_TS: u64 = 1_779_638_400;

const ACTIVATE_SUBSCRIPTION_SERVICE: &str = r#"#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-18080}"

systemctl daemon-reload
systemctl enable --now vps-subscription
systemctl restart vps-subscription
sleep 1

if ! systemctl is-active --quiet vps-subscription; then
  echo "::error:: subscription_service_not_active" >&2
  systemctl status vps-subscription --no-pager -l >&2 || true
  journalctl -u vps-subscription -n 50 --no-pager >&2 || true
  exit 1
fi

curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null
echo "远程订阅服务已启动并通过本机健康检查。"
"#;

const REMOVE_SUBSCRIPTION_SERVICE: &str = r#"#!/usr/bin/env bash
set -euo pipefail

systemctl disable --now vps-subscription 2>/dev/null || true
rm -f /etc/systemd/system/vps-subscription.service
rm -rf /opt/vps-subscription
systemctl daemon-reload 2>/dev/null || true
echo "远程订阅服务已移除。"
"#;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManagedSubscription {
    pub url: String,
    pub port: u16,
    pub token: String,
    pub updated_at: i64,
}

pub async fn install_for_nodes(
    ssh: &SshSession,
    host: &str,
    nodes: &[NodeRecord],
    progress: &dyn ProgressSink,
) -> AppResult<ManagedSubscription> {
    progress.step("subscription", "managed subscription");

    let setup_output = run_script(
        ssh,
        "subscription_setup",
        SETUP_SUBSCRIPTION_SERVICE,
        "",
        progress,
    )
    .await?;
    let setup_results = parse_results(&setup_output);
    let iface = setup_results
        .get("iface")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("eth0");

    let token = nodes
        .iter()
        .find_map(extract_managed_subscription)
        .map(|managed| managed.token)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(new_token);
    let managed = ManagedSubscription {
        url: build_url(host, DEFAULT_SUBSCRIPTION_PORT, &token),
        port: DEFAULT_SUBSCRIPTION_PORT,
        token,
        updated_at: unix_now(),
    };

    let config = build_mihomo_config(nodes)?;
    ssh.upload(SERVER_PATH, SUBSCRIPTION_SERVER_PY.as_bytes(), 0o755)
        .await?;
    ssh.upload(CONFIG_PATH, config.as_bytes(), 0o644).await?;
    ssh.upload(
        SERVICE_PATH,
        build_systemd_service(iface, &managed).as_bytes(),
        0o644,
    )
    .await?;

    run_script(
        ssh,
        "subscription_activate",
        ACTIVATE_SUBSCRIPTION_SERVICE,
        &managed.port.to_string(),
        progress,
    )
    .await?;
    run_script(
        ssh,
        "subscription_firewall",
        SETUP_FIREWALL,
        &format!("tcp {}", managed.port),
        progress,
    )
    .await?;

    Ok(managed)
}

pub async fn remove_from_vps(ssh: &SshSession, progress: &dyn ProgressSink) -> AppResult<()> {
    run_script(
        ssh,
        "subscription_remove",
        REMOVE_SUBSCRIPTION_SERVICE,
        "",
        progress,
    )
    .await?;
    Ok(())
}

pub fn build_mihomo_config(nodes: &[NodeRecord]) -> AppResult<String> {
    if nodes.is_empty() {
        return Err(AppError::Other(
            "managed subscription requires at least one node".to_string(),
        ));
    }

    let names = unique_proxy_names(nodes);
    let mut output = String::from(
        "mixed-port: 7897\nallow-lan: false\nmode: rule\nlog-level: info\n\nproxies:\n",
    );

    for (node, name) in nodes.iter().zip(names.iter()) {
        match node.protocol {
            ProtocolId::VlessReality => append_vless_proxy(&mut output, node, name)?,
            ProtocolId::Hysteria2 => append_hysteria2_proxy(&mut output, node, name)?,
        }
    }

    output.push_str("\nproxy-groups:\n");
    output.push_str("  - name: PROXY\n");
    output.push_str("    type: select\n");
    output.push_str("    proxies:\n");
    for name in &names {
        output.push_str("      - ");
        output.push_str(&yaml_quote(name));
        output.push('\n');
    }
    output.push_str("      - DIRECT\n\n");
    output.push_str("rules:\n");
    output.push_str("  - MATCH,PROXY\n");

    Ok(output)
}

pub fn apply_managed_subscription(node: &mut NodeRecord, managed: &ManagedSubscription) {
    let mut params = node
        .protocol_params
        .as_object()
        .cloned()
        .unwrap_or_default();
    params.insert(MANAGED_SUBSCRIPTION_KEY.to_string(), json!(managed));
    node.protocol_params = Value::Object(params);
}

pub fn extract_managed_subscription(node: &NodeRecord) -> Option<ManagedSubscription> {
    serde_json::from_value(
        node.protocol_params
            .get(MANAGED_SUBSCRIPTION_KEY)?
            .clone(),
    )
    .ok()
}

fn append_vless_proxy(output: &mut String, node: &NodeRecord, name: &str) -> AppResult<()> {
    let params = &node.protocol_params;
    let port = required_u64(params, "port")?;
    let uuid = required_string(params, "uuid")?;
    let sni = required_string(params, "sni")?;
    let public_key = required_string(params, "public_key")?;
    let short_id = required_string(params, "short_id")?;
    let flow = optional_string(params, "flow").unwrap_or("xtls-rprx-vision");

    output.push_str("  - name: ");
    output.push_str(&yaml_quote(name));
    output.push('\n');
    output.push_str("    type: vless\n");
    output.push_str("    server: ");
    output.push_str(&yaml_quote(&node.host));
    output.push('\n');
    output.push_str(&format!("    port: {port}\n"));
    output.push_str("    uuid: ");
    output.push_str(&yaml_quote(uuid));
    output.push('\n');
    output.push_str("    network: tcp\n");
    output.push_str("    tls: true\n");
    output.push_str("    udp: true\n");
    output.push_str("    flow: ");
    output.push_str(flow);
    output.push('\n');
    output.push_str("    servername: ");
    output.push_str(&yaml_quote(sni));
    output.push('\n');
    output.push_str("    client-fingerprint: chrome\n");
    output.push_str("    reality-opts:\n");
    output.push_str("      public-key: ");
    output.push_str(&yaml_quote(public_key));
    output.push('\n');
    output.push_str("      short-id: ");
    output.push_str(&yaml_quote(short_id));
    output.push('\n');

    Ok(())
}

fn append_hysteria2_proxy(output: &mut String, node: &NodeRecord, name: &str) -> AppResult<()> {
    let params = &node.protocol_params;
    let port = required_u64(params, "port")?;
    let password = required_string(params, "password")?;
    let sni = required_string(params, "sni")?;
    let insecure = is_insecure_enabled(params);

    output.push_str("  - name: ");
    output.push_str(&yaml_quote(name));
    output.push('\n');
    output.push_str("    type: hysteria2\n");
    output.push_str("    server: ");
    output.push_str(&yaml_quote(&node.host));
    output.push('\n');
    output.push_str(&format!("    port: {port}\n"));
    output.push_str("    password: ");
    output.push_str(&yaml_quote(password));
    output.push('\n');
    output.push_str("    sni: ");
    output.push_str(&yaml_quote(sni));
    output.push('\n');
    output.push_str(&format!("    skip-cert-verify: {insecure}\n"));
    output.push_str("    udp: true\n");

    Ok(())
}

fn unique_proxy_names(nodes: &[NodeRecord]) -> Vec<String> {
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    nodes
        .iter()
        .map(|node| {
            let base = node
                .name
                .trim()
                .to_string()
                .if_empty_then(|| node.host.clone());
            let count = seen.entry(base.clone()).or_insert(0);
            *count += 1;
            if *count == 1 {
                base
            } else {
                format!("{base} ({count})")
            }
        })
        .collect()
}

trait IfEmptyThen {
    fn if_empty_then<F: FnOnce() -> String>(self, fallback: F) -> String;
}

impl IfEmptyThen for String {
    fn if_empty_then<F: FnOnce() -> String>(self, fallback: F) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

fn required_string<'a>(params: &'a Value, key: &str) -> AppResult<&'a str> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Other(format!("missing or invalid protocol param: {key}")))
}

fn optional_string<'a>(params: &'a Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(|v| v.as_str())
}

fn required_u64(params: &Value, key: &str) -> AppResult<u64> {
    params
        .get(key)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| AppError::Other(format!("missing or invalid protocol param: {key}")))
}

fn is_insecure_enabled(params: &Value) -> bool {
    match params.get("insecure") {
        Some(value) if value.as_u64() == Some(1) => true,
        Some(value) if value.as_str() == Some("1") => true,
        Some(value) if value.as_bool() == Some(true) => true,
        _ => false,
    }
}

fn yaml_quote(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn build_systemd_service(iface: &str, managed: &ManagedSubscription) -> String {
    format!(
        r#"[Unit]
Description=V-Swift managed Clash/Mihomo subscription
After=network-online.target vnstat.service
Wants=network-online.target

[Service]
Type=simple
Environment=SUB_HOST=0.0.0.0
Environment=SUB_PORT={port}
Environment=SUB_IFACE={iface}
Environment=SUB_CONFIG_PATH={config_path}
Environment=SUB_TOTAL_BYTES={total_bytes}
Environment=SUB_EXPIRE_TS={expire_ts}
Environment=SUB_TOKEN={token}
ExecStart=/usr/bin/python3 {server_path}
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
"#,
        port = managed.port,
        iface = systemd_env_value(iface),
        config_path = CONFIG_PATH,
        total_bytes = TOTAL_BYTES,
        expire_ts = EXPIRE_TS,
        token = managed.token,
        server_path = SERVER_PATH
    )
}

fn build_url(host: &str, port: u16, token: &str) -> String {
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    format!("http://{host}:{port}/sub.yaml?token={token}")
}

fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn systemd_env_value(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | ':'))
        .collect::<String>()
        .if_empty_then(|| "eth0".to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::deploy::{NodeRecord, ProtocolId};

    fn vless_node() -> NodeRecord {
        NodeRecord {
            id: "vless-node".to_string(),
            vps_id: "vps-1".to_string(),
            vps_name: "Tokyo VPS".to_string(),
            name: "Tokyo Reality".to_string(),
            host: "203.0.113.10".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol: ProtocolId::VlessReality,
            protocol_params: json!({
                "uuid": "123e4567-e89b-12d3-a456-426614174000",
                "public_key": "pub_key-123",
                "short_id": "abcd1234",
                "port": 443,
                "sni": "www.microsoft.com",
                "flow": "xtls-rprx-vision"
            }),
            status: "active".to_string(),
            created_at: 1_700_000_000_000,
        }
    }

    fn hysteria_node() -> NodeRecord {
        NodeRecord {
            id: "hy2-node".to_string(),
            vps_id: "vps-1".to_string(),
            vps_name: "Tokyo VPS".to_string(),
            name: "Tokyo Hysteria".to_string(),
            host: "203.0.113.10".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol: ProtocolId::Hysteria2,
            protocol_params: json!({
                "password": "pass word",
                "port": 8443,
                "sni": "www.bing.com",
                "insecure": true
            }),
            status: "active".to_string(),
            created_at: 1_700_000_010_000,
        }
    }

    #[test]
    fn test_build_mihomo_config_contains_all_vps_nodes() {
        let yaml = super::build_mihomo_config(&[vless_node(), hysteria_node()])
            .expect("mihomo config should build");

        assert!(yaml.contains("type: vless"));
        assert!(yaml.contains("type: hysteria2"));
        assert!(yaml.contains("name: \"Tokyo Reality\""));
        assert!(yaml.contains("name: \"Tokyo Hysteria\""));
        assert!(yaml.contains("uuid: \"123e4567-e89b-12d3-a456-426614174000\""));
        assert!(yaml.contains("flow: xtls-rprx-vision"));
        assert!(yaml.contains("reality-opts:"));
        assert!(yaml.contains("public-key: \"pub_key-123\""));
        assert!(yaml.contains("password: \"pass word\""));
        assert!(yaml.contains("skip-cert-verify: true"));
        assert!(yaml.contains("      - \"Tokyo Reality\""));
        assert!(yaml.contains("      - \"Tokyo Hysteria\""));
        assert!(yaml.contains("      - DIRECT"));
    }

    #[test]
    fn test_apply_and_extract_managed_subscription_metadata() {
        let mut node = vless_node();
        let managed = super::ManagedSubscription {
            url: "http://203.0.113.10:18080/sub.yaml?token=test-token".to_string(),
            port: 18080,
            token: "test-token".to_string(),
            updated_at: 1_700_000_020_000,
        };

        super::apply_managed_subscription(&mut node, &managed);
        let extracted = super::extract_managed_subscription(&node)
            .expect("metadata should be readable after apply");

        assert_eq!(extracted.url, managed.url);
        assert_eq!(extracted.port, 18080);
        assert_eq!(extracted.token, "test-token");
        assert_eq!(extracted.updated_at, 1_700_000_020_000);
    }
}
