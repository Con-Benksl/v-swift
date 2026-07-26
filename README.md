# V-Swift

[English](README.md) | [简体中文](README.zh-CN.md)

> Already know your VPS ports, firewall rules, and deployment drill? Jump to the [Power User Lane](#power-user-lane). No need to sit through the "what is this thing" part.

V-Swift keeps the job simple: bring your own VPS, enter the SSH details, and let the app connect to the server, install the runtime, configure VLESS-Reality or Hysteria2, and save the generated node information locally. Fewer copy-pasted shell commands, fewer easy mistakes.

## Quick Navigation

| Goal | Start here |
| --- | --- |
| I am new and just want a working node | [Beginner Lane](#beginner-lane) |
| I want to know what I need first | [What You Need](#what-you-need) |
| I want to download the app | [Install V-Swift](#install-v-swift) |
| I want deployment steps | [Deploy Your First Node](#deploy-your-first-node) |
| Deployment worked but connection failed | [Common Snags](#common-snags) |
| I want ports, builds, releases, and internals | [Power User Lane](#power-user-lane) |

## Beginner Lane

If your goal is "I have a VPS and I want a working node", start here.

### What V-Swift Is

V-Swift is not a proxy client. It is closer to a VPS setup assistant.

| Stage | What V-Swift does |
| --- | --- |
| Before deployment | Connects to your VPS over SSH |
| During deployment | Installs components and configures VLESS-Reality or Hysteria2 |
| After deployment | Saves node information, generates links, and provides a control panel |

After deployment, import the generated link into a client such as v2rayN, NekoBox, Clash, or Mihomo. V-Swift does not route traffic on your computer; it prepares the server side.

### What You Need

Before downloading anything, make sure you have:

| Requirement | Notes |
| --- | --- |
| VPS | A server you are allowed to manage |
| Server IP | Used for SSH connection |
| SSH login | Username plus password, or username plus private key |
| SSH port | Usually `22`, unless you changed it |
| Client app | v2rayN, NekoBox, Clash, Mihomo, or another compatible client |

If your VPS comes from a cloud provider, open the required ports in that provider's dashboard. V-Swift can handle some basic firewall rules inside Linux, but it cannot edit AWS, Alibaba Cloud, Tencent Cloud, Vultr, DigitalOcean, or other provider security groups for you.

### Install V-Swift

Download the latest build from the [Releases page](https://github.com/Con-Benksl/v-swift/releases).

| Platform | Asset | What to do |
| --- | --- | --- |
| macOS Apple Silicon | `V-Swift_*_aarch64.dmg` | Open the DMG and drag V-Swift into Applications |
| Windows x86_64 | `V-Swift_*_x64-setup.exe` or `V-Swift_*_x64_en-US.msi` | Run the installer |
| Debian / Ubuntu | `V-Swift_*_amd64.deb` | `sudo dpkg -i V-Swift_*.deb` |
| RPM-based Linux | `V-Swift-*-1.x86_64.rpm` | Install with your package manager |
| Other Linux distributions | `V-Swift_*_amd64.AppImage` | Mark it executable and run it |

New releases currently do not include macOS Intel builds.

If macOS blocks the app because it is not notarized, open **System Settings > Privacy & Security** and allow it manually. You can also remove the quarantine flag:

```bash
xattr -cr /Applications/V-Swift.app
```

### Deploy Your First Node

Follow the steps in order:

| Step | Action | Notes |
| --- | --- | --- |
| 1 | Open V-Swift | Go to the main screen |
| 2 | Create a new node | Start a new VPS deployment |
| 3 | Enter SSH details | VPS address, port, username, password or private key |
| 4 | Choose a protocol | If unsure, start with VLESS-Reality |
| 5 | Start deployment | Wait for the progress log to finish |
| 6 | Copy the subscription link | Find it on the node detail page |
| 7 | Import into your client | v2rayN, NekoBox, Clash, Mihomo, or another compatible client |

Choose Hysteria2 only after confirming that the UDP port is open. Otherwise you may hit the classic "deployment succeeded, connection failed" situation.

### What You Can Do After Deployment

V-Swift is not just a one-shot installer.

| Feature | Use it for |
| --- | --- |
| Node list | View saved nodes |
| Node detail | Copy subscription links again |
| VPS control panel | Check whether the service is alive |
| Service controls | Restart or stop the deployed service |
| Logs | Read recent service logs |
| Uninstall | Remove services deployed by V-Swift |

### Common Snags

| Problem | Check first |
| --- | --- |
| SSH cannot connect | IP, port, username, password or private key; provider firewall for SSH |
| Deployment succeeded, but the client cannot connect | The selected node port is probably blocked by the provider security group |
| Which port should I choose? | Try TCP `443` for VLESS-Reality if free; choose and open a UDP port for Hysteria2 |
| Can V-Swift buy or create a VPS for me? | No. Bring your own server and account |
| Can V-Swift replace v2rayN, Clash, NekoBox, or Mihomo? | No. V-Swift handles the server side; your client app handles daily traffic |

## Power User Lane

This section is for people who already know their way around VPS deployment and want to see what the app actually changes.

### Technical Index

| Topic | Section |
| --- | --- |
| What the project owns | [Scope](#scope) |
| Server requirements | [Server Requirements](#server-requirements) |
| Cloud security groups | [Cloud Firewall Checklist](#cloud-firewall-checklist) |
| Repository layout | [Repository Layout](#repository-layout) |
| Local development | [Build From Source](#build-from-source) |
| Release flow | [Release And Updater](#release-and-updater) |
| Credential and script risks | [Security And Privacy](#security-and-privacy) |

### Scope

V-Swift handles server-side deployment and local node management:

- deploys VLESS-Reality through Xray-core;
- deploys Hysteria2 through QUIC/TLS;
- connects to VPS hosts over SSH;
- stores SSH credentials through the OS credential store;
- streams deployment progress from Rust to React through Tauri events;
- stores node metadata and subscription links locally;
- installs a VPS-side Clash/Mihomo subscription service;
- provides a control panel for system status, service operations, and logs;
- uninstalls remote protocol services deployed by the app.

It does not route local traffic, provision cloud servers, or manage provider-level firewalls.

### Server Requirements

| Item | Requirement |
| --- | --- |
| OS | Debian 11+ or Ubuntu 20.04+ recommended |
| Privilege | `root`, or a user with passwordless `sudo` |
| Service manager | `systemd` |
| VLESS-Reality | TCP, commonly `443` when available |
| Hysteria2 | UDP, and the selected port must be reachable |
| Managed subscription | TCP `18080` by default |

Check existing firewall rules before deploying to a production machine.

### Cloud Firewall Checklist

V-Swift can configure basic firewall rules inside Linux. Provider security groups are separate and must be checked manually.

Before deployment:

1. Keep the SSH port open, usually `TCP 22` or your custom SSH port.
2. For VLESS-Reality, allow the selected TCP node port.
3. For Hysteria2, allow the selected UDP node port.
4. If managed subscriptions are enabled, allow `TCP 18080`.
5. Use `0.0.0.0/0` only when broad IPv4 access is acceptable; add `::/0` if IPv6 access is needed.
6. If you restrict access to your own public IP, remember that home and mobile IPs can change.

When deployment succeeds but connectivity fails, inspect the port number, TCP/UDP choice, security group binding, instance region, and provider firewall policy before changing the app.

### Repository Layout

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

### Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop framework | Tauri 2 |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Rust, Tokio, russh |
| Storage | rusqlite and OS credential stores |
| Protocols | Xray-core VLESS-Reality and Hysteria2 |
| CI / Release | GitHub Actions and `tauri-apps/tauri-action` |

### Build From Source

Prerequisites:

- Node.js 18 or newer
- Rust stable toolchain
- Tauri 2 system dependencies for your platform

Run the app in development mode:

```bash
npm install
npm run tauri:dev
```

For frontend-only work you can skip Tauri and run it in a browser:

```bash
npm run dev
```

Backend calls then resolve against the fixtures in `src/ipc/devMock.ts`, so every page and the whole deployment flow stay reachable. That mock layer is only active in development outside Tauri and never reaches a production build.

Build a production bundle:

```bash
npm run tauri:build
```

Build outputs are written under `src-tauri/target/release/bundle/`.

Before committing, make sure these pass — CI runs the same commands:

```bash
npm run build
```

```bash
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test
```

### Release And Updater

V-Swift uses the official Tauri updater plugin. The app checks GitHub Releases on startup, and users can also trigger **Check for updates** from the node list page.

Release flow:

| Step | Action |
| --- | --- |
| 1 | Bump the version in `package.json` and `src-tauri/Cargo.toml`, then refresh both lockfiles (`npm install --package-lock-only` and `cargo check`) |
| 2 | Add a `CHANGELOG.md` entry for the release |
| 3 | Create and push a tag such as `v0.4.0` |
| 4 | Wait for GitHub Actions to build installers, updater archives, signatures, and `latest.json` |

Required repository secrets:

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater private key; local backup is stored at `~/.tauri/v-swift-updater.key`, never commit it |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Private-key password; leave unset if the key was generated without a password |

If the private key is lost, existing clients cannot verify future updater packages. Users will need to reinstall a new build manually.

### Security And Privacy

- SSH credentials are not committed to the repository and are not stored in plaintext project files.
- Runtime credentials are stored through the OS credential store.
- Node metadata is stored locally and may include parameters needed to rebuild subscription links.
- Treat the local app data directory as sensitive.
- Deployment scripts may run privileged commands on the target VPS.
- Read `src-tauri/scripts/` before using the app on servers you care about.

### Legal Notice

This project is provided for educational, research, and authorized administration purposes only. Do not use it for unauthorized access, network abuse, evasion of lawful controls, distribution of illegal content, or any activity prohibited by your jurisdiction or service provider.

By downloading, building, or running this project, you are responsible for how you use it and for any consequences of operating servers deployed with it.

## License

The source code is licensed under the [MIT License](LICENSE). The license grants rights to the source code only and does not authorize or endorse any particular deployment or network usage.
