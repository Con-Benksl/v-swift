use thiserror::Error;

#[derive(Debug, Error, serde::Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("authentication failed")]
    AuthFailed,
    #[error("network timeout")]
    NetworkTimeout,
    #[error("ssh host key verification failed: {0}")]
    SshHostKey(String),
    #[error("host unreachable: {0}")]
    HostUnreachable(String),
    #[error("permission denied")]
    PermissionDenied,
    #[error("unsupported os: {0}")]
    UnsupportedOs(String),
    #[error("deploy step failed: {step} - {message}")]
    DeployStepFailed { step: String, message: String },
    #[error("storage error: {0}")]
    Storage(String),
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("other: {0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;
