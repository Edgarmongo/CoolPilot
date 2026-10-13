# CI-P1-05 集中式端到端验证 · 阶段 1：E2E 基线清单（2026-10-09）

> **本文件是"阶段 1（基线盘点）"的交付物**：盘点现有端到端测试、接口面、环境配置，并冻结"跑前基线指纹"。
> **本轮只读**：未修改任何业务代码、未改 schema / 迁移 / 配置、未 `git add` / 未 `git commit`、未调用真实模型、未触发真实平台发布。
> **不是**："已验证通过"。本文件回答的是 **"哪些闭环已经有真实证据、哪些可验证、哪些根本不可验证"**，逐个执行取证属于阶段 2（`§9`）。

## 0. 定位与编号对照（避免与旧文档混用）

| 说法 | 编号空间 | 对照 |
| --- | --- | --- |
| 用户口径「CI-P1-05 集中式端到端验证」 | 本卡 | 即本文件；E2E-01～E2E-04 四个闭环 |
| 主计划里的对应卡 | `docs/coolpilot-capability-integration-plan.md` §8 | **CI-P5-01**（创作）/ **CI-P5-02**（视频）/ **CI-P5-03**（发布）；**CI-P5-04**（Agent 自动化）**不在本卡范围** |
| 旧审计序列的 `P1-05` | `docs/dev-exec-list.md` | **另一个编号空间**，已冻结，勿与本卡合并叙述 |

- 主计划 §0 明确警告过两套编号并存；本文件统一用 **`CI-P5-0x`** 指主计划里的验收条目，用 **`E2E-0x`** 指用户给出的执行顺序。
- 主计划 §8 的完成标准（片段）：CI-P5-01「创作数据在生成、编辑、保存和重新打开后保持完整」；CI-P5-02「从创建视频任务到获得可访问的产物，接口和存储链路完整；**真实渲染引擎的接入程度单独记录**」；CI-P5-03「发布记录、内容状态和实际发布结果有明确对应关系。**未经过验证的真实发布不得作为通过条件**」。

## 1. 状态口径（本卡统一判定）

沿用 `docs/e2e-core-loop-verification.md` §一 的六档，并针对本卡补两档：

| 状态 | 判定标准 |
| --- | --- |
| **已验证通过** | 实际执行成功，且有可复查输出（命令 + 退出码/HTTP 码 + 关键响应） |
| **已实现、未验证** | 代码/端点存在，但没有真实运行证据（或只有契约测试） |
| **验证失败** | 已执行、结果不符合预期，附复现步骤与实际输出 |
| **外部阻塞** | 需要真实平台账号 / 登录态 / 外网服务 / 已配置可调用模型 |
| **待人工验证** | 必须由人在真实界面操作（平台侧点发布等） |
| **待打包验证** | 属打包产物（Electron）行为，须在打包结果上确认 |
| **环境不可达**（新增） | 本机配置缺失导致**当前无法执行**（如调度 token 未设置、无可用图片模型）；与"产品缺陷"严格区分 |
| **基线已冻结**（新增） | 本文件只记录跑前状态，尚未执行写操作 |

## 2. 环境与前提（实测值）

| 项 | 实测值 | 取证方式 |
| --- | --- | --- |
| 运行中的 dev server | **在跑**：`next dev`（PID 35236 / 子进程 30240），`http://127.0.0.1:3000` | `Get-CimInstance Win32_Process` + 只读 GET |
| 框架版本 | Next.js 16.2.4（Turbopack），`.env.local` 生效 | 上一轮 E2E 记录 §二 |
| 数据根 | `D:\devworkspace\software\workspace\myproject\CoolPilot\web-data` | `tmp-e2e-baseline-stage1.json` → `dataDirTopLevel` |
| 数据库 | `web-data\social-auto-post.db`，921,600 B，mtime 2026-10-09T02:39:28.516Z，**29 张表** | 同上 |
| 数据目录内容 | `artifacts/`、`browser-profiles/`、`uploads/`、`videos/`、`social-auto-post.db`、`_tmp-e2e.db`（0 B 残留） | 同上 |
| **worker 进程** | **未运行**（匹配 `worker` 的 node 进程数 = 0） | `Get-CimInstance` 过滤 |
| worker 驱动方式 A | `node_modules\.bin\tsx.cmd src/worker/worker.ts`（`pnpm worker`）：**无需 token**，10s 轮询（`SOCIAL_AUTO_POST_WORKER_POLL_MS` 可调） | `src/worker/worker.ts:6-38` |
| worker 驱动方式 B | `POST /api/internal/scheduler/tick`：**需要 `COOLPILOT_SCHEDULER_TOKEN`**，`.env.local` **未设置** → 现状必然 401 | `src/app/api/internal/scheduler/tick/route.ts:9-12` |
| 工具链 | `tsx`、`playwright`、`vitest`、`tsc`、`eslint` 均在 `node_modules\.bin` | `package.json` |
| 静态与单测基线（上一卡） | `vitest run` → **103 文件 / 726 用例 / 0 失败**；`tsc --noEmit` → 0；`eslint`（列明路径）→ 0 | 上一卡 `tmp-p1-04-*.log` |
| 环境变量注意 | `SOCIAL_AUTO_POST_DATA_DIR` 必须为空（否则 DB 与 artifacts 根一起漂移，见上一轮 E2E 记录 §8.2） | 主计划 §附录 B-4 §5 |

**模型/外部依赖可用性（只读实测，决定 E2E-01/02 能走多远）**

| 能力 | 实测 | 结论 |
| --- | --- | --- |
| 文本 `chat` | `GET /api/ai/runtime` → `capabilities: chat total=265 callable=2`；`openai/default` 端点 `status=ok`、`usableKeyCount=1`、`modelCount=2`、`callableCount=2`；两个启用模型均为 `chat`：`deepseek-flash`、`deepseek-v4-pro`（`/api/ai/models` `enabled=true`） | **可能可真实调用**（未经实跑）。但 `defaults={}`、`GET /api/settings/ai` 的 `openAIModel=""`、`ai_model_preferences` 0 行 → 解析结果必须实跑确认；实跑会**消耗额度**，需授权 |
| 图片 `image_generation` | `capabilities: image_generation total=57 callable=0`；`/api/settings/ai` 的 `openAIImageModel=""`、`geminiImageModel=""` | **当前配置下不可能成功**；实测拒绝路径见 §7-1（是**诚实失败**，非模拟成功） |
| `tool_calling` / `structured_output` / `vision` | `callable=0`（各 total 195 / 195 / 85） | 影响需要工具调用/结构化输出/视觉的生成路径，须在阶段 2 分类 |
| 真实平台发布 | 需要浏览器登录态 + 真实账号；`POST /api/publish` 会真的驱动 Playwright 打开发布页 | 属**外部阻塞 / 待人工验证**；受控测试只能用拒绝与失败分支（§9 E2E-04） |
| 视频编码 | `ffmpeg` 本机存在，但**应用从不调用**（P1-04 记录） | CI-P5-02 只验"任务与产物链路"，**真实编码单独记录为未接入** |

## 3. 跑前基线指纹（冻结）

取证命令（可独立重跑，只读）：

```powershell
node tmp-e2e-baseline.cjs stage1                 # 产出 tmp-e2e-baseline-stage1.json
node tmp-e2e-baseline.cjs stage1-after-probe     # 本次已跑：证明"只读探测零漂移"
```

**3.1 代码基线**

| 项 | 值 |
| --- | --- |
| `git rev-parse --short HEAD` | **`3b48126`** |
| `git status --porcelain` 条目数 | **89**（本轮未覆盖、未清理、未提交） |

**3.2 数据库（29 表全量计数，节选与 E2E 相关者）**

| 表 | 行数 | 表 | 行数 |
| --- | --- | --- | --- |
| `content_items` | **17**（`draft` 7 / `ready` 10） | `runs` | **7** |
| `publish_records` | **3**（`drafted` 2 / `published` 1，全部平台 `知乎`） | `run_events` | 21 |
| `accounts` | **3** | `schedules` | **0** |
| `ai_models` | 422（启用 2，均 `chat`） | `ai_model_capabilities` | 923 |
| `ai_model_endpoints` | 13 | `ai_model_providers` | 16 |
| `ai_credential_keys` | 1 | `ai_model_preferences` | **0** |
| `agent_runtime_runs` | 5 | `agent_runtime_events` | 39 |
| `chat_threads` / `chat_messages` / `chat_tool_calls` | 2 / 16 / 6 | `usage_records` | 14 |
| `app_settings` | 5 | `products` | 1 |
| `positions` | 1 | `sites` | 0 |
| `knowledge_base` / `dify_connections` | 0 / 0 | `metric_snapshots` / `account_metric_snapshots` | 0 / 0 |

`runs` 的分布（阶段 2 必须扣除这些 **P1-04 探测遗留**）：

| playbook_id | status | n |
| --- | --- | --- |
| `topic_article_generator` | `queued` | 1 |
| `video_render` | `success` | 2 |
| `video_render` | `failed` | 2 |
| `video_render` | `cancelled` | 2 |

**3.3 文件系统**

| 项 | 值 |
| --- | --- |
| `web-data\artifacts` | **37 文件 / 4,636,064 B** |
| `web-data\videos` | **8 文件 / 123,882 B**（2 个上传 mp4 + 2 次渲染各 `mp4`+`srt`+`json`） |
| `web-data\uploads` | 0 文件 |
| `web-data\browser-profiles` | 7 个子目录（4,099 文件）；`accounts` 仅 3 行 → 存在未关联 profile（`GET /api/workspace/manifest` 报 `unlinkedProfiles`） |
| 残留 | `web-data\_tmp-e2e.db`（0 字节，历史 E2E 残留；**不清理**，归 CI-P6-04-05） |

**3.4 只读接口指纹（与表计数对照）**

| 接口 | 实测 | 与表的关系（**关键校准：差异不等于缺陷**） |
| --- | --- | --- |
| `GET /api/content` | `total=17` | = `content_items` 17 ✅ |
| `GET /api/publish-records` | `array[3]` | = `publish_records` 3 ✅ |
| `GET /api/accounts` | `array[3]` | = `accounts` 3 ✅ |
| `GET /api/schedules` | `array[0]` | = `schedules` 0 ✅ |
| `GET /api/runs` | `array[7]` | = `runs` 7 ✅ |
| `GET /api/tasks` | `total=12` | = `runs` 7 **+** `agent_runtime_runs` 5 → 统一任务是**聚合视图**，不等于任一张表 |
| `GET /api/videos` | 4 个 `.mp4` | 仅 `.mp4`；`videos/` 目录实际有 8 个文件 |
| `GET /api/media/assets` | `assets=45` | = `artifacts` 37 **+** `videos/` 8（含 `.srt` / `.json`） |
| `GET /api/tools` | `array[3]` | `media_list_assets` / `media_describe_asset` / `video_render` |

- `GET /api/media/assets` **没有过滤/分页参数**：只有 `?ref=<value>`（可带 `&root=<root>`）用于单条解析；单独传 `?root=videos` 会被忽略并返回全部 45 条（`src/app/api/media/assets/route.ts:19-33`）。**过滤能力在工具面**（`media_list_assets` 的 `root`/`limit`），不在路由面。

**3.5 只读探测零漂移证明（本阶段自证）**

`stage1` vs `stage1-after-probe`（跑完全部只读探测，含一次被拒绝的图片工具调用）：

| 指纹 | 结果 |
| --- | --- |
| `tables` / `runsByPlaybook` / `contentByStatus` / `publishByStatus` / `files` | **全部 SAME** |
| `db.bytes` / `db.mtime` | **相同**（921,600 B / 2026-10-09T02:39:28.516Z） |
| `git.head` / 改动条目数 | **`3b48126` / 89** |

→ 阶段 1 的取证确实没有写库、没有落文件。阶段 2 的每个写操作都必须做同款 before/after 对比。

## 4. 已有端到端 / 探测资产（阶段 2 复用，不重造框架）

| 资产 | 覆盖 | 复用方式 |
| --- | --- | --- |
| `scripts/creator-editor-link-smoke.ts` | 建内容 → 编辑器深链（含退出/失效分支），真实 Chromium | E2E-01「重新打开」分支直接复用 |
| `scripts/artifact-image-url-smoke.ts` | 上传 → 内容中心封面 → 编辑器封面 → 正文插图（判定"真被画出"） | E2E-02 产物读取/展示分支复用 |
| `scripts/workspace-overview-smoke.ts` | 概览数字来自真实 `/api/workspace/manifest` | 数据根一致性核对 |
| `scripts/model-management-smoke.ts` | 模型清单页（420 模型 / 厂商分组 / 网关开关） | E2E-01/02「模型不可用」定位 |
| `scripts/whiteboard-smoke.ts` | 白板 → 导出内容库往返（自建自删） | 不在本卡四条闭环内，回归时可用 |
| `scripts/ai-runtime-smoke.ts` | AI Runtime（隔离临时库） | 模型解析回归 |
| `scripts/electron-dry-run.ts` | Electron 运行时契约 | 待打包验证（CI-P6） |
| `docs/e2e-core-loop-verification.md` | P0 核心闭环 10 场景矩阵 + 数据安全证明 + 复核命令 | **本卡的上一轮基线**；其结论（远程素材不本地化、发布丢远程封面）沿用到阶段 3 缺陷清单 |
| `tmp-tools-live-probe.ps1`（CI-P1-03） | 工具发现 / 只读工具 / 拒绝分支 / 副作用工具审批门 | E2E-03 工具入口分支复用 |
| `tmp-video-live-probe.ps1`（CI-P1-04） | 上传 → 未审批 409 → 审批放行 → 任务查询 → 产物与 Range → 缺素材 500 → 取消 | E2E-03 的**工具入口**已基本覆盖；本卡需补**worker 入口** |
| `tmp-e2e-baseline.cjs`（**本卡新增**） | 29 表计数 + 关注表分组 + 目录文件指纹 + git/DB 元数据 | 阶段 2 每个用例前后各跑一次 |

**上一轮 E2E 的教训（必须继承）**：①`vitest` 并发跑会因 hook 超时假失败，一次只跑一个；②smoke 与写操作逐个执行、不并发；③`SOCIAL_AUTO_POST_DATA_DIR` 一旦残留，DB 与 artifacts 根会一起漂移，脚本必须先显式清空该变量。

## 5. 接口面覆盖盘点（"哪些能靠单测，哪些只能靠真跑"）

实测：`src/app/api/**/route.ts` 共 **94** 个；**21 个**存在同名 `route.test.ts`，**73 个没有**；另有 **2 个**被测试文件直接 import 处理函数（也算契约覆盖）：

- `/api/agent/artifacts` ← `src/app/api/images/upload/route.test.ts`
- `/api/tasks/[id]` ← `src/lib/videos/video-render-tool.test.ts`（CI-P1-04 新增）

**四条闭环里"没有任何路由测试"的关键面**（阶段 2 必须靠真实 HTTP 取证，不能拿单测当证据）：

| 闭环 | 无路由测试的关键面 |
| --- | --- |
| E2E-01 | **`POST /api/content`（建）**、`/api/content/whiteboard`（注意：`POST /api/content/generate`、`/api/content/[id]`、`/api/content/import-url`、`/api/ai-writing/generate` **有**测试） |
| E2E-02 | **`/api/media/assets`**、`/api/images/from-url`、`/api/images/search` |
| E2E-03 | **`/api/videos/upload`**、`/api/runs`、`/api/runs/[id]`、`/api/runs/[id]/cancel`、`/api/runs/[id]/events`、`/api/tasks`、`/api/internal/scheduler/tick` |
| E2E-04 | **`/api/publish`**、`/api/publish-records`、`/api/publish-records/[id]`、`/api/publish/discard`、`/api/publish/logs`、`/api/schedules`、`/api/calendar`、`/api/accounts` |

**已有路由测试、阶段 2 不再重复的**（举例）：`/api/content/[id]`、`/api/content/generate`、`/api/content/import-url`、`/api/images`、`/api/images/upload`、`/api/videos`、`/api/tools`、`/api/tools/[name]`、`/api/publish/draft`、`/api/publish/verify`、`/api/settings/ai`（部分）。


## 6. 四条闭环的三分类矩阵（E2E → CI-P5 验收条目 → 基线判定）

「已有证据」= 上一轮 P0 E2E 与本仓 smoke/probe 已取得的真实证据；「本卡待取证」= 阶段 2 要做的事；「不可达」= 本机条件下**不可能**取得真实成功证据（必须按 CI-P6-04-07 归入阻塞项/风险项，而不是伪造通过）。

### 6.1 E2E-01 文章生成与持久化（↔ CI-P5-01）

| 验收条目 | 已有证据 | 本卡待取证 | 基线判定 |
| --- | --- | --- | --- |
| P5-01-01 创建选题 / P5-01-02 品牌资料 / P5-01-03 研究素材 | 无（`/api/positions`、`/api/knowledge-base` 均无路由测试） | 受控建 1 条测试选题 + 读回 | 已实现、未验证 |
| P5-01-04 调用 AI 生成文章 | 仅契约测试（`src/app/api/content/generate/route.test.ts` 等） | **真实模型调用 1 次**（阶段 2，需授权/耗额度） | 外部阻塞（需授权）。若解析失败，按"配置问题"分类并记录 `MODEL_*` 错误码 |
| P5-01-05 生成/选择图片与封面 | 上传分支**已验证通过**（`artifact-image-url-smoke`）；**生成分支不可达**（`image_generation callable=0`，§7.1 实测 `MODEL_CAPABILITY_UNAVAILABLE`） | 用上传图完成封面 + 记录生成分支的诚实失败 | 一半已验证 / 一半**环境不可达** |
| P5-01-06 保存并重新打开 | **已验证通过**（P0 E2E ③：`PATCH 200` → 重开三字段一致 → `DELETE 200`，总数回落 17；`creator-editor-link-smoke` 深链） | 用 `E2E05-` 前缀测试数据复跑一遍（本轮基线已变：17 条内容里有 7 `draft`/10 `ready`） | 已验证通过（需按新基线复跑） |
| P5-01-07 修改并再次保存 | **已验证通过**（同上，`images[0]` → `image_path` 镜像一致） | 复跑 | 已验证通过（需复跑） |
| P5-01-08 正文/图片引用/关联数据一致 | **部分验证通过**：本地上传链路一致；**远程导入不本地化**（P0 E2E 7.1 已复现：`imagePath` 写成远程 URL，`metadata` 无本地引用，artifacts 仍 37） | 复现并归档为缺陷（阶段 3 排序） | **验证失败（已复现）** |

### 6.2 E2E-02 图片生成与媒体管理（↔ CI-P5-01 的图片半边）

| 验收条目 | 已有证据 | 本卡待取证 | 基线判定 |
| --- | --- | --- | --- |
| 图片工具调用 → 产物登记 | 工具面 `generate_image_file` **审批门**已验证（未审批拒绝）；**放行后诚实失败**（§7.1） | 重跑两条分支并记录错误码 | 一半已验证 / 生成分支**环境不可达** |
| 产物登记 → 统一媒体列表 | `GET /api/media/assets` = 45 条（37 artifacts + 8 videos）；**无路由测试** | 真实调用 + 分页/过滤能力缺口记录 | 已实现、未验证 |
| 图片读取（HTTP 200 + 字节一致） | `artifact-image-url-smoke` 已验证：三处展示同一文件且真被画出 | 复跑 + 记录 `source="uploaded"` 语义（P1-01 冻结映射） | 已验证通过（需复跑） |
| 编辑器引用 | 同上（正文插图成立） | 复跑 | 已验证通过（需复跑） |
| **三类失败可区分** | 生成失败=**诚实失败**（`TOOL_FAILED` + `MODEL_CAPABILITY_UNAVAILABLE`）✅；产物读取失败=404/越权校验（有单测） | ① 无模型 ② 非法输入 ③ 素材不存在 三类各 1 次真实调用 | 待取证（本卡重点） |

### 6.3 E2E-03 视频任务与产物（↔ CI-P5-02）

| 验收条目 | 已有证据 | 本卡待取证 | 基线判定 |
| --- | --- | --- | --- |
| P5-02-01/02 模板选择 + 素材参数 | `GET /api/tools` → `video_render` schema 含 `const:"existing_video_package"`（P1-04 实测） | 复跑发现接口 | 已验证通过（需复跑） |
| P5-02-03 创建渲染任务 | **工具入口已验证**：审批放行 → 200 → `taskId=88WbAGoxROTo-BVRBERSu`（真实 `runs` 行） | **补 worker 入口**：`POST /api/runs`（`playbookIds:["video_render"]`）→ 需真跑 worker | 一半已验证 / worker 入口待取证 |
| P5-02-04 查询状态与进度 | **已验证**：`GET /api/tasks/<id>` → `succeeded` / `progress=100` / 日志阶段 `run>materials>video>subtitles>package>done` | 复跑 + 记 `/api/runs/[id]` 与 `/api/runs/[id]/events` 两个无测试面 | 已验证通过（需复跑） |
| P5-02-05 失败 / 取消 / 可恢复 | **失败已验证**（缺素材 → 500 `TOOL_FAILED` + `MATERIAL_NOT_FOUND`，任务 `failed`、`progress=null`）；**取消已验证**（`POST /api/runs/<id>/cancel` → `cancelled:true` → 任务 `cancelled`）；**可恢复未实现**（无持久化恢复） | 三条分支复跑；恢复分支按"未实现"记录 | 已验证（失败/取消）/ **未实现**（恢复） |
| P5-02-06 产物登记到媒体管理 | **已验证**：deliverable 200 / 30,389 B 与素材一致；Range `bytes=0-99` → `206 bytes 0-99/30389`；`/api/videos` 列出 4 个 mp4 | 复跑 + 记录已知限制：`.srt`/`.json` 的 `url=""`、`source="uploaded"` | 已验证通过（含记录限制） |
| P5-02-07 业务界面可访问 | 未验证（P0 E2E 只做了页面可达性扫描） | 视频创作页真实打开并播放/下载 1 次 | 已实现、未验证 |
| 「真实渲染引擎接入程度单独记录」 | **pass-through**：`existing_video_package` 复制素材字节，`renderer.encoded:false`，**无帧被重新编码** | 记录为"未接入真实编码"（P1-04-06 决策项） | 已明示（不得写作"视频渲染已验证"） |

### 6.4 E2E-04 发布与状态一致性（↔ CI-P5-03）

> 本闭环的关键前提：`POST /api/publish` 会**真的驱动 Playwright 打开平台页**（`src/lib/publish.ts:57-64`）。无登录态时只可能得到 `login_required` / `failed`，因此**真实成功分支属外部阻塞**。

| 验收条目 | 已有证据 | 本卡待取证 | 基线判定 |
| --- | --- | --- | --- |
| P5-03-01 从已有内容创建排期 | 无（`/api/schedules` 无路由测试，现为 0 行） | 建 1 条受控排期 → 读回 → 删除 | 已实现、未验证 |
| P5-03-02 平台适配后的内容 | 无 | 走 `POST /api/publish/draft`（有测试）拿 `evidence` 逐字段结论 | 需真实登录态 → 外部阻塞 |
| P5-03-03 受控发布 / 测试发布 | 无（P0 E2E 明确未执行） | **只能做拒绝分支**：不存在的 accountId → `failed` 记录；已登录受阻账号 → `login_required` | 外部阻塞 / 待人工验证 |
| P5-03-04 成功/失败/重复请求 | 失败分支可从代码读出（3 条写入路径，`route.ts:30/57/76`）；重复请求未验证 | 失败分支真跑；重复请求在阶段 2 用同一 payload 连打并对比记录数 | 待取证 |
| P5-03-05 内容状态与记录状态一致 | **代码级事实**：直接发布路径 **不改内容状态**；辅助发布路径 `recordPublishSuccess` 才把内容移到 `posted`（`src/lib/publish-facts.ts:46-61`）；内容可达状态 `draft`/`ready`/`posted`（`failed` 不可达） | 真跑失败分支后核对 `content_items.status` **未变**；这既是 PE05 的证据也是"未混淆"的证据 | 待取证（本卡重点） |
| P5-03-06 记录可追溯到内容与平台 | `publish_records` 有 `content_item_id` / `platform` / `account_id`；现 3 条既有记录可读 | 用测试内容建记录后按 `content_item_id` 反查 | 部分已验证 |
| P5-03-07 单独复核 PE05 | ⚠️ **注意口径**：PE05 = "`POST /api/publish` 建记录与内容状态更新的关系"。仓内已有审计结论（`docs/data-model-inventory.md:205-208`）：**直接发布路径不更新内容状态**（发布后内容不会变 `posted`），辅助路径才更新 → 两条路径的记录契约不同 | 用真实失败分支 + 一次（需授权的）真实草稿核对两条路径的差异，把差异写成**可判定的结论**而不是印象 | 待取证（需授权） |


## 7. 外部依赖可用性实测（阶段 2 的"能不能做"依据）

**7.1 图片生成：无可用模型 → 诚实失败（正面证据）**

真实调用（已审批，唯一一次，未产生任何文件/行）：

```powershell
# 请求体先写入临时文件再 --data-binary "@file"（见 7.1 末尾的教训）
# %TEMP%\coolpilot-e2e\img-approve.json:
# {"input":{"prompt":"e2e baseline: a red fox at dawn"},"approvals":{"grantedToolCallId":"e2e-baseline"}}
curl.exe -s -o out.json -w '%{http_code}' -X POST http://127.0.0.1:3000/api/tools/generate_image_file `
  -H 'content-type: application/json' --data-binary "@$env:TEMP\coolpilot-e2e\img-approve.json"
```

实测输出：

```json
HTTP 500
{"ok":false,"error":{"code":"TOOL_FAILED","message":"No usable model provides: image_generation",
 "retryable":false,"details":{"tool":"generate_image_file","errorName":"AppError",
 "upstreamCode":"MODEL_CAPABILITY_UNAVAILABLE"}}}
```

结论：**产品没有用模拟成功糊弄**——它明确区分"没有可用模型"（`MODEL_CAPABILITY_UNAVAILABLE`）与"生成失败"。这正是 CI-P5-01/02 要求的"区分图片模型不可用、生成失败和产物读取失败"里的第一类。跑后指纹零漂移（§3.5）。

> 方法论教训（避免阶段 2 重犯）：`curl` 传 JSON 必须先写 UTF-8 临时文件再 `--data-binary "@file"`；把 JSON 内联进 PowerShell 单引号字符串会带上反斜杠转义，得到**假失败** `400 INVALID_INPUT`（本次首跑即如此，已纠正）。

**7.2 文本模型：可能可调用，但必须实跑（需授权）**

- 只读证据：`chat callable=2`、`openai/default` `status=ok`、`usableKeyCount=1`，启用模型为 `deepseek-flash` / `deepseek-v4-pro`。
- 反向证据：`/api/ai/runtime` 的 `defaults={}`、`/api/settings/ai` 的 `openAIModel=""`、`ai_model_preferences` **0 行** → 解析路径未经真实请求验证。
- 解析顺序（`src/features/ai-runtime/registry.ts:318-341`）：pinned model → 该能力的用户默认 → provider 排序 → `model_type` 匹配意图 → model id；无候选时按原因抛 `MODEL_CREDENTIAL_MISSING`(400) / `MODEL_CAPABILITY_UNAVAILABLE`(409) / `MODEL_NOT_CONFIGURED`(503)（`src/features/ai-runtime/runtime.ts:78-102`）。
- **阶段 2 首个实跑必须记录实际错误码**：若得 503 `MODEL_NOT_CONFIGURED`，那是**配置问题**（`/api/settings/ai` 未指定模型），不是产品缺陷。

**7.3 真实平台发布：外部阻塞，不伪造**

- `POST /api/publish` → `publishToSite` → `runSiteBrowserTool(... configured_create_post ...)`，`headless:true`（`src/lib/publish.ts:43-64`）。无登录态时结果为 `login_required`（账号健康预检命中时提前返回，`src/app/api/publish/route.ts:46-71`）或 `failed`。
- 主计划 CI-P5-03 完成标准："**未经过验证的真实发布不得作为通过条件**"；CI-P6-03-06 把真实发布接口/凭据/权限边界单列为检查项。
- 因此 E2E-04 的**成功分支**在本卡只能标 `外部阻塞 / 待人工验证`，不允许用"接口返回 200"顶替"发布成功"。

**7.4 视频编码：未接入**

`ffmpeg` 在本机存在，但应用**从不调用**它（P1-04 已记录）。CI-P5-02 只验"任务与产物链路完整"，`existing_video_package` 是 **pass-through 适配器**（`renderer.encoded:false`）。阶段 2 记录必须写"**素材副本**"，不得写成"真实编码视频"。

## 8. 缺陷 / 限制清单种子（阶段 3 的输入，本阶段只登记不排序）

| # | 项 | 分类 | 证据 | 归属 |
| --- | --- | --- | --- | --- |
| 1 | `POST /api/publish` 建记录但**不更新 `content_items.status`**（直接发布路径）；辅助路径才移到 `posted` → 两条路径记录契约不同 | **产品缺陷（语义不一致）** | `src/app/api/publish/route.ts` 全文无内容状态更新；`src/lib/publish-facts.ts:46-61`；`docs/data-model-inventory.md:205-208` | **PE05 核实范围**（CI-P5-03-07） |
| 2 | 远程封面被静默丢弃（`resolveLocalImagePath` 对 `https?:` 返回 `""`） | 产品缺陷（已复现） | `src/lib/publish.ts:27-33`；P0 E2E 7.1 | CI-P5-03 / 卡 3 B6 |
| 3 | `POST /api/content/import-url` 不本地化远程图（写远程 URL，artifacts 不增） | 产品缺陷（已复现） | P0 E2E 7.1 | CI-P5-01-08 |
| 4 | worker 路径 `runs.artifact_path` 被 `processRun` 末尾 `updateRunStatus` 清空 → 该路径 `resultUrl` 为空 | 产品缺陷（已定位，修复方案已识别未应用） | P1-04 附录 B-4 §6 | CI-P5-02-06 |
| 5 | 媒体产物的 `source` 恒为 `uploaded`（含渲染产物） | 已知限制（CI-P1-01 冻结映射） | P1-04 附录 B-4 §6；本轮实测：`render-*.mp4` 也是 `source=uploaded` | CI-P5-02-06 |
| 6 | `videos/` 里的 `.srt` / `.json` 在资产视图 `url=""`（`kind=subtitle` / `kind=unknown`） | 已知限制（无服务路由） | 本轮实测 `/api/media/assets` | CI-P5-02-06 |
| 7 | 任务认领无 compare-and-set 锁（`claimNextQueuedRun`） | 风险（并发安全） | P1-04 附录 B-4 §6 | CI-P6-03-04 |
| 8 | "重启后识别未完成流程"未实现（无持久化恢复） | 未实现能力 | P0 E2E ⑩ | CI-P6-02-03 |
| 9 | `web-data/_tmp-e2e.db`（0 B）残留 | 环境卫生 | 本轮 `dataDirTopLevel` | CI-P6-04-05 |
| 10 | 7 个 `browser-profiles` 目录 vs 3 行 `accounts` → 未关联 profile | 环境卫生 / 数据对账 | 本轮 `browser-profilesDirs=7` | CI-P6-04-05 |
| 11 | 视频任务**真实编码**未接入（pass-through） | 未实现能力（已明示） | P1-04 附录 B-4；`renderer.encoded:false` | P1-04-06 决策项 |
| 12 | `GET /api/media/assets` 无过滤/分页（45 条全量返回、无 `total` 字段） | 接口能力缺口 | `src/app/api/media/assets/route.ts:19-33` | CI-P6-04-03 |
| 13 | `publish_records` 的 `queued` / `running` / `cancelled` 无生产写入路径（仅建表默认值） | 记录契约缺口 | `docs/data-model-inventory.md:208` | CI-P5-03-05 |
| 14 | 73/94 路由无路由测试（含四条闭环多处关键面，见 §5） | 测试缺口 | 本轮统计 | CI-P6-01-04 |

**阶段 3 才做的事**：按"是否阻塞核心闭环 / 用户可见 / 修复成本"排序，挑出 P0/P1 级并单独批准再修（本卡**不顺手重构**）。


## 9. 阶段 2 执行计划（按用户给定顺序：文章 → 图片 → 视频 → 发布）

**统一规则（每条用例都遵守）**

1. **前后指纹**：`node tmp-e2e-baseline.cjs e2e0X-before` → 执行 → `node tmp-e2e-baseline.cjs e2e0X-after`，比对 `tables` / `runsByPlaybook` / `contentByStatus` / `publishByStatus` / `files` / `git.head`。
2. **测试数据标记**：标题/文案一律带前缀 `E2E05-`；自建自删（`DELETE` 后核对总数回落）。不对生产内容（既有 17 条）与既有素材（37 artifacts / 8 videos）做破坏性操作。
3. **成功与失败都测**：每条闭环至少 1 条失败路径。
4. **每个失败归类**：产品缺陷 / 配置问题 / 外部依赖缺失 / 测试环境限制 / 验收未满足。
5. **日志落地**：写 `tmp-p1-05-*.log`（与 `tmp-e2e-baseline-*.json` 一起作为证据）。
6. 不并发跑 `vitest`；一次只跑一个进程。

| 步骤 | 动作 | 写入面 | 需要的授权/前置 |
| --- | --- | --- | --- |
| 2.0 | 起 worker：`node_modules\.bin\tsx.cmd src/worker/worker.ts`（独立窗口）；或设置 `COOLPILOT_SCHEDULER_TOKEN` 后打 `POST /api/internal/scheduler/tick` | 无（只消费队列） | **需确认**：会真的处理队列，包括基线里那 1 条 `queued` 的 `topic_article_generator` |
| 2.1 E2E-01 | 建 `E2E05-*` 内容 → 真实模型生成（1 次）→ 保存 → 重开 → 改 → 再存 → 删除 | `content_items` + `usage_records` | **需授权真实模型调用（消耗额度）**；失败则改走契约分支并归为"配置问题" |
| 2.2 E2E-02 | 上传本机小 PNG → 登记 → `/api/media/assets` 读取 → 字节一致 → 编辑器引用；失败三分支：无模型 / 非法输入 / 素材不存在 | `artifacts/`（+1 文件，用后删） | 无需额外授权 |
| 2.3 E2E-03 | ① 工具入口：上传素材 → 未审批 409 → 审批放行 → `taskId` → `/api/tasks/<id>` → 产物 200 + Range 206 → 缺素材 500；② **worker 入口**：`POST /api/runs`（`video_render`）→ worker 处理 → 查任务 → 记录 `resultUrl` 限制 | `videos/`、`uploads/`、`runs`、`run_events` | 需 2.0 的 worker；`POST /api/runs` 会新增 `runs` 行（参数带 `E2E05` 标记） |
| 2.4 E2E-04 | ① 建受控排期 → 读回 → 删；② `POST /api/publish` 用**不存在的 accountId** → 核对写入 `failed` 记录且 `content_items.status` **未变**；③ 对登录受阻账号复现 `login_required`；④ 同一 payload 连打 2 次对比记录数 | `schedules`、`publish_records` | **不触发真实发布点击**；成功分支标"外部阻塞 / 待人工验证" |
| 2.5 | 静态与全量回归：`tsc --noEmit` → `vitest run`（单进程）→ `eslint` | 无 | 无 |
| 2.6 | 产出阶段 2 执行记录 + 缺陷清单（阶段 3 输入） | `tmp-p1-05-*.log` | 无 |

**阶段 2 明确不做**：修缺陷、改 schema、改发布语义、接真实编码引擎、清理 `web-data`、打包验证。

## 10. 阶段 1 结论

1. **基线已冻结**：代码 `3b48126`（89 条未提交改动）、DB 29 表（`content_items` 17 / `publish_records` 3 / `runs` 7 / `accounts` 3 / `schedules` 0）、文件（artifacts 37 / videos 8 / uploads 0）、只读接口指纹全部对齐；已用"跑前 vs 跑后"证明只读取证**零漂移**。
2. **可执行与不可执行的边界已经清楚**：
   - **可真实取证**：E2E-01 的建/存/重开/改；E2E-02 的上传与读取 + 三类失败；E2E-03 工具入口全链路 + worker 入口（起 worker 后）；E2E-04 排期、失败分支、状态一致性。
   - **不可达（必须按阻塞项写，不得伪造）**：真实图片生成（无可用图片模型）、真实平台发布成功（无登录态/真实账号）、视频真实编码（未接入）。
   - **需授权**：真实文本模型调用（消耗额度）、起 worker 消费既有 `queued` 队列、是否允许设置 `COOLPILOT_SCHEDULER_TOKEN`。
3. **不重复已充分覆盖的部分**：21 个已有路由测试与 726 个单测用例不作为"E2E 证据"；本卡只对 73 个无路由测试面（尤其 §5 列出的闭环关键面）做真实 HTTP 取证。
4. **PE05 口径已校正**：不是"有没有更新内容状态"这种模糊说法，而是**两条发布写入路径的契约不同**（`POST /api/publish` 不更新状态；`recordPublishSuccess` 更新为 `posted`）。阶段 2 给出可判定结论，是否需要统一必须单独批准。
5. 本阶段**未修改任何业务代码**、未 `git add` / 未提交；新增文件共 5 个（均已确认是 untracked）：`docs/e2e-baseline-inventory.md`（本文件）、`tmp-e2e-baseline.cjs`（指纹工具）、`tmp-e2e-baseline-stage1.json` / `-stage1-after-probe.json` / `-stage1-final.json`（三次快照证据）。其中 `tmp-e2e-baseline.cjs` 与 `stage1.json` 在冻结计数 **89** 里已计入，另外 3 个把 `git status --porcelain` 推到 **92**（`git rev-parse --short HEAD` 始终为 `3b48126`）；每再跑一次 `node tmp-e2e-baseline.cjs <新label>` 还会因新增快照再多 1 条——复核者若看到计数不同，先看这些 `tmp-e2e-baseline-*` 与文档文件，不要误判为"业务代码被改"。

> **阶段 2 开工前的三个确认项**：①是否允许 1 次真实文本模型调用（额度）；②是否允许起 worker 进程消费队列（会处理基线里那 1 条 `queued` 的 `topic_article_generator`）；③E2E-04 是否只做受控失败分支（**推荐**），还是允许在真实账号上做一次草稿准备。

