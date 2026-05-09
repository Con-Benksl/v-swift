# V-Swift 远程控制面板设计文档

**版本**: 1.0
**日期**: 2026-05-09
**状态**: 设计中

---

## 1. 概述

### 1.1 背景

V-Swift 是一个基于 Tauri、React 和 Rust 构建的桌面端 VPS 节点部署器。当前项目支持部署 VLESS-Reality 和 Hysteria2 节点，但缺乏对已部署节点的后续管理能力。用户需要类似 3xUI 面板那样的远程操控功能来管理节点。

### 1.2 目标

为 V-Swift 添加远程控制面板功能，提供对已部署 VPS 节点的实时监控和服务管理能力。

### 1.3 范围

**第一阶段（本期）**:
- 服务管理：查看状态、启动/停止/重启服务
- 系统监控：CPU、内存、磁盘、网络流量
- 日志查看：服务运行日志
- 刷新机制：自动 + 手动

**后续阶段**:
- 配置在线修改
- 防火墙管理
- 多节点批量操作
- 历史流量统计

---

## 2. 架构设计

### 2.1 技术方案

**纯 SSH 命令轮询** - 复用现有 SSH 模块，通过 SSH 在 VPS 上执行系统命令获取数据。

```
前端 (React) ←→ 后端 (Rust/Tauri) ←→ SSH ←→ VPS
     ↓              ↓
  仪表盘 UI    控制模块 + 连接池
```

### 2.2 SSH 连接管理

- **连接池**: 每个 VPS 维护一个 SSH 连接
- **会话复用**: 用户在一段时间内连续操作复用同一连接
- **自动重连**: 连接断开时自动重连
- **超时处理**: 命令执行超时后断开并重连

### 2.3 数据流

```
用户进入控制面板
       ↓
  选择 VPS
       ↓
  建立/复用 SSH 连接
       ↓
  并行执行监控命令 (top, df, free, vnstat, systemctl)
       ↓
  解析结果，返回给前端
       ↓
  渲染监控卡片和服务列表
       ↓
  自动轮询 / 用户手动刷新
```

---

## 3. 页面布局

### 3.1 整体布局

```
┌──────────────────────────────────────────────────────────────────┐
│  VPS 选择器  [ ▼ 请选择 VPS ]           [刷新] [连接状态 ●]      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │   CPU    │  │   内存   │  │   磁盘   │  │   流量   │          │
│  │   45%    │  │  2.1GB   │  │   62%    │  │  ↑↓ 图表 │          │
│  │  ▓▓▓▓░░  │  │  ▓▓▓░░░  │  │  ▓▓▓▓▓░  │  │          │          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│                                                                  │
│  ── 服务管理 ─────────────────────────────────────────────────    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [🟢] VLESS Reality  │  端口: 443  │  状态: 运行中  │ [重启] │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │ [🟢] Hysteria2     │  端口: 4433 │  状态: 运行中  │ [重启] │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ── 操作日志 ─────────────────────────────────────────────────   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [10:30:15] 服务已启动                                        │ │
│  │ [10:30:10] 正在重启服务...                                   │ │
│  │ [10:25:03] 内存使用率: 45%                                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 响应式设计

- **桌面端 (≥1024px)**: 监控卡片 4 列排列
- **平板端 (768-1023px)**: 监控卡片 2 列排列
- **移动端 (<768px)**: 监控卡片 1 列排列，服务列表堆叠

---

## 4. 功能模块

### 4.1 VPS 选择器

- 显示所有已保存的 VPS 列表
- 显示每个 VPS 的在线状态指示器
- 选中后自动连接并刷新数据

### 4.2 系统监控

#### 监控指标

| 指标 | 数据来源 | 刷新频率 |
|------|----------|----------|
| CPU 使用率 | `top -bn1 \| grep "Cpu(s)"` | 10秒 |
| 内存使用率 | `free -m` | 10秒 |
| 磁盘使用率 | `df -h /` | 30秒 |
| 网络流量 | `vnstat -i eth0 --oneline` 或 `/proc/net/dev` | 10秒 |

#### 显示格式

- **CPU**: 百分比 + 进度条
- **内存**: 已用/总量 (如 2.1GB / 4GB) + 百分比
- **磁盘**: 已用/总量 + 百分比
- **流量**: 上传/下载 累计 + 实时速率

### 4.3 服务管理

#### 支持的服务

| 协议 | systemd 服务名 | 进程名 |
|------|----------------|--------|
| VLESS Reality | `xray` | `xray` |
| Hysteria2 | `hysteria2` 或 `hy2` | `hysteria` |

#### 操作

- **查看状态**: `systemctl status <service>`
- **启动**: `sudo systemctl start <service>`
- **停止**: `sudo systemctl stop <service>`
- **重启**: `sudo systemctl restart <service>`
- **查看配置路径**: 从部署脚本或进程参数获取

#### 显示

- 服务图标 (协议类型)
- 协议名称
- 端口号
- 运行状态 (运行中/已停止/未知)
- 操作按钮 (启动/停止/重启)

### 4.4 日志查看

- 获取最近 50 条服务日志
- 使用 `journalctl -u <service> -n 50 --no-pager`
- 实时追加新日志 (可选)
- 支持滚动查看

### 4.5 刷新机制

- **进入页面**: 自动刷新一次
- **手动刷新**: 点击刷新按钮刷新所有数据
- **自动轮询**: 默认 30 秒，可配置 (10/30/60 秒)
- **轮询暂停**: 用户操作时暂停轮询，操作完成后恢复

---

## 5. 后端设计

### 5.1 Rust 模块结构

```
src-tauri/src/
├── control/                    # 新增控制模块
│   ├── mod.rs
│   ├── commands.rs             # Tauri IPC 命令
│   ├── ssh_pool.rs             # SSH 连接池
│   ├── monitor.rs              # 监控数据采集
│   └── service.rs              # 服务管理
```

### 5.2 IPC 命令接口

```rust
// 连接管理
#[tauri::command]
pub async fn connect_vps(state: State<'_, AppState>, vps_id: String) -> AppResult<()>

#[tauri::command]
pub async fn disconnect_vps(state: State<'_, AppState>, vps_id: String) -> AppResult<()>

#[tauri::command]
pub fn get_connection_status(state: State<'_, AppState>, vps_id: String) -> ConnectionStatus

// 监控数据
#[tauri::command]
pub async fn get_system_status(state: State<'_, AppState>, vps_id: String) -> AppResult<SystemStatus>

#[tauri::command]
pub async fn get_network_stats(state: State<'_, AppState>, vps_id: String) -> AppResult<NetworkStats>

// 服务管理
#[tauri::command]
pub async fn get_service_status(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<ServiceStatus>

#[tauri::command]
pub async fn restart_service(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<()>

#[tauri::command]
pub async fn start_service(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<()>

#[tauri::command]
pub async fn stop_service(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<()>

// 日志
#[tauri::command]
pub async fn get_service_logs(state: State<'_, AppState>, vps_id: String, protocol: String) -> AppResult<Vec<String>>
```

### 5.3 数据结构

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub cpu_percent: f64,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_percent: f64,
    pub disk_used_gb: f64,
    pub disk_total_gb: f64,
    pub disk_percent: f64,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    pub bytes_received: u64,
    pub bytes_sent: u64,
    pub rx_rate_bps: f64,
    pub tx_rate_bps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub name: String,
    pub protocol: String,
    pub port: u16,
    pub active: bool,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}
```

---

## 6. 前端设计

### 6.1 路由

```
/control              # 控制面板首页 (VPS 选择 + 概览)
/control/:vpsId       # 特定 VPS 的控制面板
```

### 6.2 组件结构

```
src/
├── pages/
│   └── ControlPanel.tsx      # 控制面板主页面
├── components/
│   ├── control/
│   │   ├── VpsSelector.tsx   # VPS 选择器
│   │   ├── StatusCard.tsx    # 监控卡片
│   │   ├── ServiceList.tsx   # 服务列表
│   │   ├── ServiceItem.tsx   # 单个服务项
│   │   └── LogViewer.tsx     # 日志查看器
```

### 6.3 状态管理

使用 React Context 管理控制面板状态：

```typescript
interface ControlState {
  selectedVpsId: string | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  systemStatus: SystemStatus | null;
  networkStats: NetworkStats | null;
  services: ServiceStatus[];
  logs: string[];
  isRefreshing: boolean;
  autoRefreshInterval: number;
}
```

---

## 7. 安全考虑

### 7.1 SSH 权限

- 服务启停需要 sudo 权限
- 使用 `NOPASSWD` 限制特定命令
- 不暴露完整 root 权限

### 7.2 凭据安全

- 复用现有的凭据存储系统 (keyring)
- SSH 连接不复用凭据明文

### 7.3 错误处理

- 网络异常时显示友好提示
- 命令执行失败时回退到断开连接
- 防止频繁重连导致 VPS 被封

---

## 8. 实施计划

### 阶段一：基础设施

1. 创建 `src-tauri/src/control/` 模块
2. 实现 SSH 连接池管理
3. 添加基础 IPC 命令

### 阶段二：监控功能

1. 实现系统状态采集
2. 实现网络流量统计
3. 前端监控卡片组件
4. 自动刷新逻辑

### 阶段三：服务管理

1. 实现服务状态查询
2. 实现服务启停重启
3. 前端服务列表组件
4. 操作确认和反馈

### 阶段四：日志功能

1. 实现日志获取
2. 前端日志查看器
3. 实时日志追加

### 阶段五：UI/UX 完善

1. 页面布局和样式
2. 响应式设计
3. 加载状态和错误处理
4. 动画和过渡效果

---

## 9. 参考资料

- [3xUI GitHub](https://github.com/MHSanaei/3x-ui)
- [x-ui 功能特性](https://github.com/alireza0/x-ui)
- [V-Swift 项目结构](../README.zh-CN.md)
