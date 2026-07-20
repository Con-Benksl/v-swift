use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock, RwLockWriteGuard};

use crate::credentials;
use crate::error::{AppError, AppResult};
use crate::ssh::{SshSession, VpsCredential};
use crate::storage::{Storage, VpsProfileRecord};

use super::ConnectionStatus;

pub struct SshPool {
    sessions: Mutex<HashMap<String, Arc<SshSession>>>,
    statuses: Mutex<HashMap<String, ConnectionStatus>>,
    connect_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    connection_barrier: RwLock<()>,
}

impl SshPool {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            statuses: Mutex::new(HashMap::new()),
            connect_locks: Mutex::new(HashMap::new()),
            connection_barrier: RwLock::new(()),
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

        // 常规 VPS 可并行建连；同一 VPS 通过 keyed single-flight 去重。
        // host 更新会取得 barrier 写锁，在本地档案提交前阻止任何新连接读取旧 host。
        let _barrier_guard = self.connection_barrier.read().await;
        let connect_lock = {
            let mut locks = self.connect_locks.lock().await;
            Arc::clone(
                locks
                    .entry(vps_id.to_string())
                    .or_insert_with(|| Arc::new(Mutex::new(()))),
            )
        };
        let _connect_guard = connect_lock.lock().await;
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

        let connection_result = async {
            let profile = storage.get_vps_profile(vps_id)?;
            let credential = build_credential(&profile)?;
            SshSession::connect(&credential).await.map(Arc::new)
        }
        .await;

        let session = match connection_result {
            Ok(s) => {
                let mut statuses = self.statuses.lock().await;
                statuses.insert(vps_id.to_string(), ConnectionStatus::Connected);
                s
            }
            Err(err) => {
                let mut statuses = self.statuses.lock().await;
                statuses.insert(
                    vps_id.to_string(),
                    ConnectionStatus::Error {
                        message: err.to_string(),
                    },
                );
                return Err(err);
            }
        };

        let mut sessions = self.sessions.lock().await;
        sessions.insert(vps_id.to_string(), Arc::clone(&session));

        Ok(session)
    }

    /// 在档案连接信息变更期间阻止任何新的池化连接读取旧档案。
    pub(crate) async fn lock_new_connections(&self) -> RwLockWriteGuard<'_, ()> {
        self.connection_barrier.write().await
    }

    pub async fn disconnect(&self, vps_id: &str) -> AppResult<()> {
        let session = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(vps_id)
        };

        if let Some(session) = session {
            close_session(session).await?;
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
            if let Err(err) = close_session(session).await {
                log::warn!("disconnect_all: failed to close session: {err}");
            }
        }

        let mut statuses = self.statuses.lock().await;
        for status in statuses.values_mut() {
            *status = ConnectionStatus::Disconnected;
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

async fn close_session(session: Arc<SshSession>) -> AppResult<()> {
    match Arc::try_unwrap(session) {
        Ok(session) => session.close().await,
        Err(session) => {
            drop(session);
            Ok(())
        }
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
        host_key_aliases: Vec::new(),
    })
}
