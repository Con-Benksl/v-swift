use async_trait::async_trait;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};
use crate::scripts::{
    CONFIGURE_HYSTERIA2, INSTALL_HYSTERIA2, PREPARE, SETUP_FIREWALL, UNINSTALL_HYSTERIA2,
};
use crate::ssh::SshSession;

use super::{
    detect_os, ownership_secret_hash, parse_results, run_script, validated_sni, DeployParams,
    Deployer, NodeRecord, OsInfo, ProgressSink, ProtocolId,
};

pub struct Hysteria2Deployer;

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
impl Deployer for Hysteria2Deployer {
    fn protocol_id(&self) -> ProtocolId {
        ProtocolId::Hysteria2
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
            INSTALL_HYSTERIA2,
            &[os.arch.as_str(), legacy_ownership_hash],
            progress,
        )
        .await?;

        let sni = validated_sni(params.sni.as_deref(), "www.bing.com")?;
        let port_arg = params.port.to_string();
        run_script(
            ssh,
            "firewall",
            SETUP_FIREWALL,
            &["udp", port_arg.as_str()],
            progress,
        )
        .await?;

        let configure_output = run_script(
            ssh,
            "configure",
            CONFIGURE_HYSTERIA2,
            &[port_arg.as_str(), sni.as_str()],
            progress,
        )
        .await?;

        let results = parse_results(&configure_output);
        let password = results
            .get("password")
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .ok_or_else(|| AppError::DeployStepFailed {
                step: "configure".to_string(),
                message: "configure script did not return a non-empty password".to_string(),
            })?;
        let port = results
            .get("port")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(params.port);
        let result_sni = results.get("sni").cloned().unwrap_or_else(|| sni.clone());
        let insecure = results
            .get("insecure")
            .map(|value| matches!(value.as_str(), "true" | "1" | "yes"))
            .unwrap_or(false);

        Ok(NodeRecord {
            id: uuid::Uuid::new_v4().to_string(),
            vps_id: String::new(),
            vps_name: String::new(),
            name: params.node_name.clone(),
            host: credential.host.clone(),
            ssh_port: credential.port,
            ssh_user: credential.user.clone(),
            protocol: ProtocolId::Hysteria2,
            protocol_params: json!({
                "password": password,
                "port": port,
                "sni": result_sni,
                "insecure": insecure,
            }),
            status: "active".to_string(),
            created_at: chrono_like_now(),
        })
    }

    async fn uninstall(&self, ssh: &SshSession, node: &NodeRecord) -> AppResult<()> {
        let legacy_ownership_hash = ownership_secret_hash(node).unwrap_or_default();
        run_script(
            ssh,
            "uninstall_hysteria2",
            UNINSTALL_HYSTERIA2,
            &[legacy_ownership_hash.as_str()],
            &NoopProgress,
        )
        .await?;
        Ok(())
    }
}
