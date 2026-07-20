use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::OptionalExtension;

use crate::deploy::{NodeRecord, ProtocolId, VpsProfileSummary};
use crate::error::{AppError, AppResult};
use crate::ssh::canonicalize_host;

#[derive(Debug, Clone)]
pub struct VpsProfileRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub credential_key: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct DeploymentAttemptRecord {
    pub id: String,
    pub profile: VpsProfileRecord,
    pub protocol: ProtocolId,
    pub phase: String,
    pub had_previous_credential: bool,
    pub should_restore_credential: bool,
    pub created_at: i64,
}

pub struct Storage {
    pub conn: Mutex<rusqlite::Connection>,
}

impl Storage {
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn =
            rusqlite::Connection::open(path).map_err(|e| AppError::Storage(e.to_string()))?;
        let storage = Self {
            conn: Mutex::new(conn),
        };
        storage.migrations()?;
        Ok(storage)
    }

    pub fn begin_deployment_attempt(&self, attempt: &DeploymentAttemptRecord) -> AppResult<()> {
        let protocol = serde_json::to_string(&attempt.protocol)
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.execute(
            "INSERT INTO deployment_attempts (
                id, profile_id, profile_name, host, ssh_port, ssh_user, credential_key,
                protocol, phase, had_previous_credential, should_restore_credential, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                &attempt.id,
                &attempt.profile.id,
                &attempt.profile.name,
                &attempt.profile.host,
                i64::from(attempt.profile.ssh_port),
                &attempt.profile.ssh_user,
                &attempt.profile.credential_key,
                protocol,
                &attempt.phase,
                i64::from(attempt.had_previous_credential),
                i64::from(attempt.should_restore_credential),
                attempt.created_at,
            ],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn transition_deployment_attempt_phase(
        &self,
        id: &str,
        expected_phase: &str,
        next_phase: &str,
    ) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let changed = conn
            .execute(
                "UPDATE deployment_attempts
                 SET phase = ?3
                 WHERE id = ?1 AND phase = ?2",
                rusqlite::params![id, expected_phase, next_phase],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        if changed != 1 {
            let current = conn
                .query_row(
                    "SELECT phase FROM deployment_attempts WHERE id = ?1",
                    [id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| AppError::Storage(e.to_string()))?;
            return Err(AppError::Storage(format!(
                "deployment attempt phase transition refused for {id}: expected {expected_phase}, current {}",
                current.as_deref().unwrap_or("missing")
            )));
        }
        Ok(())
    }

    pub fn get_deployment_attempt_phase(&self, id: &str) -> AppResult<Option<String>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.query_row(
            "SELECT phase FROM deployment_attempts WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| AppError::Storage(e.to_string()))
    }

    /// Persist a fresh durability barrier before a committed remote snapshot may be discarded.
    /// The counter must change on every retry: a prior confirmation COMMIT may itself have
    /// returned an indeterminate I/O error, so merely observing the confirmed phase is not enough.
    pub fn confirm_deployment_commit(&self, id: &str) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let changed = conn
            .execute(
                "UPDATE deployment_attempts
                 SET phase = 'local_commit_confirmed',
                     confirmation_epoch = confirmation_epoch + 1
                 WHERE id = ?1
                   AND phase IN ('local_committed', 'local_commit_confirmed')",
                [id],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        if changed != 1 {
            return Err(AppError::Storage(format!(
                "deployment attempt cannot be durably confirmed: {id}"
            )));
        }
        Ok(())
    }

    #[cfg(test)]
    fn get_deployment_confirmation_epoch(&self, id: &str) -> AppResult<i64> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.query_row(
            "SELECT confirmation_epoch FROM deployment_attempts WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Storage(e.to_string()))
    }

    pub fn list_deployment_attempts(&self) -> AppResult<Vec<DeploymentAttemptRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT
                    id, profile_id, profile_name, host, ssh_port, ssh_user, credential_key,
                    protocol, phase, had_previous_credential, should_restore_credential, created_at
                 FROM deployment_attempts
                 ORDER BY created_at ASC",
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map([], map_deployment_attempt_row)
            .map_err(|e| AppError::Storage(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Storage(e.to_string()))
    }

    pub fn delete_deployment_attempt(&self, id: &str) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.execute("DELETE FROM deployment_attempts WHERE id = ?1", [id])
            .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn upsert_vps_profile(&self, profile: &VpsProfileRecord) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        conn.execute(
            "INSERT INTO vps_profiles (
                id, name, host, ssh_port, ssh_user, credential_key, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                host = excluded.host,
                ssh_port = excluded.ssh_port,
                ssh_user = excluded.ssh_user,
                credential_key = excluded.credential_key",
            rusqlite::params![
                &profile.id,
                &profile.name,
                &profile.host,
                i64::from(profile.ssh_port),
                &profile.ssh_user,
                &profile.credential_key,
                profile.created_at,
            ],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

        Ok(())
    }

    pub fn get_vps_profile(&self, id: &str) -> AppResult<VpsProfileRecord> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        conn.query_row(
            "SELECT id, name, host, ssh_port, ssh_user, credential_key, created_at
             FROM vps_profiles
             WHERE id = ?1",
            [id],
            map_vps_profile_row,
        )
        .map_err(|e| AppError::Storage(e.to_string()))
    }

    pub fn find_vps_profile_by_connection(
        &self,
        host: &str,
        ssh_port: u16,
        ssh_user: &str,
    ) -> AppResult<Option<VpsProfileRecord>> {
        let canonical_host = canonicalize_host(host)?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, name, host, ssh_port, ssh_user, credential_key, created_at
                 FROM vps_profiles
                 WHERE ssh_port = ?1 AND ssh_user = ?2",
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut rows = stmt
            .query(rusqlite::params![i64::from(ssh_port), ssh_user])
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut matched_profile = None;
        while let Some(row) = rows.next().map_err(|e| AppError::Storage(e.to_string()))? {
            let profile = map_vps_profile_row(row).map_err(|e| AppError::Storage(e.to_string()))?;
            if canonicalize_host(&profile.host)? == canonical_host {
                if matched_profile.is_some() {
                    return Err(ambiguous_profile_identity_error(
                        &canonical_host,
                        ssh_port,
                        ssh_user,
                    ));
                }
                matched_profile = Some(profile);
            }
        }
        Ok(matched_profile)
    }

    pub fn update_vps_profile_host(&self, id: &str, host: &str) -> AppResult<()> {
        self.update_vps_profile_host_and_nodes(id, host, &[])
    }

    /// 原子更新 VPS host、所有关联节点 host，以及已在远端刷新完成的托管订阅元数据。
    pub fn update_vps_profile_host_and_nodes(
        &self,
        id: &str,
        host: &str,
        refreshed_nodes: &[NodeRecord],
    ) -> AppResult<()> {
        let refreshed_params = refreshed_nodes
            .iter()
            .map(|node| {
                serde_json::to_string(&node.protocol_params)
                    .map(|params| (node.id.clone(), params))
                    .map_err(|e| AppError::Storage(e.to_string()))
            })
            .collect::<AppResult<HashMap<_, _>>>()?;
        let mut conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let changed = tx
            .execute(
                "UPDATE vps_profiles SET host = ?2 WHERE id = ?1",
                rusqlite::params![id, host],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;

        if changed == 0 {
            return Err(AppError::Storage(format!("VPS profile not found: {id}")));
        }

        let nodes = {
            let mut stmt = tx
                .prepare(
                    "SELECT id, protocol_params
                     FROM nodes
                     WHERE vps_id = ?1",
                )
                .map_err(|e| AppError::Storage(e.to_string()))?;

            let rows = stmt
                .query_map([id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| AppError::Storage(e.to_string()))?;

            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::Storage(e.to_string()))?
        };

        for (node_id, stored_protocol_params) in nodes {
            let protocol_params = refreshed_params
                .get(&node_id)
                .map(String::as_str)
                .unwrap_or(&stored_protocol_params);
            let mut params: serde_json::Value = serde_json::from_str(protocol_params)
                .map_err(|e| AppError::Storage(e.to_string()))?;
            sync_managed_subscription_host(&mut params, host);
            let params =
                serde_json::to_string(&params).map_err(|e| AppError::Storage(e.to_string()))?;

            tx.execute(
                "UPDATE nodes SET host = ?2, protocol_params = ?3 WHERE id = ?1",
                rusqlite::params![node_id, host, params],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }

        tx.commit().map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn list_vps_profiles(&self) -> AppResult<Vec<VpsProfileSummary>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT
                    p.id,
                    p.name,
                    p.host,
                    p.ssh_port,
                    p.ssh_user,
                    p.created_at,
                    COUNT(n.id) AS node_count
                 FROM vps_profiles p
                 LEFT JOIN nodes n ON n.vps_id = p.id
                 GROUP BY p.id, p.name, p.host, p.ssh_port, p.ssh_user, p.created_at
                 ORDER BY p.created_at DESC",
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], map_vps_profile_summary_row)
            .map_err(|e| AppError::Storage(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Storage(e.to_string()))
    }

    pub fn insert(&self, node: &NodeRecord) -> AppResult<()> {
        let protocol =
            serde_json::to_string(&node.protocol).map_err(|e| AppError::Storage(e.to_string()))?;
        let protocol_params = serde_json::to_string(&node.protocol_params)
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        conn.execute(
            "INSERT INTO nodes (
                id, vps_id, name, host, ssh_port, ssh_user, credential_key,
                protocol, protocol_params, status, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            // NOTE: the `credential_key` column is deprecated; we now key credentials off vps_id via the
            // vps_profiles table. Kept for schema compatibility; written as vps_id to avoid empty strings.
            rusqlite::params![
                &node.id,
                &node.vps_id,
                &node.name,
                &node.host,
                i64::from(node.ssh_port),
                &node.ssh_user,
                &node.vps_id,
                protocol,
                protocol_params,
                &node.status,
                node.created_at
            ],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

        Ok(())
    }

    /// 原子提交一次协议部署、替换同 VPS/协议的旧记录，并保留待远端 finalize 的日志。
    pub fn commit_deployment(
        &self,
        profile: &VpsProfileRecord,
        node: &NodeRecord,
        attempt_id: &str,
    ) -> AppResult<usize> {
        let protocol =
            serde_json::to_string(&node.protocol).map_err(|e| AppError::Storage(e.to_string()))?;
        let protocol_params = serde_json::to_string(&node.protocol_params)
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        tx.execute(
            "INSERT INTO vps_profiles (
                id, name, host, ssh_port, ssh_user, credential_key, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                host = excluded.host,
                ssh_port = excluded.ssh_port,
                ssh_user = excluded.ssh_user,
                credential_key = excluded.credential_key",
            rusqlite::params![
                &profile.id,
                &profile.name,
                &profile.host,
                i64::from(profile.ssh_port),
                &profile.ssh_user,
                &profile.credential_key,
                profile.created_at,
            ],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

        tx.execute(
            "INSERT INTO nodes (
                id, vps_id, name, host, ssh_port, ssh_user, credential_key,
                protocol, protocol_params, status, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                &node.id,
                &node.vps_id,
                &node.name,
                &node.host,
                i64::from(node.ssh_port),
                &node.ssh_user,
                &node.vps_id,
                &protocol,
                &protocol_params,
                &node.status,
                node.created_at,
            ],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

        let replaced = tx
            .execute(
                "DELETE FROM nodes
                 WHERE vps_id = ?1 AND protocol = ?2 AND id <> ?3",
                rusqlite::params![&node.vps_id, &protocol, &node.id],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let committed_attempts = tx
            .execute(
                "UPDATE deployment_attempts
                 SET phase = 'local_committed'
                 WHERE id = ?1
                   AND profile_id = ?2
                   AND protocol = ?3
                   AND phase = 'remote_starting'",
                rusqlite::params![attempt_id, &profile.id, &protocol],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        if committed_attempts != 1 {
            return Err(AppError::Storage(format!(
                "deployment attempt not found or not ready during commit: {attempt_id}"
            )));
        }

        tx.commit().map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(replaced)
    }

    pub fn list(&self) -> AppResult<Vec<NodeRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT
                    n.id,
                    n.vps_id,
                    COALESCE(p.name, n.host) AS vps_name,
                    n.name,
                    n.host,
                    n.ssh_port,
                    n.ssh_user,
                    n.protocol,
                    n.protocol_params,
                    n.status,
                    n.created_at
                 FROM nodes n
                 LEFT JOIN vps_profiles p ON p.id = n.vps_id
                 ORDER BY n.created_at DESC",
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], map_node_row)
            .map_err(|e| AppError::Storage(e.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Storage(e.to_string()))
    }

    pub fn get(&self, id: &str) -> AppResult<NodeRecord> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.query_row(
            "SELECT
                n.id,
                n.vps_id,
                COALESCE(p.name, n.host) AS vps_name,
                n.name,
                n.host,
                n.ssh_port,
                n.ssh_user,
                n.protocol,
                n.protocol_params,
                n.status,
                n.created_at
             FROM nodes n
             LEFT JOIN vps_profiles p ON p.id = n.vps_id
             WHERE n.id = ?1",
            [id],
            map_node_row,
        )
        .map_err(|e| AppError::Storage(e.to_string()))
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.execute("DELETE FROM nodes WHERE id = ?1", [id])
            .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn update_node_status(&self, id: &str, status: &str) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.execute(
            "UPDATE nodes SET status = ?2 WHERE id = ?1",
            rusqlite::params![id, status],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn update_node_protocol_params(
        &self,
        id: &str,
        protocol_params: &serde_json::Value,
    ) -> AppResult<()> {
        let protocol_params =
            serde_json::to_string(protocol_params).map_err(|e| AppError::Storage(e.to_string()))?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.execute(
            "UPDATE nodes SET protocol_params = ?2 WHERE id = ?1",
            rusqlite::params![id, protocol_params],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn update_nodes_protocol_params(&self, nodes: &[NodeRecord]) -> AppResult<()> {
        let serialized = nodes
            .iter()
            .map(|node| {
                serde_json::to_string(&node.protocol_params)
                    .map(|params| (node.id.as_str(), params))
                    .map_err(|e| AppError::Storage(e.to_string()))
            })
            .collect::<AppResult<Vec<_>>>()?;
        let mut conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        for (node_id, protocol_params) in serialized {
            let changed = tx
                .execute(
                    "UPDATE nodes SET protocol_params = ?2 WHERE id = ?1",
                    rusqlite::params![node_id, protocol_params],
                )
                .map_err(|e| AppError::Storage(e.to_string()))?;
            if changed == 0 {
                return Err(AppError::Storage(format!("node not found: {node_id}")));
            }
        }

        tx.commit().map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub fn delete_vps_profile(&self, id: &str) -> AppResult<()> {
        self.delete_vps_profiles(&[id.to_string()])
    }

    pub fn delete_vps_profiles(&self, ids: &[String]) -> AppResult<()> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        for id in ids {
            tx.execute("DELETE FROM nodes WHERE vps_id = ?1", [id])
                .map_err(|e| AppError::Storage(e.to_string()))?;
            tx.execute("DELETE FROM vps_profiles WHERE id = ?1", [id])
                .map_err(|e| AppError::Storage(e.to_string()))?;
        }

        tx.commit().map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    fn migrations(&self) -> AppResult<()> {
        let migrations = [
            r#"
                CREATE TABLE IF NOT EXISTS nodes (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  host TEXT NOT NULL,
                  ssh_port INTEGER NOT NULL,
                  ssh_user TEXT NOT NULL,
                  credential_key TEXT NOT NULL,
                  protocol TEXT NOT NULL,
                  protocol_params TEXT NOT NULL,
                  status TEXT NOT NULL,
                  created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes(created_at DESC);
            "#,
            r#"
                CREATE TABLE IF NOT EXISTS vps_profiles (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  host TEXT NOT NULL,
                  ssh_port INTEGER NOT NULL,
                  ssh_user TEXT NOT NULL,
                  credential_key TEXT NOT NULL,
                  created_at INTEGER NOT NULL
                );
                ALTER TABLE nodes ADD COLUMN vps_id TEXT;
                CREATE INDEX IF NOT EXISTS idx_nodes_vps_id ON nodes(vps_id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_vps_profiles_identity
                  ON vps_profiles(host, ssh_port, ssh_user);
            "#,
            r#"
                CREATE TABLE IF NOT EXISTS deployment_attempts (
                  id TEXT PRIMARY KEY,
                  profile_id TEXT NOT NULL,
                  profile_name TEXT NOT NULL,
                  host TEXT NOT NULL,
                  ssh_port INTEGER NOT NULL,
                  ssh_user TEXT NOT NULL,
                  credential_key TEXT NOT NULL,
                  protocol TEXT NOT NULL,
                  phase TEXT NOT NULL,
                  had_previous_credential INTEGER NOT NULL,
                  should_restore_credential INTEGER NOT NULL,
                  created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_deployment_attempts_created_at
                  ON deployment_attempts(created_at ASC);
            "#,
            r#"
                ALTER TABLE deployment_attempts
                  ADD COLUMN confirmation_epoch INTEGER NOT NULL DEFAULT 0;
            "#,
        ];

        let mut conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let version: i64 = tx
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| AppError::Storage(e.to_string()))?;

        for (idx, migration) in migrations.iter().enumerate().skip(version as usize) {
            // Repair the only schema shape that an unreleased pre-atomic v4 build could leave:
            // the column was committed but user_version was not. Released upgrades execute the
            // ALTER and version bump in this same transaction.
            if idx == 3 && deployment_confirmation_column_exists(&tx)? {
                tx.pragma_update(None, "user_version", (idx + 1) as i64)
                    .map_err(|e| AppError::Storage(e.to_string()))?;
                continue;
            }
            tx.execute_batch(migration)
                .map_err(|e| AppError::Storage(e.to_string()))?;
            tx.pragma_update(None, "user_version", (idx + 1) as i64)
                .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        tx.commit().map_err(|e| AppError::Storage(e.to_string()))?;
        drop(conn);

        self.backfill_vps_profiles()?;

        Ok(())
    }

    fn backfill_vps_profiles(&self) -> AppResult<()> {
        #[derive(Debug)]
        struct LegacyNode {
            id: String,
            host: String,
            ssh_port: u16,
            ssh_user: String,
            credential_key: String,
            created_at: i64,
            vps_id: Option<String>,
        }

        let mut conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut stmt = tx
            .prepare(
                "SELECT id, host, ssh_port, ssh_user, credential_key, created_at, vps_id
                 FROM nodes
                 ORDER BY created_at ASC",
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| {
                let ssh_port: i64 = row.get(2)?;
                Ok(LegacyNode {
                    id: row.get(0)?,
                    host: row.get(1)?,
                    ssh_port: ssh_port as u16,
                    ssh_user: row.get(3)?,
                    credential_key: row.get(4)?,
                    created_at: row.get(5)?,
                    vps_id: row.get(6)?,
                })
            })
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let legacy_nodes = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut profile_by_identity: HashMap<(String, u16, String), String> = HashMap::new();

        for node in legacy_nodes {
            let referenced_profile_id = node
                .vps_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if let Some(profile_id) = referenced_profile_id {
                let profile_exists: i64 = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM vps_profiles WHERE id = ?1)",
                        [profile_id],
                        |row| row.get(0),
                    )
                    .map_err(|e| AppError::Storage(e.to_string()))?;
                if profile_exists != 0 {
                    if node.vps_id.as_deref() != Some(profile_id) {
                        tx.execute(
                            "UPDATE nodes SET vps_id = ?2 WHERE id = ?1",
                            rusqlite::params![&node.id, profile_id],
                        )
                        .map_err(|e| AppError::Storage(e.to_string()))?;
                    }
                    continue;
                }
            }

            let canonical_host = canonicalize_host(&node.host)?;
            let identity = (canonical_host, node.ssh_port, node.ssh_user.clone());
            let profile_id = if let Some(existing) = profile_by_identity.get(&identity) {
                existing.clone()
            } else if let Some(existing) =
                find_profile_id_by_identity(&tx, &node.host, node.ssh_port, &node.ssh_user)?
            {
                profile_by_identity.insert(identity.clone(), existing.clone());
                existing
            } else {
                let new_id = node
                    .vps_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                tx.execute(
                    "INSERT INTO vps_profiles (
                        id, name, host, ssh_port, ssh_user, credential_key, created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        &new_id,
                        &node.host,
                        &node.host,
                        i64::from(node.ssh_port),
                        &node.ssh_user,
                        if node.credential_key.trim().is_empty() {
                            &node.id
                        } else {
                            &node.credential_key
                        },
                        node.created_at,
                    ],
                )
                .map_err(|e| AppError::Storage(e.to_string()))?;
                profile_by_identity.insert(identity, new_id.clone());
                new_id
            };

            if node.vps_id.as_deref().map(str::trim) != Some(profile_id.as_str()) {
                tx.execute(
                    "UPDATE nodes SET vps_id = ?2 WHERE id = ?1",
                    rusqlite::params![&node.id, &profile_id],
                )
                .map_err(|e| AppError::Storage(e.to_string()))?;
            }
        }

        drop(stmt);
        tx.commit().map_err(|e| AppError::Storage(e.to_string()))
    }
}

fn deployment_confirmation_column_exists(conn: &rusqlite::Connection) -> AppResult<bool> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(deployment_attempts)")
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| AppError::Storage(e.to_string()))?;
    for name in names {
        if name.map_err(|e| AppError::Storage(e.to_string()))? == "confirmation_epoch" {
            return Ok(true);
        }
    }
    Ok(false)
}

fn find_profile_id_by_identity(
    conn: &rusqlite::Connection,
    host: &str,
    ssh_port: u16,
    ssh_user: &str,
) -> AppResult<Option<String>> {
    let canonical_host = canonicalize_host(host)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, host
             FROM vps_profiles
             WHERE ssh_port = ?1 AND ssh_user = ?2",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut rows = stmt
        .query(rusqlite::params![i64::from(ssh_port), ssh_user])
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut matched_id = None;
    while let Some(row) = rows.next().map_err(|e| AppError::Storage(e.to_string()))? {
        let id: String = row.get(0).map_err(|e| AppError::Storage(e.to_string()))?;
        let stored_host: String = row.get(1).map_err(|e| AppError::Storage(e.to_string()))?;
        if canonicalize_host(&stored_host)? == canonical_host {
            if matched_id.is_some() {
                return Err(ambiguous_profile_identity_error(
                    &canonical_host,
                    ssh_port,
                    ssh_user,
                ));
            }
            matched_id = Some(id);
        }
    }
    Ok(matched_id)
}

fn ambiguous_profile_identity_error(
    canonical_host: &str,
    ssh_port: u16,
    ssh_user: &str,
) -> AppError {
    AppError::Storage(format!(
        "multiple VPS profiles match canonical SSH identity {ssh_user}@{canonical_host}:{ssh_port}"
    ))
}

fn map_vps_profile_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VpsProfileRecord> {
    let ssh_port: i64 = row.get(3)?;
    let created_at: i64 = row.get(6)?;

    Ok(VpsProfileRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        ssh_port: ssh_port as u16,
        ssh_user: row.get(4)?,
        credential_key: row.get(5)?,
        created_at: normalize_timestamp(created_at),
    })
}

fn map_vps_profile_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VpsProfileSummary> {
    let ssh_port: i64 = row.get(3)?;
    let created_at: i64 = row.get(5)?;

    Ok(VpsProfileSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        ssh_port: ssh_port as u16,
        ssh_user: row.get(4)?,
        created_at: normalize_timestamp(created_at),
        node_count: row.get(6)?,
        credential_available: false,
    })
}

fn map_deployment_attempt_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<DeploymentAttemptRecord> {
    let ssh_port: i64 = row.get(4)?;
    let protocol: String = row.get(7)?;
    let had_previous_credential: i64 = row.get(9)?;
    let should_restore_credential: i64 = row.get(10)?;
    let created_at: i64 = row.get(11)?;

    Ok(DeploymentAttemptRecord {
        id: row.get(0)?,
        profile: VpsProfileRecord {
            id: row.get(1)?,
            name: row.get(2)?,
            host: row.get(3)?,
            ssh_port: ssh_port as u16,
            ssh_user: row.get(5)?,
            credential_key: row.get(6)?,
            created_at: normalize_timestamp(created_at),
        },
        protocol: serde_json::from_str(&protocol).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e))
        })?,
        phase: row.get(8)?,
        had_previous_credential: had_previous_credential != 0,
        should_restore_credential: should_restore_credential != 0,
        created_at: normalize_timestamp(created_at),
    })
}

fn map_node_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NodeRecord> {
    let ssh_port: i64 = row.get(5)?;
    let protocol: String = row.get(7)?;
    let protocol_params: String = row.get(8)?;
    let created_at: i64 = row.get(10)?;

    Ok(NodeRecord {
        id: row.get(0)?,
        vps_id: row.get(1)?,
        vps_name: row.get(2)?,
        name: row.get(3)?,
        host: row.get(4)?,
        ssh_port: ssh_port as u16,
        ssh_user: row.get(6)?,
        protocol: serde_json::from_str(&protocol).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e))
        })?,
        protocol_params: serde_json::from_str(&protocol_params).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(e))
        })?,
        status: row.get(9)?,
        created_at: normalize_timestamp(created_at),
    })
}

fn sync_managed_subscription_host(params: &mut serde_json::Value, host: &str) {
    let Some(managed) = params
        .get_mut("managed_subscription")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };

    let Some(port) = managed
        .get("port")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
    else {
        return;
    };

    let Some(token) = managed
        .get("token")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
    else {
        return;
    };

    managed.insert(
        "url".to_string(),
        serde_json::Value::String(build_managed_subscription_url(host, port, token)),
    );
}

fn build_managed_subscription_url(host: &str, port: u16, token: &str) -> String {
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    format!("http://{host}:{port}/sub.yaml?token={token}")
}

fn normalize_timestamp(value: i64) -> i64 {
    if value > 0 && value < 1_000_000_000_000 {
        value.saturating_mul(1000)
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;

    use super::{DeploymentAttemptRecord, Storage, VpsProfileRecord};
    use crate::deploy::{NodeRecord, ProtocolId};

    struct FileCleanupGuard {
        path: std::path::PathBuf,
    }

    impl Drop for FileCleanupGuard {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn test_node(id: &str, vps_id: &str, vps_name: &str, created_at: i64) -> NodeRecord {
        NodeRecord {
            id: id.to_string(),
            vps_id: vps_id.to_string(),
            vps_name: vps_name.to_string(),
            name: format!("node-{id}"),
            host: "1.2.3.4".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            protocol: ProtocolId::VlessReality,
            protocol_params: json!({
                "uuid": "123e4567-e89b-12d3-a456-426614174000",
                "public_key": "pub",
                "short_id": "abcd",
                "port": 443,
                "sni": "example.com"
            }),
            status: "ready".to_string(),
            created_at,
        }
    }

    fn test_profile(id: &str, name: &str) -> VpsProfileRecord {
        VpsProfileRecord {
            id: id.to_string(),
            name: name.to_string(),
            host: "1.2.3.4".to_string(),
            ssh_port: 22,
            ssh_user: "root".to_string(),
            credential_key: id.to_string(),
            created_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn test_migrate_and_insert() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        let storage = Storage::open(&path).expect("open should succeed");
        storage
            .upsert_vps_profile(&test_profile("vps-1", "Tokyo VPS"))
            .expect("profile insert should succeed");
        let node = test_node("node-1", "vps-1", "Tokyo VPS", 1_700_000_000_000);

        storage.insert(&node).expect("insert should succeed");
        let loaded = storage.get("node-1").expect("get should succeed");

        assert_eq!(loaded.id, "node-1");
        assert_eq!(loaded.name, "node-node-1");
        assert_eq!(loaded.vps_id, "vps-1");
        assert_eq!(loaded.vps_name, "Tokyo VPS");
        assert_eq!(loaded.created_at, 1_700_000_000_000);

        storage
            .update_node_status("node-1", "unknown")
            .expect("status update should succeed");
        let updated = storage.get("node-1").expect("get should succeed");
        assert_eq!(updated.status, "unknown");
    }

    #[test]
    fn migration_repairs_confirmation_column_when_version_bump_was_interrupted() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };
        let storage = Storage::open(&path).expect("initial open should succeed");
        {
            let conn = storage.conn.lock().expect("connection lock should succeed");
            assert!(super::deployment_confirmation_column_exists(&conn)
                .expect("column lookup should succeed"));
            conn.pragma_update(None, "user_version", 3_i64)
                .expect("simulate interrupted version bump");
        }
        drop(storage);

        let repaired = Storage::open(&path).expect("partial v4 migration should be repairable");
        let conn = repaired
            .conn
            .lock()
            .expect("connection lock should succeed");
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("version lookup should succeed");
        assert_eq!(version, 4);
    }

    #[test]
    fn test_delete_vps_profile_cascades_nodes() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        let storage = Storage::open(&path).expect("open should succeed");
        storage
            .upsert_vps_profile(&test_profile("vps-1", "Tokyo VPS"))
            .expect("profile insert should succeed");
        storage
            .insert(&test_node(
                "node-1",
                "vps-1",
                "Tokyo VPS",
                1_700_000_000_000,
            ))
            .expect("first insert should succeed");
        storage
            .insert(&test_node(
                "node-2",
                "vps-1",
                "Tokyo VPS",
                1_700_000_010_000,
            ))
            .expect("second insert should succeed");

        assert_eq!(
            storage.list().expect("list should succeed").len(),
            2,
            "two nodes should exist before cascade delete"
        );

        storage
            .delete_vps_profile("vps-1")
            .expect("profile delete should succeed");

        let remaining = storage.list().expect("list should succeed");
        assert!(
            remaining.is_empty(),
            "nodes should be cascade-deleted with their VPS profile, got {remaining:?}"
        );
        assert!(
            storage.get_vps_profile("vps-1").is_err(),
            "VPS profile should no longer exist after delete"
        );
    }

    #[test]
    fn test_open_repairs_version_2_nodes_missing_vps_profile() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        {
            let storage = Storage::open(&path).expect("initial open should create schema");
            let conn = storage
                .conn
                .lock()
                .expect("test connection lock should succeed");
            conn.execute(
                "INSERT INTO nodes (
                    id, vps_id, name, host, ssh_port, ssh_user, credential_key,
                    protocol, protocol_params, status, created_at
                ) VALUES (?1, '', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    "legacy-node",
                    "Legacy Node",
                    "203.0.113.10",
                    2222i64,
                    "root",
                    "legacy-credential-key",
                    serde_json::to_string(&ProtocolId::VlessReality)
                        .expect("protocol should serialize"),
                    json!({
                        "uuid": "123e4567-e89b-12d3-a456-426614174000",
                        "public_key": "pub",
                        "short_id": "abcd",
                        "port": 443,
                        "sni": "example.com"
                    })
                    .to_string(),
                    "unknown",
                    1_700_000_000_000i64,
                ],
            )
            .expect("legacy node insert should succeed");
        }

        let reopened = Storage::open(&path).expect("reopen should repair orphan node");
        let node = reopened.get("legacy-node").expect("node should load");

        assert!(
            !node.vps_id.trim().is_empty(),
            "orphan legacy node should receive a VPS profile id"
        );

        let profile = reopened
            .get_vps_profile(&node.vps_id)
            .expect("repaired VPS profile should exist");
        assert_eq!(profile.name, "203.0.113.10");
        assert_eq!(profile.host, "203.0.113.10");
        assert_eq!(profile.ssh_port, 2222);
        assert_eq!(profile.ssh_user, "root");
        assert_eq!(profile.credential_key, "legacy-credential-key");
    }

    #[test]
    fn test_open_backfills_legacy_nodes_by_canonical_host_port_and_user() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        {
            let storage = Storage::open(&path).expect("initial open should create schema");

            let mut root_profile = test_profile("root-vps", "Root VPS");
            root_profile.host = "Legacy.Example.COM.".to_string();
            root_profile.credential_key = "root-credential-key".to_string();
            storage
                .upsert_vps_profile(&root_profile)
                .expect("root profile insert should succeed");

            let mut admin_profile = test_profile("admin-vps", "Admin VPS");
            admin_profile.host = "legacy.example.com".to_string();
            admin_profile.ssh_user = "admin".to_string();
            admin_profile.credential_key = "admin-credential-key".to_string();
            storage
                .upsert_vps_profile(&admin_profile)
                .expect("admin profile insert should succeed");

            let protocol = serde_json::to_string(&ProtocolId::VlessReality)
                .expect("protocol should serialize");
            let protocol_params = json!({
                "uuid": "123e4567-e89b-12d3-a456-426614174000",
                "public_key": "pub",
                "short_id": "abcd",
                "port": 443,
                "sni": "example.com"
            })
            .to_string();
            let conn = storage
                .conn
                .lock()
                .expect("test connection lock should succeed");

            for (id, host, user, credential_key, created_at) in [
                (
                    "legacy-root-node",
                    "legacy.example.com",
                    "root",
                    "root-credential-key",
                    1_700_000_000_000i64,
                ),
                (
                    "legacy-admin-node",
                    "LEGACY.EXAMPLE.COM.",
                    "admin",
                    "admin-credential-key",
                    1_700_000_010_000i64,
                ),
            ] {
                conn.execute(
                    "INSERT INTO nodes (
                        id, vps_id, name, host, ssh_port, ssh_user, credential_key,
                        protocol, protocol_params, status, created_at
                    ) VALUES (?1, '', ?2, ?3, 22, ?4, ?5, ?6, ?7, 'unknown', ?8)",
                    rusqlite::params![
                        id,
                        id,
                        host,
                        user,
                        credential_key,
                        &protocol,
                        &protocol_params,
                        created_at,
                    ],
                )
                .expect("legacy node insert should succeed");
            }
        }

        let reopened = Storage::open(&path).expect("reopen should backfill legacy nodes");
        let root_node = reopened
            .get("legacy-root-node")
            .expect("root node should load");
        let admin_node = reopened
            .get("legacy-admin-node")
            .expect("admin node should load");

        assert_eq!(root_node.vps_id, "root-vps");
        assert_eq!(admin_node.vps_id, "admin-vps");
        assert_eq!(
            reopened
                .get_vps_profile(&root_node.vps_id)
                .expect("root profile should load")
                .credential_key,
            "root-credential-key"
        );
        assert_eq!(
            reopened
                .get_vps_profile(&admin_node.vps_id)
                .expect("admin profile should load")
                .credential_key,
            "admin-credential-key"
        );
    }

    #[test]
    fn test_open_rejects_ambiguous_canonical_profile_identity() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        {
            let storage = Storage::open(&path).expect("initial open should create schema");
            let mut first = test_profile("first-vps", "First VPS");
            first.host = "Duplicate.Example.COM.".to_string();
            storage
                .upsert_vps_profile(&first)
                .expect("first profile insert should succeed");

            let mut second = test_profile("second-vps", "Second VPS");
            second.host = "duplicate.example.com".to_string();
            storage
                .upsert_vps_profile(&second)
                .expect("raw-host-distinct profile insert should succeed");

            let conn = storage
                .conn
                .lock()
                .expect("test connection lock should succeed");
            conn.execute(
                "INSERT INTO nodes (
                    id, vps_id, name, host, ssh_port, ssh_user, credential_key,
                    protocol, protocol_params, status, created_at
                ) VALUES (?1, '', ?2, ?3, 22, 'root', ?4, ?5, ?6, 'unknown', ?7)",
                rusqlite::params![
                    "ambiguous-node",
                    "Ambiguous Node",
                    "duplicate.example.com",
                    "ambiguous-credential-key",
                    serde_json::to_string(&ProtocolId::VlessReality)
                        .expect("protocol should serialize"),
                    json!({
                        "uuid": "123e4567-e89b-12d3-a456-426614174000",
                        "public_key": "pub",
                        "short_id": "abcd",
                        "port": 443,
                        "sni": "example.com"
                    })
                    .to_string(),
                    1_700_000_000_000i64,
                ],
            )
            .expect("legacy node insert should succeed");
        }

        let error = match Storage::open(&path) {
            Ok(_) => panic!("ambiguous canonical identity must fail closed"),
            Err(error) => error,
        };
        assert!(
            error
                .to_string()
                .contains("multiple VPS profiles match canonical SSH identity"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn test_open_preserves_valid_profile_links_when_canonical_identity_is_ambiguous() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        {
            let storage = Storage::open(&path).expect("initial open should create schema");
            let mut first = test_profile("first-vps", "First VPS");
            first.host = "Example.com".to_string();
            storage
                .upsert_vps_profile(&first)
                .expect("first profile insert should succeed");

            let mut second = test_profile("second-vps", "Second VPS");
            second.host = "example.com.".to_string();
            storage
                .upsert_vps_profile(&second)
                .expect("raw-host-distinct profile insert should succeed");

            let protocol = serde_json::to_string(&ProtocolId::VlessReality)
                .expect("protocol should serialize");
            let protocol_params = json!({
                "uuid": "123e4567-e89b-12d3-a456-426614174000",
                "public_key": "pub",
                "short_id": "abcd",
                "port": 443,
                "sni": "example.com"
            })
            .to_string();
            let conn = storage
                .conn
                .lock()
                .expect("test connection lock should succeed");

            for (id, vps_id, host, created_at) in [
                (
                    "first-node",
                    "first-vps",
                    "Example.com",
                    1_700_000_000_000i64,
                ),
                (
                    "second-node",
                    "second-vps",
                    "example.com.",
                    1_700_000_010_000i64,
                ),
            ] {
                conn.execute(
                    "INSERT INTO nodes (
                        id, vps_id, name, host, ssh_port, ssh_user, credential_key,
                        protocol, protocol_params, status, created_at
                    ) VALUES (?1, ?2, ?3, ?4, 22, 'root', ?2, ?5, ?6, 'unknown', ?7)",
                    rusqlite::params![
                        id,
                        vps_id,
                        id,
                        host,
                        &protocol,
                        &protocol_params,
                        created_at,
                    ],
                )
                .expect("legacy node insert should succeed");
            }
        }

        let reopened =
            Storage::open(&path).expect("valid legacy profile links should survive upgrade");
        assert_eq!(
            reopened
                .get("first-node")
                .expect("first node should load")
                .vps_id,
            "first-vps"
        );
        assert_eq!(
            reopened
                .get("second-node")
                .expect("second node should load")
                .vps_id,
            "second-vps"
        );
    }

    #[test]
    fn test_list_order_desc_by_created_at() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        let storage = Storage::open(&path).expect("open should succeed");
        storage
            .upsert_vps_profile(&test_profile("vps-1", "Tokyo VPS"))
            .expect("profile insert should succeed");
        storage
            .insert(&test_node("older", "vps-1", "Tokyo VPS", 1_700_000_000_000))
            .expect("first insert should succeed");
        storage
            .insert(&test_node("newer", "vps-1", "Tokyo VPS", 1_700_000_010_000))
            .expect("second insert should succeed");

        let nodes = storage.list().expect("list should succeed");

        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].id, "newer");
        assert_eq!(nodes[1].id, "older");
    }

    #[test]
    fn test_update_node_protocol_params() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        let storage = Storage::open(&path).expect("open should succeed");
        storage
            .upsert_vps_profile(&test_profile("vps-1", "Tokyo VPS"))
            .expect("profile insert should succeed");
        storage
            .insert(&test_node(
                "node-1",
                "vps-1",
                "Tokyo VPS",
                1_700_000_000_000,
            ))
            .expect("insert should succeed");

        let updated_params = json!({
            "uuid": "123e4567-e89b-12d3-a456-426614174000",
            "public_key": "pub",
            "short_id": "abcd",
            "port": 443,
            "sni": "example.com",
            "managed_subscription": {
                "url": "http://203.0.113.10:18080/sub.yaml?token=test-token",
                "port": 18080,
                "token": "test-token",
                "updated_at": 1_700_000_010_000i64
            }
        });

        storage
            .update_node_protocol_params("node-1", &updated_params)
            .expect("protocol params update should succeed");

        let loaded = storage.get("node-1").expect("node should load");
        assert_eq!(loaded.protocol_params, updated_params);
    }

    #[test]
    fn test_update_vps_profile_host_syncs_nodes_and_managed_subscription_url() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        let storage = Storage::open(&path).expect("open should succeed");
        storage
            .upsert_vps_profile(&test_profile("vps-1", "Tokyo VPS"))
            .expect("profile insert should succeed");

        let mut node = test_node("node-1", "vps-1", "Tokyo VPS", 1_700_000_000_000);
        node.protocol_params = json!({
            "uuid": "123e4567-e89b-12d3-a456-426614174000",
            "public_key": "pub",
            "short_id": "abcd",
            "port": 443,
            "sni": "example.com",
            "managed_subscription": {
                "url": "http://1.2.3.4:18080/sub.yaml?token=test-token",
                "port": 18080,
                "token": "test-token",
                "updated_at": 1_700_000_010_000i64
            }
        });
        storage.insert(&node).expect("insert should succeed");

        let mut refreshed_node = node.clone();
        refreshed_node.protocol_params["managed_subscription"]["updated_at"] =
            json!(1_700_000_020_000i64);

        storage
            .update_vps_profile_host_and_nodes("vps-1", "203.0.113.99", &[refreshed_node])
            .expect("host update should succeed");

        let profile = storage
            .get_vps_profile("vps-1")
            .expect("profile should load");
        assert_eq!(profile.host, "203.0.113.99");

        let loaded = storage.get("node-1").expect("node should load");
        assert_eq!(loaded.host, "203.0.113.99");
        assert_eq!(
            loaded.protocol_params["managed_subscription"]["url"],
            "http://203.0.113.99:18080/sub.yaml?token=test-token"
        );
        assert_eq!(
            loaded.protocol_params["managed_subscription"]["updated_at"],
            1_700_000_020_000i64
        );
    }

    #[test]
    fn find_profile_matches_canonical_dns_and_ipv6_forms_for_same_user() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };
        let storage = Storage::open(&path).expect("open should succeed");

        let mut dns_profile = test_profile("dns-vps", "DNS VPS");
        dns_profile.host = "B.Example.COM.".to_string();
        storage
            .upsert_vps_profile(&dns_profile)
            .expect("DNS profile insert should succeed");
        let dns_match = storage
            .find_vps_profile_by_connection("b.example.com", 22, "root")
            .expect("canonical DNS lookup should succeed")
            .expect("canonical DNS alias should match");
        assert_eq!(dns_match.id, "dns-vps");
        assert!(
            storage
                .find_vps_profile_by_connection("b.example.com", 22, "different-user")
                .expect("different-user lookup should succeed")
                .is_none(),
            "a canonical host match must not cross SSH user identities"
        );

        let mut ipv6_profile = test_profile("ipv6-vps", "IPv6 VPS");
        ipv6_profile.host = "2001:0db8:0:0::1".to_string();
        ipv6_profile.ssh_user = "admin".to_string();
        storage
            .upsert_vps_profile(&ipv6_profile)
            .expect("IPv6 profile insert should succeed");
        let ipv6_match = storage
            .find_vps_profile_by_connection("[2001:db8::1]", 22, "admin")
            .expect("canonical IPv6 lookup should succeed")
            .expect("canonical IPv6 alias should match");
        assert_eq!(ipv6_match.id, "ipv6-vps");
    }

    #[test]
    fn commit_deployment_replaces_only_the_same_protocol() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };
        let storage = Storage::open(&path).expect("open should succeed");
        let profile = test_profile("vps-1", "Tokyo VPS");
        storage
            .upsert_vps_profile(&profile)
            .expect("profile insert should succeed");

        let old_vless = test_node("old-vless", "vps-1", "Tokyo VPS", 1);
        let mut hysteria = test_node("hysteria", "vps-1", "Tokyo VPS", 2);
        hysteria.protocol = ProtocolId::Hysteria2;
        storage.insert(&old_vless).expect("old VLESS insert");
        storage.insert(&hysteria).expect("Hysteria insert");

        let replacement = test_node("new-vless", "vps-1", "Tokyo VPS", 3);
        let attempt = DeploymentAttemptRecord {
            id: "attempt-1".to_string(),
            profile: profile.clone(),
            protocol: ProtocolId::VlessReality,
            phase: "remote_starting".to_string(),
            had_previous_credential: true,
            should_restore_credential: true,
            created_at: 3,
        };
        storage
            .begin_deployment_attempt(&attempt)
            .expect("deployment attempt should persist before remote mutation");
        let replaced = storage
            .commit_deployment(&profile, &replacement, &attempt.id)
            .expect("deployment commit should succeed");
        assert_eq!(replaced, 1);
        let attempts = storage
            .list_deployment_attempts()
            .expect("attempt list should load");
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].phase, "local_committed");
        storage
            .confirm_deployment_commit(&attempt.id)
            .expect("a second durable phase write should confirm the local commit");
        storage
            .confirm_deployment_commit(&attempt.id)
            .expect("every retry should perform a new durability barrier");
        assert_eq!(
            storage
                .get_deployment_confirmation_epoch(&attempt.id)
                .expect("confirmation epoch should load"),
            2
        );
        storage
            .transition_deployment_attempt_phase(
                &attempt.id,
                "remote_starting",
                "remote_rolled_back",
            )
            .expect_err("a stale rollback transition must not overwrite local_committed");
        assert_eq!(
            storage
                .get_deployment_attempt_phase(&attempt.id)
                .expect("phase lookup should succeed")
                .as_deref(),
            Some("local_commit_confirmed")
        );

        let nodes = storage.list().expect("list should succeed");
        assert_eq!(nodes.len(), 2);
        assert!(nodes.iter().any(|node| node.id == "new-vless"));
        assert!(nodes.iter().any(|node| node.id == "hysteria"));
        assert!(!nodes.iter().any(|node| node.id == "old-vless"));
    }

    #[test]
    fn deployment_commit_without_durable_attempt_rolls_back_every_local_change() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };
        let storage = Storage::open(&path).expect("open should succeed");
        let profile = test_profile("vps-1", "Tokyo VPS");
        storage
            .upsert_vps_profile(&profile)
            .expect("profile insert should succeed");
        let old_node = test_node("old-vless", "vps-1", "Tokyo VPS", 1);
        storage.insert(&old_node).expect("old node insert");

        let replacement = test_node("new-vless", "vps-1", "Tokyo VPS", 2);
        let error = storage
            .commit_deployment(&profile, &replacement, "missing-attempt")
            .expect_err("commit must fail closed without its durable attempt journal");
        assert!(error
            .to_string()
            .contains("deployment attempt not found or not ready"));

        let nodes = storage.list().expect("list should succeed");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "old-vless");
    }

    #[test]
    fn deployment_commit_requires_ready_matching_attempt() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };
        let storage = Storage::open(&path).expect("open should succeed");
        let profile = test_profile("vps-1", "Tokyo VPS");
        storage
            .upsert_vps_profile(&profile)
            .expect("profile insert should succeed");
        let old_node = test_node("old-vless", "vps-1", "Tokyo VPS", 1);
        storage.insert(&old_node).expect("old node insert");

        let attempt = DeploymentAttemptRecord {
            id: "attempt-not-ready".to_string(),
            profile: profile.clone(),
            protocol: ProtocolId::VlessReality,
            phase: "preparing_credentials".to_string(),
            had_previous_credential: false,
            should_restore_credential: false,
            created_at: 2,
        };
        storage
            .begin_deployment_attempt(&attempt)
            .expect("attempt insert should succeed");

        let replacement = test_node("new-vless", "vps-1", "Tokyo VPS", 2);
        storage
            .commit_deployment(&profile, &replacement, &attempt.id)
            .expect_err("commit must reject an attempt before remote_starting");

        let nodes = storage.list().expect("list should succeed");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "old-vless");
        let attempts = storage
            .list_deployment_attempts()
            .expect("attempt list should succeed");
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].phase, "preparing_credentials");

        storage
            .transition_deployment_attempt_phase(
                &attempt.id,
                "preparing_credentials",
                "remote_starting",
            )
            .expect("attempt should become ready");
        let mut mismatched_profile = profile.clone();
        mismatched_profile.id = "different-vps".to_string();
        storage
            .commit_deployment(&mismatched_profile, &replacement, &attempt.id)
            .expect_err("commit must reject an attempt owned by another profile");
        let nodes = storage.list().expect("list should still succeed");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "old-vless");
        assert_eq!(
            storage
                .get_deployment_attempt_phase(&attempt.id)
                .expect("phase lookup should succeed")
                .as_deref(),
            Some("remote_starting")
        );
    }
}
