# P0-06 Agent 执行基础审计（只读）

> **审计对象**：CoolPilot 当前已有的 Agent 执行基础——任务与运行模型、执行器与调度、Agent 与工具调用、人工审批与发布安全、持久化与可观测性。
> **审计方式**：只读源码取证（读文件 + grep）。**未运行 Agent 任务、未触发任何平台发布、未改数据库/配置/生产代码。**
> **基线**：工作区当前版本，含未提交的在途改动（`git status` 前后一致，见 §12）。凡引用 `src/app/api/publish/*` 的代码，均指工作区当前版本（C2-1b 在途，未提交）。
> **结论定位**：**P2 = 混合方式（收口为主 + 三处最小补齐）**，不是从零建设，也不是纯收口。见 §8。

---

## 一、一句话结论

CoolPilot **已经具备一条真实可运行的 Agent 执行链**：聊天 → 模型规划（走统一 AI Runtime）→ 工具注册与 zod 双向校验 → 逐工具执行 → 需审批则写 `paused` + `pendingApprovalJson` 暂停 → `/api/agent/runs/[id]/resume` 读库恢复 → 终态写 `resultJson`；执行过程与聊天记录都落库，刷新页面可还原暂停态。

**但它还缺三件关键事**，而且三件都集中在“能不能安全地做真实业务”上：

1. **Agent 的发布结果没有任何业务事实**：`threads_create_post` 只返回自报的 `published: true`，不写 `publish_records`、不改 `content_items.status`、不产生可核验证据，也**绕过了 C2 已冻结的 `checkPublishResult` 核验契约**（§九 G1）。
2. **任务只能通过聊天消息间接看到**：没有 `GET /api/agent/runs`（列表）与 `GET /api/agent/runs/[id]`（详情），P2-04 / P3-01 没有可用的读接口；`/api/agent/runs/[id]/events`（含 SSE 流）**已存在但全仓无人调用**（§九 G2）。
3. **失败/未知/取消/幂等四类语义基本不存在**：无重试策略、无幂等键、无 `unknown` 结果语义、无运行中取消、无状态转移守卫；`running` 中被中断的 run 永久停在 `running`（§六、§九 G3–G5）。

---

## 二、现有 Agent 执行架构（现状图）

```
[Chatroom UI]  src/app/[locale]/(console)/chatroom/page.tsx:7 → components/agent-chat/chat-conversation.tsx
   │  POST /api/agent/chat                            chat-conversation.tsx:204
   ▼
[/api/agent/chat]  src/app/api/agent/chat/route.ts:78
   ├── 排程意图分支（纯正则，不经模型）looksLikeScheduleRequest → resolveScheduleIntent
   │        src/lib/agent/schedule-intent.ts      → schedules 表（createSchedule）
   └── LangGraphAgentEngine().run()                src/lib/agent/langgraph-engine.ts:339
   ▼
[Agent Engine]  src/lib/agent/langgraph-engine.ts
   ├── planToolCalls()                :152
   │      └─ aiRuntime.chatStructured(toolPlanSchema)  :165   ← 唯一模型入口（AI Runtime）
   │      └─ steps.filter(registry.has)                :170   ← 工具名白名单
   ├── ToolRegistry                   src/lib/agent/tool-registry.ts:4
   │      └─ 9 个本地工具             src/lib/agent/local-tools.ts:26（browser_* 4 / generate_* 3 / *_create_post 2）
   ├── executeToolCalls()             :255
   │      ├─ requiresApproval → 暂停  :269-303（status=paused + pendingApprovalJson）
   │      ├─ emit tool_start/tool_end :305,:309
   │      └─ 工具抛错 → status=failed 结果 + error 事件 :312-313（不中断、不重试）
   └── 终态：success :325-330 / failed :397-398 / cancelled（拒绝审批）:412-423
   │
   ├── 持久化：agent_runtime_runs（schema.ts:111）+ agent_runtime_events（:125）
   ├── 聊天侧：chat_threads/chat_messages/chat_tool_calls（schema.ts:71,:79,:90）
   └── 审批回路：聊天消息 metadata.localAgentStatus="paused"
              → UI Continue/Stop   chat-conversation.tsx:87-107
              → POST /api/agent/runs/[id]/resume   src/app/api/agent/runs/[id]/resume/route.ts:92
              → engine.resume()  :402（读 stateJson → 续跑 pendingIndex）
              → syncResumeResultToChat  resume/route.ts:24-90
```

**并行的第二条链（playbook runs，不是 Agent）**：

```
[Runs 页面] src/app/[locale]/(console)/runs/page.tsx:17
   │ POST /api/runs（含 frontendPublishApproved 门禁）page.tsx:80-90 / api/runs/route.ts:18-24
   ▼ runs 表（status=queued）  repository.ts:597-620
   ▼ 驱动者：Electron 主进程 10s 轮询  electron/main.cjs:158-175（token :17,:120）
        → POST /api/internal/scheduler/tick  api/internal/scheduler/tick/route.ts:9-18
        → schedulerTick()  worker/scheduler-service.ts:20  或  claimNextQueuedRun() repository.ts:644
        → processRun()     worker/runner.ts:195 → lib/threads.ts:40（markContentItemPosted:126）
   ▼ 另一驱动者：独立 worker 进程  src/worker/worker.ts:11-20（`pnpm worker`，打包版未见自动拉起）
```

**两条互不相通的“真实发布”路径（本次审计最关键的结构性发现）**：

```
(A) 辅助发布（C2，已冻结，有核验）
    publish-run-panel → POST /api/publish/draft（rememberPublishDraft:36）→ 人工在平台发帖
      → POST /api/publish/verify（checkPublishResult + takePublishReceipt + recordPublishSuccess:40-49）
      → 写 publish_records + content_items→posted（lib/publish-facts.ts:42-61）

(B) Agent 工具发布（无核验、无事实）
    threads_create_post（local-tools.ts:238）→ runSiteBrowserTool（browser-preview-session.ts:1568）
      → runThreadsCreatePost 返回 { drafted, published, ... }（:958 draft / :1005 published）
      → 仅写 chat_tool_calls + agent_runtime_events；**不写 publish_records、不改内容状态、无 receipt**
```

即：C2 用“receipt 消费 + 平台信号核验”把「已发布」变成业务事实；Agent 路径目前拿的是**工具自报的布尔值**。

---

## 三、真实调用链（创建 → 执行 → 终态）

### 链 A：聊天触发一次 Agent 运行（含规划与工具执行）

| # | 动作 | 证据（file:line） |
| --- | --- | --- |
| A1 | UI 提交消息 | `src/components/agent-chat/chat-conversation.tsx:204` |
| A2 | 路由解析 + 取/建会话 | `src/app/api/agent/chat/route.ts:78-91` |
| A3 | 写用户消息 + 组装上下文 | `route.ts:92-100`（`createAgentChatMessage` → `buildAgentChatContext`，`src/lib/agent/chat-context.ts`） |
| A4 | **排程意图分支**：正则命中则不走模型，直接解析“时间+账号+最近内容” | `route.ts:102-134`；`src/lib/agent/schedule-intent.ts`；`createSchedule` `src/db/repository.ts:524` |
| A5 | 否则进入引擎 | `route.ts:177-185`（`new LangGraphAgentEngine().run({ message, site, threadId, locale })`） |
| A6 | 读设置 + 系统提示词 | `langgraph-engine.ts:339-348`（`getLocalAgentSettings`、`buildAgentSystemPrompt`） |
| A7 | 创建运行记录（**直接 `running`**，不是 `queued`） | `langgraph-engine.ts:349-353`；`createAgentRuntimeRun` `repository.ts:912-937`（函数默认 `queued`，引擎显式传 `running`） |
| A8 | 事件 `progress` | `langgraph-engine.ts:371` |
| A9 | 规划：模型 + 工具目录 → 步骤 | `planToolCalls` `:152-181`；`aiRuntime.chatStructured` `:165`；`toolPlanSchema` `src/lib/ai/schemas.ts:57-69` |
| A10 | 工具名白名单过滤（未注册的步骤被静默丢弃，无审计事件） | `langgraph-engine.ts:170` |
| A11 | 规划失败/无可用工具 → 单步降级为 `generate_social_post_draft` | `:171-180`（测试：`src/lib/agent/langgraph-engine.test.ts:116-128`） |
| A12 | 循环执行 | `executeToolCalls` `:255-337` |
| A13 | 输入补全（把上一步草稿/图片/上下文注入后续工具参数） | `resolveToolInput` `:186-221` |
| A14 | 审批判定 | `:269-272` → `ToolRegistry.requiresApproval` `tool-registry.ts:43-53` |
| A15 | 需审批 → 写 `paused` + `pendingApprovalJson={toolCall}` + `approval_required` 事件 | `:277-303`（`updateAgentRuntimeRun` `repository.ts:945-966`） |
| A16 | 执行 → zod 输入解析 → 工具 → zod 输出解析 | `tool-registry.ts:36-41`；本地工具 `local-tools.ts`（`browser_open_page:29`、`browser_click:51`、`browser_type:80`、`browser_screenshot:113`、`generate_social_post_draft:138`、`generate_image_prompt:182`、`generate_image_file:213`、`threads_create_post:238`、`xiaohongshu_create_post:279`） |
| A17 | 事件 `tool_start` / `tool_end`；失败则 `failed` 结果 + `error` 事件并**继续下一步** | `:305`、`:309`、`:312-313` |
| A18 | 组装助手文本 + `final` 事件 | `buildAssistant` `:223-253`；`:318` |
| A19 | 终态 `success`，`resultJson={assistant, toolCalls}` | `:325-330` |
| A20 | 回写聊天：工具调用逐条入库、助手消息带 `metadata.localAgentRunId` / `localAgentStatus` | `route.ts:33-64`（`persistLocalToolCalls`）→ `createAgentToolCall` `repository.ts:844-878`；助手消息 `route.ts:186-198` |
| A21 | 浏览器工具落到本地真浏览器 | `local-tools.ts:259,309` → `runSiteBrowserTool` `src/lib/browser-preview-session.ts:1568-1701` |
| A22 | 生文/生图落到统一 Runtime | `local-tools.ts:192`（`aiRuntime.chatStructured`）、`local-tools.ts:224` → `src/lib/agent/image-generation.ts:53-58`（`aiRuntime.generateImage`） |

**链 A 的性质**：**单次 HTTP 请求内同步执行完整个计划**（`route.ts:177` 之后 `await`）。除“审批暂停”外没有断点，因此进程中途被杀 ⇒ 该 run 永久停在 `running`（§六.5）。

### 链 B：审批 → 恢复（唯一真正可恢复的断点）

| # | 动作 | 证据（file:line） |
| --- | --- | --- |
| B1 | 暂停态写入聊天消息元数据（`paused` + runId） | `route.ts:186-198` |
| B2 | UI 从库还原并渲染 Continue / Stop | `chat-conversation.tsx:54-55`、`:87-107` |
| B3 | POST resume（`{ approved, input: { locale } }`） | `chat-conversation.tsx:61` → `src/app/api/agent/runs/[id]/resume/route.ts:92-109` |
| B4 | 写 `resume` 事件 | `langgraph-engine.ts:405-410` |
| B5 | `approved=false` → `status=cancelled` + `resultJson`（“拒绝”与“取消”共用此路径） | `:411-423`；回写聊天 `resume/route.ts:44` |
| B6 | `approved=true` → 读 `stateJson`：`toolResults` / `pendingIndex` / `pendingToolCall` | `:425-432` |
| B7 | 重建执行上下文（settings / 账号 / 提示词） | `:434-465` |
| B8 | `status=running` 后从 `pendingIndex` 续跑，仅对该次调用跳过审批 | `:456`、`:467-475`（`approvedToolCallId` → `tool-registry.ts:44-46`） |
| B9 | 结果回写聊天（工具调用 + 助手消息） | `resume/route.ts:24-90` |
| B10 | 无待审批工具时 `resume` 抛错（无状态守卫） | `langgraph-engine.ts:429-432` |

**链 B 的性质**：`stateJson` 只在**暂停点**与**终态**写；计划内的部分进度（已完成的工具结果）**不落库**（只落事件）。所以“可恢复”仅限 `paused`，且恢复时会**重跑 pending 的那一个工具**（幂等无保证）。

### 链 C：playbook 运行（对照项——任务/调度基础已存在，但不是 Agent）

| # | 动作 | 证据（file:line） |
| --- | --- | --- |
| C1 | Runs 页面排队（含“正式发布需勾选确认”门禁） | `src/app/[locale]/(console)/runs/page.tsx:64,80-90,186-201` |
| C2 | 服务端门禁 | `src/app/api/runs/route.ts:18-24`（`confirmLivePost` 必须有 `frontendPublishApproved`） |
| C3 | 入队 `queued` + `run_events` | `repository.ts:597-620` |
| C4 | 驱动：Electron 主进程 10s tick（打包版唯一驱动） | `electron/main.cjs:158-175`；`src/app/api/internal/scheduler/tick/route.ts:9-18` |
| C5 | 驱动：独立 worker 进程（手动 `pnpm worker`） | `src/worker/worker.ts:11-20`；`package.json` scripts.worker |
| C6 | 认领与执行 | `claimNextQueuedRun` `repository.ts:644-657`；`processRun` `runner.ts:195-228` |
| C7 | 定时去重（**靠最近 200 条 run 扫描**，非幂等键） | `scheduler-service.ts:30`（`listRuns(200).find(scheduleId && params._scheduledFor)`） |
| C8 | 终止/失败写终态 | `runner.ts:222`、`:227` |
| C9 | Threads 发帖并改内容状态 | `src/lib/threads.ts:40-131`，`:126 markContentItemPosted`（**此路径同样不写 `publish_records`**） |
| C10 | 取消信号 | `runner.ts:54`（`checkStop` 读 `run_events` 是否 `cancelled`），但**全仓没有任何地方把 run 置为 `cancelled`** |

> 结论：任务 / 调度 / 执行器 / 事件日志这套基础**已经存在且是生产在用**（打包版由 Electron 主进程驱动）。Agent 目前是**另一条平行的执行链**，两者共享 `accounts` / `content_items`，但**不共享任务表、不共享调度、不共享恢复机制**。

---

## 四、数据模型与关联方式（含 JSON blob 隐式关联）

### 4.1 Agent 执行侧

| 表 | 位置 | 关键列 | 性质 |
| --- | --- | --- | --- |
| `agent_runtime_runs` | `schema.ts:111-123`（DDL `client.ts:154`，索引 `client.ts:268`） | `id`(PK) / `thread_id` / `account_id` / `status`(默认 `queued`) / `mode`(固定 `local`) / `input_json` / `state_json` / `pending_approval_json` / `result_json` / `created_at` / `updated_at` | **执行记录**。**没有** `started_at` / `finished_at` / `error` / `retry_count` / `idempotency_key` |
| `agent_runtime_events` | `schema.ts:125-132`（DDL `client.ts:167`，索引 `client.ts:269`） | `id` / `agent_run_id` / `type` / `message` / `data_json` / `created_at` | **执行过程记录**（事件流；7 种 type：`progress/tool_start/tool_end/approval_required/resume/error/final`，`types.ts:343-350`） |

关联方式：`agent_runtime_events.agent_run_id → agent_runtime_runs.id`（**逻辑关联，无外键**）；`thread_id` / `account_id` 同样是**逻辑关联，无外键**。

### 4.2 聊天侧（Agent 的“界面数据源”）

| 表 | 位置 | 与 Agent 运行的关系 |
| --- | --- | --- |
| `chat_threads` | `schema.ts:71-77` | 会话容器（`agent_runtime_runs.thread_id` 指向它） |
| `chat_messages` | `schema.ts:79-88` | 助手消息 `metadata.localAgentRunId` / `metadata.localAgentStatus` 是**聊天 → 运行**的唯一连接点（**JSON blob 隐式关联**，`route.ts:191-197`） |
| `chat_tool_calls` | `schema.ts:90-103` | 逐条工具调用（`status` 默认 `pending`，`repository.ts:866`）。**没有 `agent_run_id` 列**——只能靠 `message_id → chat_messages.id` 再翻 `metadata.localAgentRunId`（**两级 JSON 隐式关联**） |

### 4.3 业务事实侧（Agent 基本不写）

| 表 | 位置 | 谁在写 | Agent 是否写 |
| --- | --- | --- | --- |
| `content_items` | `schema.ts:17-28` | `generate_social_post_draft`（`local-tools.ts:165 createContentItem`）、`generate_image_file`（`:226 updateContentItemImage`） | **只写内容，不写状态转移**——`posted` 仍只有 `markContentItemPosted`（`repository.ts:446`）的既有调用者 |
| `publish_records` | `schema.ts:181-208` | 仅 `/api/publish/verify` → `recordPublishSuccess`（`lib/publish-facts.ts:42`） | **否**（Agent 发布路径无 receipt、无核验、无写入） |
| `schedules` | `schema.ts:30-44` | 排程意图分支 `route.ts:123-131`（是否自动落库取决于 `agentPermissions.schedulePost`，`route.ts:122`） | **是**，但走的是**正则意图分支**、不是工具调用；`confirm` 时只回文案不落库 |
| `runs` / `run_events` | `schema.ts:46-69` | playbook 运行 | **否**（Agent 与 playbook 无任何关联列） |

### 4.4 隐式关联清单（P2 需要显式化的部分）

1. 聊天 → 运行：`chat_messages.metadata_json.localAgentRunId`（JSON）。
2. 工具调用 → 运行：`chat_tool_calls.message_id` → 上面的 JSON（**无直接列**）。
3. 运行 → 内容：`agent_runtime_runs.result_json.toolCalls[].output.itemId` / `state_json.toolResults[].output.itemId`（JSON），以及会话推导的 `chatContext.latestContentItemId`（`src/lib/agent/chat-context.ts`）。
4. 运行 → 账号：`agent_runtime_runs.account_id`（列，OK）。
5. 运行 → 发布记录：**不存在**（Agent 发布不产生记录）。
6. 同一事实的重复记录：一次工具调用同时存在于 `chat_tool_calls`（表）、`agent_runtime_events`（`tool_start/tool_end` 的 `data_json`）、`agent_runtime_runs.result_json`（三段副本）；`resume` 时再由 `resultJson` 反推聊天侧（`resume/route.ts:24-90`）⇒ **无单一权威来源**。

### 4.5 三类对象的边界（沿用 P0-04 结论）

- **执行过程记录**：`agent_runtime_events`、`agent_runtime_runs.state_json/input_json`、`run_events`。
- **业务事实**：`content_items`（及其 `status`）、`publish_records`、`schedules`。
- **核验证据**：`PublishDraftReceipt`（会话内存 + `rememberPublishDraft`，`browser-preview-session.ts:538`）、`checkPublishResult().evidence`（写入 `publish_records.message`）。
- 边界本身清晰，**但 Agent 执行链目前只写第一类**——这是 §九 G1 的根因。

---

## 五、能力矩阵（已存在 / 部分存在 / 不存在）

### 5.1 已存在（可直接复用，不需新建）

| 能力 | 证据 |
| --- | --- |
| 工具注册与查找 | `ToolRegistry` `tool-registry.ts:4-34`；`createDefaultToolRegistry` `local-tools.ts:26`（9 个工具） |
| 工具输入/输出校验 | `tool-registry.ts:36-41`（`inputSchema.parse` + `outputSchema.parse` 双向） |
| 工具类型契约 | `src/lib/agent/contracts.ts`（`AgentToolDefinition` / `AgentExecutionContext`） |
| AI 调用统一入口 | `aiRuntime.chatStructured`（`langgraph-engine.ts:165`、`local-tools.ts:192`）、`aiRuntime.generateImage`（`image-generation.ts:58`）——全仓无第二套模型调用链 |
| 审批暂停与存储 | `paused` + `pending_approval_json`（`langgraph-engine.ts:289-303`） |
| 审批恢复链路 | `POST /api/agent/runs/[id]/resume`（`resume/route.ts:92-109`）+ `engine.resume`（`:402-476`） |
| 执行事件 | `appendAgentRuntimeEvent` / `listAgentRuntimeEvents`（`repository.ts:968-995`）；HTTP `/api/agent/runs/[id]/events`（含 SSE，`events/route.ts:6-42`） |
| 运行持久化 | `agent_runtime_runs` 全套读写（`repository.ts:912-966`） |
| 聊天持久化与刷新还原 | `/api/agent/chat` GET + `chat_tool_calls`；UI 从库渲染暂停按钮（`chat-conversation.tsx:54-55`） |
| 任务/调度/执行器（playbook） | `runs`/`run_events`/`schedules` + `claimNextQueuedRun` + `processRun` + Electron tick |
| 发布核验契约（C2，已冻结） | `checkPublishResult` / `takePublishReceipt` / `recordPublishSuccess`（`publish-facts.ts:42-61`） |
| 权限模式设置 | `LocalAgentSettings.agentPermissions`（`types.ts:279-303`）+ 工具侧 `requiresApproval` |

### 5.2 部分存在（能用但不完整，需收口）

| 能力 | 现状 | 缺口 |
| --- | --- | --- |
| 任务状态 | 枚举存在（`types.ts:276`） | `updateAgentRuntimeRun` **无转移校验**（`repository.ts:945-966`）；`queued` 实际从未使用（引擎直接 `running`）；缺 `waiting_approval` 语义（现由 `paused` 承担） |
| 任务详情 | 四个 JSON 齐全 | **无 HTTP 读接口**（`/api/agent/runs/[id]` 不存在） |
| 工具结果 | `{output}` / `{error}`（`langgraph-engine.ts:308,312`） | 无统一 `status`（成功/失败/**未知**）、无 `unknown`、无耗时/重试元数据 |
| 工具权限 | 二值“是否需要审批” | 无读/写/删/外部发布风险分类；`execute` 内无二次权限校验（`tool-registry.ts:36-41`） |
| 业务能力复用 | 复用 `generateTopicPost`、`runSiteBrowserTool`、`image-generation` | 直接写库 `createContentItem` / `updateContentItemImage`（`local-tools.ts:165,226`）；发布**绕过 C2 核验** |
| 可恢复性 | `paused` 可从库恢复 | `running` 中断不可恢复；无崩溃后扫描；无“先核验再重做” |
| 事件游标 | `after` 游标存在 | `repository.ts:987-995` / `678-686` 用 `createdAt > after` 过滤，**同毫秒事件会漏**（含 SSE，`events/route.ts:21-25`） |
| 取消 | 拒绝审批 → `cancelled` | 无运行中取消端点；playbook 的 `checkStop`（`runner.ts:54`）无人触发 |

### 5.3 不存在（确实缺失，P2 必须补齐才能做真实业务）

| 能力 | 证据 |
| --- | --- |
| Agent 任务列表 API / 详情 API | `src/app/api/agent/runs/` 下只有 `[id]/events`、`[id]/resume`；`repository.ts` 无 `listAgentRuntimeRuns` |
| 任务读界面（列表 / 步骤进度 / 恢复建议） | 仅 `chatroom` 消费工具调用；`/api/agent/runs/[id]/events` 的客户端消费者为 0 |
| 重试策略与退避 | Agent 链无 retry/backoff；工具失败即跳过（`langgraph-engine.ts:312-313`） |
| 幂等键 / 幂等保护 | `claimNextQueuedRun` 为“读-改”无锁（`repository.ts:644-657`）；Agent 无幂等键 |
| 结果未知（unknown）语义 | 工具只返回 `drafted/published` 布尔（`browser-preview-session.ts:958,1005`）；无 `waiting`/`unknown` |
| 状态转移守卫 | 无非法转移拒绝（`resume` 对任意 run 都尝试续跑） |
| 错误归类 | 错误只有字符串（`langgraph-engine.ts:396-397`） |
| 崩溃恢复（`running` → 明确终态/待核验） | 全仓无该逻辑 |

---

## 六、失败 / 重试 / 取消 / 未知结果 / 重启的处理现状

### 6.1 失败

| 场景 | 现状 | 证据 |
| --- | --- | --- |
| 单个工具执行失败 | 记为 `failed` 结果 + `error` 事件，**继续执行后续步骤**；最终 run 仍可能写 `success` | `langgraph-engine.ts:307-313`、`:325-330` |
| 后果 | **“部分失败被整体成功掩盖”**：助手文本只汇总 `completed` 的工具（`buildAssistant` `:223-253`），`resultJson.toolCalls` 里虽有 `failed`，但状态是 `success` | 同上 |
| 模型规划失败 | 捕获后降级为单步 `generate_social_post_draft`，run 不标记降级 | `:171-180`；测试 `langgraph-engine.test.ts:123-128` |
| 引擎整体异常 | run → `failed` + `resultJson.error` | `:396-398` |
| 路由层兜底 | `catch` → 500 错误响应 | `src/app/api/agent/runs/[id]/resume/route.ts:106-109` |

### 6.2 重试

- **不存在重试策略**：没有 retry 计数、没有退避、没有“可安全重试/不可安全重试”的区分（`agent_runtime_runs` 连 `retry_count` 列都没有，`schema.ts:111-123`）。
- 用户重发同一条消息会生成**另一个全新 run**，两者之间**没有 `retry_of` / `parent_run_id` 关联**（`createAgentRuntimeRun` `repository.ts:912-937`）。
- playbook 侧同理：失败 run 不会被再次认领（`claimNextQueuedRun` 只取 `queued`，`repository.ts:649`）。

### 6.3 取消

- **运行中取消：不存在**——没有 `cancel` 端点；`agent_runtime_runs` 也没有“请求取消”标记位。
- **暂停中取消**：`POST /api/agent/runs/[id]/resume { approved:false }` → `status=cancelled`（`langgraph-engine.ts:411-423`），但结果里**不说明已经发生的外部操作**（只有一句文本）。
- playbook 的取消信号 `ctx.checkStop`（`runner.ts:54`）读取的 `run_events` 里**没有任何代码会写入 `cancelled`**（全仓 grep：`"cancelled"` 的写点只在 `updateSchedule` 与 `agent/schedules`，不涉及 `runs` 表）。

### 6.4 结果未知（unknown）

- **Agent 链没有 unknown 概念**：`threads_create_post` 在点击 Post 后 `sleep(4s)` 便返回 `published: true`（`browser-preview-session.ts:1004-1005`），**不做平台信号核验**。
- 对照 C2（已冻结）：`checkPublishResult` 三态 `published / unknown / waiting`，且“URL 变了”本身**不足以宣布成功**（`src/app/api/publish/verify/route.ts:17-28` 注释）。
- **风险**：Agent 路径会把“点了按钮但不确定是否发出”表达为成功 ⇒ **误报成功**，与 PE01/PE02 已冻结目标直接冲突。

### 6.5 进程重启 / 刷新

| 对象 | 重启后行为 | 证据 |
| --- | --- | --- |
| Agent run `paused` | **可恢复**（stateJson 含 toolCalls / pendingIndex / pendingToolCall；UI 从聊天消息还原 Continue/Stop） | `langgraph-engine.ts:425-432,467-475`；`chat-conversation.tsx:54-55` |
| Agent run `running` | **永久停在 running**：无扫描、无恢复；`resume` 因缺 `pendingToolCall` 抛错 | `langgraph-engine.ts:429-432`；全仓无清理逻辑 |
| playbook `queued` | 由 tick 继续认领 | `repository.ts:644-657` |
| playbook `running` | **永久停在 running**（claim 只取 `queued`） | `repository.ts:649` |
| 浏览器 session / PublishDraftReceipt | **丢失**（只在会话内存，未持久化） | `browser-preview-session.ts:530-560` |
| 刷新页面 | 聊天历史、工具调用、暂停按钮可还原；**任务级状态与步骤进度不可见**（无读接口） | `chat-conversation.tsx:139-150` |

### 6.6 幂等

- Agent 链：**无幂等键**。唯一“幂等”来源是审批暂停（暂停后若不 resume 就不会继续），以及 `ToolRegistry.requiresApproval` 里 `approvedToolCallId` 的**单次放行**（`tool-registry.ts:43-46`）。
- 恢复时 pending 的工具会被**重跑一次**（`:467-475`），若该工具是发布类操作且上次已经产生了外部副作用，则存在**重复外部操作**风险（无法从现有数据判断上次是否已发出）。
- playbook 侧：定时去重靠“最近 200 条 run 扫描”（`scheduler-service.ts:30`），`claimNextQueuedRun` 为无锁“读-改”（`repository.ts:644-657`）。
- C2 侧的 receipt **一次性消费**（`takePublishReceipt`，`browser-preview-session.ts:554-560`）是本仓已有的幂等范式，Agent 未复用。

---

## 七、与 §六 P2 的逐条映射（AG01 ～ AG23）

> 状态取值：**已存在** = 有实现且有调用者；**部分存在** = 有实现但不完整；**不存在** = 代码里找不到。
> 结论取值：**可复用**（P2 直接用）、**需补齐**（在现有结构上收口）、**确实缺失**（必须新建，但仍不新建表）。
> 口径说明：本节标题与表格中的 **`§六 P2`** 指 `docs/dev-exec-list.md` §六（P2-01 ～ P2-04）与 `docs/dev-list.md` §四 的 **AG01 ～ AG23** 清单，**不是**本报告的 §六（§六 讲的是失败/重试/取消/未知/重启）。

### 7.1 P2-01 Agent 任务管理（AG01 ～ AG07）

| 编号 | 功能 | 审计结论 | 可复用 / 需补齐 / 缺失 | 证据（file:line） |
| --- | --- | --- | --- | --- |
| AG01 | 创建任务 | **已存在**（唯一创建者在引擎内，且直接落 `running`） | 可复用（调用点集中） | `langgraph-engine.ts:349-353`；`repository.ts:912-937` |
| AG02 | 任务身份 | **已存在**（`nanoid` 主键，稳定） | 可复用 | `schema.ts:112`；`repository.ts:923` |
| AG03 | 任务状态 | **部分存在**：枚举 6 态齐全，但**无转移守卫**、`queued` 从不使用、`waiting_approval` 不存在（由 `paused` 承担） | 需补齐（守门 + 明确 `paused` 语义；**不建议新增 `waiting_approval`**，除非人工决策） | `types.ts:276`；`repository.ts:945-966`；写点 `langgraph-engine.ts:353,290,326,384,397,413,456` |
| AG04 | 任务详情 | **部分存在**：四个 JSON 有读写，**无 HTTP 详情接口** | 需补齐 | `schema.ts:117-120`；`repository.ts:939-943`；`src/app/api/agent/runs/`（无 `route.ts`、无 `[id]/route.ts`） |
| AG05 | 任务列表 | **不存在**（无 `listAgentRuntimeRuns`，无列表 API） | 确实缺失（但**无需新表**：索引 `client.ts:268` 已按 `status,created_at` 就绪） | `repository.ts`（仅 `listAgentRuntimeEvents:987`）；`client.ts:268` |
| AG06 | 任务关联 | **部分存在**：`account_id` / `thread_id` 为列；内容 / 素材 / 发布记录**仅在 JSON** | 需补齐 | `schema.ts:113-114`；隐式关联见 §4.4 |
| AG07 | 任务终态 | **部分存在**：`success/failed/cancelled` 有写点；无终态守卫、无 `finished_at`、失败 run 无错误码 | 需补齐 | `schema.ts:121-122`；`langgraph-engine.ts:326,397,413` |

### 7.2 P2-02 步骤与工具调用（AG08 ～ AG15）

| 编号 | 功能 | 审计结论 | 可复用 / 需补齐 / 缺失 | 证据（file:line） |
| --- | --- | --- | --- | --- |
| AG08 | 步骤模型 | **部分存在**：步骤只存在于 `state_json.toolCalls/toolResults/pendingIndex`（JSON），事件流是过程而非步骤（无步骤 ID / 状态 / 重试语义） | 需补齐（先用 JSON + 事件表达，**不新建步骤表**） | `langgraph-engine.ts:264-266,427-428`；`types.ts:343-350` |
| AG09 | 工具注册 | **已存在**（9 个工具 + 契约） | **可复用** | `tool-registry.ts:4-34`；`local-tools.ts:26-330`；`contracts.ts` |
| AG10 | 工具参数校验 | **已存在**（输入/输出双向 zod；工具名白名单） | **可复用**（补一条：被丢弃的步骤应留事件） | `tool-registry.ts:38-40`；`langgraph-engine.ts:170` |
| AG11 | 工具结果 | **部分存在**：`{output}` / `{error}` 二形状，无统一状态、无 unknown | 需补齐 | `langgraph-engine.ts:308,312`；`browser-preview-session.ts:1005` |
| AG12 | 执行事件 | **已存在**（7 种 type，落库 + 可查询 + SSE） | **可复用**（SSE 目前无人消费，见 §11） | `repository.ts:968-995`；`events/route.ts:6-42` |
| AG13 | 工具权限 | **部分存在**：只有“是否需要审批” | 需补齐（风险分类属 P3-04；P2 只需守住“受控操作不能无审批执行”） | `tool-registry.ts:43-53`；`local-tools.ts:33,60,88,117,154,190,222,253,301` |
| AG14 | Runtime 复用 | **已存在（已完成）** | **可复用** | `langgraph-engine.ts:165`；`local-tools.ts:192`；`image-generation.ts:58` |
| AG15 | 业务能力复用 | **部分存在**：复用 `generateTopicPost` / `runSiteBrowserTool` / image facade，但**直接写库**且**绕过发布核验契约** | 需补齐（收口到 published facts 契约） | `local-tools.ts:165,226,259,309`；`lib/browser-preview-session.ts:1005`；`lib/publish-facts.ts:42-61` |


### 7.3 P2-03 审批、重试与恢复（AG16 ～ AG23）

| 编号 | 功能 | 审计结论 | 可复用 / 需补齐 / 缺失 | 证据（file:line） |
| --- | --- | --- | --- | --- |
| AG16 | 人工审批节点 | **已存在**（`paused` + `pendingApprovalJson` + `approval_required` 事件 + UI Continue/Stop） | **可复用** | `langgraph-engine.ts:277-303`；`chat-conversation.tsx:87-107` |
| AG17 | 审批结果 | **部分存在**：写 `resume` 事件与状态；审批对象含 `toolCall.input`（含账号/内容/文本/图片），但**恢复时不校验内容是否已变化** | 需补齐（绑定内容/平台/账号 + 变化后要求重新确认） | `langgraph-engine.ts:405-410`；`resume/route.ts:92-109`；`threads.ts:56-58`（内容状态校验的既有先例） |
| AG18 | 重试策略 | **不存在** | 确实缺失 | 无 retry 计数/退避；`langgraph-engine.ts:312-313` |
| AG19 | 幂等保护 | **不存在**（仅 receipt 一次性消费的既有范式可借鉴） | 需补齐（按步骤设计幂等键；可复用 `takePublishReceipt` 思路） | `repository.ts:644-657`；`browser-preview-session.ts:554-560` |
| AG20 | 结果未知处理 | **不存在**（Agent 发布自报 `published:true`，无核验） | 需补齐（**P2 最高优先级**） | `browser-preview-session.ts:1004-1005` vs `src/app/api/publish/verify/route.ts:17-28` |
| AG21 | 任务恢复 | **部分存在**：`paused` 可真正恢复；`running` 中断不可恢复 | 需补齐（收口：崩溃后 `running` 的处理规则） | `langgraph-engine.ts:402-476`；`:429-432` |
| AG22 | 任务取消 | **部分存在**：拒绝审批 = `cancelled`；**无运行中取消** | 需补齐 | `langgraph-engine.ts:411-423`；`runner.ts:54`（无写入者） |
| AG23 | 错误归类 | **部分存在**：仅字符串错误 | 需补齐（模型 / 业务校验 / 平台 / 系统四类） | `langgraph-engine.ts:396-397`；`tool-registry.ts:38`（zod 校验错误目前与业务错误同形） |

### 7.4 P2-04 Agent 执行界面

| 需求 | 审计结论 | 证据 |
| --- | --- | --- |
| 任务列表查看状态 | **不存在**（无列表 API） | `repository.ts`、`src/app/api/agent/runs/` |
| 任务详情查看步骤进度 | **部分存在**：只有聊天气泡内的工具调用折叠面板 | `chat-conversation.tsx:20-48` |
| 查看工具调用结果与等待审批的操作 | **已存在**（工具调用 chip + JSON 详情；暂停按钮） | `chat-conversation.tsx:20-48,87-107` |
| 在允许状态重试 / 继续 | **部分存在**：仅“继续（resume）” | `chat-conversation.tsx:61` |
| 查看失败原因与恢复建议 | **不存在** | `langgraph-engine.ts:396-397` 只留字符串 |
| 从任务打开内容与发布记录 | **不存在**（运行 → 内容只有 JSON 里的 `itemId`） | §4.4 第 3 项 |
| 刷新/重开后还原执行过程 | **部分存在**：聊天侧可还原；任务侧不可见 | `chat-conversation.tsx:139-150` |

### 7.5 与 P2-01 ～ P2-07 的关系说明

- `docs/dev-exec-list.md` §六 实际只有 **P2-01 ～ P2-04**；P0-06 执行卡里写的“P2-01 至 P2-07”**在本仓找不到对应的 P2-05 ～ P2-07 定义**（`docs/dev-list.md` 侧需人工确认）。→ 标记为 **待验证（文档不一致）**，本报告按 §六 的 P2-01 ～ P2-04 + AG01 ～ AG23 逐条映射。

---

## 八、P2 的建议决策：**混合方式（收口为主 + 三处最小补齐）**

**不建议 A（从现有基础上“补齐”式全面扩建）**：会重复造出第二套任务/执行/事件体系，而现有那条已经能用且已被测试覆盖。

**不建议 B（只收口）**：有 3 项确实不存在的能力不补就无法满足 P2 验收标准（“每项业务操作复用现有业务接口”“重试不无条件重复外部副作用”“结果未知场景有验收”）。

**建议 C（混合，本次审计结论）**：

| 层 | 做法 | 依据 |
| --- | --- | --- |
| 复用（不动） | 任务表 `agent_runtime_runs`、事件表 `agent_runtime_events`、`ToolRegistry` + zod 校验、`aiRuntime` 单一模型入口、审批暂停 + resume 恢复链路、C2 发布核验契约 | §5.1 |
| 收口（改现有） | ① 状态转移守门（不新增状态名，沿用 `queued/running/paused/success/failed/cancelled`）；② 工具结果统一结构（含 `unknown`）；③ 工具调用事实单一权威（消除三副本）；④ 审批对象绑定内容/平台/账号且内容变化需重新确认；⑤ `running` 中断的明确处理规则 | §5.2、§7.1、§7.3 |
| 补齐（新建最小接口/字段级） | ① Agent 任务列表 + 详情读接口（复用索引 `client.ts:268`）；② **Agent 发布必须产出可核验事实**（复用 `checkPublishResult` + receipt 幂等范式）；③ 错误归类 + 幂等键（键值可先存 JSON，**不新建表**） | §5.3、§9 |

**明确不做（与 §六 P2 暂不开发一致）**：通用规划引擎、多 Agent 协作、无人监管自动发布、第二套任务表/状态机、独立 Agent 调度器。

**命名决策（需人工确认）**：§六 P2-03 执行卡写“补 `waiting_approval`”。审计发现现状用 `paused` + `pendingApprovalJson` 表达“等待审批”，且 §六 正文要求“状态枚举一律沿用现有实现”。→ 建议**不新增 `waiting_approval`**，改为在文档中把 `paused` 明确为“等待人工审批中”。此项属产品语义决策，**未擅自写入 §六**。

---

## 九、P2 必须先解决的关键缺口（按风险排序）

| ID | 缺口 | 为什么危险 | 证据 |
| --- | --- | --- | --- |
| **G1** | Agent 发布不产生业务事实，且不做结果核验 | 会把“可能没发出”当成功；`publish_records` / 内容状态与真实发布脱节；P3-03 证据视图无从取证 | `local-tools.ts:238,259`；`browser-preview-session.ts:1004-1005`；`lib/publish-facts.ts:42-61` |
| **G2** | 任务无读接口、事件流无人消费 | P2-04 / P3-01 无数据源；刷新后看不到任务状态；SSE 端点存在却无客户端 | `repository.ts:987`；`events/route.ts:6-42`；全仓 grep `/api/agent/runs` 仅命中 `resume` |
| **G3** | 无幂等键 + 恢复会重跑 pending 工具 | 恢复后可能重复发布（不可安全重试的操作被重做） | `langgraph-engine.ts:467-475`；`repository.ts:644-657` |
| **G4** | `running` 中断后无处理规则 | 任务永久卡在 `running`，用户与系统都无从判断“是否已发出” | `langgraph-engine.ts:349-353,429-432` |
| **G5** | 状态转移无守卫 + 部分失败被整体成功掩盖 | 非法转移不会被拒；`success` 里可能含 `failed` 步骤 | `repository.ts:945-966`；`langgraph-engine.ts:312-330` |
| **G6**（次要，可延后） | 事件游标同毫秒漏事件 | 事件流/SSE 可能丢事件，影响可观测性 | `repository.ts:987-995,678-686`；`events/route.ts:21-25` |

---

## 十、下一张执行卡的范围与验收标准

### 10.1 队列中的下一张卡（按 §十 顺序，不自动开始）

**P0-07 核实备份与恢复（只读）**

- 范围：`src/lib/backup.ts`、`/api/backup/export`、`/api/backup/restore`；确认还原时未知表/列的处理；确认数据库与本地文件（浏览器 profile、uploads、videos、artifacts）能否一起恢复。
- 与 P0-06 的交集（必须覆盖）：`agent_runtime_runs` / `agent_runtime_events`（含 `paused` 的 `stateJson`、`pendingApprovalJson`）与 `chat_messages.metadata` 是否随备份完整还原；还原后**暂停中的 Agent 任务是否还能 resume**。
- 验收：明确“能恢复 / 不能恢复 / 需人工复制”三类清单；每项有 `file:line`；不修改源码与数据库。

### 10.2 P0-06 结论推出的 P2 首卡建议（需人工选定后才执行）

**建议 P2 首卡 = “Agent 发布事实与未知结果收口”（对应 AG11 + AG15 + AG20）**

- 范围：让 Agent 的发布类工具（`threads_create_post` / `xiaohongshu_create_post` / `configured_create_post`）在**不新建表、不改 C2 冻结契约**的前提下复用现有核验与幂等范式：
  1. 工具结果统一为“成功 / 失败 / **未知**”，未知不得表达为成功；
  2. 发布成功的业务事实仍由既有 `recordPublishSuccess` 路径产生（复用 `PublishDraftReceipt` 一次性消费范式），不得由 Agent 直接写 `publish_records`；
  3. 发布前必须有绑定“内容 + 平台 + 账号”的人工确认（复用现有 `pendingApprovalJson` 与 `resume`）。
- 验收：模拟“点击后平台无确认”时结果为 `unknown` 且**不写业务事实**；重复触发不产生第二条发布事实；正常成功仍产生 `publish_records` 与内容状态变更；C2 既有测试全绿。
- 停止边界：先出方案（含工具结果结构变更清单与迁移影响），**经人工批准后再改代码**。

**建议 P2 第二卡 = “Agent 任务读写接口”（对应 AG04 + AG05 + AG07）**

- 范围：新增 `GET /api/agent/runs`（列表，复用索引 `client.ts:268`）与 `GET /api/agent/runs/[id]`（详情：状态 + 事件 + 工具调用 + 待审批对象）；**不新建表、不新增状态名**；状态转移加守卫。
- 验收：刷新/重启后能还原任务状态与步骤进度；非法转移被拒绝；无待审批对象时 `resume` 不产生状态污染。

---

## 十一、待验证清单（无法只靠源码定论，标记为待验证）

| # | 事项 | 为什么无法确认 | 建议验证方式 |
| --- | --- | --- | --- |
| V1 | 打包版是否还会额外拉起独立 worker 进程 | `electron/main.cjs` 只见 tick 轮询（`:158-175`），`package.json` 另有 `pnpm worker`；无法从源码断定打包运行时行为 | 在**打包产物**上观察进程列表与 worker 日志 |
| V2 | “P2-05 ～ P2-07”的定义 | `docs/dev-exec-list.md`（§六）与 `docs/dev-list.md`（§四）都只定义到 P2-04 | 人工确认卡中编号是否为笔误（可能指 §十 队列第 7、8 行） |
| V3 | `running` 中断时是否可能残留可用暂停数据 | 崩溃时刻取决于 `updateAgentRuntimeRun` 前后，源码无法穷举 | 故障注入：执行中杀进程，检查 `state_json` 与 `status` |
| V4 | `C2-1b` 在途改动提交后，本报告引用的 `publish/verify`、`publish/draft` 行号是否会变 | 这两个文件当前为**未提交修改** | 提交后重新核对 §三、§九的引用行号 |
| V5 | 事件游标同毫秒漏事件是否真实可触发 | 由 `createdAt > after` 与 `nanoid` 时间戳推断（`repository.ts:987-995`、`678-686`） | 构造同毫秒两次 `append` 的用例 |
| V6 | 排程意图分支是否应纳入工具注册表 | 现状是正则分支（`route.ts:102-134`），不经 `ToolRegistry`；是否“收口进工具”属产品决策 | 由 P2-03 卡决策 |

---

## 十二、只读声明与验证记录

### 12.1 未改动清单

- **未修改**生产代码、数据库（schema / 迁移 / 数据）、配置（`next.config.ts`、`package.json` 等）与其他架构文档。
- `docs/dev-exec-list.md` 仅回填 **P0-06 的状态与报告链接**（§四 表头行、§四 卡片、§十 队列第 1 行）；**§六 P2 状态列未改**。
- 既有工作区改动（`README*.md`、`docs/creator-workflow-audit.md`、`next.config.ts`、`publish/*`、`browser-preview-session*`、locales、test fixtures 等在途修改与新文档）**保持原样**，未 stash、未提交、未回滚。
- 未运行任何 Agent 任务，未调用任何发布端点，未触发真实平台发布。

### 12.2 验证命令与结果（本次审计执行）

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0** |
| `node_modules\.bin\eslint.cmd .` | **exit 0**（1 个既有 warning：`src/components/agent-chat/chat-conversation.tsx:146` `react-hooks/exhaustive-deps`；非本次引入、未修改该文件） |
| `node_modules\.bin\vitest.cmd run` | **88 个测试文件 / 574 个测试全部通过**（首跑 16.87s，复跑 14.03s / 15.91s，结果一致；exit 0） |

> 已覆盖 Agent 链的测试：`src/lib/agent/langgraph-engine.test.ts`（规划→工具接线、降级）、`local-tools.test.ts`（审批策略、Runtime 复用）、`tool-registry.test.ts`、`chat-context.test.ts`、`src/app/api/agent/artifacts/route.test.ts`。
> **未覆盖**：审批暂停/恢复的端到端、`/api/agent/runs/[id]/resume` 路由、事件 SSE、发布类工具的结果语义 → 这三处正是 §九 缺口所在，P2 补测试的天然落点。

### 12.3 停止边界

本报告完成后**停止**；不执行 P0-07、P0-08 或 P1/P2 的任何实现，不修改源码，等待人工复核。

