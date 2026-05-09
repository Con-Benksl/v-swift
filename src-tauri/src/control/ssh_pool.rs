use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::ssh::{SshSession, VpsCredential};
use crate::storage::{Storage, VpsProfileRecord};

use super::ConnectionStatus;

pub struct SshPool {
    sessions: Mutex<HashMap<String, Arc<SshSession>>>,
    statuses: Mutex<HashMap<String, ConnectionStatus>>,
}

impl SshPool {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            statuses: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_or_connect(
        &self,
        vps_id: &str,
        storage: &Storage,
    ) -> AppResult<Arc<SshSession>> {
        {
            let sessions = self.sessions.lock().await;
            if let Some(session) = sessions.get(vps_id) {
                return Ok(Arc::clone(session));
            }
        }

        {
            let mut statuses = self.statuses.lock().await;
            statuses.insert(vps_id.to_string(), ConnectionStatus::Connecting);
        }

        let profile = storage.get_vps_profile(vps_id)?;
        let credential = build_credential(&profile)?;

        let session = match SshSession::connect(&credential).await {
            Ok(s) => {
                let mut statuses = self.statuses.lock().await;
                statuses.insert(vps_id.to_string(), ConnectionStatus::Connected);
                Arc::new(s)
            }
            Err(err) => {
                let mut statuses = self.statuses.lock().await;
                statuses.insert(
                    vps_id.to_string(),
                    ConnectionStatus::Error { message: err.to_string() },
                );
                return Err(err);
            }
        };

        let mut sessions = self.sessions.lock().await;
        sessions.insert(vps_id.to_string(), Arc::clone(&session));

        Ok(session)
    }

    pub async fn disconnect(&self, vps_id: &str) -> AppResult<()> {
        let session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(vps_id)
        };

        if let Some(session) = session {
            session.close().await?;
        }

        let mut statuses = self.statuses.lock().await;
        statuses.insert(vps_id.to_string(), ConnectionStatus::Disconnected);

        Ok(())
    }

    pub async fn disconnect_all(&self) -> AppResult<()> {
        let sessions: Vec<_> = {
            let mut sessions_guard = self.sessions.lock().await;
            sessions_guard.drain().map(|(_, v)| v).collect()
        };

        for session in sessions {
            if let Err(err) = session.close().await {
                log::warn!("disconnect_all: failed to close session: {err}");
            }
        }

        let mut statuses = self.statuses.lock().await;
        for key in statuses.keys() {
            statuses.insert(key.clone(), ConnectionStatus::Disconnected);
        }

        Ok(())
    }

    pub async fn get_status(&self, vps_id: &str) -> ConnectionStatus {
        let statuses = self.statuses.lock().await;
        statuses
            .get(vps_id)
            .cloned()
            .unwrap_or(ConnectionStatus::Disconnected)
    }
}

impl Default for SshPool {
    fn default() -> Self {
        Self::new()
    }
}

fn build_credential(profile: &VpsProfileRecord) -> AppResult<VpsCredential> {
    let auth = match credentials::load_optional(&profile.credential_key)? {
        Some(a) => a,
        None => {
            return Err(AppError::Other(format!(
                "已保存的 VPS「{}」缺少系统安全存储中的登录凭据。请切换到「新建连接」重新输入一次 SSH 信息，程序会自动补回这条凭据。",
                profile.name
            )));
        }
    };

    Ok(VpsCredential {
        host: profile.host.clone(),
        port: profile.ssh_port,
        user: profile.ssh_user.clone(),
        auth,
    })
}
