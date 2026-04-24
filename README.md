# V-Swift

> ⚠️ **免责声明 / Disclaimer**
>
> 本项目仅供**个人学习、技术研究与网络安全教学**用途，旨在帮助开发者理解 SSH 远程编排、Tauri 桌面应用架构、Rust 异步编程、QUIC / TLS 协议工程实现等技术原理。
>
> - 使用者应当自行确保所部署的 VPS 节点及其使用方式**符合所在国家、地区及服务器供应商的法律法规与服务条款**。
> - **严禁**将本项目用于任何违反当地法律法规的用途，包括但不限于：未经授权访问网络、传播违法信息、干扰公共秩序、规避合法监管等。
> - 本项目作者及贡献者**不对任何使用者的行为及由此产生的任何直接或间接后果承担任何法律责任**。
> - 下载、克隆、编译或运行本项目代码即视为您已阅读、理解并同意上述声明。如不同意，请立即停止使用并删除相关文件。
>
> **This project is provided for educational and research purposes only. Users are solely responsible for compliance with all applicable laws and regulations in their jurisdiction. The authors assume no liability for misuse.**

---

一键部署 VPS 代理节点的桌面客户端 —— 通过 SSH 远程登录全新 Linux VPS，自动完成依赖安装、协议配置、防火墙加固，最终生成可直接导入客户端的订阅链接。

基于 [Tauri 2](https://tauri.app/) + React + Rust 构建，单二进制分发，原生跨平台（macOS / Windows / Linux）。

---

## 特性

- **两种协议开箱即用**
  - **VLESS-Reality** —— 基于 Xray-core，伪装目标握手抗主动探测
  - **Hysteria2** —— 基于 QUIC，弱网环境吞吐更稳
- **全自动部署流水线** —— 系统检测 → 依赖安装 → 内核组件下载 → 协议配置 → 防火墙加固 → 服务启停 → 落盘订阅
- **实时部署进度** —— 后端通过 Tauri 事件流推送每一步日志，前端无缓冲展示
- **凭据安全存储** —— SSH 密码 / 私钥使用系统密钥环（macOS Keychain / Windows Credential Manager / Linux Secret Service）
- **节点管理** —— 多节点并存、订阅查看、一键卸载
- **健壮的错误处理** —— 所有部署脚本带防 SSH 自锁、服务启动失败诊断、端口监听校验

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- Rust 工具链（`rustup default stable`）
- Tauri 2 系统依赖（参考 [Tauri Prerequisites](https://tauri.app/start/prerequisites/)）

### 开发模式

```bash
npm install
npm run tauri:dev
```

### 构建发行包

```bash
npm run tauri:build
```

产物位置：`src-tauri/target/release/bundle/`（macOS `.dmg` / Windows `.msi` / Linux `.deb` `.AppImage`）

---

## 使用流程

1. **新建节点** —— 输入 VPS IP、SSH 端口、登录凭据（密码或私钥）
2. **选择协议** —— VLESS-Reality 或 Hysteria2，可自定义节点名
3. **执行部署** —— 客户端 SSH 进入 VPS 自动跑完整套部署脚本，全程实时显示进度
4. **导入订阅** —— 部署完成后在节点详情页复制订阅链接到客户端（v2rayN / NekoBox 等）

---

## VPS 系统要求

- Debian 11+ / Ubuntu 20.04+（其他 systemd 发行版理论可用）
- root 用户或具备 sudo 免密的账号
- 至少一个公网可访问端口（部署器会自动随机分配并配置 UFW/nftables）

---

## 项目结构

```
.
├── src/                    # React 前端（节点向导 / 部署进度 / 订阅视图）
├── src-tauri/
│   ├── src/
│   │   ├── commands.rs     # Tauri IPC 命令层
│   │   ├── ssh/            # russh 0.45 SSH 客户端封装
│   │   ├── deploy/         # 部署编排（VLESS-Reality / Hysteria2）
│   │   ├── credentials/    # 系统密钥环集成
│   │   └── storage/        # 节点 / 订阅本地存储
│   └── scripts/            # VPS 端 Shell 脚本（含 download_with_heartbeat、防火墙保护）
└── README.md
```

---

## 技术栈

- **桌面框架**：Tauri 2（Rust 后端 + WebView 前端）
- **前端**：React 18 + TypeScript + Vite + Tailwind CSS
- **路由**：React Router v6
- **SSH**：[russh](https://github.com/warp-tech/russh) 0.45（纯 Rust 实现）
- **协议内核**：[Xray-core](https://github.com/XTLS/Xray-core) / [Hysteria2](https://github.com/apernet/hysteria)

---

## License

MIT —— 但请注意：MIT 许可证仅授予您对本仓库**源代码**的使用、修改、再分发权利，**不构成对您实际部署或使用代理服务行为的任何法律授权或背书**。具体使用方式的合规性由使用者本人承担全部责任。详见文首免责声明。
