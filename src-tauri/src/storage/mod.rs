use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::deploy::{NodeRecord, VpsProfileSummary};
use crate::error::{AppError, AppResult};

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
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, name, host, ssh_port, ssh_user, credential_key, created_at
                 FROM vps_profiles
                 WHERE host = ?1 AND ssh_port = ?2 AND ssh_user = ?3
                 LIMIT 1",
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut rows = stmt
            .query(rusqlite::params![host, i64::from(ssh_port), ssh_user])
            .map_err(|e| AppError::Storage(e.to_string()))?;

        rows.next()
            .map_err(|e| AppError::Storage(e.to_string()))?
            .map(map_vps_profile_row)
            .transpose()
            .map_err(|e| AppError::Storage(e.to_string()))
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
        let protocol_params = serde_json::to_string(protocol_params)
            .map_err(|e| AppError::Storage(e.to_string()))?;
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

    pub fn delete_vps_profile(&self, id: &str) -> AppResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.execute("DELETE FROM nodes WHERE vps_id = ?1", [id])
            .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.execute("DELETE FROM vps_profiles WHERE id = ?1", [id])
            .map_err(|e| AppError::Storage(e.to_string()))?;
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
        ];

        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| AppError::Storage(e.to_string()))?;

        for (idx, migration) in migrations.iter().enumerate().skip(version as usize) {
            conn.execute_batch(migration)
                .map_err(|e| AppError::Storage(e.to_string()))?;
            conn.pragma_update(None, "user_version", (idx + 1) as i64)
                .map_err(|e| AppError::Storage(e.to_string()))?;
        }

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

        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut stmt = conn
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

        let mut profile_by_identity: HashMap<String, String> = HashMap::new();

        for node in legacy_nodes {
            let identity = format!(
                "{}\u{1f}{}\u{1f}{}",
                node.host, node.ssh_port, node.ssh_user
            );
            let profile_id = if let Some(existing) = profile_by_identity.get(&identity) {
                existing.clone()
            } else if let Some(existing) =
                find_profile_id_by_identity(&conn, &node.host, node.ssh_port, &node.ssh_user)?
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
                conn.execute(
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
                conn.execute(
                    "UPDATE nodes SET vps_id = ?2 WHERE id = ?1",
                    rusqlite::params![&node.id, &profile_id],
                )
                .map_err(|e| AppError::Storage(e.to_string()))?;
            }
        }

        Ok(())
    }
}

fn find_profile_id_by_identity(
    conn: &rusqlite::Connection,
    host: &str,
    ssh_port: u16,
    ssh_user: &str,
) -> AppResult<Option<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT id
             FROM vps_profiles
             WHERE host = ?1 AND ssh_port = ?2 AND ssh_user = ?3
             LIMIT 1",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut rows = stmt
        .query(rusqlite::params![host, i64::from(ssh_port), ssh_user])
        .map_err(|e| AppError::Storage(e.to_string()))?;

    rows.next()
        .map_err(|e| AppError::Storage(e.to_string()))?
        .map(|row| row.get(0))
        .transpose()
        .map_err(|e| AppError::Storage(e.to_string()))
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

    use super::{Storage, VpsProfileRecord};
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
    fn test_delete_vps_profile_cascades_nodes() {
        let path = std::env::temp_dir().join(format!("test_{}.db", uuid::Uuid::new_v4()));
        let _guard = FileCleanupGuard { path: path.clone() };

        let storage = Storage::open(&path).expect("open should succeed");
        storage
            .upsert_vps_profile(&test_profile("vps-1", "Tokyo VPS"))
            .expect("profile insert should succeed");
        storage
            .insert(&test_node("node-1", "vps-1", "Tokyo VPS", 1_700_000_000_000))
            .expect("first insert should succeed");
        storage
            .insert(&test_node("node-2", "vps-1", "Tokyo VPS", 1_700_000_010_000))
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
            .insert(&test_node("node-1", "vps-1", "Tokyo VPS", 1_700_000_000_000))
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
}
