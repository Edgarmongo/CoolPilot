# CoolPilot 集成契约（CI-P0-03 / CI-P0-04 / CI-P0-05）

> 本文件是 `docs/coolpilot-capability-integration-plan.md` 的**接口约定**附件，对应 P0 的三项契约任务。
> 契约只描述**现有代码里已经存在的事实**加**本轮最小必要扩展**；凡标 `【新】` 的都是本计划要新增的最小接口，其余都是对现有实现的引用。

## 1. CI-P0-03 · 统一媒体产物契约

### 1.1 现状盘点（实测，不推断）

**存储根（`src/lib/paths.ts` 是唯一定义处，共 3 个根、4 个目录）**

| 根函数 | 目录 | 写入方 | 只读解析 | 初始化函数 |
| --- | --- | --- | --- | --- |
| `artifactsRoot()` | `web-data/artifacts` | images/upload、`agent/image-generation.ts`、`article-images.ts`、`remote-image.ts` | 是 | `ensureArtifactsRoot()` |
| `videosRoot()` | `web-data/videos` | `api/videos/upload/route.ts` | 是 | `ensureVideosRoot()` |
| `productImagesRoot()` | `web-data/uploads/product-images` | `api/products/image/route.ts` | 是 | `ensureProductImagesRoot()` |
| `brandLogosRoot()` | `web-data/uploads/brand-logos` | `api/settings/brand/logo/route.ts` | 是 | `ensureBrandLogosRoot()` |

`uploadsRoot()` **故意没有 initializer**：它由两个子目录的写入方各自以父目录身份创建。任何新代码都必须沿用“解析 ≠ 初始化”的分工（P5-B0-2.5）。

**文件命名前缀即来源（可零成本用作 `source` 判定）**

- `agent-image-<ts>-<rand>.<ext>` → AI 生成（`agent/image-generation.ts:48`）
- `writing-<ts>-<rand>.<ext>` → 产品图/素材复制入产物目录（`article-images.ts:16`）
- `online-<ts>-<rand>.<ext>` → 远程图片本地化（`remote-image.ts:113`）
- `upload-*` → 用户上传图片（`api/images/upload/route.ts`）
- 其余（历史文件）→ `unknown`

**当前可访问地址（3 种形状，全部已被写入历史数据，**不得更改**）**

1. `/api/agent/artifacts?file=<basename>`：服务 `artifacts/` 下的图片，`.png/.jpg/.jpeg/.webp/.gif` 白名单，`path.basename` 强校验；`GET` 不建目录。
2. `/api/videos?file=<basename>`：服务 `videos/` 下的视频（`video-library.ts` 定扩展名与 MIME）。
3. `/api/products/image`、`/api/settings/brand/logo` 对应的上传目录没有统一的“按文件名取回”入口（它们只在各自业务界面内被引用）。
4. `/api/media?file=<basename>`：服务 `media/` 下的音视频（`media-library.ts` 定扩展名与 MIME），支持 `Range` → 206 —— **CI-P3-02 新增**，是转写任务的输入来源；`GET` 列目录但不建目录（同 P5-B0-2.5），`?file=` 的取值同样经 `path.basename` 强校验。导入走 `POST /api/media/upload`（写进 `media/`，命名前缀 `media-`）；`GET /api/media` 只读，不接 `POST`。

**引用字段（数据库里已有的 2 处，且有镜像关系）**

- `content_items.image_path`：**封面镜像** = `metadata_json.images[0]`（幂等重建，见 `docs/p1-card-01-acceptance.md`）。已冻结，不改语义。
- `content_items.metadata_json.images: string[]`：文章图片列表，元素可以是裸文件名、绝对本地路径或远程 `http(s)` URL（**三种合法形态并存是现状**，见 `resolveArtifactImageSrc()` 的注释）。
- `content_items.metadata_json.videoPath`：视频文件名（`video-library.ts:74`）。

**解析规则现状（`src/lib/artifact-image-url.ts`）**

- 远程 `http(s)://` → 原样返回（浏览器直接请求）。
- 其他（裸名 / 绝对路径 / 相对路径）→ 取 basename → `/api/agent/artifacts?file=<basename>`。
- 该模块**不判断文件是否存在、不校验扩展名**（“浏览器该请求哪个地址” vs “这个引用是否有效”分离，404 由路由回答）。

**已知缺陷（本轮 E2E 实测，不属于本契约范围但必须被它承认）**

- `src/lib/publish.ts:27-40` 的 `resolveLocalImagePath()` 只接受本地文件，**远程封面 URL 会被静默丢弃**，导致“远程素材 → 发布封面”断链（`docs/e2e-core-loop-verification.md` §8.1）。CI-P1-01 的解析层必须能表达“这是远程引用”，从而让发布侧**要么本地化、要么显式报错**，不再静默丢弃。修不修发布侧属于 CI-P2-03/CI-P5-03 的范围，本契约只保证信息不丢失。

### 1.2 契约定义【新】

位置建议：`src/lib/media-artifacts.ts`（纯解析、无 Node fs 依赖，可被客户端组件复用，沿用 `artifact-image-url.ts` 的分层习惯）。

```ts
/** 产物类别。以“文件所在根 + 扩展名”判定，不引入新表。 */
export type MediaAssetKind = "image" | "video" | "audio" | "subtitle" | "document" | "unknown";

/** 产物来源。优先由文件名前缀判定，其次由所在根判定。 */
export type MediaAssetSource = "generated" | "uploaded" | "copied" | "remote" | "unknown";

/** 产物所在根。取值与 paths.ts 的四个目录一一对应。 */
export type MediaAssetRoot = "artifacts" | "videos" | "product-images" | "brand-logos";

/** 统一产物引用。fileName 是当前系统里唯一稳定的寻址键（没有 Asset 表，也不新建）。 */
export type MediaAssetRef = {
  fileName: string;   // basename；远程引用时为 ""
  kind: MediaAssetKind;
  mimeType: string;   // 由扩展名映射，未知为 "application/octet-stream"
  root: MediaAssetRoot;
  source: MediaAssetSource;
  url: string;        // 可访问地址；必须是 1.1 中已有形状之一
  remoteUrl?: string; // 原始远程地址（远程引用时存在，供本地化使用）
  external: boolean;  // true = 远程地址，CoolPilot 未持有本地副本
};

/** 把任意历史引用解析成统一引用；解析不读盘、不建目录、不下载。 */
export function toMediaAssetRef(value: string, hint?: { root?: MediaAssetRoot }): MediaAssetRef;

/** 列表：合并四个根的现有文件（每个根一次 readdir，缺失目录视为空）。 */
export function listMediaAssets(): Promise<MediaAssetRef[]>;
```

规则（全部为最小实现要求）：

1. **输入形态**：裸文件名、绝对/相对路径、`/api/agent/artifacts?file=`、`/api/videos?file=`、`http(s)://` —— 六种历史形态都必须能解析，且解析结果对同一文件幂等。
2. **不新建表、不改列**：不新增 `assets` 表，不改 `content_items`；`image_path` 与 `metadata.images[0]` 的镜像语义保持不变。
3. **不改变任何已有 URL 形状**；`resolveArtifactImageSrc()` 的行为与输出继续原样保留（历史正文里存的就是它）。
4. **访问入口复用现有路由**：`/api/agent/artifacts` 与 `/api/videos`；统一查询入口【新】只做“列出 + 解析”，返回结构里直接给 `url`，不新增第三个二进制服务路由。
5. **安全边界不变**：任何落到磁盘的路径都必须经过 basename 归一 + 扩展名白名单；不允许出现 `..`、盘符、绝对路径逃逸。
6. **只读不初始化**：`listMediaAssets()` 用 `artifactsRoot()`/`videosRoot()` 等**非 ensure** 访问器，缺失目录返回空数组。
7. **远程引用显式化**：远程 URL 返回 `{ external: true, remoteUrl, url }`，绝不返回空串或静默丢弃。

### 1.3 验收标准

- 对 6 种历史引用形态各一条用例，解析结果稳定且幂等（`vitest`）。
- 对 `content_items.metadata_json.images`（裸名/绝对路径/远程 URL 三形态混排）解析后仍能得到可显示 `url`。
- `web-data/artifacts` 现有 37 个文件全部可列出，且 `url` 与实际可访问地址一致（用真实 dev server 抽查）。
- 已有图片展示、文章正文图片、封面镜像**行为不变**（回归：现有 90 个测试文件全绿）。
## 2. CI-P0-04 · 统一长任务契约

### 2.1 现状盘点（实测）

**三套并行入口**

| 入口 | 表 | 状态词表 | 记录表 | API |
| --- | --- | --- | --- | --- |
| 业务流程任务（playbook 运行） | `runs` | `queued/running/success/warning/failed/cancelled` | `run_events`（`level/message/data_json`） | `GET|POST /api/runs`、`GET /api/runs/[id]`、`GET /api/runs/[id]/events` |
| Agent 执行 | `agent_runtime_runs` | `queued/running/paused/success/failed/cancelled` | `agent_runtime_events`（`type/message/data`） | `GET /api/agent/runs/[id]/events`、`POST /api/agent/runs/[id]/resume` |
| 定时排期 | `schedules` | `scheduled/queued/running/posted/failed/missed/cancelled` | 同上（排期触发后写 `runs`） | `GET|POST /api/schedules`、`/api/schedules/[id]`、`POST /api/internal/scheduler/tick` |

**`runs` 现有字段**：`id`、`playbook_id`、`account_id`、`schedule_id`、`scheduled_for`、`status`、`params_json`、`result_message`、`artifact_path`、`created_at`、`started_at`、`finished_at`、`updated_at`。

**三个诚实结论（本轮实测，决定了 P1-02 的最小改动范围）**

1. **没有进度字段**：`runs` 与 `agent_runtime_runs` 都没有 `progress`。项目的“进度”现在只由 `publish-run-panel.tsx` 在前端本地推导。
2. **没有取消入口**：`/api/runs/[id]` 只有 `GET`，没有 `POST .../cancel`；只有 Agent 排期存在“取消排期”（把 `schedules.status` 置 `cancelled`）以及 `agent/runs/[id]/resume` 对 `cancelled` 结果的处理。
3. **没有重启收敛逻辑**：在 `src/` 与 `scripts/` 中检索 `interrupted|stale|orphan`，命中的都是无关语义（metrics 的 `stale`、manifest 的 `unlinkedProfiles`、DB 迁移的 `sites` 表）→ **当前没有任何代码在进程重启后把遗留 `running` 任务标记为中断**。

### 2.2 契约定义

**任务 ID**：沿用现有主键（`runs.id` / `agent_runtime_runs.id` / `schedules.id`），不加前缀、不做复合 ID。统一视图里用 `kind` 区分来源。

**统一状态（canonical view）【新】** —— 只做映射，**不改任何已有列取值**：

| canonical | `runs` | `agent_runtime_runs` | `schedules` | 说明 |
| --- | --- | --- | --- | --- |
| `queued` | `queued` | `queued` | `queued` | 已受理未开始 |
| `running` | `running` | `running` | `running` | 执行中 |
| `paused` | — | `paused` | — | **等待人工审批**（保留，不并入 `running`） |
| `succeeded` | `success` | `success` | `posted` | 成功 |
| `warning` | `warning` | — | — | **部分成功**（保留，不并入 `succeeded`） |
| `failed` | `failed` | `failed` | `failed` | 失败 |
| `cancelled` | `cancelled` | `cancelled` | `cancelled` | 已取消 |
| `missed` | — | — | `missed` | 排期错过（保留） |

**统一任务视图【新】**（`src/lib/tasks/`，只读组合现有表，不新建表）

```ts
export type TaskKind = "playbook" | "agent" | "schedule";
export type TaskStatus =
  | "queued" | "running" | "paused" | "succeeded" | "warning" | "failed" | "cancelled" | "missed";

export type TaskView = {
  id: string;
  kind: TaskKind;
  /** 任务类型：playbook id，或 Agent 的 mode（chat/…）。不是新的枚举，直接取自现有列。 */
  type: string;
  status: TaskStatus;
  /** 原始状态值，映射前的字面量，便于排查（永不丢失 warning / paused / missed）。 */
  rawStatus: string;
  input: Record<string, unknown>;      // runs.params_json / agent.input / schedule.params_json
  progress: number | null;             // 见下：默认 null，不臆造
  error: TaskErrorSummary | null;      // 见下
  resultUrl?: string;                  // runs.artifact_path 等现有产物引用
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
};

export type TaskErrorSummary = { code: string; message: string; retryable: boolean };
```

**字段映射（不加列）**

- `input` ← `runs.params_json` / `agent_runtime_runs.input` / `schedules.params_json`。
- `progress` ← **默认 `null`**。只有当日志里出现过显式进度时才给出数字：`run_events.data_json.progress`（0–100）或 `{ current, total }` → 由 `deriveProgress(events)` 计算【新】。**禁止**用时间估算、用阶段数猜百分比，或把 `null` 显示成 `0%`。
- `error` ← `runs.result_message`（自由文本 → `code: "RUN_FAILED"`，`retryable` 由下方规则判定）/ `agent_runtime_runs.result.error`。
- 时间：`created_at`/`started_at`/`finished_at`/`updated_at` 直接映射；`schedules` 用 `last_run_at`/`next_run_at`。

**`retryable` 判定规则【新，最小实现】**

- `true`：网络类（DNS/连接超时/`ECONNRESET`）、上游 5xx、限流（429）、AI Runtime 的凭据冷却类错误。
- `false`：参数校验失败（400）、权限/审批被拒、登录态缺失需要人工、文件不存在、路径越界。

**日志统一视图【新】**：`{ taskId, at, level: "info"|"warn"|"error", stage: string, message, data }`。
`run_events` 没有 `stage` 列 → `stage` 取自 `data_json.stage`，缺失时用 `"run"`；`agent_runtime_events` 的 `stage` 用其 `type`。**不新建第 3 张记录表**。

**取消语义【新，P1-02-05】**

- 只有底层可安全停止时才回 `{ cancelled: true }`：
  - 可停：持有中止句柄的浏览器/进程内任务（Playwright `page`/`context`、`AbortController` 支撑的 fetch 循环）→ 中止后写 `cancelled` + 一条 `cancelled` 事件。
  - 不可停：已提交到外部平台且不可撤回的动作（例如已点击“发布”）→ 回 `{ cancelled: false, reason: "not-safe-to-stop" }`，可写 `warning`，**不得谎报已取消**。
- 取消入口位置（与现有路由风格一致）：`POST /api/runs/[id]/cancel`；Agent 侧复用已有的 `resume({approved:false})` 语义。

**重启恢复【新，P1-02-06】**

- 进程启动时（或首次访问任务视图时）扫描 `status in (queued, running)` 的记录：
  - 若宿主进程已不存在（当前实现为“应用进程重启”，即无内存态句柄）→ 标记 `failed` + `error.code = "interrupted"`，并追加事件说明“进程重启导致中断，未自动续跑”。
  - **绝不**自动重放可能产生副作用的步骤（发布、提交、删除）；需要继续的任务必须由用户显式重试。
  - 恢复动作必须是幂等的（重复启动不产生重复事件）。

### 2.3 验收标准

- `TaskView` 映射表逐行有用例：`success→succeeded`、`warning` 保留、`paused` 保留、`missed` 保留、未知值不崩溃（落到 `rawStatus` 并标记 `failed`？——**保留原值并在测试里固定**）。
- 进度：无进度事件时返回 `null`（用例断言，不允许 0）。
- 取消：可停任务 → `cancelled: true` 且状态落库；不可停任务 → `cancelled: false, reason`，状态不写 `cancelled`。
- 重启：插入一条 `running` 且无宿主的记录 → 收敛为 `failed/interrupted`；再跑一次不产生第二条事件（幂等）。
## 3. CI-P0-05 · 工具调用契约

### 3.1 现状盘点（实测）

- **契约已存在，直接复用**：`src/lib/agent/contracts.ts` 的 `AgentToolDefinition`：

  ```ts
  { name; description; inputSchema: z.ZodType; outputSchema: z.ZodType;
    requiresApproval?: (input, ctx: AgentExecutionContext) => boolean;
    execute: (input, ctx: AgentExecutionContext) => Promise<output> }
  ```

- **注册与执行已存在**：`ToolRegistry`（`register`/`get`/`has`/`list`/`execute`/`requiresApproval`），`execute` 做 **input/output 双向 zod 校验**，输出还会被 `outputSchema.parse()` 再收窄一次。
- **已注册工具 9 个**：`browser_open_page`、`browser_click`、`browser_type`、`browser_screenshot`、`generate_social_post_draft`、`generate_image_prompt`、`generate_image_file`、`threads_create_post`、`xiaohongshu_create_post`。
- **执行记录**：`chat_tool_calls` 表（`status` 可取 `failed`/`cancelled` 等，由 Agent schedules 代码写入）+ `agent_runtime_events`（`type/message/data`）。
- **MCP**：`src/` 中 **零命中** —— 现有系统没有任何 MCP 接入。CI-P4-01-01 的结论是“无 MCP”，不得把 MCP 当作已有能力来规划。
- **耦合点（本任务要解决的唯一结构问题）**：`execute`/`requiresApproval` 的第二参数被硬编码为 `AgentExecutionContext`，字段里有 `agentRunId`（必填）、`profilePath`、`systemPrompt`、`settings.agentPermissions`。这意味着**任何非 Agent 调用方（页面按钮、API 路由、媒体任务）都无法复用这个注册表**，只能各写一套。9 个工具与 2 个测试文件都依赖此形状 → **不修改 `AgentToolDefinition` 的方法签名**，改为只加一个适配层。

### 3.2 契约定义

**第 1 层：不放宽的工具描述（复用现有类型）**

工具注册信息 = `name`（全局唯一，`snake_case`：`<域>_<动作>`）、`description`（一句话说明用途与副作用）、`inputSchema`、`outputSchema`。**不新增字段**。

**第 2 层：最小调用上下文【新】**

```ts
/** 不含 Agent 私有时段的执行上下文：页面按钮、API、任务都能提供。 */
export type ToolCallContext = {
  taskId?: string;                     // 长任务时为 run id；同步调用可省略
  signal?: AbortSignal;                // 取消/超时；无则可停性为 false
  approvals?: { grantedToolCallId?: string };
  emit?: AgentExecutionContext["emit"]; // 事件出口，可选
};

/** 把最小上下文适配成现有契约要求的 AgentExecutionContext。 */
export function asAgentContext(context: ToolCallContext): AgentExecutionContext;
```

`asAgentContext()` 的行为（必须显式、可测、无副作用）：

- `agentRunId: context.taskId ?? "tool-call"`；
- `profilePath: ""`（媒体工具不碰浏览器 profile）；
- `settings.runtimeMode: "local"`；`agentPermissions` 全取 **`"confirm"`**（安全默认：没有权限配置就是不自动执行副作用）；
- `systemPrompt: ""`；
- `emit: context.emit ?? async () => {}`。

**只在需要时使用**：纯函数型媒体工具（如本地的图片列表/解析）**不应该**经过 `asAgentContext`，应在 CI-P1-03 里为它们注册一个更薄的注册表（同一 `ToolRegistry` 类，只是工具自身不读 `AgentExecutionContext` 的私有时段）。这保证了：不复制凭据系统、不改 Agent 侧契约、也不强迫媒体工具假装自己是 Agent。

**第 3 层：统一结果信封【新】**

```ts
export type ToolCallError = { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
export type ToolCallResult<T> = { ok: true; data: T } | { ok: false; error: ToolCallError };
```

- 参数校验失败 → `{ ok: false, error: { code: "INVALID_INPUT", retryable: false } }`（`ToolRegistry.execute` 抛出的 zod 错误在入口处被翻译，不把 zod 原文暴露给前端）。
- 需要人工确认但未确认 → `{ ok: false, error: { code: "APPROVAL_REQUIRED", retryable: false } }`。
- **同步工具**：`data` 就是结果本身。
- **长任务工具**：`data = { taskId }`，其余进度/结果通过 CI-P0-04 的任务视图查询 —— 工具**不阻塞**到任务结束。

**第 4 层：调用记录（不新建表）**

| 字段 | 来源 |
| --- | --- |
| `name` | 工具名 |
| `inputSummary` | 入参的**脱敏摘要**（只保留键与长度/截断值；`apiKey`、`token`、`cookie`、`password`、`authorization` 一律替换为 `"[redacted]"`） |
| `status` | `completed` / `failed` / `pending`（与 `AgentRunResult.toolCalls.status` 一致） |
| `outputSummary` | 输出的键与简短值（同样脱敏） |
| `at` | 时间戳 |

落点：Agent 侧写 `chat_tool_calls`（已有）；非 Agent 侧若已有宿主任务，写该任务的 `run_events`。**不新增记录表。**

**第 5 层：发现与调用入口【新，最小】**

- `GET /api/tools` → `[{ name, description, inputSchema }]`（`inputSchema` 用 zod 的 JSON Schema 输出；zod `^4.3.6` 提供 `z.toJSONSchema` —— 实现时先验证该 API 在本版本可用，不可用则退化为“键名 + 类型名”清单，**不允许臆造 schema**）。
- `POST /api/tools/[name]` → 请求体 `{ input: {...} }`，响应 `ToolCallResult`。
- 副作用与权限：有副作用的工具**必须**实现 `requiresApproval`；入口在未获批准时必须返回 `APPROVAL_REQUIRED`，而不是默默执行。
- 凭据：工具内部只通过现有凭据/Runtime 读取（`src/lib/credentials.ts`、`src/lib/secrets.ts`、`ai-runtime`），入口层不做任何密钥透传。

### 3.3 验收标准

- 至少 1 个**现有**媒体能力（`generate_image_file`）通过统一注册表被调用并返回结构化结果；调用记录可见（用例 + 真实请求各一次）。
- `INVALID_INPUT` / `APPROVAL_REQUIRED` / 成功三条路径各一个用例，且错误响应中**不含** zod 原始堆栈。
- 脱敏用例：入参含 `apiKey`/`cookie` 时，记录里出现 `[redacted]`，且日志中不含原值。
- `GET /api/tools` 返回的 schema 与实际 `inputSchema` 一致（用一个故意非法的入参验证会被拒）。
- Agent 侧零回归：`tool-registry.test.ts`、`local-tools.test.ts` 全绿，`AgentToolDefinition` 签名未变。
