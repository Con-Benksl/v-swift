use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use russh::client::{self, Handle};
use russh::keys::key::PublicKey;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthMethod {
    Password { password: String },
    PrivateKey { key: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpsCredential {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: AuthMethod,
}

pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub struct SshSession {
    handle: Arc<Mutex<Handle<Client>>>,
}

#[derive(Clone, Default)]
struct Client;

#[derive(Debug)]
struct ClientError(russh::Error);

impl From<russh::Error> for ClientError {
    fn from(value: russh::Error) -> Self {
        Self(value)
    }
}

#[async_trait::async_trait]
impl client::Handler for Client {
    type Error = ClientError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        log::warn!(
            "Skipping SSH host key verification for server key: {:?}",
            server_public_key.name()
        );
        Ok(true)
    }
}

impl SshSession {
    pub async fn connect(cred: &VpsCredential) -> AppResult<Self> {
        let connect_result = timeout(Duration::from_secs(15), async {
            let mut config = client::Config::default();
            config.inactivity_timeout = Some(Duration::from_secs(600));
            config.keepalive_interval = Some(Duration::from_secs(20));
            config.keepalive_max = 5;

            let addr = format!("{}:{}", cred.host, cred.port);
            let mut handle = client::connect(Arc::new(config), addr, Client)
                .await
                .map_err(map_connect_error)?;

            let auth_result = match &cred.auth {
                AuthMethod::Password { password } => handle
                    .authenticate_password(cred.user.as_str(), password.as_str())
                    .await
                    .map_err(map_russh_error)?,
                AuthMethod::PrivateKey { key, passphrase } => {
                    let private_key =
                        russh_keys::decode_secret_key(key, passphrase.as_deref()).map_err(|err| {
                            AppError::Other(format!("failed to parse private key: {err}"))
                        })?;
                    handle
                        .authenticate_publickey(cred.user.as_str(), Arc::new(private_key))
                        .await
                        .map_err(map_russh_error)?
                }
            };

            if !auth_result {
                return Err(AppError::AuthFailed);
            }

            Ok(Self {
                handle: Arc::new(Mutex::new(handle)),
            })
        })
        .await;

        match connect_result {
            Ok(result) => result,
            Err(_) => Err(AppError::NetworkTimeout),
        }
    }

    pub async fn exec(&self, cmd: &str) -> AppResult<ExecOutput> {
        let handle = self.handle.lock().await;
        let mut channel = handle.channel_open_session().await.map_err(map_russh_error)?;
        channel.exec(true, cmd).await.map_err(map_russh_error)?;

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut exit_code = 0;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => stdout.push_str(&String::from_utf8_lossy(&data)),
                ChannelMsg::ExtendedData { data, .. } => {
                    stderr.push_str(&String::from_utf8_lossy(&data))
                }
                ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status as i32,
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }

        Ok(ExecOutput {
            stdout,
            stderr,
            exit_code,
        })
    }

    pub async fn exec_stream<F: Fn(&str) + Send + Sync>(
        &self,
        cmd: &str,
        on_line: F,
    ) -> AppResult<i32> {
        let handle = self.handle.lock().await;
        let mut channel = handle.channel_open_session().await.map_err(map_russh_error)?;
        channel.exec(true, cmd).await.map_err(map_russh_error)?;

        let mut stdout_buffer = String::new();
        let mut stderr_buffer = String::new();
        let mut exit_code = 0;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => {
                    stdout_buffer.push_str(&String::from_utf8_lossy(&data));
                    flush_complete_lines(&mut stdout_buffer, "", &on_line);
                }
                ChannelMsg::ExtendedData { data, .. } => {
                    stderr_buffer.push_str(&String::from_utf8_lossy(&data));
                    flush_complete_lines(&mut stderr_buffer, "[stderr] ", &on_line);
                }
                ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status as i32,
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }

        flush_remaining_line(&mut stdout_buffer, "", &on_line);
        flush_remaining_line(&mut stderr_buffer, "[stderr] ", &on_line);

        Ok(exit_code)
    }

    pub async fn upload(&self, remote_path: &str, content: &[u8], mode: u32) -> AppResult<()> {
        let encoded = base64::engine::general_purpose::STANDARD.encode(content);
        let remote_path = shell_single_quote(remote_path);
        let command = format!(
            "printf '%s' '{encoded}' | base64 -d > {remote_path} && chmod {:o} {remote_path}",
            mode
        );

        let result = self.exec(&command).await?;
        if result.exit_code == 0 {
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "upload failed with exit code {}: {}",
                result.exit_code,
                result.stderr.trim()
            )))
        }
    }

    pub async fn close(self) -> AppResult<()> {
        let handle = self.handle.lock().await;
        handle
            .disconnect(
                russh::Disconnect::ByApplication,
                "session closed",
                "en-US",
            )
            .await
            .map_err(map_russh_error)
    }
}

// Safety net: if the SshSession is dropped without close() being called
// (e.g., due to panic or future refactor), spawn a best-effort background
// disconnect so the server-side sshd cleans up promptly instead of waiting
// for a TCP timeout. This runs only on drop, so normal paths are unaffected.
impl Drop for SshSession {
    fn drop(&mut self) {
        let handle = self.handle.clone();
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            rt.spawn(async move {
                let guard = handle.lock().await;
                let _ = guard
                    .disconnect(
                        russh::Disconnect::ByApplication,
                        "dropped without close()",
                        "en-US",
                    )
                    .await;
            });
        }
    }
}

fn map_connect_error(error: ClientError) -> AppError {
    let message = error.0.to_string();
    AppError::HostUnreachable(message)
}

fn map_russh_error(error: russh::Error) -> AppError {
    AppError::Other(error.to_string())
}

fn flush_complete_lines<F: Fn(&str) + Send + Sync>(buffer: &mut String, prefix: &str, on_line: &F) {
    while let Some(idx) = buffer.find('\n') {
        let line = buffer[..idx].trim_end_matches('\r');
        let rendered = format!("{prefix}{line}");
        on_line(rendered.as_str());
        buffer.drain(..=idx);
    }
}

fn flush_remaining_line<F: Fn(&str) + Send + Sync>(buffer: &mut String, prefix: &str, on_line: &F) {
    if !buffer.is_empty() {
        let line = buffer.trim_end_matches('\r').to_string();
        let rendered = format!("{prefix}{line}");
        on_line(rendered.as_str());
        buffer.clear();
    }
}

fn shell_single_quote(value: &str) -> String {
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{escaped}'")
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_parse_private_key() {
        let key = r#"-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDmCakObOO3R+GVHD1pdZL94LI09CvZBbSthQw8XVvgLQAAAKhsF1ADbBdQ
AwAAAAtzc2gtZWQyNTUxOQAAACDmCakObOO3R+GVHD1pdZL94LI09CvZBbSthQw8XVvgLQ
AAAEDSYymqwWQP+SGGxtvnN6wT1D8RxiCH2IG6FW2IYCCAt+YJqQ5s47dH4ZUcPWl1kv3g
sjT0K9kFtK2FDDxdW+AtAAAAI2NvbmJlbmtzbEBCZW5rc2xNYWNCb29rLUFpci03LmxvY2
FsAQI=
-----END OPENSSH PRIVATE KEY-----"#;

        let parsed = russh_keys::decode_secret_key(key, None);
        assert!(parsed.is_ok(), "expected valid ed25519 private key");
    }
}
