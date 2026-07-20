use async_trait::async_trait;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};
use crate::scripts::{
    CONFIGURE_VLESS_REALITY, INSTALL_XRAY, PREPARE, SETUP_FIREWALL, UNINSTALL_XRAY,
};
use crate::ssh::SshSession;

use super::{
    detect_os, ownership_secret_hash, parse_results, run_script, validated_sni, DeployParams,
    Deployer, NodeRecord, OsInfo, ProgressSink, ProtocolId,
};

pub struct VlessRealityDeployer;

struct NoopProgress;

impl ProgressSink for NoopProgress {
    fn step(&self, _step: &str, _label: &str) {}
    fn log(&self, _line: &str) {}
}

fn chrono_like_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[async_trait]
impl Deployer for VlessRealityDeployer {
    fn protocol_id(&self) -> ProtocolId {
        ProtocolId::VlessReality
    }

    fn validate_os(&self, os: &OsInfo) -> AppResult<()> {
        let distro = os.distro.to_ascii_lowercase();
        if distro == "debian" || distro == "ubuntu" {
            Ok(())
        } else {
            Err(AppError::UnsupportedOs(format!(
                "{} {}",
                os.distro, os.version
            )))
        }
    }

    async fn install(
        &self,
        ssh: &SshSession,
        params: &DeployParams,
        progress: &dyn ProgressSink,
    ) -> AppResult<NodeRecord> {
        let credential = params
            .credential
            .as_ref()
            .ok_or_else(|| AppError::Other("missing resolved VPS credential".to_string()))?;
        let os = detect_os(ssh).await?;
        self.validate_os(&os)?;

        run_script(ssh, "prepare", PREPARE, &[], progress).await?;
        let legacy_ownership_hash = params.legacy_ownership_hash.as_deref().unwrap_or("");
        run_script(
            ssh,
            "install",
            INSTALL_XRAY,
            &[os.arch.as_str(), legacy_ownership_hash],
            progress,
        )
        .await?;

        let sni = validated_sni(params.sni.as_deref(), "www.microsoft.com")?;
        let port_arg = params.port.to_string();
        run_script(
            ssh,
            "firewall",
            SETUP_FIREWALL,
            &["tcp", port_arg.as_str()],
            progress,
        )
        .await?;

        let configure_output = run_script(
            ssh,
            "configure",
            CONFIGURE_VLESS_REALITY,
            &[port_arg.as_str(), sni.as_str()],
            progress,
        )
        .await?;

        let results = parse_results(&configure_output);
        let required_result = |key: &str| {
            results
                .get(key)
                .filter(|value| !value.trim().is_empty())
                .cloned()
                .ok_or_else(|| AppError::DeployStepFailed {
                    step: "configure".to_string(),
                    message: format!("configure script did not return a non-empty {key}"),
                })
        };
        let uuid = required_result("uuid")?;
        let public_key = required_result("public_key")?;
        let short_id = required_result("short_id")?;
        let flow = results
            .get("flow")
            .cloned()
            .unwrap_or_else(|| "xtls-rprx-vision".to_string());
        let spider_x = results
            .get("spider_x")
            .cloned()
            .unwrap_or_else(|| "/".to_string());

        Ok(NodeRecord {
            id: uuid::Uuid::new_v4().to_string(),
            vps_id: String::new(),
            vps_name: String::new(),
            name: params.node_name.clone(),
            host: credential.host.clone(),
            ssh_port: credential.port,
            ssh_user: credential.user.clone(),
            protocol: ProtocolId::VlessReality,
            protocol_params: json!({
                "uuid": uuid,
                "port": params.port,
                "sni": sni,
                "flow": flow,
                "spider_x": spider_x,
                "public_key": public_key,
                "short_id": short_id,
            }),
            status: "active".to_string(),
            created_at: chrono_like_now(),
        })
    }

    async fn uninstall(&self, ssh: &SshSession, node: &NodeRecord) -> AppResult<()> {
        let legacy_ownership_hash = ownership_secret_hash(node).unwrap_or_default();
        run_script(
            ssh,
            "uninstall_xray",
            UNINSTALL_XRAY,
            &[legacy_ownership_hash.as_str()],
            &NoopProgress,
        )
        .await?;
        Ok(())
    }
}
