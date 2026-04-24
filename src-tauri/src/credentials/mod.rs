use keyring::Entry;

use crate::error::{AppError, AppResult};
use crate::ssh::AuthMethod;

const SERVICE_NAME: &str = "V-Swift";
const LEGACY_SERVICE_NAMES: &[&str] = &["vps-node-deployer"];

pub fn save(node_id: &str, auth: &AuthMethod) -> AppResult<()> {
    let json =
        serde_json::to_string(&auth.normalized()).map_err(|e| AppError::Keychain(e.to_string()))?;
    let entry = Entry::new(SERVICE_NAME, node_id).map_err(|e| AppError::Keychain(e.to_string()))?;
    entry
        .set_password(&json)
        .map_err(|e| AppError::Keychain(e.to_string()))
}

pub fn load(node_id: &str) -> AppResult<AuthMethod> {
    match load_optional(node_id)? {
        Some(auth) => Ok(auth),
        None => Err(AppError::Keychain(
            "No matching entry found in secure storage".to_string(),
        )),
    }
}

pub fn load_optional(node_id: &str) -> AppResult<Option<AuthMethod>> {
    for service in std::iter::once(SERVICE_NAME).chain(LEGACY_SERVICE_NAMES.iter().copied()) {
        let entry = Entry::new(service, node_id).map_err(|e| AppError::Keychain(e.to_string()))?;
        match entry.get_password() {
            Ok(json) => {
                let auth = serde_json::from_str::<AuthMethod>(&json)
                    .map_err(|e| AppError::Keychain(e.to_string()))?;
                return Ok(Some(auth.normalized()));
            }
            Err(keyring::Error::NoEntry) => continue,
            Err(e) => return Err(AppError::Keychain(e.to_string())),
        }
    }

    Ok(None)
}

pub fn exists(node_id: &str) -> AppResult<bool> {
    Ok(load_optional(node_id)?.is_some())
}

pub fn delete(node_id: &str) -> AppResult<()> {
    for service in std::iter::once(SERVICE_NAME).chain(LEGACY_SERVICE_NAMES.iter().copied()) {
        let entry = Entry::new(service, node_id).map_err(|e| AppError::Keychain(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(AppError::Keychain(e.to_string())),
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{delete, load, save};
    use crate::ssh::AuthMethod;

    struct CleanupGuard {
        node_id: String,
    }

    impl Drop for CleanupGuard {
        fn drop(&mut self) {
            let _ = delete(&self.node_id);
        }
    }

    #[test]
    #[ignore] // run with -- --ignored on a machine with a keychain
    fn test_save_load_roundtrip() {
        let node_id = format!("test-{}", uuid::Uuid::new_v4());
        let _guard = CleanupGuard {
            node_id: node_id.clone(),
        };
        let auth = AuthMethod::PrivateKey {
            key: "test-private-key".to_string(),
            passphrase: Some("secret".to_string()),
        };

        save(&node_id, &auth).expect("save should succeed");
        let loaded = load(&node_id).expect("load should succeed");

        match loaded {
            AuthMethod::PrivateKey { key, passphrase } => {
                assert_eq!(key, "test-private-key");
                assert_eq!(passphrase.as_deref(), Some("secret"));
            }
            other => panic!("unexpected auth method: {other:?}"),
        }
    }

    #[test]
    #[ignore] // run with -- --ignored on a machine with a keychain
    fn test_delete() {
        let node_id = format!("test-{}", uuid::Uuid::new_v4());
        let _guard = CleanupGuard {
            node_id: node_id.clone(),
        };
        let auth = AuthMethod::Password {
            password: "pw".to_string(),
        };

        save(&node_id, &auth).expect("save should succeed");
        delete(&node_id).expect("delete should succeed");

        let err = load(&node_id).expect_err("load should fail after delete");
        match err {
            crate::error::AppError::Keychain(_) => {}
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
