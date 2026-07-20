use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::deploy::{parse_results, run_script, NodeRecord, ProgressSink, ProtocolId};
use crate::error::{AppError, AppResult};
use crate::scripts::{
    ACTIVATE_SUBSCRIPTION_SERVICE, CLEANUP_SUBSCRIPTION_STAGING, REMOVE_SUBSCRIPTION_SERVICE,
    SETUP_FIREWALL, SETUP_SUBSCRIPTION_SERVICE, SUBSCRIPTION_SERVER_PY,
};
use crate::ssh::SshSession;

const MANAGED_SUBSCRIPTION_KEY: &str = "managed_subscription";
const DEFAULT_SUBSCRIPTION_PORT: u16 = 18080;
const CONFIG_PATH: &str = "/opt/vps-subscription/config.yaml";
const SERVER_PATH: &str = "/opt/vps-subscription/subscription_server.py";
const RUNTIME_ENV_PATH: &str = "/opt/vps-subscription/runtime.env";
const TOTAL_BYTES: u64 = 3_000_000_000_000;
const LEGACY_SERVER_HASHES: &[&str] =
    &["31e754ac04b13226dc97b87b2f561e70f2a213aefcf535cfa4cc7e2cce94fe14"];
// 0 表示不声明固定到期日；避免新订阅因硬编码历史时间立即显示已过期。
const EXPIRE_TS: u64 = 0;

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

    // Finish every fallible local validation before setup mutates the remote host.
    let config = build_mihomo_config(nodes)?;
    let token = managed_token_for_nodes(nodes)?.unwrap_or_else(new_token);
    let managed = ManagedSubscription {
        url: build_url(host, DEFAULT_SUBSCRIPTION_PORT, &token),
        port: DEFAULT_SUBSCRIPTION_PORT,
        token,
        updated_at: unix_now(),
    };
    let service = build_systemd_service();
    let stage_id = uuid::Uuid::new_v4().simple().to_string();
    let server_stage = format!("/opt/vps-subscription/.v-swift-{stage_id}-server.tmp");
    let config_stage = format!("/opt/vps-subscription/.v-swift-{stage_id}-config.tmp");
    let env_stage = format!("/opt/vps-subscription/.v-swift-{stage_id}-env.tmp");
    let service_stage = format!("/opt/vps-subscription/.v-swift-{stage_id}-service.tmp");
    let legacy_token_hash = sha256_hex(managed.token.as_bytes());
    let expected_server_hashes = allowed_server_hashes();

    let setup_output = run_script(
        ssh,
        "subscription_setup",
        SETUP_SUBSCRIPTION_SERVICE,
        &[legacy_token_hash.as_str(), expected_server_hashes.as_str()],
        progress,
    )
    .await?;
    let setup_results = parse_results(&setup_output);
    let iface = setup_results
        .get("iface")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("eth0");
    let runtime_env = build_runtime_env(iface, &managed);
    let upload_result = async {
        ssh.upload(&server_stage, SUBSCRIPTION_SERVER_PY.as_bytes(), 0o600)
            .await?;
        ssh.upload(&config_stage, config.as_bytes(), 0o600).await?;
        ssh.upload(&env_stage, runtime_env.as_bytes(), 0o600)
            .await?;
        ssh.upload(&service_stage, service.as_bytes(), 0o600)
            .await?;
        AppResult::Ok(())
    }
    .await;
    if let Err(err) = upload_result {
        cleanup_staging(ssh, &stage_id, progress).await;
        return Err(err);
    }

    let port_arg = managed.port.to_string();
    let firewall_result = run_script(
        ssh,
        "subscription_firewall",
        SETUP_FIREWALL,
        &["tcp", port_arg.as_str()],
        progress,
    )
    .await;
    if let Err(err) = firewall_result {
        cleanup_staging(ssh, &stage_id, progress).await;
        return Err(err);
    }

    let activate_result = run_script(
        ssh,
        "subscription_activate",
        ACTIVATE_SUBSCRIPTION_SERVICE,
        &[
            stage_id.as_str(),
            port_arg.as_str(),
            legacy_token_hash.as_str(),
            expected_server_hashes.as_str(),
        ],
        progress,
    )
    .await;
    if let Err(err) = activate_result {
        cleanup_staging(ssh, &stage_id, progress).await;
        return Err(err);
    }

    Ok(managed)
}

pub async fn remove_from_vps(
    ssh: &SshSession,
    legacy_token: Option<&str>,
    progress: &dyn ProgressSink,
) -> AppResult<()> {
    let legacy_token_hash = legacy_token
        .filter(|token| valid_managed_token(token))
        .map(|token| sha256_hex(token.as_bytes()))
        .unwrap_or_default();
    let expected_server_hashes = allowed_server_hashes();
    run_script(
        ssh,
        "subscription_remove",
        REMOVE_SUBSCRIPTION_SERVICE,
        &[legacy_token_hash.as_str(), expected_server_hashes.as_str()],
        progress,
    )
    .await?;
    Ok(())
}

async fn cleanup_staging(ssh: &SshSession, stage_id: &str, progress: &dyn ProgressSink) {
    if let Err(err) = run_script(
        ssh,
        "subscription_staging_cleanup",
        CLEANUP_SUBSCRIPTION_STAGING,
        &[stage_id],
        progress,
    )
    .await
    {
        progress.log(&format!(
            "订阅临时文件清理失败，请检查 stage {stage_id}：{err}"
        ));
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn allowed_server_hashes() -> String {
    std::iter::once(sha256_hex(SUBSCRIPTION_SERVER_PY.as_bytes()))
        .chain(
            LEGACY_SERVER_HASHES
                .iter()
                .map(|value| (*value).to_string()),
        )
        .collect::<Vec<_>>()
        .join(",")
}

fn managed_token_for_nodes(nodes: &[NodeRecord]) -> AppResult<Option<String>> {
    let mut tokens = HashSet::new();

    for node in nodes {
        let Some(value) = node.protocol_params.get(MANAGED_SUBSCRIPTION_KEY) else {
            continue;
        };
        let managed: ManagedSubscription = serde_json::from_value(value.clone()).map_err(|_| {
            AppError::Other(format!(
                "节点 {} 的托管订阅元数据已损坏，已在修改远端服务前中止。",
                node.id
            ))
        })?;
        if !valid_managed_token(&managed.token) {
            return Err(AppError::Other(format!(
                "节点 {} 的托管订阅令牌格式无效，已在修改远端服务前中止。",
                node.id
            )));
        }
        tokens.insert(managed.token);
    }

    if tokens.len() > 1 {
        return Err(AppError::Other(
            "同一 VPS 的节点保存了互相冲突的托管订阅令牌，已拒绝静默覆盖远端服务。".to_string(),
        ));
    }

    Ok(tokens.into_iter().next())
}

fn valid_managed_token(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|value| matches!(value, b'0'..=b'9' | b'a'..=b'f'))
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
    serde_json::from_value(node.protocol_params.get(MANAGED_SUBSCRIPTION_KEY)?.clone()).ok()
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

fn build_systemd_service() -> String {
    format!(
        r#"[Unit]
Description=V-Swift managed Clash/Mihomo subscription
After=network-online.target vnstat.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile={runtime_env_path}
ExecStart=/usr/bin/python3 {server_path}
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
"#,
        runtime_env_path = RUNTIME_ENV_PATH,
        server_path = SERVER_PATH
    )
}

fn build_runtime_env(iface: &str, managed: &ManagedSubscription) -> String {
    // Prefer one dual-stack listener even when the public address is an AAAA-only hostname.
    // The Python service falls back to IPv4 if the host kernel has IPv6 disabled.
    format!(
        "SUB_PORT={}\nSUB_IFACE={}\nSUB_CONFIG_PATH={}\nSUB_TOTAL_BYTES={}\nSUB_EXPIRE_TS={}\nSUB_TOKEN={}\n",
        managed.port,
        systemd_env_value(iface),
        CONFIG_PATH,
        TOTAL_BYTES,
        EXPIRE_TS,
        managed.token
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

    #[test]
    fn managed_subscription_tokens_must_be_valid_and_consistent() {
        let mut first = vless_node();
        let mut second = hysteria_node();
        let first_managed = super::ManagedSubscription {
            url: "http://example.test/sub?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            port: 18080,
            token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            updated_at: 1,
        };
        let second_managed = super::ManagedSubscription {
            url: "http://example.test/sub?token=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
            port: 18080,
            token: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
            updated_at: 2,
        };
        super::apply_managed_subscription(&mut first, &first_managed);
        super::apply_managed_subscription(&mut second, &second_managed);

        assert!(super::managed_token_for_nodes(&[first.clone()]).is_ok());
        let conflict = super::managed_token_for_nodes(&[first, second])
            .expect_err("conflicting tokens must fail before remote mutation");
        assert!(conflict.to_string().contains("互相冲突"));

        let mut invalid = vless_node();
        let mut invalid_managed = first_managed;
        invalid_managed.token = "bad\nEnvironment=INJECTED=1".to_string();
        super::apply_managed_subscription(&mut invalid, &invalid_managed);
        let invalid_error = super::managed_token_for_nodes(&[invalid])
            .expect_err("invalid persisted token must fail closed");
        assert!(invalid_error.to_string().contains("格式无效"));
    }

    #[test]
    fn systemd_unit_keeps_token_in_private_environment_file() {
        let managed = super::ManagedSubscription {
            url: "http://example.test/sub?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            port: 18080,
            token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            updated_at: 1,
        };
        let unit = super::build_systemd_service();
        let runtime_env = super::build_runtime_env("eth0;injected", &managed);

        assert!(unit.contains("EnvironmentFile=/opt/vps-subscription/runtime.env"));
        assert!(!unit.contains("SUB_TOKEN="));
        assert!(runtime_env.contains("SUB_IFACE=eth0injected\n"));
        assert!(runtime_env.contains("SUB_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"));
    }
}
