# V-Swift

[English](README.md) | [简体中文](README.zh-CN.md)

V-Swift 是一个基于 Tauri、React 和 Rust 构建的桌面端 VPS 节点部署器。它通过 SSH 连接到全新的 Linux VPS，自动安装依赖、配置 VLESS-Reality 或 Hysteria2、设置基础防火墙规则，并生成可导入兼容客户端的订阅链接。

本项目面向个人学习、技术研究和已授权的基础设施管理场景。你需要自行确保服务器部署方式、网络使用方式以及服务商条款均符合所在国家或地区的法律法规。

## 项目定位

V-Swift 不是通用代理客户端，也不会在本机接管流量。它的核心职责是把重复的服务端部署流程自动化，并在桌面端保存节点信息和订阅链接。

当前范围：

- 部署基于 Xray-core 的 VLESS-Reality 节点
- 部署基于 QUIC/TLS 的 Hysteria2 节点
- 通过 SSH 连接 VPS 主机
- 使用系统凭据管理器保存 SSH 凭据
- 通过 Tauri 事件实时展示部署进度
- 在本地保存节点记录和订阅链接
- 从目标 VPS 卸载已部署的协议服务

## 特性

- **引导式节点创建**：输入 VPS 连接信息、选择协议，并从桌面界面启动部署流程。
- **双协议支持**：支持 VLESS-Reality 和 Hysteria2 两种部署方式。
- **SSH 远程自动化**：系统检测、依赖安装、协议配置、服务管理和防火墙设置由内置脚本完成。
- **实时进度日志**：Rust 后端通过 Tauri 事件把部署日志推送到 React 前端。
- **凭据安全存储**：SSH 密码或私钥认证信息通过 `keyring` 存入 macOS Keychain、Windows Credential Manager 或 Linux Secret Service。
- **本地节点管理**：支持查看节点、复制订阅链接、删除节点以及卸载远端服务。

## 安装

### 下载发行版

前往 [Releases 页面](https://github.com/Con-Benksl/v-swift/releases) 下载对应平台的安装包。

| 平台 | 文件 | 安装方式 |
| --- | --- | --- |
| macOS Apple Silicon | `V-Swift_*_aarch64.dmg` | 打开 DMG 后拖入 Applications |
| macOS Intel | `V-Swift_*_x64.dmg` | 打开 DMG 后拖入 Applications |
| Windows x86_64 | `V-Swift_*_x64-setup.exe` 或 `*_x64_en-US.msi` | 运行安装程序 |
| Debian / Ubuntu | `v-swift_*_amd64.deb` | 使用 `sudo dpkg -i v-swift_*.deb` 安装 |
| 其他 Linux 发行版 | `v-swift_*_amd64.AppImage` | 添加执行权限后直接运行 |

如果 macOS 因未公证签名阻止启动，可以在 **系统设置 > 隐私与安全性** 中手动允许，或执行：

```bash
xattr -cr /Applications/V-Swift.app
```

### 从源码构建

环境要求：

- Node.js 18 或更高版本
- Rust stable 工具链
- 当前平台所需的 Tauri 2 系统依赖

安装依赖并以开发模式启动桌面应用：

```bash
npm install
npm run tauri:dev
```

构建发行包：

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 使用流程

1. 新建节点，填写 VPS 主机、SSH 端口、用户名和认证方式。
2. 选择 VLESS-Reality 或 Hysteria2。
3. 启动部署，并查看实时进度日志。
4. 在节点详情页复制生成的订阅链接。
5. 将订阅链接导入 v2rayN、NekoBox 或其他支持对应协议格式的客户端。

## VPS 要求

- 推荐 Debian 11+ 或 Ubuntu 20.04+。
- 登录账号需要是 `root`，或具备免密 `sudo` 权限。
- 服务器至少需要一个可被客户端访问的公网端口。
- 目标系统应使用 `systemd`。
- 如果目标主机已有生产防火墙规则，部署前应先人工确认。

## 安全与隐私

- SSH 凭据不会提交到仓库，也不会写入明文项目配置文件。
- 运行时凭据通过操作系统凭据管理器保存。
- 生成的节点元数据保存在桌面应用本地，其中可能包含用于重新生成订阅链接的协议参数。
- 请将本地应用数据目录视为敏感数据位置。
- 部署脚本会在必要时以高权限在目标 VPS 上执行。
- 建议在对重要服务器运行前，先审阅 `src-tauri/scripts/` 下的脚本。

## 仓库结构

```text
.
├── .github/workflows/       # 发布工作流
├── src/                     # React 前端
│   ├── components/          # 可复用 UI 组件
│   ├── ipc/                 # Tauri IPC 类型和封装
│   └── pages/               # 节点列表、创建向导和详情页
├── src-tauri/
│   ├── scripts/             # VPS 端部署和卸载脚本
│   └── src/                 # Rust 后端
│       ├── credentials/     # 系统凭据管理器集成
│       ├── deploy/          # 协议部署编排
│       ├── ssh/             # SSH 客户端封装
│       ├── storage/         # 本地节点存储
│       └── subscription/    # 订阅 URI 生成
└── README.md                # 英文文档
```

## 技术栈

- **桌面框架**：Tauri 2
- **前端**：React 18、TypeScript、Vite、Tailwind CSS
- **后端**：Rust、Tokio、russh
- **存储**：rusqlite 和系统凭据管理器
- **协议**：Xray-core VLESS-Reality、Hysteria2
- **CI / 发布**：GitHub Actions 和 `tauri-apps/tauri-action`

## 合规声明

本项目仅供学习、研究和已授权的系统管理用途。请勿将其用于未经授权访问、滥用网络资源、规避合法监管、传播违法内容，或任何违反所在地法律法规与服务商条款的行为。

下载、构建或运行本项目即表示你理解并同意：你需要自行承担使用本项目以及运行相关服务器所产生的一切责任和后果。

## License

源代码基于 [MIT License](LICENSE) 授权。该许可证仅授予对源代码的使用、修改和再分发权利，不构成对任何具体部署方式或网络使用行为的授权或背书。
