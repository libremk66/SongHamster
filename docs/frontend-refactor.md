# 前端重构方案：Eta + htmx → React SPA

> 定稿 2026-09-20 ｜ **状态：已完成（2026-09-23）**
>
> 8 个页面全部迁完，旧的 Eta 页面 / daisy.css / pico 桥 / icons-sprite 已整体删除，
> `/` 跳到 `/app`，`src/routes/pages.ts` 已删，后端 HTML 片段接口清掉 52 个（路由 122 → 70）。
> 本文保留作为**当时的方案记录**；下面提到的"并行期""阶段一/二"等都已经走完了。
> 决策：技术路线 **React**（2026-09-20 用户拍板）｜ 分两阶段 ｜ UI 设计 skill 已装

---

## 一、为什么要重构

现有前端是「自然生长」出来的，三笔债：

| 债 | 表现 |
|---|---|
| **两套 CSS 打架** | DaisyUI + pico.css 并存，`render.ts` 里养了 100+ 行「pico 桥」覆盖规则，把 pico 涂坏的按钮/输入框一条条钉回去 |
| **零组件抽象** | 同样的卡片/按钮/表格在各页复制粘贴；改一处样式要全仓库搜 |
| **双端靠打补丁** | 每页自己写响应式类，没有统一规范；移动端体验不一致 |

**目标**：一次到位 —— 干净的前端地基 + PC/移动一套代码两种形态 + 可迭代的设计系统。

---

## 二、现状盘点（改动范围底数）

### 2.1 页面（9 个）

| 页面 | 模板体积 | htmx 属性 | 复杂度 |
|---|---:|---:|---|
| 歌单同步 `sync-setup` | 40.1 KB | 29 | 🔴 最高（建任务/监听/任务表/编辑） |
| 榜单订阅 `charts` | 21.8 KB | 10 | 🟠 高（榜单浏览 + 订阅 CRUD + 行内编辑） |
| 设置 `settings` | 21.0 KB | **85** | 🔴 最高（通知 7 渠道 / 账号 / 通用 / 保护） |
| 进度历史 `history` | 19.2 KB | 5 | 🔴 高（三标签 + 13 列筛选 + 批次展开 + 每秒轮询） |
| 曲库管理 `library` | 16.4 KB | 16 | ⚪ **界面暂时收起**，可放最后 |
| 下载选项 `options` | 8.1 KB | 4 | 🟢 低 |
| 连接容器 `connect` | 6.0 KB | 10 | 🟡 中（5 种媒体服务器选项卡） |
| 日志 `logs` | 4.4 KB | 0 | 🟢 低 |
| 登录 `login` | 2.9 KB | 3 | 🟢 低（有意保留 Pico 风格） |

合计 **≈141 KB 模板**、**≈162 处 htmx 属性**。

### 2.2 端点（89 个 = 80 API + 9 页面路由）

**⚠️ 最关键的发现：147 处返回 HTML 片段，只有 3 处返回 JSON。**

也就是说，现在的「API」其实是**服务端渲染的片段接口**，不是数据接口。React 要的是 JSON，所以**每个片段端点都要拆**。

按功能域分布：

| 功能域 | 端点数 | 典型形态 | 迁移动作 |
|---|---:|---|---|
| 连接容器（config/test/probe/apply） | 19 | 片段 | 拆 JSON + React 表单 |
| 歌单同步 / 任务 CRUD | 8 | 片段 | 拆 JSON + TanStack Table |
| 进度 / 历史 | 12 | 片段（`/progress/json` 除外 ✅） | 拆 JSON + 虚拟滚动 |
| 监听 / 自动新增 | 8 | 片段 | 拆 JSON |
| 设置（通用/通知/账号/保护） | 11 | 片段 | 拆 JSON + 表单化 |
| 榜单订阅 | 5 | 片段 | 拆 JSON |
| 曲库管理（dupe/upgrade） | 10 | 片段 | **可最后做**（界面已收起） |
| 回收站 | 3 | 片段 | 拆 JSON |
| 日志 / 路径检查 / 其它 | 4 | 片段 | 拆 JSON |

**三类改写模式**（覆盖全部）：

| 类型 | 现在 | 改成 |
|---|---|---|
| **A. 数据型** | `res.json({...})` | ✅ 原样保留（3 个） |
| **B. 片段型** | `res.send(<渲染好的 HTML>)` | 返回数据，React 渲染 |
| **C. 动作型** | `res.send(ok('已开始同步…'))` / `err(...)` | `{ ok: true, message: '…' }`，前端弹 toast |

### 2.3 不动的部分（重要）

后端**引擎层与 UI 完全解耦，一行不改**：

```
src/core/sync-engine.ts   同步引擎（1425 行）
src/core/{notify,delete,dupe,upgrade,listen,autoadd,validator,…}
src/store/{db,repo}.ts    数据层
src/scheduler/            定时调度
src/adapters/             5 种媒体服务器适配
```

重构只碰 **`src/routes/`（返回形态）+ `src/views/`（整体替换）**。

---

## 三、目标架构

### 3.1 目录

```
SongHamster/
├── src/                    ← 后端（Node + Express + SQLite），保留
│   ├── core/ store/ scheduler/ adapters/   引擎层：不动
│   ├── routes/api.ts       ← 改成纯 JSON
│   └── views/              ← 阶段一结束前保留（旧页面兜底），最后删
└── web/                    ← 🆕 前端（React SPA）
    ├── src/
    │   ├── pages/          9 个页面
    │   ├── components/     ui/（shadcn）+ 业务组件
    │   ├── lib/            api 客户端、query hooks、utils
    │   └── styles/         Tailwind + 设计 token
    ├── index.html
    └── vite.config.ts
```

### 3.2 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | **React 19 + TypeScript + Vite** | — |
| 路由 | React Router v7 | |
| 数据 | **TanStack Query** | 进度页要每秒轮询 → 内置 `refetchInterval`，替代现在的 `hx-trigger="every 1s"` |
| 表格 | **TanStack Table** | 历史页 13 列 + 表头筛选 + 分页 + 展开，手写不可维护 |
| 表单 | React Hook Form + Zod | 设置页 85 处交互、任务表单校验 |
| 组件 | **shadcn/ui**（Radix） | 无障碍内建（对齐 UX 规则第 1 优先级）；**主题 = CSS 变量** → 阶段二只改变量值即可换肤 |
| 样式 | Tailwind | |
| 图表 | Recharts | 榜单页 |

### 3.3 Express 的转变：并行挂载，逐页替换

```
/            → 旧 Eta 页面（保持可用，直到全部迁完）
/app         → 🆕 React SPA（迁一页加一条路由）
/api/*       → 🆕 JSON API（新增；路径复用现有 /api 前缀）
```

**任何时刻网站都可用** —— 同步任务 24 小时在跑，不能出现"重构期间上不去"的窗口。

全部迁完后：`/` 重定向到 `/app`，删 `src/views/`、`static/pico.css`、`static/daisy.css`、`scripts/build-icons.mjs` 及 `render.ts` 里的 pico 桥。

### 3.4 部署影响

| 项 | 现在 | 重构后 |
|---|---|---|
| Dockerfile | 单阶段（node:22-slim） | 加前端构建阶段（`npm ci && npm run build` → 产物 COPY 进最终镜像） |
| Express | 渲染 HTML | 只服务 `/api` + SPA 静态文件（`index.html` fallback） |
| 镜像体积 | ~小 | +前端产物（预计 +1～2 MB，可接受） |
| 开发 | `npm run dev` (8935) | + `npm run dev:web`（Vite 5173，proxy `/api` → 8935） |

---

## 四、双端策略

**一套代码，CSS 切形态**（绝不做两套页面）：

| 组件 | PC | 移动 |
|---|---|---|
| 导航 | 侧栏 | 底部 tab 栏（≤5）+ 汉堡抽屉 |
| 列表 / 表格 | 多列表格 | 卡片（每行一张，字段纵向） |
| 筛选 | 表头/工具栏一行 | 底部升起的筛选面板 |
| 表单 | 两列栅格 | 单列全宽 |
| 弹窗 | Dialog | 底部 Sheet（全屏） |
| 批量操作 | 工具栏按钮 | 底部固定操作条 |

移动端硬性指标（来自已装 skill 的 UX 规则）：**触控目标 ≥44×44px**、输入框字号 **≥16px**（防 iOS 自动缩放）、安全区内边距、**不出现横向滚动**。

> ⚠️ SPA 在这里反而没有 SSR 的取舍问题：视口已知，表格/卡片可以**按需渲染**，不用像 SSR 那样两份都输出。

---

## 五、分阶段任务表

### 阶段一 · 清结构（地基）

**P1 — 骨架**
- [ ] `npm create vite` 建 `web/`，装 React + TS + Tailwind + shadcn/ui
- [ ] 路由骨架 + 侧栏/底部导航外壳（PC/移动两形态）
- [ ] API 客户端（fetch 封装：统一错误 + 401 跳登录）+ TanStack Query Provider
- [ ] Express 挂载 `web/dist` + SPA fallback，`/app` 可访问

**P2 — API 化**（按功能域分批，每批自带冒烟脚本）
- [ ] 连接容器（19）→ JSON
- [ ] 歌单同步 / 任务（8）→ JSON
- [ ] 进度 / 历史（12）→ JSON
- [ ] 设置（11）→ JSON
- [ ] 榜单订阅（5）+ 监听 / 自动新增（8）→ JSON
- [ ] 日志 / 回收站 / 路径检查（8）→ JSON
- [ ] 认证（3）→ 保持/微调
- [ ] 曲库管理（10）→ **暂缓**（界面已收起）

**P3 — 逐页迁移**（顺序：先易后难，每页迁完双端截图验收）
- [ ] 登录 → [ ] 日志 → [ ] 下载选项 → [ ] 连接容器
- [ ] 歌单同步 → [ ] 榜单订阅 → [ ] 设置 → [ ] 进度历史（最难，放最后）
- [ ] 曲库管理（可选，恢复界面时再做）

**P4 — 切换与清理**
- [ ] `/` 重定向到 `/app`，导航全部指向新页
- [x] 删 `src/views/`、`pico.css`、`daisy.css`、`icons-sprite` 构建脚本、pico 桥 ✅ 2026-09-23
- [ ] 更新 README 的「界面」章节 + `docs/ui-guidelines.md`
- [ ] Dockerfile 加前端构建阶段 + 发版验证

### 阶段二 · 视觉升级（干净地基上换皮）

- [ ] 用 `ui-ux-pro-max` 生成设计系统（查询词要用 `admin dashboard data table` 这类，配 `--density 8`；**别用营销词**，否则会给出落地页方案）
- [ ] 用 `frontend-design` 做审美把关（避开模板化的 AI 味）
- [ ] 产出 2～3 个候选方向 → **做成可点击对比页** → 用户拍板
- [ ] 把选中的设计系统灌进 shadcn 的 CSS 变量（配色/字体/圆角/阴影/间距）
- [ ] **组件代码一行不用改** —— 这正是选 shadcn 的原因
- [ ] 把新规范写回 `docs/ui-guidelines.md`

---

## 六、验收方式

**每完成一页**，用已装的 `ui-screenshot-check` 截图：

| 视口 | 用途 |
|---|---|
| 1440×900 | PC 形态 |
| 390×844 | 移动形态 |

对照检查：无横向滚动 / 触控目标够大 / 表格或卡片形态正确 / 与旧页面功能对齐（逐项对一遍）。

---

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| 迁移期新旧并存导致行为不一致 | 新页迁完前，导航仍指向旧页；迁一页切一页 |
| API 化改坏引擎调用 | **不改引擎**，只在路由层换返回形态；每批 API 化后跑冒烟 |
| 移动端回归 | 每页双端截图，纳入验收硬指标 |
| 工作量估算失真 | 先做「日志」页（最小）打通全链路，用实际耗时校准后面 8 页 |
| 前端产物让镜像变大 | 阶段一结束实测镜像体积，超预期再考虑压缩 |

---

## 八、附：已装的两把"设计钳子"

| Skill | 用途 | 调用时机 |
|---|---|---|
| `ui-ux-pro-max` | 设计系统生成（79 风格 / 192 配色 / 74 字体对 / 119 条 UX 规则 / 22 栈指南） | 阶段二定方向时 |
| `frontend-design`（Anthropic 官方） | 审美把关，避开 AI 味 | 阶段二评审时 |
| `ui-screenshot-check`（已有） | 双端截图验收 | 阶段一每页 + 阶段二每轮 |


---

## 九、实施进度（2026-09-20 起）

### 已完成

**P1 骨架**：`web/` Vite + React 19 + TS + Tailwind v4 + shadcn/ui（手写基础，CLI 会卡交互）；
Express 并行挂载 `/app`（旧页面仍在 `/`）；`npm run dev:web` / `build:web`。

**P2 API 化**：新增 ~40 个 JSON 端点（约定：新端点带 `-json` 后缀或复数路径，与旧 HTML 端点并存）。
**6 处业务逻辑抽成新旧共用函数**（避免两套校验漂移）：
`saveDownloadOptions` / `saveProtection` / `applyServer` / `runPathCheck` / `saveListen` / `createTasks` / `saveAuth` / `notifyFromBody` 复用。

**P3 逐页迁移**（8/8 页面，全部双端截图验收过）：

| 页面 | 状态 | 说明 |
|---|---|---|
| 日志 | ✅ | 级别筛选 + 关键字 + 智能暂停轮询 |
| 下载选项 | ✅ | 音质多选 + 保护设置 |
| 连接容器 | ✅ | 5 种服务器选项卡 + 「确定」三步链 + 路径自检 |
| 歌单同步 | ✅ | 任务表 + 创建表单（三级级联）+ 监听区 |
| 榜单订阅 | ✅ | 订阅表 + 新建订阅 + 榜单浏览（选歌下载） |
| 设置 | ✅ | 通用 + 账号 + 通知（7 渠道按规格表通用渲染） |
| 登录 | ✅ | SPA 自带登录页 + `/app` 白名单 |
| 进度历史 | 🟡 | 实时进度/记录表/重试/回收站/批次视图已完成；剩**歌曲来历卡**与**批量删除** |

### 途中修掉的 bug

- **`ensureArchiveTarget` 重复创建同名歌单**（`src/core/sync-engine.ts`）：
  `findPlaylistByName` 读的是 `playlistCache`，建完不更新缓存 → 同进程内再查仍读到旧列表。
  同步引擎别处建歌单都会 push 进缓存，唯独这里漏了。**已修 + 端到端验证**。
- **API 客户端吞掉 401 的真实原因**：一律显示"未登录"，导致登录失败看不出是密码错还是别的。已改为透传服务端消息。

### 踩过的坑（写进代码注释了）

- `flex-1` 的 flex-basis 为 0 → **basis 为 0 的项不会换行**，移动端被 `min-w` 顶出屏幕。修法：移动端 `w-full` 独占一行。
- 表格里的删除确认面板必须渲染成**跨整行的独立 `<tr>`**，塞进「操作」单元格会压到下一行上。
- Playwright 定位器要**锁死在行内**（`locator('tr', has_text=…)`），用 `.first` 会点到别的行（实测把两个任务的启停都弄反了）。
- 测试脚本里 `name=` 不支持 lambda；`get_by_role(name='筛选')` 会同时匹配「清除筛选」→ 用 `exact=True`。

### 还没做（P4 切换前必须完成）

1. **进度历史剩余 2 块**：歌曲来历卡、批量删除
2. **`/` 重定向到 `/app`**，删 `src/views/`、`pico.css`、`daisy.css`、`icons-sprite` 构建脚本、`render.ts` 的 pico 桥
3. **Dockerfile 加前端构建阶段** + 发版验证（镜像体积实测）
4. 更新 README「界面」章节与 `docs/ui-guidelines.md`

### 阶段二（视觉升级）待办

设计系统生成 → 候选对比页 → 灌进 shadcn 的 CSS 变量（`web/src/index.css` 的 `:root` / `.dark`，
**组件代码不用改**）。查询词用 `admin dashboard data table` 这类 + `--density 8`，别用营销词（会给出落地页方案）。
