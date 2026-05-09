# V-Swift

[English](README.md) | [简体中文](README.zh-CN.md)

V-Swift is a desktop VPS node deployer built with Tauri, React, and Rust. It connects to a fresh Linux VPS over SSH, installs the required runtime, configures either VLESS-Reality or Hysteria2, applies basic firewall protection, and generates a subscription link that can be imported into compatible clients.

The project is designed for personal learning, technical research, and authorized infrastructure administration. You are responsible for ensuring that any server you operate and any resulting network usage comply with local laws, provider terms, and organizational policies.

## Project Scope

V-Swift is not a general-purpose proxy client. It does not route traffic on your local machine. Its job is to automate repeatable server-side deployment tasks and keep the node metadata available in a small desktop app.

Current scope:

- Deploy VLESS-Reality nodes backed by Xray-core
- Deploy Hysteria2 nodes backed by QUIC/TLS
- Connect to VPS hosts through SSH
- Store SSH credentials through the operating system credential store
- Show real-time deployment progress from the Rust backend
- Save node records and generated subscription links locally
- Uninstall previously deployed protocol services from the target VPS
- Monitor and control deployed VPS protocol services from the desktop app

## Features

- **Guided node creation**: enter VPS connection details, choose a protocol, and run the deployment workflow from the desktop UI.
- **Two supported protocols**: VLESS-Reality for Xray-based deployments and Hysteria2 for QUIC-based deployments.
- **Remote automation over SSH**: system detection, dependency setup, protocol configuration, service management, and firewall setup are handled by bundled shell scripts.
- **Live progress events**: the Rust backend streams deployment logs to the React interface through Tauri events.
- **Credential storage**: SSH password or private-key authentication data is saved through macOS Keychain, Windows Credential Manager, or Linux Secret Service via `keyring`.
- **Local node management**: deployed nodes can be listed, inspected, copied as subscription links, and removed.
- **Managed multi-node subscription**: install a lightweight VPS-side subscription service for Clash/Mihomo and return usage headers backed by `vnstat`.
- **VPS control panel**: connect to a saved VPS profile, view system status, start/stop/restart deployed protocol services, and inspect recent service logs.

## Install

### Download a Release

Download the build for your platform from the [Releases page](https://github.com/Con-Benksl/v-swift/releases).

| Platform | Asset | Install notes |
| --- | --- | --- |
| macOS Apple Silicon | `V-Swift_*_aarch64.dmg` | Open the DMG and drag the app into Applications |
| macOS Intel | `V-Swift_*_x64.dmg` | Open the DMG and drag the app into Applications |
| Windows x86_64 | `V-Swift_*_x64-setup.exe` or `*_x64_en-US.msi` | Run the installer |
| Debian / Ubuntu | `v-swift_*_amd64.deb` | Install with `sudo dpkg -i v-swift_*.deb` |
| Other Linux distributions | `v-swift_*_amd64.AppImage` | Mark executable and run directly |

If macOS blocks the app because it is not notarized, open **System Settings > Privacy & Security** and allow it manually, or run:

```bash
xattr -cr /Applications/V-Swift.app
```

### Build From Source

Prerequisites:

- Node.js 18 or newer
- Rust stable toolchain
- Tauri 2 system dependencies for your platform

Install dependencies and start the desktop app in development mode:

```bash
npm install
npm run tauri:dev
```

Create a production bundle:

```bash
npm run tauri:build
```

Build outputs are written under `src-tauri/target/release/bundle/`.

## Usage

1. Create a node and enter the VPS host, SSH port, username, and authentication method.
2. Choose VLESS-Reality or Hysteria2.
3. Start deployment and watch the live progress log.
4. Copy the generated subscription link from the node detail view.
5. Import the link into a compatible client, such as v2rayN, NekoBox, or another client that supports the generated protocol format.
6. Open the control panel for a saved VPS to check host metrics, manage `xray` or `hysteria2`, and read recent `journalctl` logs.

## Auto Update

V-Swift uses the official Tauri updater plugin to check GitHub Releases and install new versions. The app checks once on startup. You can also click **Check for updates** on the node list page. When an update is available, click **Download and install**; the app relaunches after installation.

To publish an update:

1. Bump the version in both `package.json` and `src-tauri/Cargo.toml`.
2. Create and push a Git tag such as `v0.2.0`.
3. GitHub Actions builds the platform installers, creates updater artifacts, uploads `latest.json`, and publishes the Release.

Maintainers must configure these GitHub repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the Tauri updater private key. The local backup is stored at `~/.tauri/v-swift-updater.key`; never commit it.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the private-key password. Leave it unset if the key was generated without a password.

If the private key is lost, existing clients cannot verify future update packages and users must reinstall a new build manually.

## VPS Requirements

- Debian 11+ or Ubuntu 20.04+ is recommended.
- The account must be `root` or have passwordless `sudo` access.
- The server must have at least one public port reachable from your client.
- For VLESS-Reality, TCP 443 is recommended when available; if it is already occupied, choose another reachable TCP port such as 8443.
- For Hysteria2, choose and open a reachable UDP port, commonly in the high port range.
- The target system should use `systemd`.
- Existing firewall rules should be reviewed before deployment, especially on production hosts.

## Cloud Security Group Ports

V-Swift configures basic firewall rules inside the VPS operating system, but it cannot automatically edit the security group or cloud firewall rules in providers such as AWS, Google Cloud, Azure, Alibaba Cloud, Tencent Cloud, Vultr, or DigitalOcean. Before deployment, open the required port in your cloud provider console. Otherwise, the app may finish installing the service while clients still cannot connect, or the connection may behave poorly.

Steps:

1. In V-Swift, confirm the protocol and port you are going to deploy.
2. For VLESS-Reality, `TCP 443` is recommended by default. If 443 is already used by a website or another service, use `TCP 8443` or another free TCP port.
3. For Hysteria2, open the exact `UDP` port entered in V-Swift.
4. V-Swift also installs a managed multi-node subscription service, which requires `TCP 18080` by default.
5. Sign in to your cloud provider console and find the security group, firewall, or network rules attached to the VPS instance.
6. Add an inbound rule:
   - Protocol: use `TCP` for VLESS-Reality and `UDP` for Hysteria2.
   - Port: enter the node port from V-Swift, such as `443`, `8443`, or your custom port.
   - Source: for normal personal use, `0.0.0.0/0` allows IPv4 clients; add `::/0` too if the server uses IPv6.
   - Action: allow or accept the traffic.
7. Add another inbound rule for the managed subscription service:
   - Protocol: `TCP`
   - Port: `18080`
   - Source: for normal personal use, `0.0.0.0/0`; add `::/0` too if the server uses IPv6.
   - Action: allow or accept the traffic.
8. Save the rule and confirm it is attached to the exact VPS instance, region, and network you are deploying to.

Additional notes:

- V-Swift logs in over SSH, so your SSH port must also be open in the security group, such as the default `TCP 22` or your custom SSH port.
- If you only want to allow your own fixed IP, use your public IP as the source. Be aware that mobile networks, home broadband, and ISP exits may change IPs and break access later.
- Cloud security groups and the VPS operating-system firewall are separate layers. V-Swift handles the basic OS-level rule, but you still need to confirm the cloud-level rule manually.
- If deployment finishes but the app reports that the public port is unreachable, check the port number, TCP/UDP selection, security group binding, instance region, and any extra provider firewall policy first.

## Security and Privacy

- SSH credentials are not committed to the repository and are not stored in plaintext project files.
- Runtime credentials are stored through the operating system credential store.
- Generated node metadata is stored locally by the desktop app and may include protocol parameters required to rebuild subscription links.
- Treat the local application data directory as sensitive.
- Deployment scripts run on the target VPS with elevated privileges when needed.
- Review the scripts under `src-tauri/scripts/` before running the app against servers you care about.

## Repository Layout

```text
.
├── .github/workflows/       # Release workflow
├── src/                     # React frontend
│   ├── components/          # Reusable UI components
│   │   └── control/         # VPS control-panel UI components
│   ├── ipc/                 # Tauri IPC types and wrappers
│   └── pages/               # Node list, creation wizard, detail, and control-panel views
├── src-tauri/
│   ├── scripts/             # VPS-side deployment and uninstall scripts
│   └── src/                 # Rust backend
│       ├── control/         # SSH pool, system monitor, service control, and log retrieval
│       ├── credentials/     # OS credential-store integration
│       ├── deploy/          # Protocol deployment orchestration
│       ├── ssh/             # SSH client wrapper
│       ├── storage/         # Local node storage
│       └── subscription/    # Subscription URI generation
└── README.zh-CN.md          # Simplified Chinese documentation
```

## Tech Stack

- **Desktop framework**: Tauri 2
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Rust, Tokio, russh
- **Storage**: rusqlite and OS credential stores
- **Protocols**: Xray-core VLESS-Reality and Hysteria2
- **CI / Release**: GitHub Actions and `tauri-apps/tauri-action`

## Legal Notice

This project is provided for educational, research, and authorized administration purposes only. Do not use it for unauthorized access, abuse, evasion of lawful controls, distribution of illegal content, or any activity prohibited by your jurisdiction or service provider.

By downloading, building, or running this project, you acknowledge that you are solely responsible for how you use it and for any consequences of operating servers deployed with it.

## License

The source code is licensed under the [MIT License](LICENSE). The license grants rights to the source code only and does not authorize or endorse any particular deployment or network usage.
