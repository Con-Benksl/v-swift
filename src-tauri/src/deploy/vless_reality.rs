use async_trait::async_trait;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};
use crate::scripts::{
    CONFIGURE_VLESS_REALITY, INSTALL_XRAY, PREPARE, SETUP_FIREWALL, UNINSTALL_XRAY,
};
use crate::ssh::SshSession;

use super::{
    detect_os, parse_results, run_script, DeployParams, Deployer, NodeRecord, OsInfo,
    ProgressSink, ProtocolId,
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

        run_script(ssh, "prepare", PREPARE, "", progress).await?;
        run_script(ssh, "install", INSTALL_XRAY, &os.arch, progress).await?;

        let sni = params
            .sni
            .clone()
            .unwrap_or_else(|| "www.microsoft.com".to_string());
        let configure_args = format!("{} {}", params.port, sni);
        let configure_output = run_script(
            ssh,
            "configure",
            CONFIGURE_VLESS_REALITY,
            &configure_args,
            progress,
        )
        .await?;

        run_script(
            ssh,
            "firewall",
            SETUP_FIREWALL,
            &format!("tcp {}", params.port),
            progress,
        )
        .await?;

        let results = parse_results(&configure_output);
        let uuid = results.get("uuid").cloned().unwrap_or_default();
        let public_key = results.get("public_key").cloned().unwrap_or_default();
        let short_id = results.get("short_id").cloned().unwrap_or_default();
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

    async fn uninstall(&self, ssh: &SshSession, _node: &NodeRecord) -> AppResult<()> {
        run_script(ssh, "uninstall_xray", UNINSTALL_XRAY, "", &NoopProgress).await?;
        Ok(())
    }
}
