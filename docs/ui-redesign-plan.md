# V-Swift 前端 UI 重构设计方案

> 版本：v1.0 · 2026-07-18
> 范围：`src/` 全部前端代码（Tauri 2 + React 18 + Tailwind CSS 3）
> 基于对全部 15 个前端文件（约 3800 行）的逐文件审计

---

## 0. 现状诊断：为什么"丑"

审计结论高度一致：**工程素养在线，视觉体系缺位**。逻辑层（连接竞态处理、状态机、loading/empty/error 覆盖）质量良好，应"留骨换皮"。丑的根源有五个：

### R1 · 没有设计系统（根因，权重约 80%）

- `tailwind.config.js` 的 `theme.extend` 是**空对象**，`index.css` 只有 3 行 `@tailwind` 指令。全项目零 design token。
- 所有视觉靠各组件手写 Tailwind 默认色板堆砌，主色就是路人皆知的默认 `blue-600`，"Tailwind 模板感"扑面而来。
- 圆角无规则：`rounded-[2rem] / 3xl / 2xl / xl / lg / full` 混用；阴影 `xl/md/sm` 随手配；`tracking-[0.2em]`、`max-w-[18rem]` 等魔法数字散落各处。

### R2 · 模板复制 + 视觉漂移

- 200+ 字符的内联渐变背景在 ControlPanel、NodeList、NodeDetail、Wizard **四个页面各写一份，参数还各不相同**（`circle_at_top` / `top_right` / `top_left`），像四个不同产品。
- `fieldClass / labelClass / cardClass` 在 ConnectForm 与 ProtocolPicker 逐字复制；按钮 class 串全项目重复 6 次以上；`formatBytes` 两份拷贝且精度规则不同；`extractPort` 两处返回值已漂移（`undefined` vs `'未记录'`）。
- 死代码：`src/pages/ControlPanel (1).tsx`（未跟踪的 Finder 拷贝残留，仍被 tsc 检查、拖慢构建、误导维护）。

### R3 · 色彩纪律涣散

- 同屏出现 blue / emerald / amber / purple / rose 五种彩色：流量卡用 purple 与主调毫无逻辑关联；协议选中卡是整卡实心 `bg-blue-600` 大色块（全 UI 最刺眼元素）；下载进度条按阶段轮换 sky/blue/indigo/emerald **四种色相**——一个进度条四种颜色。
- 中文界面上大量 `uppercase tracking-[0.2em]` 装饰字距（uppercase 对中文无效），`VLESS-REALITY` 这类技术标识直接当徽章展示给用户。

### R4 · 廉价装饰与"截图感"

- 日志终端仿 macOS 红黄绿三圆点（在 Windows/Linux 桌面上语义错位）；
- 外壳是"营销落地页"风格：毛玻璃 + 胶囊导航 + "DESKTOP CONSOLE" 装饰眉题，与桌面工具的信息密度需求相悖；
- logo 外套白框、`bg-slate-950` 深色孤岛卡片突兀插入浅色界面。

### R5 · 信息架构与 Tauri 不匹配

- 用 `BrowserRouter`（Tauri 生产环境下深链/刷新不可靠），应为 `HashRouter`；
- 顶部导航把低频动作"新建节点"与高频"控制面板"平级；
- 无暗色模式（桌面工具的明显缺口），全项目无一个 `dark:` 变体；
- 无 VPS 空态无引导、向导步骤不可回退、订阅失败是死胡同、节点行整行 `<button>` 导致 ID 无法复制。

---

## 1. 设计方向

**定位：克制、高密度、低饱和的桌面运维工具**，而非营销网站。

| 原则 | 说明 |
|---|---|
| 低饱和暖灰基底 | 弃用高饱和蓝渐变光晕，底色用暖灰（stone/zinc 系），品牌色只用于关键动作与状态 |
| 一处品牌色 | 品牌色从 logo 提取并 token 化，全项目只允许这一套蓝 |
| 信息密度优先 | 缩小卡片留白与圆角，监控数据/日志是主角，装饰退位 |
| 状态语义收敛 | 成功/警告/错误/中性 四色语义集中定义，砍掉紫色孤岛 |
| 暗色模式原生 | token 化之后 `dark:` 变体成本极低，本轮一并落地 |
| 留骨换皮 | 竞态防护、状态机、loading 覆盖、VPS 分组聚合等逻辑资产原样保留 |

---

## 2. 设计系统（Tokens）

### 2.1 Tailwind 主题扩展

```js
// tailwind.config.js — theme.extend 示意
colors: {
  brand: { /* 从 logo #255BEE 降饱和的一套 50–900 色阶 */ },
  surface: { /* 暖灰基底：bg / card / border 三档 */ },
  success / warning / danger / info: { /* 各 50–700 色阶，语义唯一来源 */ },
}
borderRadius: { control: '0.5rem', card: '0.75rem', panel: '1rem' }  // 三档语义圆角，废弃 [2rem]
boxShadow: { card: '...', pop: '...' }  // 两档，弃用 shadow-xl
fontFamily: { sans: ['系统中文优先栈'], mono: ['等宽栈'] }
```

### 2.2 全局基座（`index.css` + `index.html`）

- `@layer base`：中文字体栈（PingFang SC / Microsoft YaHei / Noto Sans CJK）、`body` 底色与抗锯齿、自定义滚动条、selection 色；
- `@layer components`：`btn-primary / btn-secondary / btn-danger`、`badge`、`callout`、`app-shell`（唯一页面背景定义处）；
- `index.html`：`lang="zh-CN"`、`<meta name="color-scheme" content="light dark">`、body 兜底底色防白闪；
- 暗色模式：`class` 策略 + 外壳设置项，所有 token 配 `dark:` 变体。

### 2.3 基础组件库 `src/components/ui/`

| 组件 | 收编的重复代码 |
|---|---|
| `Button`（primary/secondary/danger/ghost） | 全项目 6+ 处复制的按钮 class 串 |
| `Card` / `PageShell` / `SectionHeader` | 四页复制的渐变背景、玻璃 hero 卡、"步骤 N + 标题 + 说明"头 |
| `Badge`（status / protocol 两类色板） | `statusClass`、`protocolLabel` 散落的 emerald/rose/blue 组合 |
| `Field`（label + input + hint + error） | ConnectForm/ProtocolPicker 逐字复制的 `fieldClass` |
| `Callout`（info/warning/danger 三档提示条） | 各页局部定义的错误横幅、蓝/黄/灰提示卡 |
| `StatCard` | NodeDetail 复制 5 遍的指标卡、StatusCard 体系 |
| `Modal`（焦点陷阱 + Esc + 遮罩关闭） | 手写的卸载确认框 |
| `SegmentedControl`、`Spinner`、`Toast`（底部居中浮条） | 档案切换、缺失的反馈层 |

### 2.4 共享工具层 `src/lib/`

- `format.ts`：合并 `formatBytes`（统一精度）、`formatRelativeTime`、`formatAbsoluteTime`、`formatUptime`；
- `labels.ts`：`protocolLabel`、`statusLabel`、`extractPort`（修复两处漂移）；
- `errors.ts`：合并 `extractFriendlyError` / `extractErrorMessage` 两份近似实现。

---

## 3. 信息架构与外壳

1. **路由**：`BrowserRouter` → `HashRouter`；补 404 catch-all；`TopBar` 拆出 `components/`。
2. **布局**：从"网站式顶栏"改为**左侧窄边栏 + 内容区**的桌面工具布局——边栏含 logo、节点列表、控制面板两个主入口（带图标），"新建节点"降级为列表页内主按钮。窄窗口设最小宽度策略。
3. **去装饰**：删除 "DESKTOP CONSOLE" 眉题、logo 白框、胶囊导航的实心蓝激活态（改为浅色底 + 主色文字 + 图标）。
4. **页面背景**：唯一 `app-shell` 类，暖灰纯色或极浅纹理，**废弃四页四种 radial-gradient**。

---

## 4. 页面级重设计要点

### 4.1 节点列表（首页）

- 保留 VPS 分组聚合的产品设计；节点行从整行 `<button>` 改为 `<article>` + "查看详情 →" 链接（ID 可复制、chevron 提示可点）；
- loading 改骨架屏（与实物同布局，消除跳动），错误态带"重试"按钮；
- "修改 IP"面板支持 Enter 保存 / Esc 取消，改平滑展开；
- 页头只留一个主按钮"新建节点"，UpdateControl 改为低视觉重量的次要样式（解决两个实心彩色按钮抢焦点）。

### 4.2 控制面板

- 连接状态抽 `<ConnectionStatusBadge>`（色点 + 文字），错误详情进 callout，不再双显（头部 + 横幅各显示一遍）；
- 砍紫色流量卡，流量并入状态卡体系；修正 `NetworkRateCard` 命名（实为累计总量）；
- 无 VPS 空态加"去新建节点"引导；
- **日志查看器实用化**：去假 mac 圆点改真实工具栏（协议切换 tab——修复永远只能看 `services[0]` 的缺陷、级别着色、搜索、复制、上滚暂停跟随），高度随窗口拉伸；
- 服务操作期间整表互斥（`actionLoading` 改 Set），运行状态点去 `animate-pulse` 改静态色 + 文字。

### 4.3 节点详情

- 五张指标卡改 `<StatCard>` 组件并纳入统一骨架（消除"半个 Hero 先渲染再跳动"）；
- 状态字段与列表页共用 Badge 组件（同一数据同一表达）；
- 订阅 URI 默认掩码 + 点击展开；卸载走新 `Modal` + 成功 Toast。

### 4.4 新建节点向导

- **步骤指示器**：实心蓝步骤卡改为细条式 stepper（小圆点 + 连接线 + 当前步高亮），已完成步骤可点击回退；每步底部统一"上一步/下一步"操作条；
- **修复死路**：订阅获取失败增加"重试 / 跳过并完成"出口；订阅反馈移入 DeployProgress 区域内，不与导航按钮挤一行；
- disabled 的"下一步"加提示"请先测试连接"；
- ConnectForm 拆分为 `SavedProfileList` / `ManualCredentialFields` / `ConnectionSummary` 三个子组件（现 606 行单文件）；
- **统一"选择"语言**：档案卡与协议卡统一为"浅底 + 主色描边 + 右上角对勾"；协议卡改双列对照表（传输层/防火墙要求/适用场景），隐藏 `card.id` 技术标识；
- 校验联动到字段级：字段下红字 + 输入框 `border-danger`，替代顿号连成串的汇总文案；
- **部署进度**：步骤列表改竖向时间线（连接线 + 当前步 spinner + 失败红叉）+ 顶部全局进度条；下载条单色主色 + 真实字节数，删除四色轮换；日志默认折叠、失败自动展开。

### 4.5 订阅成果页

- 加成功确认头（对勾 + 节点名），营造"完成感"；
- 复制按钮带 copied 图标态；toast 改底部居中浮条；
- 客户端导入按钮加品牌图标、区分主推荐/次要；URI 掩码折叠。

---

## 5. 工程清理（先行，低成本高回报）

| # | 事项 | 收益 |
|---|---|---|
| 1 | 删除 `src/pages/ControlPanel (1).tsx` | 死代码、拖慢构建、文件名带空格括号易出错 |
| 2 | 抽取 `src/lib/format.ts / labels.ts / errors.ts`，修复 `extractPort` 漂移 | 消除 4 处重复实现 |
| 3 | `BrowserRouter` → `HashRouter`，`lang="zh-CN"` | Tauri 兼容 + 无障碍 |
| 4 | `tailwind.config.js` 建 token 层 + `index.css` 基座 | 后续所有工作的地基 |
| 5 | 建 `components/ui/` 首批 5 组件（Button/Card/Badge/Callout/Field） | 删掉约 40% 重复 class 串 |

## 6. 分阶段路线图

| 阶段 | 内容 | 验证标准 |
|---|---|---|
| **P0 地基**（0.5 天） | 第 5 节全部清理项 | 构建通过；无 `(1)` 文件；token 层就位 |
| **P1 组件库**（1 天） | `components/ui/` 全部组件 + Storybook 式示例页（或临时 route） | 每个组件有三态展示 |
| **P2 外壳 + 列表页**（1 天） | 侧边栏布局、HashRouter、NodeList/NodeDetail 重构 | 暗色模式切换可用；骨架无跳动 |
| **P3 控制面板**（1 天） | Badge、日志查看器、服务互斥、空态引导 | 多协议日志可切换；错误不双显 |
| **P4 向导 + 成果页**（1.5 天） | stepper、选择语言统一、字段级校验、部署进度、SubscriptionView | 订阅失败有出口；步骤可回退 |
| **P5 打磨**（0.5 天） | 暗色模式全量走查、焦点/键盘流、窄窗口检查 | 全页 `dark:` 无遗漏 |

> 总计约 5.5 个工作日。P0–P1 完成后"丑"的观感已消除大半（统一底色 + 统一按钮/卡片/徽章），后续阶段逐页精修。

---

## 7. 明确保留的资产

重构中以下逻辑**原样保留**，只换视觉：

1. `ControlPanel.tsx` 的连接竞态防护（`connectRequestIdRef` + `isCurrentRequest`）；
2. 各表单的状态机设计（idle/loading/ok/err 四态、`cancelled` flag 防竞态）；
3. NodeList 的 VPS 分组聚合算法；
4. 向导的校验门禁（先测连接再往下走）与协议切换自动换默认端口；
5. 部署日志折叠 + 下载心跳聚合的产品思路；
6. 错误文案提炼层（`extractIpcErrorMessage` 等，合并后保留）。
