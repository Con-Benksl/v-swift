use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use russh::client::{self, Handle};
use russh::keys::key::PublicKey;
use russh::ChannelMsg;
use russh_keys::{known_host_keys, learn_known_hosts};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthMethod {
    Password {
        password: String,
    },
    PrivateKey {
        key: String,
        passphrase: Option<String>,
    },
}

impl AuthMethod {
    pub fn normalized(&self) -> Self {
        match self {
            Self::Password { .. } => self.clone(),
            Self::PrivateKey { key, passphrase } => Self::PrivateKey {
                key: key.clone(),
                passphrase: passphrase
                    .as_ref()
                    .filter(|value| !value.trim().is_empty())
                    .cloned(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpsCredential {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: AuthMethod,
    #[serde(skip)]
    pub(crate) host_key_aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedHostKey {
    pub algorithm: String,
    pub fingerprint: String,
}

pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub struct SshSession {
    handle: Arc<Mutex<Handle<Client>>>,
}

#[derive(Clone)]
struct Client {
    host: String,
    port: u16,
    aliases: Vec<String>,
    accept_new_host_key: bool,
    expected_host_key: Option<ExpectedHostKey>,
}

impl Client {
    fn new(
        host: &str,
        port: u16,
        aliases: Vec<String>,
        accept_new_host_key: bool,
        expected_host_key: Option<ExpectedHostKey>,
    ) -> Self {
        Self {
            host: host.to_string(),
            port,
            aliases,
            accept_new_host_key,
            expected_host_key,
        }
    }

    fn verify_expected_host_key(&self, server_public_key: &PublicKey) -> Result<(), ClientError> {
        if !self.accept_new_host_key {
            return Ok(());
        }

        let Some(expected) = &self.expected_host_key else {
            return Err(ClientError::HostKey(format!(
                "refusing to trust SSH host key for {}:{} without the algorithm and SHA256 fingerprint shown to the user",
                self.host, self.port
            )));
        };
        let current_algorithm = server_public_key.name();
        let current_fingerprint = server_public_key.fingerprint().to_string();
        if expected.algorithm != current_algorithm || expected.fingerprint != current_fingerprint {
            return Err(ClientError::HostKey(format!(
                "SSH host key changed before confirmation for {}:{}: expected {} {}, received {} {}. Refusing to trust it.",
                self.host,
                self.port,
                expected.algorithm,
                expected.fingerprint,
                current_algorithm,
                current_fingerprint
            )));
        }

        Ok(())
    }
}

#[derive(Debug)]
enum ClientError {
    Russh(russh::Error),
    HostKey(String),
}

impl From<russh::Error> for ClientError {
    fn from(value: russh::Error) -> Self {
        Self::Russh(value)
    }
}

#[async_trait::async_trait]
impl client::Handler for Client {
    type Error = ClientError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        self.verify_expected_host_key(server_public_key)?;

        let mut candidates = vec![self.host.clone()];
        for alias in &self.aliases {
            if !candidates.iter().any(|candidate| candidate == alias) {
                candidates.push(alias.clone());
            }
        }

        let mut found_known_key = false;
        let mut canonical_has_key = false;
        let mut mismatches = Vec::new();
        for candidate in &candidates {
            let known_keys = known_host_keys(candidate, self.port).map_err(|err| {
                ClientError::HostKey(format!(
                    "failed to verify SSH host key alias {candidate}:{}: {err}",
                    self.port
                ))
            })?;
            if known_keys.is_empty() {
                continue;
            }
            found_known_key = true;
            if candidate == &self.host {
                canonical_has_key = true;
            }
            if !known_keys
                .iter()
                .any(|(_, recorded)| recorded == server_public_key)
            {
                let lines = known_keys
                    .iter()
                    .map(|(line, _)| line.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                mismatches.push(format!("{candidate} (line(s) {lines})"));
            }
        }

        if !mismatches.is_empty() {
            return Err(ClientError::HostKey(format!(
                "SSH host key mismatch for {}:{}: {} contain different key(s). Refusing to authenticate.",
                self.host,
                self.port,
                mismatches.join(", ")
            )));
        }

        if found_known_key {
            if !canonical_has_key {
                learn_known_hosts(&self.host, self.port, server_public_key).map_err(|err| {
                    ClientError::HostKey(format!(
                        "verified a legacy SSH host alias, but failed to migrate its pin to {}:{}: {err}",
                        self.host, self.port
                    ))
                })?;
                log::info!(
                    "Migrated verified SSH host key alias to {}:{} ({})",
                    self.host,
                    self.port,
                    server_public_key.name()
                );
            }
            return Ok(true);
        }

        let fingerprint = server_public_key.fingerprint();
        if !self.accept_new_host_key {
            return Err(ClientError::HostKey(format!(
                "UNKNOWN_SSH_HOST_KEY|host={}|port={}|algorithm={}|fingerprint={fingerprint}",
                self.host,
                self.port,
                server_public_key.name()
            )));
        }

        learn_known_hosts(&self.host, self.port, server_public_key).map_err(|err| {
            ClientError::HostKey(format!(
                "failed to trust explicitly confirmed SSH host key for {}:{}: {err}",
                self.host, self.port
            ))
        })?;
        log::info!(
            "Trusted explicitly confirmed SSH host key for {}:{} ({fingerprint})",
            self.host,
            self.port
        );
        Ok(true)
    }
}

impl SshSession {
    pub async fn connect(cred: &VpsCredential) -> AppResult<Self> {
        Self::connect_with_host_key_acceptance(cred, false, None).await
    }

    pub async fn connect_with_host_key_acceptance(
        cred: &VpsCredential,
        accept_new_host_key: bool,
        expected_host_key: Option<ExpectedHostKey>,
    ) -> AppResult<Self> {
        let connect_result = timeout(Duration::from_secs(15), async {
            let config = client::Config {
                inactivity_timeout: Some(Duration::from_secs(600)),
                keepalive_interval: Some(Duration::from_secs(20)),
                keepalive_max: 5,
                ..Default::default()
            };

            let host = canonicalize_host(&cred.host)?;
            let mut aliases = cred.host_key_aliases.clone();
            let raw_host = cred.host.trim().to_string();
            if raw_host != host && !aliases.iter().any(|alias| alias == &raw_host) {
                aliases.push(raw_host);
            }
            let addr = socket_address(&host, cred.port);
            let mut handle = client::connect(
                Arc::new(config),
                addr,
                Client::new(
                    &host,
                    cred.port,
                    aliases,
                    accept_new_host_key,
                    expected_host_key,
                ),
            )
            .await
            .map_err(map_connect_error)?;

            let auth_result = match &cred.auth {
                AuthMethod::Password { password } => handle
                    .authenticate_password(cred.user.as_str(), password.as_str())
                    .await
                    .map_err(map_russh_error)?,
                AuthMethod::PrivateKey { key, passphrase } => {
                    let passphrase = passphrase
                        .as_deref()
                        .filter(|value| !value.trim().is_empty());
                    let private_key =
                        russh_keys::decode_secret_key(key, passphrase).map_err(|err| {
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
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(map_russh_error)?;
        channel.exec(true, cmd).await.map_err(map_russh_error)?;

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut exit_code = None;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => stdout.push_str(&String::from_utf8_lossy(&data)),
                ChannelMsg::ExtendedData { data, .. } => {
                    stderr.push_str(&String::from_utf8_lossy(&data))
                }
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status as i32),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }

        Ok(ExecOutput {
            stdout,
            stderr,
            exit_code: require_exit_status(exit_code)?,
        })
    }

    pub async fn exec_stream<F: Fn(&str) + Send + Sync>(
        &self,
        cmd: &str,
        on_line: F,
    ) -> AppResult<i32> {
        let handle = self.handle.lock().await;
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(map_russh_error)?;
        channel.exec(true, cmd).await.map_err(map_russh_error)?;

        let mut stdout_buffer = String::new();
        let mut stderr_buffer = String::new();
        let mut exit_code = None;

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
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status as i32),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }

        flush_remaining_line(&mut stdout_buffer, "", &on_line);
        flush_remaining_line(&mut stderr_buffer, "[stderr] ", &on_line);

        require_exit_status(exit_code)
    }

    /// Uploads a file by streaming base64-encoded content over the SSH channel's stdin.
    ///
    /// The payload is deliberately kept out of the remote command line so credentials do
    /// not become visible through process listings or command-audit logs. The remote path is
    /// still shell-single-quoted because only the small decoder command is passed to a shell.
    pub async fn upload(&self, remote_path: &str, content: &[u8], mode: u32) -> AppResult<()> {
        let encoded = base64::engine::general_purpose::STANDARD.encode(content);
        let remote_path = shell_single_quote(remote_path);
        let command = format!(
            "umask 077; base64 -d > {remote_path} && chmod {:o} {remote_path}",
            mode
        );

        let handle = self.handle.lock().await;
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(map_russh_error)?;
        channel
            .exec(true, command.as_str())
            .await
            .map_err(map_russh_error)?;
        channel
            .data(encoded.as_bytes())
            .await
            .map_err(map_russh_error)?;
        channel.eof().await.map_err(map_russh_error)?;

        let mut stderr = String::new();
        let mut exit_code = None;
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::ExtendedData { data, .. } => {
                    stderr.push_str(&String::from_utf8_lossy(&data));
                }
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status as i32),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }

        let exit_code = require_exit_status(exit_code)?;
        if exit_code == 0 {
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "upload failed with exit code {}: {}",
                exit_code,
                stderr.trim()
            )))
        }
    }

    pub async fn close(self) -> AppResult<()> {
        let handle = self.handle.lock().await;
        handle
            .disconnect(russh::Disconnect::ByApplication, "session closed", "en-US")
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
        match tokio::runtime::Handle::try_current() {
            Ok(rt) => {
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
            Err(err) => {
                log::debug!(
                    "SshSession::drop: no tokio runtime available for background disconnect: {err}"
                );
            }
        }
    }
}

fn map_connect_error(error: ClientError) -> AppError {
    match error {
        ClientError::Russh(error) => AppError::HostUnreachable(error.to_string()),
        ClientError::HostKey(message) => AppError::SshHostKey(message),
    }
}

fn map_russh_error(error: russh::Error) -> AppError {
    AppError::SshTransport(error.to_string())
}

fn require_exit_status(exit_code: Option<i32>) -> AppResult<i32> {
    exit_code.ok_or_else(|| {
        AppError::SshTransport(
            "SSH command channel closed before the server reported an exit status".to_string(),
        )
    })
}

pub(crate) fn canonicalize_host(host: &str) -> AppResult<String> {
    let trimmed = host.trim();
    let unbracketed = trimmed
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(trimmed);
    if unbracketed.is_empty() {
        return Err(AppError::Other("VPS IP 或域名不能为空".to_string()));
    }

    if let Ok(ip) = unbracketed.parse::<IpAddr>() {
        return Ok(ip.to_string());
    }

    let canonical = unbracketed.trim_end_matches('.').to_lowercase();
    let invalid = canonical.is_empty()
        || canonical.len() > 253
        || canonical.contains(char::is_whitespace)
        || canonical
            .chars()
            .any(|value| matches!(value, ':' | '[' | ']' | '/' | '?' | '#'));
    if invalid {
        return Err(AppError::Other(
            "VPS 地址必须是有效的 IP 或主机名，端口请单独填写。".to_string(),
        ));
    }
    Ok(canonical)
}

pub(crate) fn socket_address(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
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
    use russh::client::Handler;

    use super::{
        canonicalize_host, require_exit_status, socket_address, AuthMethod, Client, ClientError,
    };

    #[test]
    fn formats_ipv4_domain_and_ipv6_socket_addresses() {
        assert_eq!(socket_address("example.com", 22), "example.com:22");
        assert_eq!(socket_address("2001:db8::1", 2222), "[2001:db8::1]:2222");
        assert_eq!(
            canonicalize_host("[2001:0db8:0:0::1]").expect("valid IPv6"),
            "2001:db8::1"
        );
        assert_eq!(
            canonicalize_host(" B.Example.COM. ").expect("valid hostname"),
            "b.example.com"
        );
        assert!(canonicalize_host("example.com:22").is_err());
    }

    #[test]
    fn test_blank_private_key_passphrase_is_absent() {
        let auth = AuthMethod::PrivateKey {
            key: "key".to_string(),
            passphrase: Some("   ".to_string()),
        }
        .normalized();

        match auth {
            AuthMethod::PrivateKey { passphrase, .. } => assert!(passphrase.is_none()),
            other => panic!("unexpected auth method: {other:?}"),
        }
    }

    #[test]
    fn missing_remote_exit_status_is_not_treated_as_success() {
        assert_eq!(require_exit_status(Some(0)).expect("reported success"), 0);
        assert!(require_exit_status(None).is_err());
    }

    #[tokio::test]
    async fn strict_client_rejects_an_unknown_host_key() {
        let generated = russh_keys::key::KeyPair::generate_ed25519()
            .expect("expected Ed25519 key generation to succeed");
        let public_key = generated
            .clone_public_key()
            .expect("expected public key extraction to succeed");
        let host = format!("v-swift-test-{}.invalid", uuid::Uuid::new_v4());
        let mut client = Client::new(&host, 22, Vec::new(), false, None);

        let error = client
            .check_server_key(&public_key)
            .await
            .expect_err("strict SSH connections must not enroll an unknown host key");
        match error {
            ClientError::HostKey(message) => {
                assert!(message.starts_with("UNKNOWN_SSH_HOST_KEY|"));
                assert!(message.contains(&format!("host={host}|port=22|")));
            }
            ClientError::Russh(error) => panic!("unexpected SSH transport error: {error}"),
        }
    }

    #[test]
    fn host_key_acceptance_rejects_a_key_switch_before_writing_known_hosts() {
        let observed = russh_keys::key::KeyPair::generate_ed25519()
            .expect("expected observed Ed25519 key generation to succeed")
            .clone_public_key()
            .expect("expected observed public key extraction to succeed");
        let switched = russh_keys::key::KeyPair::generate_ed25519()
            .expect("expected switched Ed25519 key generation to succeed")
            .clone_public_key()
            .expect("expected switched public key extraction to succeed");
        let client = Client::new(
            "key-switch.invalid",
            22,
            Vec::new(),
            true,
            Some(super::ExpectedHostKey {
                algorithm: observed.name().to_string(),
                fingerprint: observed.fingerprint().to_string(),
            }),
        );

        let error = client
            .verify_expected_host_key(&switched)
            .expect_err("a key changed after user confirmation must be rejected");
        match error {
            ClientError::HostKey(message) => {
                assert!(message.contains("SSH host key changed before confirmation"));
                assert!(message.contains("Refusing to trust it"));
            }
            ClientError::Russh(error) => panic!("unexpected SSH transport error: {error}"),
        }
    }

    #[test]
    fn host_key_acceptance_requires_the_confirmed_key_identity() {
        let public_key = russh_keys::key::KeyPair::generate_ed25519()
            .expect("expected Ed25519 key generation to succeed")
            .clone_public_key()
            .expect("expected public key extraction to succeed");
        let client = Client::new("missing-confirmation.invalid", 22, Vec::new(), true, None);

        let error = client
            .verify_expected_host_key(&public_key)
            .expect_err("acceptance without a confirmed key identity must be rejected");
        match error {
            ClientError::HostKey(message) => {
                assert!(message.contains("without the algorithm and SHA256 fingerprint"));
            }
            ClientError::Russh(error) => panic!("unexpected SSH transport error: {error}"),
        }
    }

    #[test]
    fn test_parse_private_key() {
        let generated = russh_keys::key::KeyPair::generate_ed25519()
            .expect("expected Ed25519 key generation to succeed");
        let mut encoded = Vec::new();
        russh_keys::encode_pkcs8_pem(&generated, &mut encoded)
            .expect("expected generated key to encode as PKCS#8 PEM");
        let key = String::from_utf8(encoded).expect("expected PEM output to be UTF-8");

        let parsed = russh_keys::decode_secret_key(&key, None);
        assert!(parsed.is_ok(), "expected valid ed25519 private key");
    }
}
