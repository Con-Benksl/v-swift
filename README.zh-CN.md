# V-Swift

[English](README.md) | [简体中文](README.zh-CN.md)

> VPS、端口、安全组这些已经玩明白的大佬，可以直接去 [大佬通道](#大佬通道)。不想从“这是啥”开始看，就走那边。

V-Swift 做的事很朴素：你准备一台 VPS，把 SSH 信息填进去，它帮你连上服务器，安装环境，配置 VLESS-Reality 或 Hysteria2，然后把生成的节点信息保存到本地。少敲一堆命令，也少踩一点坑。

## 快速导航

| 你现在想干嘛 | 去哪看 |
| --- | --- |
| 我第一次用，只想赶紧跑起来 | [新手上车](#新手上车) |
| 我只想知道要准备什么 | [先准备这些](#先准备这些) |
| 我要下载 App | [安装 V-Swift](#安装-v-swift) |
| 我要照着步骤部署 | [第一次部署节点](#第一次部署节点) |
| 我部署完连不上 | [常见小坑](#常见小坑) |
| 我想看端口、脚本、构建、发布这些细节 | [大佬通道](#大佬通道) |

## 新手上车

如果你现在的想法是“我有一台 VPS，想赶紧把节点跑起来”，先看这里。

### V-Swift 是啥

V-Swift 不是代理客户端，它更像一个“VPS 节点部署小帮手”。

它主要帮你做三件事：

| 阶段 | V-Swift 做什么 |
| --- | --- |
| 部署前 | 通过 SSH 连接你的 VPS |
| 部署中 | 安装组件，配置 VLESS-Reality 或 Hysteria2 |
| 部署后 | 保存节点信息，生成订阅链接，提供控制面板 |

部署完以后，你还是要把订阅链接导入 v2rayN、NekoBox、Clash、Mihomo 这类客户端里使用。V-Swift 不接管你电脑上的网络流量，它只负责把 VPS 那一端收拾好。

### 先准备这些

别急着点下载，先确认手里有这些东西：

| 需要准备 | 说明 |
| --- | --- |
| VPS | 必须是你有权限管理的服务器 |
| VPS IP | 后面连接 SSH 要用 |
| SSH 登录信息 | 用户名和密码，或者用户名和私钥 |
| SSH 端口 | 通常是 `22`，如果你改过就填自己的 |
| 客户端 | v2rayN、NekoBox、Clash、Mihomo 等都可以 |

如果你的 VPS 是云服务器，还要去云厂商控制台放行端口。V-Swift 可以处理服务器内部的一些基础防火墙规则，但它不会跑去阿里云、腾讯云、AWS、Vultr、DigitalOcean 的后台替你改安全组。

### 安装 V-Swift

去 [Releases 页面](https://github.com/Con-Benksl/v-swift/releases) 下载最新版。

| 平台 | 文件 | 怎么装 |
| --- | --- | --- |
| macOS Apple Silicon | `V-Swift_*_aarch64.dmg` | 打开 DMG，把 V-Swift 拖进 Applications |
| Windows x86_64 | `V-Swift_*_x64-setup.exe` 或 `V-Swift_*_x64_en-US.msi` | 运行安装程序 |
| Debian / Ubuntu | `V-Swift_*_amd64.deb` | `sudo dpkg -i V-Swift_*.deb` |
| RPM 系 Linux | `V-Swift-*-1.x86_64.rpm` | 用发行版的软件包管理器安装 |
| 其他 Linux 发行版 | `V-Swift_*_amd64.AppImage` | 加执行权限后直接运行 |

当前新版不再提供 macOS Intel 安装包。

macOS 如果因为未公证签名拦住应用，可以到 **系统设置 > 隐私与安全性** 里手动允许。也可以执行：

```bash
xattr -cr /Applications/V-Swift.app
```

### 第一次部署节点

按这个顺序来，不用想太多：

| 步骤 | 做什么 | 说明 |
| --- | --- | --- |
| 1 | 打开 V-Swift | 进入主界面 |
| 2 | 新建节点 | 开始一条新的 VPS 部署 |
| 3 | 填 SSH 信息 | VPS 地址、端口、用户名、密码或私钥 |
| 4 | 选择协议 | 不确定就先用 VLESS-Reality |
| 5 | 开始部署 | 等进度日志跑完 |
| 6 | 复制订阅链接 | 在节点详情页复制 |
| 7 | 导入客户端 | 放进 v2rayN、NekoBox、Clash、Mihomo 等客户端 |

想用 Hysteria2 的话，先确认 UDP 端口已经在云厂商安全组里放行。这个很关键，不然后面容易出现“部署成功但就是连不上”的经典场面。

### 部署完还能干嘛

V-Swift 不只是“一次性安装器”。节点部署完以后，你还可以用它做维护：

| 功能 | 用途 |
| --- | --- |
| 节点列表 | 查看已经保存的节点 |
| 节点详情 | 再复制一次订阅链接 |
| VPS 控制面板 | 看服务是不是还活着 |
| 服务操作 | 重启、停止已经部署好的服务 |
| 日志查看 | 翻一下最近的服务日志 |
| 卸载 | 移除由 V-Swift 部署过的服务 |

### 常见小坑

| 问题 | 先看哪里 |
| --- | --- |
| SSH 连不上 | IP、端口、用户名、密码或私钥有没有填错；云厂商安全组有没有放行 SSH |
| 部署成功，但客户端连不上 | 节点端口大概率被云厂商安全组挡住了 |
| 不知道端口怎么选 | VLESS-Reality 先试 TCP `443`；Hysteria2 选 UDP 端口并确认放行 |
| V-Swift 能帮我买 VPS 吗 | 不能。钱包、账号、服务器都得你自己准备 |
| V-Swift 能替代客户端吗 | 不能。V-Swift 管服务端，客户端还是客户端 |

## 大佬通道

这部分给已经熟悉 VPS、部署、端口和安全组的人看。这里会少一点“点哪里”，多一点“它到底改了什么”。

### 技术索引

| 想看什么 | 位置 |
| --- | --- |
| 项目到底负责什么 | [职责边界](#职责边界) |
| VPS 和系统要求 | [VPS 技术要求](#vps-技术要求) |
| 云安全组怎么放 | [云平台防火墙检查](#云平台防火墙检查) |
| 仓库里文件怎么分 | [项目结构](#项目结构) |
| 本地怎么跑 | [从源码构建](#从源码构建) |
| 怎么发新版 | [发布与自动更新](#发布与自动更新) |
| 凭据和脚本风险 | [安全与隐私](#安全与隐私) |

### 职责边界

V-Swift 做的是服务端部署和本地节点管理，具体包括：

- 通过 Xray-core 部署 VLESS-Reality；
- 通过 QUIC/TLS 部署 Hysteria2；
- 通过 SSH 连接 VPS；
- 用系统凭据管理器保存 SSH 凭据；
- 通过 Tauri 事件把 Rust 后端的部署进度推给 React 前端；
- 在本地保存节点信息和订阅链接；
- 在 VPS 上安装面向 Clash/Mihomo 的远程订阅服务；
- 提供控制面板，用于查看系统状态、控制服务和读取日志；
- 卸载由本应用部署过的远端协议服务。

它不负责本机流量转发，不创建云服务器，也不管理云厂商安全组。

### VPS 技术要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Debian 11+ 或 Ubuntu 20.04+ 推荐 |
| 权限 | `root`，或具备免密 `sudo` 权限 |
| 服务管理 | 目标系统应使用 `systemd` |
| VLESS-Reality | TCP，常见选择是 `443` |
| Hysteria2 | UDP，所选端口必须能从客户端访问 |
| 远程托管订阅 | 默认 TCP `18080` |

如果目标主机已经有生产防火墙规则，部署前先人工确认，不要直接覆盖线上策略。

### 云平台防火墙检查

V-Swift 可以配置 Linux 系统内部的基础防火墙规则，但云厂商安全组是另一层，需要单独检查。

部署前确认：

1. SSH 端口是开放的，通常是 `TCP 22` 或你的自定义 SSH 端口。
2. VLESS-Reality 对应的 TCP 节点端口已放行。
3. Hysteria2 对应的 UDP 节点端口已放行。
4. 如果启用远程托管订阅，`TCP 18080` 已放行。
5. 只有在接受公网访问时才使用 `0.0.0.0/0`；需要 IPv6 时再加 `::/0`。
6. 如果限制为自己的公网 IP，要考虑家庭宽带和移动网络出口 IP 变化。

如果部署成功但无法连接，优先查端口号、TCP/UDP 类型、安全组绑定的实例、实例区域和云厂商额外防火墙策略，再回头查应用逻辑。

### 项目结构

```text
.
├── .github/workflows/       # 发布工作流
├── src/                     # React 前端
│   ├── components/          # 可复用 UI 组件
│   │   └── control/         # VPS 控制面板 UI 组件
│   ├── ipc/                 # Tauri IPC 类型和封装
│   └── pages/               # 节点列表、创建向导、详情页和控制面板
├── src-tauri/
│   ├── scripts/             # VPS 端部署和卸载脚本
│   └── src/                 # Rust 后端
│       ├── control/         # SSH 连接池、系统监控、服务控制和日志读取
│       ├── credentials/     # 系统凭据管理器集成
│       ├── deploy/          # 协议部署编排
│       ├── ssh/             # SSH 客户端封装
│       ├── storage/         # 本地节点存储
│       └── subscription/    # 订阅 URI 生成
└── README.md                # 英文文档
```

### 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 前端 | React 18、TypeScript、Vite、Tailwind CSS |
| 后端 | Rust、Tokio、russh |
| 存储 | rusqlite、系统凭据管理器 |
| 协议 | Xray-core VLESS-Reality、Hysteria2 |
| CI / 发布 | GitHub Actions、`tauri-apps/tauri-action` |

### 从源码构建

环境要求：

- Node.js 22 或更高版本
- Rust stable 工具链
- 当前平台所需的 Tauri 2 系统依赖

开发模式运行：

```bash
npm install
npm run tauri:dev
```

只调前端时，也可以不开 Tauri，直接在浏览器里跑：

```bash
npm run dev
```

此时后端调用会走 `src/ipc/devMock.ts` 里的假数据，全部页面与部署流程都能走通。这层 mock 只在开发模式且非 Tauri 环境下启用，不会进入生产构建。

构建发行包：

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。

提交前请确保以下检查通过（CI 会跑同样的命令）：

```bash
npm run build
```

```bash
cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test
```

### 发布与自动更新

V-Swift 使用 Tauri 官方 updater 插件从 GitHub Releases 检查更新。应用启动后会自动检查一次，也可以在节点列表页点击 **检查更新**。

发布流程：

| 步骤 | 操作 |
| --- | --- |
| 1 | 同步提升 `package.json` 和 `src-tauri/Cargo.toml` 的版本号，并刷新两个 lockfile（`npm install --package-lock-only` 与 `cargo check`）|
| 2 | 在 `CHANGELOG.md` 补上本次发布的条目 |
| 3 | 创建并推送形如 `v0.4.0` 的 Git tag |
| 4 | 等待 GitHub Actions 构建安装包、updater archive、签名文件和 `latest.json` |

仓库需要配置这些 GitHub Secrets：

| Secret | 用途 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 私钥内容；本机备份位于 `~/.tauri/v-swift-updater.key`，不要提交到仓库 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；如果生成私钥时没有设置密码，可以不配置 |

如果私钥丢失，旧版客户端将无法验证未来更新包，用户需要手动重新安装新版应用。

### 安全与隐私

- SSH 凭据不会提交到仓库，也不会写入明文项目配置文件。
- 运行时凭据通过系统凭据管理器保存。
- 节点元数据保存在本地，其中可能包含重新生成订阅链接所需的协议参数。
- 本地应用数据目录应视为敏感位置。
- 部署脚本可能会在目标 VPS 上执行高权限命令。
- 对重要服务器使用前，建议先阅读 `src-tauri/scripts/` 下的脚本。

### 合规声明

本项目仅供学习、研究和已授权的系统管理用途。请勿将其用于未经授权访问、滥用网络资源、规避合法监管、传播违法内容，或任何违反所在地法律法规与服务商条款的行为。

下载、构建或运行本项目即表示你理解并同意：你需要自行承担使用本项目以及运行相关服务器所产生的一切责任和后果。

## License

源代码基于 [MIT License](LICENSE) 授权。该许可证仅授予对源代码的使用、修改和再分发权利，不构成对任何具体部署方式或网络使用行为的授权或背书。
