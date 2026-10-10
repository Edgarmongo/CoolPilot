# P0-08 P0 总体验收与 P1 排卡准备（只读）

> **本卡性质**：P0 阶段的收口卡。把 P0-02 / P0-06 / P0-07 的结论合并成一次总体验收，并给出可以直接开工的 P1 任务顺序。
> **本卡不做**：不写生产代码、不改数据库、不改配置、不执行真实备份/恢复、不触发真实平台发布、不提交 Git、不修改 §六 P2 状态列。
> **方法**：① 逐份核对 `docs/` 下已产出的报告与源码证据；② 对"仍与当前工作区一致"的关键断言做**抽查复验**（`file:line`）；③ 跑一遍仓库基线命令；④ 只把结论写成本文件与 `docs/dev-exec-list.md` 的 P0-08 回填。
> **基线**：工作区当前版本（HEAD `3b48126`，含用户既有的未提交改动；P0 报告本身均未提交）。本文件对 `docs/dev-exec-list.md` 的**行号引用均为本卡回填之后的版本**（589 行）。

被验收的报告（真实路径已核对，未新建/未改名任何既有文档）：

| 报告 | 对应卡 | 行数 |
| --- | --- | --- |
| `docs/menu-inventory.md` | P0-01 | 约 155 行 |
| `docs/data-model-inventory.md` | P0-02 | 约 232 行 |
| `docs/creator-workflow-audit.md` | P0-03 / P0-04 / P0-05（辅助） | 约 417 行 |
| `docs/assisted-publishing-engine.md` | P0-05（辅助发布的产品模型） | 约 245 行 |
| `docs/agent-execution-audit.md` | P0-06 | 约 455 行 |
| `docs/backup-restore-audit.md` | P0-07 | 约 381 行 |
| `docs/dev-exec-list.md` / `docs/dev-list.md` | 队列与编号来源 | 589 行（本卡回填后）/ 562 行 |
| `docs/open-source-capability-map.md` | P1 范围的第二来源（用于对账，不是队列） | 约 1160 行 |

---

## 一、一句话结论

**P0-01 ～ P0-07 的报告与证据齐备且可复核，P0 在"文档与证据层"验收通过（6 项验收标准中 5 项满足）**；唯一未闭合的 P0 门槛是 `docs/dev-exec-list.md:149` 所要求的"**P0-06 已回填 §六 P2**"，本卡按约束**未修改 §六**，因此把它列为**需人工一次编辑的前置动作**（§八 D6）。（**2026-10-09 更新**：该门槛**已闭合**——§六 P2 状态列已按 `docs/agent-execution-audit.md` §7 回填、勘误 E1 已修正；见 §十一。）

**P1 可以按 §五 的 9 步卡序开工**（另有 1 张可并行的卡 10：A06 + A09），前置条件 4 条（§九）；三项长期人工决策（`replace` 语义、备份加密、隔离演练负责人）**不阻塞 P1 前 5 张卡**，但必须在做备份/自动发布相关卡之前闭合。

**本卡新发现 1 处 P0-02 的勘误**（§八 E1）：`data-model-inventory.md` §6 的 `publish_records.status` 行与 §7-11 声称"发布事实只有一个写入路径 / `updatePublishRecord` 无生产调用方"，与当前源码不符——自动发布路由 `src/app/api/publish/route.ts:30,57,76` **也在写 `publish_records`**，`src/app/api/publish-records/[id]/route.ts:22` **也在调 `updatePublishRecord`**。这不改变 P0 的结论（C2 冻结面未破坏），但直接决定 P1-04 PE05 的范围与优先级。

---

## 二、P0-01 ～ P0-07 状态与证据表（含本轮复验）

复验只针对"如果报告过期就会误导排卡"的断言，不是重做审计。

| 编号 | 状态 | 交付物 | 关键结论 | 本轮复验（本轮实测） |
| --- | --- | --- | --- | --- |
| P0-01 | 已完成 | `docs/menu-inventory.md`（9 顶级 / 27 叶子 + §7 四项发现） | 菜单唯一来源 = `console-layout-shell.tsx` 的 `navItems`；存在 4 条无菜单入口的路由 | 未重跑盘点；抽查 §6 表（`/schedule`、`/settings/[tab]`、`/content/library`、`/whiteboard`）结论与 `dev-exec-list.md` §四引用一致 |
| P0-02 | 已完成（**含 1 处勘误，见 §八 E1**） | `docs/data-model-inventory.md`（27 表 + R1～R14 + §7 十一条发现） | 素材无独立表（路径字符串即身份）；同一件事有 5 套状态词表 | ✅ 复验 `src/db/schema.ts:111-132`：`agent_runtime_runs`（111-123）与 `agent_runtime_events`（125-132）逐字一致；❌ 复验 §6/§7-11 的"唯一写入者"说法**不成立**（`api/publish/route.ts:30,57,76`、`api/publish-records/[id]/route.ts:22`） |
| P0-03 | 已完成 | `creator-workflow-audit.md` F-C0-5 / F-C0-1 / F-C0-9 | `metadata.images` 有三类值（绝对路径 / 远程 URL / 裸文件名），4 处客户端各自解析；发布侧丢弃远程封面 | ✅ 复验四处客户端解析**仍在**：`articles-workspace.tsx:57`、`ai-writing-step-output.tsx:29`、`article-editor.tsx:42`、`posts-composer.tsx:17`（四处都返回 `/api/agent/artifacts?file=`）；服务端 `artifact-image-url.ts:14` 只提供 `artifactImageUrl(fileName)`；`lib/publish.ts:27-41` 的"远程即空串"分支仍在 |
| P0-04 | 已完成 | F-C0-6 + `src/lib/publish-facts.ts` | `draft`/`ready`/`posted` 可达，`failed` 不可达；`posted` 有两个写入者 | ✅ 复验 `markContentItemPosted` 的生产调用者只有 2 个：`publish-facts.ts:61`（C2）与 `threads.ts:126`（旧 worker）；全仓 grep 未见内容状态的 `failed` 写入 |
| P0-05 | 已完成（辅助发布）/ **待独立核实（自动发布，转 P1-04 PE05）** | `assisted-publishing-engine.md`（§4 状态、§5 证据强度、§8 验收实测、§10 已交付） | 辅助发布：强信号才写事实；弱信号 → `unknown` 且不写；C2-1 的四道护栏已交付 | ✅ 复验自动发布侧仍在写记录且**不核验**：`api/publish/route.ts:11-17,30,57,76`；`findNextReadyContentItem` 的唯一生产调用者是 `lib/threads.ts:51`，其后 `threads.ts:126` 才移状态 |
| P0-06 | 已完成（只读审计） | `docs/agent-execution-audit.md`（AG01～AG23 逐条 + 链路 A/B/C + G1～G6） | Agent 执行链真实可用；P2 = 混合（收口 + 3 处最小补齐）；不新建表、不改状态枚举 | ✅ 复验 `src/app/api/agent/runs/route.ts` **不存在**（G2 成立）；`resume` / `events` 路由存在；`src/lib/agent/` 递归 19 个文件，与 `dev-exec-list.md` §二 一致 |
| P0-07 | 已完成（只读审计） | `docs/backup-restore-audit.md`（§三 三类清单、§四 字段总表、§六 R1～R9、§七 与 P0-06 交集、§九 A1～A6、§十 B1～B7） | 备份 = 数据库逻辑导出；文件/凭据/`.env.local` 不在其中；最高风险 = 绝对路径引用 | ✅ 复验 `src/lib/publish.ts:24-41`：远程 → `""`、绝对路径 → 原样返回、否则 join 到 `artifactsRoot()`/`videosRoot()`（R7 成立）；✅ 复验 `README.md:303` 的 "so the workspace becomes an exact copy of the backup" 措辞逐字存在（R3/B4 决策项，措辞与 `replace` 实现不符） |
| P0-08 | **本卡** | 本文件 | P0 总体验收 + P1 排卡 | 见 §九 |

> 状态取值沿用 `dev-exec-list.md` §一：`已完成` / `已完成（只读审计）` / `待补齐` / `待验证` / `暂缓`。**未执行的动作（A3～A6 演练、PE05 实现、真实发布）一律不写成“已通过”。**

---

## 三、已冻结边界核查：P1 计划会不会意外扩大它

判定口径：**"接触点存在"不等于"允许改"**。下表逐条列出冻结面、本轮复验证据、P1 的接触点与允许/禁止的动作。

| # | 冻结面（`dev-exec-list.md` §二） | 本轮复验证据 | P1 的接触点 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | **AI Runtime** | `src/features/ai-runtime/runtime.ts`、`registry.ts` 均存在（实测）；P0-06 §5.1 结论：全仓无第二套模型调用链 | 卡 3（A04）不涉及模型；卡 9/卡 10 的文本、图片生成必须复用 `aiRuntime` | **只允许复用**。禁止新增第二条调用链、禁止改模型选择 / 键轮换 / 失败转移策略 |
| 2 | **Workspace 基础（P5-B0）** | `src/lib/workspace/manifest.ts:325` `createWorkspaceManifest()`；`linked/unlinked` 在 `:331`、`:375-382`；`src/app/api/workspace/manifest/route.test.ts` 存在 | 卡 4（A07 引用查询）复用 `contentImageNames` 对账；卡 5 / 卡 10（A09 内部文件隔离）复用"引用 vs 实际文件" | **只允许只读复用**（`contentImageList()` / `createWorkspaceManifest()`）。禁止改其返回结构与字段语义 |
| 3 | **C1（生成 → 编辑器）** | `src/lib/editor-link.ts` + `src/lib/editor-link.test.ts`（5 项） | 卡 9（WF02 / WF09）沿用 `?edit=<id>` 深链 | 不得改成"第二个页面"、不得改 URL 契约 |
| 4 | **C2（辅助发布成为事实）** | `src/lib/publish-facts.ts`（`recordPublishSuccess`，`:61` 移状态）；`api/publish/verify/route.ts` + `draft/route.ts` 两个测试 | 卡 7（DE 证据）、卡 8（PE05）、卡 9（WF08） | **只允许读**。PE05 **只出方案**；禁止改 verify 的写入条件与 `takePublishReceipt` 的"读取即取走"语义 |
| 5 | **C2-1a（草稿证据契约）** | `src/lib/browser-preview-shared.ts:31-45` 复验逐字一致：`DraftFieldOutcome` / `PublishDraftEvidence` / `NO_DRAFT_HANDED_OVER` | 卡 7（DE01 若要持久化草稿准备证据） | 持久化必须**沿用三态**（`filled` / `empty` / `not_offered`）；禁止改"`drafted` 是什么意思" |
| 6 | **C3（统一文章生成服务）** | `src/lib/article-generation.ts` + `src/lib/article-generation.test.ts` 存在 | 卡 9（WF02）、卡 10（A06 产品素材进入创作流程） | **禁止再引入第三条生成入口**；两条 HTTP 边界各自的 payload/guards 保持 |
| 7 | **Agent 运行时存储与工具恢复** | `src/db/schema.ts:111-132` 复验逐字一致；`src/lib/agent/` 递归 19 文件；`resume` / `events` 路由存在 | P1 **不应接触**（`GET /api/agent/runs` 仍不存在，G2 属 P2） | P1 任何卡不得改 `agent_runtime_*` 表、`src/lib/agent/*`、Agent 路由 |
| 8 | **P0 自身的只读结论**（P0-06 G1～G6、P0-07 R1～R9 / B1～B7） | 见 §二 复验列 | 见 §七 暂缓清单 | 不得在 P1 顺带实现；**唯一例外**：B6（素材路径解析统一）与卡 3 同根因，按卡 3 排卡并纳入其验收 |

**核查结论**：逐条比对后，**没有发现 P1 计划扩大任何冻结面**；但有 3 处"容易踩线"，必须写进对应卡的停止边界：

1. **卡 4 / 卡 5 不得为方便而新建 Asset 表**（`docs/dev-list.md:97` 的边界：第一版不要求新增独立 Asset 表；要建表必须先报批）。
2. **卡 7 的持久化不得改变 C2-1a 的判据**，且任何数据库变更**先出方案再实现**（`docs/dev-exec-list.md:264`）。
3. **卡 8（PE05）不得以"修重复发布"为名改 `verify` 路由或 `publish-facts.ts`**；它的交付物是"风险证据 + 最小修复方案 + 回归测试"，实现另开一张卡。

---

## 四、端到端验收场景设计（`dev-exec-list.md` §四 P0-08 卡要求的 ①～⑩）

> 这一节是**设计**，不是执行结果：本卡没有跑真实发布、没有恢复真实备份、没有触发真实模型扣费。
> "预期结果"是**验收口径**（应当成立），"现状差距"是**今天还不成立**的部分（按卡号排入 P1）。

| # | 场景 | 前置条件 | 操作 | 预期结果（验收口径） | 数据库事实 | 证据 / 现状差距 / 自动化 |
| --- | --- | --- | --- | --- | --- | --- |
| ① | 创建内容 | 可写工作区；1 个帐号 | 文章创作 → 新建（只填标题） | 该条内容立刻在编辑器里打开 | `content_items` +1，`status='ready'` | `articles-workspace.tsx:93-102`、`repository.ts:400`；**可自动化**，但 `POST /api/content` **目前没有路由测试**，需新增 |
| ② | AI 生成并进入编辑器 | AI Runtime 可用（模型已配） | `POST /api/content/generate`（或 `/api/ai-writing/generate`）→ 点结果里的「在编辑器中打开」 | 结果不是 toast，而是打开刚写入的那条内容 | `content_items` + `metadata.images` + `usage_records` + `artifacts/` 文件 | `src/lib/editor-link.ts`、`editor-link.test.ts`、`api/content/[id]/route.test.ts`、`scripts/creator-editor-link-smoke.ts`（真浏览器，不点"生成"）；**部分自动化**（URL 契约可自动化，真实模型调用不自动化） |
| ③ | 编辑并保存为内容草稿 | 内容已在编辑器中 | 改标题 / 正文 → 存为草稿 | 只有写库成功才显示"已保存"；重开不丢字段；失败有重试入口 | `content_items.title/body/post_ready_text`，`status='draft'` | `article-editor.tsx:521-529`、`PATCH /api/content/[id]`；**现状差距**：无失败恢复入口（D07）、无来源记录（D05）；可自动化（需补写路径断言） |
| ④ | 关联本地素材 + 远程导入素材 | 一张本地图片；一个含 `og:image` 的远程页 | 上传图片 → 插入正文 / 设为封面；URL 导入文章 | 编辑器 / 内容中心 / 发布三处看到**同一个**地址；发布不丢封面 | `metadata_json.images`（首项 = 封面）+ `image_path` 镜像 | **现状差距**：远程封面不本地化（`api/content/import-url/route.ts:49` 直接存 `og:image`），发布时被丢弃（`lib/publish.ts:29`）→ 卡 1/2/3；可自动化（本地 HTTP 服务 + fixture 图片） |
| ⑤ | 选择平台及帐号 | 至少 1 个已登录帐号 + 1 个失效帐号 | 发布对话框选平台与帐号 | 失效帐号被拦截并说明原因，不空跑浏览器 | `accounts.status`（`needs_login` / `paused`）与健康检查记录 | `src/lib/account-health.ts`、`account-risk.test.ts`；**部分自动化** |
| ⑥ | 准备平台草稿 | 一个已登录帐号 | `POST /api/publish/draft` | 逐字段证据（`filled` / `empty` / `not_offered`）；页面什么都没接住 → 失败（`publishDraftEmpty`） | **不写库**（receipt 只在会话内存，C2/D2） | `api/publish/draft/route.test.ts` + `src/test/browser-session-fixture.ts`；**可自动化** |
| ⑦ | 人工确认发布 | ⑥ 成功，预览停留在平台编辑器 | 人在实时预览里点平台的发布按钮 | CoolPilot 不代点发布；关闭对话框前会确认（C2-1d） | **不写库** | `src/lib/publish-run-teardown.ts`、`publish-run-panel.tsx`；**不可自动化**（必须人工） |
| ⑧ | 核验发布结果 | ⑦ 已完成 | 客户端轮询 `POST /api/publish/verify` | 只有强信号写事实；弱信号 → `unknown` 且不写 | `publish_records` +1（`status='published'`）**且** `content_items.status='posted'`；记录 `message` 存证据原文 | `api/publish/verify/route.test.ts`（一次成功 = 一条记录 + 一次状态迁移；重复轮询不新增；无 receipt 不写；失败不花掉 receipt）；**可自动化** |
| ⑨ | 结果与内容 / 帐号 / 平台关联 | ⑧ 已产生记录 | 发布记录页按内容、帐号、平台查询 | 能从内容找到它的发布记录与证据 | `publish_records.content_item_id / account_id / platform / account_name`（后两者为快照冗余） | `/publishing/records`、`api/publish-records/route.ts`、`data-model-inventory.md` §7-5；**可自动化**（列表读数） |
| ⑩ | 未知 / 失败 / 取消 / 重复触发 / 应用重启 | 可控会话 fixture；一份含未完成流程的库 | 分别制造这 5 种情形 | 未知不写、失败不写、取消不写、重复触发不产生第二条事实、重启后**能识别未完成流程**而不是假定成功 | 除正常成功外**零新增行** | 前 4 项部分已由 ⑧ 的测试覆盖；**"重启后识别未完成流程"当前无持久化**（DE01，需先报批）；**部分自动化** |

### 4.1 自动化与人工的分界（用现有工具，不新增框架）

- **可自动化且已有范式**：路由测试（`api/publish/draft|verify/route.test.ts`）、假会话 fixture（`src/test/browser-session-fixture.ts`）、临时目录式测试（`src/lib/backup.test.ts`）、`src/lib/workspace/manifest.test.ts`。
- **只能人工**：⑦ 平台侧点击；⑥ / ⑦ 的真实登录态（依赖 `browser-profiles/`，P0-07 V1 未决）；⑩ 的"应用重启"（按 `AGENTS.md`：以**打包产物**行为为准）。
- **真浏览器 smoke 的既有形态**（起服务、不打真实模型/平台）：`scripts/creator-editor-link-smoke.ts`、`scripts/workspace-overview-smoke.ts`。新增 E2E smoke 应沿用这个形态。

### 4.2 场景 ↔ 卡片映射

① 卡 6 / 卡 9；② 卡 9（回归已冻结部分）；③ 卡 6；④ 卡 1 / 2 / 3 / 4；⑤ 卡 9；⑥ ⑦ ⑧ 卡 7 / 卡 9；⑨ 卡 9；⑩ 卡 6 / 7 / 8 / 9。

### 4.3 当前无法自动化的部分及原因

1. **真实平台发布（⑦⑧ 的真实成功）**：涉及真实账号与平台风控，只能人工或隔离演练（与 P0-07 §九 A3～A6 同类）。
2. **真实登录态**（`browser-profiles/`）：取决于平台对设备指纹的判断，源码看不到（P0-07 V1）。
3. **应用重启后的任务态**：属打包产物行为（P0-06 V1、P0-07 V5 都标注"需在打包产物上确认"）。

### 4.4 每个场景对应的最小代码范围（预估，供排卡）

| 场景 | 最小代码面 |
| --- | --- |
| ① | 只补测试（`src/app/api/content/route.test.ts`，新文件） |
| ③ | `article-editor.tsx` 保存反馈 + `PATCH /api/content/[id]` + 必要时最小证据字段（**要报批**） |
| ④ | `src/lib/artifact-image-url.ts`、4 处客户端解析、`src/lib/remote-image.ts`、`src/lib/publish.ts:24-41`、`api/content/import-url/route.ts` |
| ⑥ ⑩ | `src/lib/browser-preview-shared.ts` 的既有三态（只读复用）+ 持久化方案（**要报批**） |
| ⑦ ⑧ | 不改（已冻结）；只补回归 |
| ⑨ | 只读聚合（`/publishing/records` 侧），如需新列 **要报批** |

---

## 五、P1 最终执行顺序与每张卡

### 5.1 依赖图（P1 子阶段）

```text
P0 收口（§九 的 4 条前置）
   │
   ├─ 卡 1  A02 统一素材 URL 解析（含 A01 规则声明）
   │     └─► 卡 2  A03 统一素材写入格式（含 A05 封面 = 列表首项）
   │            └─► 卡 3  A04 远程素材本地化（+ P0-07 B6 同根因）
   │                   ├─► 卡 4  A07 素材引用查询
   │                   │      └─► 卡 5  A08 素材删除保护
   │                   │             └─► 卡 10  A06 + A09 来源与内部文件隔离（可与卡 5 同批）
   │                   └─► 卡 6  D01 ～ D07 内容草稿与保存一致性
   │                          └─► 卡 7  DE01（方案）/ DE04 / DE06 / DE07 平台草稿证据
   │                                 └─► 卡 8  PE05 自动发布审计（只出方案，不实现）
   │                                        └─► 卡 9  WF01 ～ WF10 端到端 Creator Workflow 1.0
   └─ 支线：卡 8（PE05）只依赖"发布事实的判据已明确"，可与卡 6 / 卡 7 并行出方案
A10 文件可迁移性 → 暂缓（等备份 / 导出需求明确，见 §七）
```

**顺序理由**（每条都能在源码里找到依据）：

1. **卡 1 在卡 2 之前**："解析"决定"同一个地址长什么样"，写入格式才有唯一判定基准；而且它是 4 处重复实现中改动面最小的一处（`dev-exec-list.md:171-180`）。
2. **卡 2 在卡 3 之前**：本地化的结果必须落进统一写入格式，否则又多出一种格式。
3. **卡 3 在卡 4 / 卡 5 之前**：引用查询与删除保护都要先有稳定的"引用形态"（`metadata_json.images` 首项 = 封面 + `image_path` 镜像），否则要改两次。
4. **卡 4 在卡 5 之前**：删除保护的判定条件（"这条素材被谁引用"）就是 A07 的产物；`/api/images` 的 `DELETE`（`src/app/api/images/route.ts:55-60`）今天**没有任何引用检查**，只做路径安全（`image-library.ts:18`，测试覆盖 `../secret.png` 被拒）。
5. **卡 6 在卡 7 之前**：Draft Evidence 记录的是"内容（含素材）交给平台的结果"，输入不确定时证据也会失真。
6. **卡 7 在卡 8 之前**：DE 与 PE05 共享"未确认 = `unknown` 且不写事实"的判据；先定 DE 的语义，PE05 的方案才不用推翻它。
7. **卡 9 最后**：`dev-exec-list.md:302` 已写死"前置：P1-01 ～ P1-04 全部冻结后"。
8. **卡 10（A06 + A09）合并**：两者都是"现状有能力、语义未明确"的待验证项，合成一张小卡减少往返；也可以并进卡 5 的批次。

### 5.2 与另两份计划的逐条对账（避免重复实现与顺序倒置）

| 来源 | 对账结论 |
| --- | --- |
| `docs/dev-list.md` §八 队列 | **编号顺序一致**（A → D → DE → PE → WF）。**唯一差异**：`dev-list.md:72-73` 把 A07 / A08 标为"P1 优先级"（完成核心工作流后再做的治理能力），而人工给定的 9 步顺序把它们放在 D 之前。**本报告采用人工 9 步顺序**（先让素材引用稳定，再动内容保存），差异登记为 §八 D9，等确认；确认前卡 6 不启动 |
| `docs/dev-exec-list.md` §五 / §十 | 各卡的范围与停止边界**照抄沿用**，只调整卡序（A06 后移为卡 10，A01 并入卡 1）。§十 队列第 2～6 行不变（第一行按本卡回填） |
| `docs/open-source-capability-map.md` §五 P1 工作清单（A～E 五组） | **无范围冲突**：它是同一条链的分组写法（A00 系列 / 内容创作 / Draft Evidence / 辅助发布与验证 / 端到端）。其 §六 依赖图（P0→P1→P2→P3→P4→P5）与本报告 §七 的分离结论一致。**不需要第二份 P1 计划文档** |
| `docs/open-source-capability-map.md` §五 交付物（`:693`） | 它列了 `docs/creator-workflow-roadmap.md`，**本仓不存在该文件**；本报告**不新建**（本文件 §五 / §六 已覆盖其要表达的排卡结论）。登记为文档待清理项（§八 D5 附注） |
| `docs/open-source-capability-map.md` §四 4.1～4.7 能力清单 | 与 P1-01 / P1-03 / P1-04 一一对应；**4.6 多平台 / 4.7 Marketplace 不进 P1**（§七） |

### 5.3 卡片清单与验收条件

编号规则：`卡 n` = 执行顺序；括号内是该卡覆盖的 `dev-list.md` §三 子项。每张卡都遵守 `dev-exec-list.md` §十一 的通用约束（一次一卡、先方案后实现、冻结记录、提交前全绿）。

| 卡 | 覆盖子项 | 依赖 | 交付性质 | 需数据库变更审批 |
| --- | --- | --- | --- | --- |
| 1 | A02（+ A01 规则声明） | P0 收口 | 代码 + 文档 | 否 |
| 2 | A03（+ A05） | 卡 1 | 代码 + 方案 | 否（改 JSON 值形态，不改结构） |
| 3 | A04（+ P0-07 B6） | 卡 2 | 代码 | 否 |
| 4 | A07 | 卡 3 | 代码（只读聚合） | 否（默认不加表） |
| 5 | A08 | 卡 4 | 代码 | 否 |
| 6 | D01 ～ D07 | 卡 3 | 代码 + 文档 | **可能（D06 最小证据字段）** |
| 7 | DE01 / DE04 / DE06 / DE07 | 卡 6 | 方案 + 代码 | **是（DE01 持久化）** |
| 8 | PE05 | 卡 7（也可并行出方案） | **只出方案** | 可能是（若要改写入者） |
| 9 | WF01 ～ WF10 | 卡 1～卡 8 | 验收 + 修补 | 否 |
| 10 | A06 + A09（可并入卡 5 批次） | 卡 4 | 代码 + 文档 | 否（默认不改结构） |

---

#### 卡 1：A02 统一素材 URL 解析（+ A01 规则声明）

- **范围**：4 处客户端解析（`articles-workspace.tsx:57`、`ai-writing-step-output.tsx:29`、`article-editor.tsx:42`、`posts-composer.tsx:17`）与服务端 `src/lib/artifact-image-url.ts`（`artifactImageUrl`，`:14`）。抽一个共用解析函数放进**既有** `src/lib/` 模块（不新建框架、不新建包），四个调用点改为引用它。
- **验收**：① 4 个文件里不再各自定义解析函数（grep 只剩一处定义）；② 同一输入（远程 URL / 绝对路径 / 裸文件名 / 空串）四处输出**完全一致**；③ 不影响 `/api/agent/artifacts?file=` 的既有 URL 形状，UI 无可见变化；④ A01 的规则声明（什么是素材 / 什么是内部文件 / 封面 = 列表首项）落到文字里（写进 `dev-exec-list.md` 或本报告续节，**不新建独立设计文档**）。
- **测试要求**：新增共用解析的单元测试（4 类输入）；`src/lib/content-images.test.ts`、`src/app/api/agent/artifacts/route.test.ts` 保持通过；`tsc --noEmit`、`eslint .`、`vitest run` 全绿。
- **冻结边界**：不改 `/api/agent/artifacts` 的 URL 契约；不改 `paths.ts` 的目录语义（P5-B0）；**不新增表/列**。
- **本卡不做**：本地化（卡 3）、写入格式（卡 2）、引用查询（卡 4）、删除（卡 5）。

#### 卡 2：A03 统一素材写入格式（+ A05 封面 = 列表首项）

- **范围**：`src/lib/content-images.ts:24`（`mergeContentMetadata`）、`src/db/repository.ts:471` 的写路径、`api/content/import-url/route.ts:49`、`api/images/route.ts`（POST）、编辑器与创作页的写入点。
- **验收**：① **先出方案**（写入形态选哪个、历史三种形态如何读），再实现；② 所有写入 `metadata.images` 的路径产出同一种形态；③ 首项 = 封面且 `image_path` 与之一致（保持 `content-images.ts:5-8` 的回退链语义）；④ URL 导入不再把远程地址写进本地封面字段；⑤ 历史数据仍可读：读路径对三种旧形态不抛错（`contentImageList()` 兜底）。
- **测试要求**：`src/lib/content-images.test.ts` 扩展（三种历史形态 + 新形态 + 往返读取）；`api/content/import-url/route.test.ts`、`api/images/route.test.ts` 扩展；新增"写入 → 读出 = 写入值"断言。
- **冻结边界**：不改 `metadata_json` 之外的列语义；不碰 C2 / C2-1a；**不做历史数据迁移**（迁移单独报批）。
- **本卡不做**：远程下载（卡 3）、删除（卡 5）。

#### 卡 3：A04 远程素材本地化（+ P0-07 B6）

- **范围**：`src/lib/remote-image.ts`（既有 `isFetchableImageUrl:77`、`fetchRemoteImageToArtifacts:98`、体积与超时常量 `:17-19`）、`api/content/import-url/route.ts`、`src/lib/publish.ts:24-41`（**B6**：发布侧解析与卡 1 对齐——basename 优先、以工作区目录为准）。
- **验收**：① URL 导入的 `og:image` 落地为 `artifacts/` 文件，`metadata.images` 里是本地可解析引用；② 下载失败/超时**不阻塞**文章导入（保留原始 URL 供显示）；③ **发布不再丢弃封面**：`resolveLocalImagePath()` 对远程输入不再是"静默空串"，改为可解释的失败或本地等价回退，且用户可见；④ 协议/内网限制沿用既有实现，不引入 SSRF；⑤ 体积上限与两种超时有测试。
- **测试要求**：新增 `src/lib/remote-image.test.ts`（本地 HTTP stub：成功 / 404 / 超时 / 超 10 MB / 非 http 协议 / 内网地址）；`api/content/import-url/route.test.ts` 扩展；`src/lib/content-images.test.ts`、发布相关测试保持通过。
- **冻结边界**：不改 `publish-run-panel` 的 UI 契约与 C2-1a 三态；不改 `verify` 路由；不新增表/列。
- **本卡不做**：素材库管理界面（卡 4 / 5 / 10）。

#### 卡 4：A07 素材引用查询

- **范围**：读侧聚合，复用 `contentImageList()`（`src/lib/content-images.ts`）、`createWorkspaceManifest()` 的 `linked / unlinked`（`src/lib/workspace/manifest.ts:331,375-382`）、`deriveContentImageAssociations()`（`src/lib/content-image-reconciliation.ts:16`）。输出形态在方案里定，**默认不改表结构**。
- **验收**：① 给定一个素材文件名 → 列出引用它的内容（`metadata_json.images` 与 `image_path` 两处都算）；② 给定一条内容 → 列出它的素材及其来源（本地 / 远程 / 生成）；③ 与 `GET /api/workspace/manifest` 的 `artifacts.linked / unlinked` **可对账**（不要求相等，要求差异可解释）；④ 可以枚举"没有任何内容引用的素材"。
- **测试要求**：`src/lib/workspace/manifest.test.ts`、`src/lib/content-image-reconciliation.test.ts` 扩展；若新增路由 → 新增路由测试（fixture 库 + 临时数据目录，范式见 `src/lib/backup.test.ts`）。
- **冻结边界**：**只读**；不改 manifest 返回结构；不新增表；不写缓存文件。
- **本卡不做**：删除与自动清理（卡 5 / 卡 10）。

#### 卡 5：A08 素材删除安全

- **范围**：`src/app/api/images/route.ts:55-60`（`DELETE`）+ `src/lib/image-library.ts:18`；删除前用卡 4 的查询做引用检查。
- **验收**：① **被至少一条内容引用**的素材拒绝删除，返回明确错误码与 message；② 未被引用的素材可删；③ 批量删除部分失败时结果可解释（删了哪些 / 拒了哪些）；④ 路径安全保持今天的行为（越目录、绝对路径、非图片扩展一律拒绝，测试已覆盖）；⑤ UI 删除入口显示被拒原因。
- **测试要求**：`src/app/api/images/route.test.ts` 扩展（被引用 / 未被引用 / 混合批量 / 越权路径 / 不存在文件）；`src/lib/image-library.test.ts` 保持通过。
- **冻结边界**：**不加软删除列/表**（要加先报批）；不改上传与列表行为；不改 `paths.ts`。
- **本卡不做**：清理历史孤立文件（属运维动作，见 §七）。

#### 卡 6：D01 ～ D07 内容草稿与保存一致性

- **范围**：`src/app/api/content/[id]/route.ts`（读写）、`src/db/repository.ts:400,435,446` 附近的内容仓储函数、`src/components/creation/article-editor/*`、`articles-workspace.tsx` 的创建入口。
- **映射与验收**：

| 子项 | 验收口径（对照 `dev-list.md:115-127`） |
| --- | --- |
| D01 状态定义 | `draft` / `ready` / `posted` / `failed` 各自含义写进文字；明确 `failed` 今天**没有任何写入者**（`markContentItemPosted` 只有 `publish-facts.ts:61` 与 `threads.ts:126` 两个调用者，全仓无内容状态 `failed` 写入），并决定是"定义出来留待将来"还是"补一个写入点"（后者属行为变更，需登记） |
| D02 保存可靠性 | 只有写库成功才显示"已保存"；失败必须可见且可重试 |
| D03 三入口一致 | 手动新建 / AI 生成 / URL 导入都走同一条写入路径，产出一致的字段与状态 |
| D04 字段完整性 | 重开后标题、正文、封面、素材引用都不丢 |
| D05 来源记录 | 记录内容来源（手动 / AI / URL），**形态若需新字段 → 先报批** |
| D06 最小证据 | "是否已保存"的判据最小化，**只加确实必要的字段**（可能需报批） |
| D07 失败可见与恢复入口 | 失败有明确提示与回到编辑/重试的入口 |

- **测试要求**：新增 `src/app/api/content/route.test.ts`（POST 创建，当前**缺失**）；`src/app/api/content/[id]/route.test.ts` 扩展写路径与 `draft` 落库断言；`src/db/repository.test.ts` 扩展；三个入口（`content/generate`、`ai-writing/generate`、`content/import-url`）各补一条"写入后字段一致"的断言。
- **冻结边界**：不改 C1 深链与编辑器 URL 契约；不改 C3 生成服务；`posted` 仍**只由发布事实**驱动（`publish-facts.ts`），编辑器不得手改；不改 C2/C2-1a。
- **本卡不做**：版本树、自动保存历史、多人协作（`dev-list.md:127`）；不碰平台草稿证据（卡 7）。

#### 卡 7：Draft Evidence / DE01 · DE04 · DE06 · DE07

- **范围**：`src/lib/browser-preview-shared.ts`（三态，**只读复用**）、`src/app/api/publish/draft/route.ts`（证据产生点）、`src/components/creation/publish-run-panel.tsx`（展示），以及"草稿准备记录"的实体（若持久化）。
- **验收**：① **DE01 先出方案**（存什么字段、存在哪里、保留多久、与 receipt 的关系、是否需要新表/列），**方案批准后才实现**；② DE05 的 `unknown` 语义**不被自动当成功**（回归测试固定）；③ 用户取消不产生虚假成功事实；④ 能从内容找到相关草稿准备记录（DE06）；⑤ 失败字段可定位（DE03 已由三态提供）且失败后能回到编辑或重新准备（DE07）；⑥ 不破坏 `DraftFieldOutcome` / `PublishDraftEvidence`（`dev-list.md:153`）。
- **测试要求**：`src/app/api/publish/draft/route.test.ts` 扩展（中断 / 取消 / `empty` / `unknown`）；`src/lib/browser-preview-shared.test.ts` 与 `browser-preview-session.test.ts` 回归；若新增读接口 → 新增路由测试。
- **冻结边界**：不改 verify 的写入条件与 receipt 一次性语义；不改三态判据；**不新建表**（若确需 → 报批）。
- **本卡不做**：自动发布路径（卡 8 才有结论）；不改 CoolPilot 不代点发布这一行为。

#### 卡 8：PE05 自动发布审计（**只出方案，不实现**）

- **范围（只读）**：`src/app/api/publish/route.ts`（状态映射 `:11-17`、写记录 `:30,57,76`、调 `publishToSite` `:73`）、`src/lib/publish.ts:44-82`（`output.published` 由浏览器工具**自报**）、`src/lib/threads.ts`（`:51` `findNextReadyContentItem`、`:126` `markContentItemPosted`）、`src/lib/publish-facts.ts`（对照 C2）、`src/app/api/publish-records/[id]/route.ts:22`（`updatePublishRecord` 的**生产**调用者）。
- **本轮已核实的事实（写成方案的第一节）**：
  1. 自动路径每处理一个帐号就写一条 `publish_records`，`status` 由 `recordStatusByResult` 决定（`published` / `drafted` / `failed`），其中 `published` **没有任何核验步骤**，来自 `output.published` 自报（`publish.ts:69-71`）。
  2. 自动路径**不移动** `content_items.status`；只有旧 worker 链路（`threads.ts:126`）在发布**之后**才移状态。
  3. 因此自动路径有两条独立风险：**假阳性事实**（未确认即写 `published`，污染发布记录 / 日历 / 指标匹配）与 **重复选择**（状态未成功迁移时 `findNextReadyContentItem()` 会再次选中同一条内容，与 P0-06 G3 同根因）。
  4. `data-model-inventory.md` §6 / §7-11 关于"只有一个写入路径"的说法**与源码不符**（§八 E1）——方案必须以源码为准。
- **验收（方案交付物）**：① 上述两条风险的书面结论与证据；② 明确"谁有权把一个发布标记为事实"；③ 重复触发 / 重试 / 结果未知的处理策略，以及与 PE03 的对齐结论；④ 最小修复方案（不改代码）+ 影响面（既有 `publish_records` 数据、指标匹配、内容日历）；⑤ 若需改写入者或加约束 → 单独报批条目。
- **测试要求（方案阶段可落地）**：为"自动路径写下 `published` 不依赖核验"这一**现状**补一条只读回归测试（防止在 P1 期间被悄悄"修好"而没有记录）；`api/publish/verify/route.test.ts`、`api/publish/draft/route.test.ts` 保持通过。
- **冻结边界**：不改 `verify` 路由与 `publish-facts.ts`；不改 `publish_records` 状态枚举；不改 C2 的"先写记录、再移状态"。
- **本卡不做**：实现修复（另开卡）；Agent 侧同根因问题（P2 的 G1）。

#### 卡 9：WF01 ～ WF10 端到端 Creator Workflow 1.0

- **前置**：卡 1 ～ 卡 8 全部冻结（`dev-exec-list.md:302`）。本卡**只做验收与最小修补**；任何修补都要回填冻结记录。
- **范围**：`docs/dev-list.md:199-221` 的 10 个场景 + §四 的 10 行验收设计。
- **验收**：① 交付一张"场景 → 结果 → 证据（测试文件 / 人工记录）"表，**不允许把未执行的场景写成通过**；② 逐条满足 `docs/dev-list.md:115-127`（内容侧）、`:143-155`（草稿证据）、`:170-182`（发布证据）与 `open-source-capability-map.md:780-786`（P1 验收标准）；③ `tsc --noEmit`、`eslint .`、`vitest run` 全绿；④ 人工部分（真实发布、登录态、应用重启）必须有可复述的操作步骤与结果记录。
- **测试要求**：补齐 §四 中标注"需新增"的测试（`api/content/route.test.ts`、`src/lib/remote-image.test.ts`、共用解析单测、`api/images/route.test.ts` 的引用保护用例）；smoke 记录沿用 `scripts/creator-editor-link-smoke.ts` 的形态。
- **冻结边界**：**不得为了通过验收而修改冻结面**；通过后按 `dev-list.md:221` 冻结 Creator Workflow 1.0，之后对素材解析 / 写入 / 证据 / 发布验证的任何改动都要新开卡。
- **本卡不做**：Agent、多平台、Marketplace（§七）。

#### 卡 10：A06 + A09 素材来源与内部文件隔离（可与卡 5 同批）

- **范围**：`products.image_path`、`content_items.source_urls_json`（产品/热点 ↔ 内容的**字符串**关联，`data-model-inventory.md` §7-6）、`runs.artifact_path` 与 `artifacts/` 的混用（用户素材 vs 运行产物）。
- **验收**：① "产品素材 / 用户上传 / AI 生成产物 / 运行截图"四类的归属与可见性写进文字；② 工作区视图能区分这四类（复用 manifest 分类，**不新增表**）；③ 产品图与内容的关联若仍只能是字符串，明确写成"已知限制"，不假装有外键。
- **测试要求**：`src/lib/workspace/manifest.test.ts` 扩展（分类断言）；`src/app/api/products/image/route.test.ts` 回归。
- **冻结边界**：不加外键、不加表（`data-model-inventory.md` §7-1；加约束与 C2 冻结语义冲突，需单独批准）。
- **本卡不做**：A10 文件可迁移性（暂缓，§七）。

---

## 六、任务分类：代码 / 数据库变更审批 / 隔离环境验收

| 类别 | 卡片与子项 | 判定依据 |
| --- | --- | --- |
| **只需代码修改（含测试与文档）** | 卡 1、卡 3、卡 4、卡 5、卡 10；卡 2（先出方案但**不改结构**）；卡 6 的 D02 / D03 / D04 / D07；卡 7 的 DE04 / DE06 / DE07（若不需要新字段）；卡 9 的验收修补 | 改动都在既有文件内，表结构不变 |
| **需数据库变更审批（先方案后实现）** | 卡 6 的 D05 / D06（若确需字段）；卡 7 的 DE01（草稿准备证据持久化）；卡 8 的 PE05（若需改写入者或加约束）；任何"新建 Asset 表"的提议 | `dev-exec-list.md:264`：任何表结构/迁移变更**先出方案再实现**；卡 1 / 4 / 5 已明令默认不加表 |
| **绝对禁止（冻结面改动）** | C2 的 verify 写入条件与 receipt 一次性语义、C2-1a 三态判据、C1 深链、C3 生成服务、AI Runtime、`agent_runtime_*`、`publish_records` 状态枚举 | §三 逐条判定；要改必须先走"解除冻结"流程 |
| **必须隔离环境验收** | 卡 7 的真实草稿交接；卡 9 中涉及真实平台、真实登录态（`browser-profiles/`）、打包产物重启的场景；P0-07 A3～A6（不属 P1，同一套隔离规矩） | `backup-restore-audit.md` §九：隔离副本 + 不复用生产数据目录 |
| **只读验收（无代码改动）** | PE01 / PE02 / PE04 回归（`api/publish/verify/route.test.ts` 已在）、PE06 已存在（`/publishing/records` + `/api/publish-records`）、P0-07 A1（`backup.test.ts` + `workspace/manifest.test.ts` + `paths.test.ts` + `api/workspace/manifest/route.test.ts` = 4 文件 / 43 测试，见 `backup-restore-audit.md:363`；其中 `src/lib/backup.test.ts` 单独 8 项）、`workspace manifest` 只读对账 | 能力已存在，只需记录与对账 |

---

## 七、P0 未完成事项与 P1 范围的分离

### 7.1 明确**不并入** P1 的（暂缓）

| 事项 | 来源 | 为什么不并入 P1 | 何时再看 |
| --- | --- | --- | --- |
| 备份 / 恢复补齐 B1～B7 | `backup-restore-audit.md` §十 | 属"备份系统重做"，与 Creator Workflow 1.0 的验收无关；只读审计已把风险定级 | P1 冻结后单独排卡 |
| 隔离副本演练 A3～A6 | `backup-restore-audit.md` §九 | 需要独立数据目录 + 真实账号/token，风险面在"真实发布"，不在 P1 | 人工指定负责人后执行（§八 D3） |
| Agent 执行缺口 G1～G6 | `agent-execution-audit.md` §九 | Agent 属 P2；P1 不接触 `agent_runtime_*`（§三 第 7 条） | P2 首卡 |
| A10 文件可迁移性 | `dev-list.md:75` | 依赖"备份是否包含文件本身"的产品决策（B5 / B7） | 备份决策之后 |
| 多平台适配 / Marketplace | `capability-map` §四 4.6 / 4.7 | 属 P4 / P5；P1 只做现有平台与站点 | P1 冻结后 |
| 自动发布修复（实现） | 本报告卡 8 | P1 只出方案；实现另开卡 | PE05 方案批准后 |
| `web-data/_tmp-e2e.db` 清理 | `backup-restore-audit.md` V4 | 0 字节疑似测试产物，无代码引用 | 人工确认时顺手处理 |

### 7.2 唯一交集：B6 ↔ 卡 3

`backup-restore-audit.md` 的 R7 / B6（素材路径解析统一）与 P1-01 的 A02 / A04 是**同一根因**（素材以路径字符串为身份）。处理方式：**不为它单独排卡**，把 B6 的验收条件并入卡 3（`src/lib/publish.ts:24-41`，已复验：远程 → `""`、绝对路径 → 原样、否则 join 工作区目录），并在卡 9 的验收表里同时勾掉"恢复后仍能找到图"这一条。反向说明：**P1 不修备份系统**，只修"路径解析"。

### 7.3 P0 未闭合且**阻塞** P1 的事项

只有一项：`dev-exec-list.md` §四 写死的 P0 门槛"**P0-06 已回填 §六 P2**"（本卡按约束未改，见 §八 D6）。（**2026-10-09 更新**：该项**已闭合**，见 §十一。）其余 P0 未完成项（B1～B7、A3～A6、G1～G6）都**不阻塞** P1。

---

## 八、待决策与暂缓清单（负责人动作；本卡一律未改）

| ID | 事项 | 现状（证据） | 为什么必须人工 | 建议动作 | 阻塞谁 |
| --- | --- | --- | --- | --- | --- |
| D1 | `replace` 恢复语义 | `README.md:303` 说"exact copy"，实现只清空**文件里出现的表**（P0-07 R3 / B4） | 产品语义二选一 | 选定后：要么改 README 措辞，要么让 `replace` 清空全部 schema 声明表 | 不阻塞 P1；阻塞 B4 与 A3～A6 |
| D2 | 备份加密与明文凭据 | `dify_connections.api_key` 明文入库（P0-07 R8 / B7） | 涉及存储 / 传输 / 访问权限与可用性取舍 | 独立评估（谁存、谁能读、是否排除或加密） | 不阻塞 P1；阻塞 B7 |
| D3 | A3～A6 隔离演练负责人 | P0-07 §九 全部标"需人工" | 需要独立副本、测试数据与清理边界 | 指定负责人 + 固定演练目录 | 阻塞 P0-07 的"验收"表述，不阻塞 P1 |
| D4 | `paused` vs `waiting_approval` | `dev-exec-list.md:362` 写"补 `waiting_approval`"；现状由 `paused` + `pendingApprovalJson` 承担 | 状态枚举是产品语义 | 按审计建议：**不新增枚举**，改为在文档中把 `paused` 定义为"等待人工审批中" | 阻塞 P2-03 首卡 |
| D5 | "P2-05 ～ P2-07" 编号 | `dev-exec-list.md` §六 与 `dev-list.md` §四 都只到 P2-04；`dev-exec-list.md:116` 已登记为未定项 | 无法确定指代，不能靠猜 | 人工确认（可能指 §十 队列第 7、8 行）或作废该表述。**附注**：`capability-map` §五 交付物提到的 `docs/creator-workflow-roadmap.md` 不存在，建议一并清理 | 不阻塞 P1 |
| D6 | **§六 P2 状态列回填（P0 门槛）** | `dev-exec-list.md:117` 记"待人工复核"（**2026-10-09 已闭合**：该行已改为"已完成"，见 §十一）；门槛文本见 §四 总验收行 | 本卡约束"不擅自修改 P2 状态列" | 人工一次编辑：按 `agent-execution-audit.md` §7.1～§7.4（AG01～AG23 逐条结论）回填 §六 P2-01～P2-04 的状态列；或明确豁免该门槛 | **P1 首卡开工前**（按门槛字面） |
| D7 | 内容中心是否为编辑入口 | `creator-workflow-audit.md` §7 列为未回答 | 影响 WF02 / WF09 与卡 1 / 卡 4 的验收范围 | 产品决策一次 | 不阻塞卡 1～卡 8；阻塞卡 9 |
| D8 | **P0-02 勘误 E1**（见 8.1） | 本轮复验：`api/publish/route.ts:30,57,76`、`api/publish-records/[id]/route.ts:22` | 关系已交付报告的准确性 | 批准后修正 `data-model-inventory.md` §6 行与 §7-11（本卡未改，只在此记录） | 不阻塞 P1；影响卡 8 的方案起点 |
| D9 | A07 / A08 放在 D 之前还是之后 | `dev-list.md:72-73` 把 A07 / A08 标为"完成核心工作流后再具备的管理与治理能力" | 排卡取舍（先稳定引用再改保存 vs 先跑通主链） | 确认本报告采用的 9 步顺序（A07 / A08 在前）；**确认前卡 6 不启动** | 卡 6 |
| D10 | 待验证项汇总 | P0-06 V1～V6、P0-07 V1～V7（含 C2-1b 提交后行号复核 V4） | 源码无法定论 | 各负责人按报告里的"建议验证方式"执行 | 不阻塞 P1 |

### 8.1 E1：P0-02 勘误（发布记录的写入者）

`docs/data-model-inventory.md` 有两处与当前源码不符：

1. §6 的 `publish_records.status` 行：写"**实际只有一个写入路径**：`recordPublishSuccess` → `published`"，"`recordPublishSuccess` 是全仓唯一的 `createPublishRecord` 调用方"。
2. §7 第 11 条："**发布事实只有一个入口**……`createPublishRecord` 在全仓的唯一调用方是 `recordPublishSuccess`（`src/lib/publish-facts.ts:46`）"，以及"`updatePublishRecord`（`repository.ts:1046-1062`）**目前没有生产调用方**"。

本轮复验结果：

| 断言 | 实测 |
| --- | --- |
| `createPublishRecord` 的生产调用者 | **4 处**：`src/lib/publish-facts.ts:46`（`status: "published"`）与 `src/app/api/publish/route.ts:30` / `:57` / `:76`（`status` 由 `recordStatusByResult`（`:11-17`）映射） |
| `updatePublishRecord` 是否有生产调用者 | **有**：`src/app/api/publish-records/[id]/route.ts:22` |
| 原结论是否仍然成立 | "发布事实只有一个入口"在**辅助发布路径**上成立（C2 的语义没有被破坏）；作为**全仓事实**不成立 |

对 P1 的影响：**卡 8（PE05）的风险面比原报告更大**——自动路径既可能写假阳性 `published`（无核验），又存在人工编辑发布记录的入口。修正方式（需批准，本卡未执行）：把 §6 那一行与 §7-11 改为「两个生产写入者 + 一个可编辑入口」，同时保留原结论的适用边界。

---

## 九、P0 总体验收结论与开始 P1 的前置条件

### 9.1 按 §四 给定的 6 条验收标准逐条判定

| 验收标准 | 判定 | 依据 |
| --- | --- | --- |
| 所有已完成阶段均有对应报告或可核实证据 | ✅ 通过 | §二 表：P0-01～P0-07 各有报告，关键断言本轮抽查复验通过（例外：E1 一处已记录并登记勘误） |
| 已冻结模块与后续修改范围明确分离 | ✅ 通过 | §三 的 8 条逐条判定 + 3 处"容易踩线"已写死停止边界 |
| P1 任务之间的依赖关系清楚 | ✅ 通过 | §五 5.1 依赖图、每卡的"依赖"列与 8 条顺序理由 |
| 未决策事项有明确负责人动作或进入暂缓清单 | ✅ 通过 | §八 D1～D10（每条含"阻塞谁"）+ §七 7.1 暂缓清单 |
| 不存在把未验证行为写成已通过验收的情况 | ✅ 通过 | 全文统一使用"已完成 / 已完成（只读审计）/ 待独立核实 / 待补齐 / 暂缓"；A3～A6、PE05、真实发布一律标"未执行" |
| **P0 门槛**：P0-06 已回填 §六 P2 | ❌ 交付时未闭合 → ✅ **2026-10-09 已闭合** | `dev-exec-list.md` §四 总验收行；本卡按约束未修改 §六（见 §八 D6）；闭合记录见 §十一 |

**结论：P0 有条件通过。** 文档与证据层全部通过；唯一未闭合项是"§六 P2 状态列回填"这一个**人工动作**。（**2026-10-09 更新**：该人工动作**已完成**，P0 现**无未闭合项**；见 §十一。）它不影响 P1 前几张卡的技术可行性，但按 `dev-exec-list.md` §四 的**字面门槛**，应在 P1 首卡开工前完成或明确豁免。

### 9.2 P1 启动的 4 条前置条件

1. **闭合 D6**：回填 §六 P2 状态列，或明确豁免该门槛（二选一，必须是人工确认过的动作）。→ **2026-10-09：已按第一项闭合（回填 §六 P2 状态列），见 §十一。**
2. **确认排卡**：确认 §五 的 9 步卡序、卡 10 的合并，以及 D9（A07 / A08 是否前置到 D 系列之前）。
3. **登记长期决策**：D1 / D2 / D3 可以暂不决定，但要指定负责人与期限（它们不阻塞卡 1 ～ 卡 3）。
4. **确认执行协议**：一次只派一张卡；每卡先方案后实现；卡内出现新增需求就停卡登记；每卡结束写冻结记录并跑 §十 的三条命令全绿。

### 9.3 建议的第一张卡

**卡 1（A02 统一素材 URL 解析 + A01 规则声明）**：改动面最小、依赖为零、不需数据库审批、验收可完全自动化，而且是卡 2 / 卡 3 / 卡 4 / 卡 5 的共同前置。

---

## 十、停止边界与本轮验证记录

### 10.1 未改动清单（本卡只读）

- **未修改**生产代码、数据库（schema / 迁移 / 数据）、配置（`next.config.ts`、`package.json` 等）与其他文档——**包括 §八 E1 指出的 P0-02 两处，本卡只记录不修正**。
- `docs/dev-exec-list.md` **仅回填 P0-08 的状态、报告链接与排卡结论**，共 5 处：① §四 P0-08 状态表行；② §四 P0-08 卡片（状态 + 结论摘要）；③ §四 总验收行的回填说明；④ §十 执行队列第 1 行的状态；⑤ §十 队列下方新增的"P1 细化卡序"提示。**§六 P2 状态列未改**。（2026-10-09 更新：该状态列已由后续文档修正任务回填，见 §十一。）
- 既有工作区改动（`README*.md`、`docs/creator-workflow-audit.md`、`next.config.ts`、`src/app/api/publish/*`、`src/lib/browser-preview*`、locales、test fixtures，以及未跟踪的新文档）**保持原样**：未 stash、未提交、未回滚。
- 未执行真实备份/恢复，未触发真实平台发布，未启动 Agent 任务，未调用任何发布端点。

### 10.2 验证命令与结果（本轮实测）

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0** |
| `node_modules\.bin\eslint.cmd .` | **0 errors / 1 warning**（既有：`src/components/agent-chat/chat-conversation.tsx:146` `react-hooks/exhaustive-deps`；非本卡引入，未修改该文件） |
| `node_modules\.bin\vitest.cmd run` | **88 个测试文件 / 574 个测试全部通过，exit 0**（两次运行结果一致：17.77s / 17.51s） |
| 复验抽查（见 §二 右列） | 均为真实读取：`schema.ts:111-132`、`browser-preview-shared.ts:31-45`、`publish.ts:24-41`、4 处客户端解析、`markContentItemPosted` 的调用者、`/api/agent/runs`（不存在）、`/api/images` 的 DELETE、`README.md:303`、`dev-exec-list.md:149/264/302` |

> 说明一（退出码）：`vitest` 第一次运行经管道包装（`2>&1 | Select-Object`）后回报了可疑的非零退出码，已改用"输出重定向 + 显式读取 `$LASTEXITCODE`"重跑；**单独运行**的结果为 `Test Files 88 passed (88)` / `Tests 574 passed (574)` / `EXIT=0`（三次单独运行：17.77s、15.44s、15.56s）。
>
> 说明二（并行运行的假失败，重要）：本轮曾出现一次**两个 `vitest` 进程并发**运行的情况，该次结果为 `Test Files 1 failed | 87 passed (88)` / `Tests 1 failed | 573 passed (574)` / `EXIT=1`，失败点是 `src/lib/ai/generate.test.ts:150` 的 `beforeEach` → `resetRuntime()` 报 `Error: Hook timed out in 10000ms.`（**基础设施/资源超时，不是断言失败**）。该次之后**单独重跑全绿（exit 0）**。因此记录如下结论：**并行运行 `vitest` 会因 hook 超时产生假失败；本项目的验收命令必须一次只跑一个 `vitest` 进程**——这也是 P1 每卡验收（§九 9.2 第 4 条）的操作性要求。

### 10.3 交付物清单

- 本文件（`docs/p0-acceptance-and-p1-sequencing.md`）：P0 状态与证据表（§二）、冻结边界核查（§三）、端到端验收场景设计（§四）、P1 依赖图与卡片验收条件（§五）、任务分类（§六）、P0 与 P1 的范围分离（§七）、待决策与暂缓清单（§八）、总体验收结论与前置条件（§九）。
- `docs/dev-exec-list.md` 的 5 处回填（见 10.1）。

### 10.4 停止边界

本卡完成后**停止**：不执行 P1 的任何实现，不执行 P0-07 的 A3～A6 演练，不修正 P0-02 的勘误，不回填 §六 P2 状态列——等待人工复核。（**2026-10-09 更新**：人工复核通过后，这两项已由后续文档修正任务完成；见 §十一。）

## 十一、交付后状态更新（2026-10-09，追加记录）

> 本节为**追加记录**：不修改 §一 ～ §十 的原始结论、判定与卡序，只登记交付后由人工安排的两项文档修正的闭合状态。

| 项 | 交付时状态 | 现状（2026-10-09） | 证据 |
| --- | --- | --- | --- |
| §八 D6：§六 P2 状态列回填（P0 最后一条门槛） | 未闭合（人工动作） | **已闭合** | `docs/dev-exec-list.md` §六 的 P2-01 ～ P2-04 四个表已改为「状态（现状）+ 结论 / 证据」四列，逐条落 `docs/agent-execution-audit.md` §7.1 ～ §7.4 的结论（已存在 7 / 部分存在 12 / 不存在 4）、状态口径与 `file:line`；`dev-exec-list.md:117` 由"待人工复核"改为"已完成（2026-10-09）"；`paused` vs `waiting_approval` 与 "P2-05 ～ P2-07" 两项仍为待决事项，未擅自决定 |
| §十 勘误 E1：`docs/data-model-inventory.md` §6 / §7-11 的"发布事实写入者"结论 | 已发现，未修正 | **已修正** | `data-model-inventory.md` §6 `publish_records.status` 行与 §7-11 已按 4 个生产调用点（`publish-facts.ts:46`；`api/publish/route.ts:30/57/76`）与 `updatePublishRecord` 的生产调用方（`api/publish-records/[id]/route.ts:22`）重写；原结论以"修正说明"保留在 §7-11 末尾；`dev-exec-list.md` 在 §四 P0-02 卡、§四 P0-08 卡、§四 总验收说明与 §十 队列第 1 行同步登记 |

- **P0 是否可冻结**：§四 的 6 条验收标准现**全部闭合**（第 6 条"P0-06 已回填 §六 P2"于 2026-10-09 完成），P0 具备冻结条件。P1 仍按 §五 的 9 步卡序开工，首卡 = **A02（+ A01 规则声明）**；§九 的 4 条开工前置与 §八 的三项长期人工决策（D1 `replace` 语义 / D2 备份加密 / D3 隔离演练负责人）**不变**，也仍**不阻塞**卡 1 ～ 卡 5。
- **行号基准**：本节追加于文件末尾，不改变上文行号。`dev-exec-list.md` §六 因回填新增 12 行，故本报告对 §六 的行号引用已由 `dev-exec-list.md:360` 同步为 `:362`；其余引用 `:116` / `:117` / `:149` / `:171-180` / `:264` / `:302` 已复验未变。
- **本次仍不改动的面**：未改源码 / 数据库 / 配置 / 冻结契约；未启动 P1 实现；未执行真实发布或备份恢复。
