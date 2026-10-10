# CoolPilot 核心业务数据模型盘点（Data Model Inventory）

只读盘点：本文档**没有修改任何代码、没有新增字段、没有迁移**，只把现有数据库结构、关系与 JSON blob 列逐项列出。
所有结论都带 `file:line` 证据，可逐条回查。基准：分支 `main`，Next.js 16.2.4，默认语系 `zh-cn`。

事实来源：

| 层 | 定义位置 | 规模 |
| --- | --- | --- |
| Drizzle 表定义（唯一事实来源） | `src/db/schema.ts` | 582 行 / 32 张表（CI-P7-01 新增 2 张：`ai_usage_ledger`、`ai_model_prices`） |
| 建表语句（运行时真正执行） | `src/db/client.ts:54-526` | 879 行（CI-P7-01-05 复核；行号随卡片漂移）：`statements` 数组（`:54-526`）里是 32 条 `CREATE TABLE IF NOT EXISTS` 与 26 条 `CREATE INDEX` **交错**；数组之后另有 2 条 `CREATE INDEX`（用于 `ALTER TABLE` 出来的列）；再往后是就地迁移的 `ALTER TABLE … ADD COLUMN` / `RENAME COLUMN`，然后是**本仓库第一个具名迁移 `migrateAiModelPriceCatalog()`**（CI-P7-01-05：补价格目录的四个新列 + 重建带计量维度的唯一键；先查 `pragma_table_info`/`pragma_index_list`/`pragma_index_info` 与重复键，再先建新键后删旧键，失败带 SQLite 原文落进日志与返回值，**不吞异常**），最后由 `absorbLegacyAccountRows()` 收尾 |
| 仓储层（关系的唯一维护者） | `src/db/repository.ts`（1405 行）+ `src/db/repositories/*.ts`（25 文件） | — |

两张清单的 32 张表**完全一一对应**，没有漂移；`schema.ts` 与 `client.ts` 的字段顺序不同，但字段名与默认值一致。

> **行号与规模的回填范围（2026-10-09，CI-P3-01 回填）**：本轮同样只更新上面三行规模数字（30 张表 / `schema.ts` 450 行 / `client.ts` 602 行 / 21 个仓储文件），并在 §3.2 补上 CI-P3-01 新增的 `research_materials` 一行（行号按现文实测）。**本文其余 `file:line` 未逐条复核**：P2-01 / P2-02 / P3-01 在 `schema.ts` 与 `client.ts` 中段插入过表，其后各表的行号已后移；P2-02 / P2-03 / P3-01 又在 `validation.ts` 的 `contentGenerateSchema` 里加过字段，其后各行号同样后移。引用本文行号前请以现文复核。真实工作区数据库里另有 `ai_providers` / `sites` 两张历史表，`/api/workspace/manifest` 因此报 `tableCount=32`（30 + 2），详见主计划 §附录 A-1 的注。
>
> **（2026-10-10，CI-P3-02 回填）本轮没有新增任何表**：只给 `research_materials` 加了一列 `transcript_json`（`schema.ts:454`，`client.ts` 里是一条就地 `ALTER TABLE … ADD COLUMN`），并把上面三行的规模数字更新为 **30 张表 / `schema.ts` 457 行 / `client.ts` 606 行 / 21 个仓储文件**。§3.2 的 `research_materials` 一行已按现文更新（类型词汇表增加 `audio` / `video`，并记下 `transcript_json` 这一列）。**其余 `file:line` 未复核**，理由同上一条。 
>
> **（2026-10-10，CI-P3-03 回填）本轮同样没有新增任何表**：给 `research_materials` 再加两列 `extraction_json`（`schema.ts:473`）与 `extraction_history_json`（`schema.ts:481`），在 `client.ts` 里同样是就地 `ALTER TABLE … ADD COLUMN`。规模数字更新为 **30 张表 / `schema.ts` 484 行 / `client.ts` 616 行 / 21 个仓储文件**。§3.2 的 `research_materials` 一行已补上这两列与「研究提炼」的语义（注意：**没有** `summary_json` 列，摘要就是提炼里的 `summary` 字段——见主计划 §附录 B-9 §5 的勘误与 §附录 B-10）。**其余 `file:line` 未复核**，理由同前。
>
> **（2026-10-10，CI-P7-01-04 回填）本轮没有新增表、没有新增列**：账本口径从「一次模型**尝试**一行」明确为「运行时**实际发出的每一个请求**一行」——`ModelAttempt` 增加了 `kind`（`answer` / `self-correction`）与 `outcome`（`success` / `failed`）等字段，但那**只在运行时与账本写入器之间**流动，表结构一字未改（31 列保持不变）。因此上面三行的**全部规模数字不变**（仍是 32 张表 / 582 行 / 675 行），变的只有写入语义：`parent_usage_id` 现在真的会写（同一次调用里紧邻的前一行，构成调用链），14 个生产调用点全部开始写账本（逐条清单见 `coolpilot-capability-integration-plan.md` §附录 B-11 §4）。**`usage_records` 依旧逐字节未变。**
>
> **（2026-10-10，CI-P7-01 回填）本轮新增 2 张表**（这是 CI-P3-03 之后的第一次加表）：`ai_usage_ledger`（AI 使用账本，**一次模型尝试一行**，含失败与重试）与 `ai_model_prices`（价格目录，只增不改）。规模数字更新为 **32 张表 / `schema.ts` 582 行 / `client.ts` 675 行 / 25 个仓储文件**，并在 §3.8 补上这两张表的逐表说明。**`usage_records` 未做任何改动**（列、默认值、写入点、读取路径全部逐字节不变）；账本与它是两张并存的表，语义差别见 §3.8。**其余 `file:line` 未复核**，理由同前；新增表的行号按现文实测（`schema.ts:486-583`）。

## 1. 三条底层事实（先看这三条，后面的关系才读得懂）

1. **数据库里没有任何外键约束。** 全仓 `FOREIGN KEY`、`REFERENCES`、`PRAGMA foreign_keys` 零命中；`client.ts` 里唯一的 `pragma` 用法是 `client.ts:502` 的 `SELECT name FROM pragma_table_info(?)`（读列名，用于迁移判断）。
   → 关系是**约定**：删除父行不会级联、也不会被拒绝，是否悬空由应用层决定。
2. **部分关系只存在于 JSON blob 里，而不是列里。** 例如"这次运行发布的是哪条内容"写在 `runs.params.contentItemId`（`src/worker/runner.ts:170`），`runs` 表本身**没有** `content_item_id` 列（`schema.ts:46-60`）。JSON blob 在这里承担了外键职责，靠字符串约定维持。
3. **数据库文件位置随运行方式变化。** `<dataRoot>/social-auto-post.db`（`client.ts:11`），`dataRoot()` 由 `src/lib/paths.ts:27` 解析：dev 为仓库内 `web-data/`，打包/安装版为 `%APPDATA%\CoolPilot\data`。`SOCIAL_AUTO_POST_DB_URL` 可覆盖（`client.ts:10`），Electron 下相对路径会被强制拉回 data 目录（`client.ts:20-25`）。

## 2. 六者关系图（内容 / 素材 / 发布记录 / 帐号 / 任务 / 运行记录）

```
accounts（帐号）  id(PK) · platform · profile_path(历史字段) · preset_json
   │
   ├─1:N─> schedules（任务/排程）   id(PK) · playbook_id · account_id · content_item_id · params_json · schedule_times_json
   │           │
   │           └─1:N─> runs（运行记录）  id(PK) · account_id · schedule_id · status · params_json · artifact_path
   │                       │                 │
   │                       │                 └─ runs.params.contentItemId  ← 运行真正发布的内容（JSON blob，不是列）
   │                       │                 └─ runs.params._scheduledFor  ← 排程去重键（JSON blob）
   │                       └─1:N─> run_events（运行日志）  run_id · level · message · data_json
   │
   ├─1:N─> publish_records（发布记录）  id(PK) · account_id(可空) · content_item_id(可空) · status · url · method · terminal
   │           │                        + 指标缓存列 views/likes/…/metric_status/metrics_source
   │           └─1:N─> metric_snapshots（指标时间序列）  publish_record_id · account_id · content_item_id · extra_json
   │
   ├─1:N─> account_metric_snapshots（帐号指标快照）  account_id · followers · posts_count · extra_json
   ├─1:N─> usage_records（AI 用量流水）  account_id(可空) · content_item_id(可空) · provider · model · kind
   │       └─1:N─> ai_usage_ledger（AI 使用账本，CI-P7-01）  content_item_id(可空) · task_id / run_id / node_id · provider_id · model_id · cost_amount(可空)
   └─1:N─> chat_threads（Agent 对话）  id(PK) · active_account_id
               ├─1:N─> chat_messages  thread_id · account_id · role · content · metadata_json
               │           └─1:N─> chat_tool_calls  thread_id · message_id · name · status · input_json/output_json
               └─1:N─> agent_runtime_runs（Agent 运行）  thread_id · account_id · status · mode
                           │                            input_json / state_json / pending_approval_json / result_json
                           └─1:N─> agent_runtime_events  agent_run_id · type · message · data_json

content_items（内容）  id(PK) · title · body · post_ready_text · image_path · metadata_json · status · source_urls_json
   ▲
   └─ 被引用的位置（列，全部可空）：schedules.content_item_id · publish_records.content_item_id
                                     metric_snapshots.content_item_id · usage_records.content_item_id
                                     runs.params.contentItemId（JSON blob）

素材（Asset）：**没有独立表**，见 §5
```

读法要点：

- 实线箭头都是"应用层约定"，数据库不强制（§1 第 1 条）。
- `publish_records` 同时挂 `accounts` 与 `content_items`，两个外键列**都可空**：内容被删、帐号被删都不会带走这条发布事实（`schema.ts:183,193`；`src/lib/publish-facts.ts:38-40` 的注释解释了为什么）。
- `schedules` 与内容的关系被**写了两遍**：列 `schedules.content_item_id`（`schema.ts:38`）+ blob `schedules.params.contentItemId`（`src/app/api/agent/schedules/route.ts:34,36`）。真正被运行时消费的是 blob（`src/worker/runner.ts:170`），列目前只有日历视图读（`src/lib/calendar.ts:175`）。

## 3. 逐表清单（32 张表：用途一句话 / 主键 / 关系字段 / JSON blob）

> "关系字段"一栏的写法：`列名 → 目标`，括号里是可空性；**没有外键约束**（§1），箭头只是约定。

### 3.1 帐号

| 表 | 定义 | 用途一句话 | PK | 关系字段 | JSON blob |
| --- | --- | --- | --- | --- | --- |
| `accounts` | `schema.ts:3-15` | 一个可发布的平台帐号：平台、登录网址、帐号标识、浏览器 profile 位置、状态与预设 | `id` | 被下列各表引用：`schedules.account_id`、`runs.account_id`、`publish_records.account_id`、`metric_snapshots.account_id`、`account_metric_snapshots.account_id`、`chat_threads.active_account_id`、`chat_messages.account_id`、`chat_tool_calls.account_id`、`agent_runtime_runs.account_id`、`usage_records.account_id` | `preset_json`（`:12`，平台预设） |

### 3.2 内容与素材

| 表 | 定义 | 用途一句话 | PK | 关系字段 | JSON blob |
| --- | --- | --- | --- | --- | --- |
| `content_items` | `schema.ts:17-28` | 一条可编辑/可发布的内容（文章或动态）：正文、可发布文本、封面图路径、元数据与生命周期状态 | `id` | 被 `schedules.content_item_id`、`publish_records.content_item_id`、`metric_snapshots.content_item_id`、`usage_records.content_item_id` 引用（均**可空**）；另被 `runs.params.contentItemId` 以 blob 方式引用 | `source_urls_json`（`:22`，来源网址）、`metadata_json`（`:24`，**素材事实来源**，见 §5） |
| `products` | `schema.ts:134-147` | 产品资料库条目：品牌、分类、关键词、图片、连结，供知识库与配图取材 | `id` | 无列级关系（产品与内容的关联目前只是字符串，见 §7 发现 6） | `keywords_json`（`:140`） |
| `knowledge_base` | `schema.ts:149-163` | 本机知识库条目：正文、分类、权重、来源（手动/AI/上传文件）与可选定位归属 | `id` | `position_id`（`:160` → `positions.id`，**空串代表不属于任何定位**，不是 NULL） | `tags_json`（`:157`） |
| `dify_connections` | `schema.ts:165-179` | 外部知识库连接：Dify API 地址与密钥、知识库 id 列表、检索阈值与回退模式 | `id` | `position_id`（`:173` → `positions.id`） | `knowledge_ids_json`（`:170`）、`scopes_json`（`:172`） |
| `topics` | `schema.ts:158-171` | **CI-P2-01 新增（本轮回填）**：选题库条目——标题、描述、关键词、来源与来源连结、状态，以及它产出的那条内容 | `id` | `content_item_id`（`:168` → `content_items.id`，**可空**）：由生成入口在文章落库后回写（`src/db/repositories/topics.ts` 的 `linkTopicContentItem`），选题列表据此提供「打开文章」 | `keywords_json`（`:162`） |
| `brands` | `schema.ts:173-184` | **CI-P2-02 新增（本轮回填）**：品牌资料条目——名称、简介、目标受众、语气、关键词与禁用表达，供写作流程选择 | `id` | 无列级关系：文章不在自己身上建关系列，只在 `metadata.brandId` / `metadata.brandVersion` 里记下用的是哪一条、用的是哪一版（CI-P2-02，见 `docs/coolpilot-capability-integration-plan.md` §附录 B-6 / B-7）。与单例 `app_settings["brand"]`（控制台品牌：logo / 配色 / Agent 提示词）**不是同一件事** | `keywords_json`（`:180`）、`banned_words_json`（`:181`） |
| `research_materials` | `schema.ts:443-484` | **CI-P3-01 新增 / CI-P3-02、CI-P3-03 扩列（本轮回填）**：研究素材库条目——标题、类型（`text` 文本 / `url` 网页 / `file` 文件 / `audio` 音频 / `video` 视频，后两者由转写写出）、正文、来源连结、**处理状态**（`draft` 待读取 / `ready` 正文就绪 / `empty` 读取成功但无正文 / `failed` 读取失败）、状态原因、来源页 `og:image`、导入文件名、标签，来源**读取成功**的时间，**转写记录**（`transcript_json`：来源文件、引擎与模型、语言、时长、返回格式、分段），以及**研究提炼**（`extraction_json`：摘要 / 核心观点 / 带原文片段的事实 / 引述 / 选题建议 + 版本、任务、模型、读到的正文指纹；`extraction_history_json`：被替换掉的版本，用户手工编辑不算新版） | `id` | 无列级关系：生成时只把 `id` 与读到的 `updatedAt` 记进 `content_items.metadata`（`researchMaterialId` / `researchMaterialVersion`）。带上提炼时再多记 `researchExtractionRevision` / `researchExtractionTaskId`（CI-P3-03）；**没有** `content_item_id` 反向列（与 `topics` 不同，属有意的范围控制，见主计划 §附录 B-8 §5）；转写与提炼同运行的关系也走 blob：`transcript_json.taskId` / `extraction_json.taskId` ← `runs.id`，而 `runs.params.materialId` 指向本表 | `tags_json`（`:455`）、`transcript_json`（`:463`，`""` ＝「不是转写来的」）、`extraction_json`（`:473`，`""` ＝「没提炼过」，与「提炼结果是空的」不同）、`extraction_history_json`（`:481`） |

### 3.3 发布与指标

| 表 | 定义 | 用途一句话 | PK | 关系字段 | JSON blob |
| --- | --- | --- | --- | --- | --- |
| `publish_records` | `schema.ts:181-208` | **发布事实**：某条内容在某个帐号上发布成功（或失败）的唯一定案，含平台返回地址、方式、终端与最新指标缓存 | `id` | `account_id`（`:183` → `accounts.id`，可空）、`content_item_id`（`:193` → `content_items.id`，可空） | 无（本表用**平铺列**存指标：`:198-207`） |
| `metric_snapshots` | `schema.ts:210-227` | 一条发布记录在某一时刻的指标快照，构成时间序列（趋势图的数据源） | `id` | `publish_record_id`（`:212` → `publish_records.id`，**非空**）、`account_id`（`:213`，可空）、`content_item_id`（`:215`，可空） | `extra_json`（`:224`，平台特有指标） |
| `account_metric_snapshots` | `schema.ts:229-239` | 帐号在某一时刻的整体指标快照（粉丝数、发布数） | `id` | `account_id`（`:231` → `accounts.id`，**非空**） | `extra_json`（`:236`） |

### 3.4 任务与运行记录

| 表 | 定义 | 用途一句话 | PK | 关系字段 | JSON blob |
| --- | --- | --- | --- | --- | --- |
| `schedules` | `schema.ts:30-44` | 一条排程（"任务"）：用哪个 playbook、对哪个帐号、按哪些时间规则、跑的时候带什么参数 | `id` | `account_id`（`:33`，可空）、`content_item_id`（`:38` → `content_items.id`，可空，**当前只有日历视图读**，见 §7 发现 3） | `schedule_times_json`（`:35`，时间规则）、`params_json`（`:36`，会被整包展开进 run） |
| `runs` | `schema.ts:46-60` | 一次实际执行的运行记录：状态、时间、结果消息与产物文件路径 | `id` | `account_id`（`:49`，可空）、`schedule_id`（`:50` → `schedules.id`，可空，手动触发的 run 没有） | `params_json`（`:53`，**同时承载关系**：`contentItemId`、`_scheduledFor`、`_scheduleId`） |
| `run_events` | `schema.ts:62-69` | 一次运行的日志流水（界面上"运行详情"的每一行） | `id` | `run_id`（`:64` → `runs.id`，**非空**） | `data_json`（`:67`） |

### 3.5 Agent 与对话

| 表 | 定义 | 用途一句话 | PK | 关系字段 | JSON blob |
| --- | --- | --- | --- | --- | --- |
| `chat_threads` | `schema.ts:71-77` | 一个 Agent 对话线程（`DEFAULT_AGENT_CHAT_THREAD_ID` 是默认线程） | `id` | `active_account_id`（`:74` → `accounts.id`，可空，`@` 指定的目标网站） | 无 |
| `chat_messages` | `schema.ts:79-88` | 线程里的一条消息（`role` 区分用户/助手，`mode` 记录该轮的处理模式） | `id` | `thread_id`（`:81` → `chat_threads.id`，**非空**）、`account_id`（`:84`，可空） | `metadata_json`（`:86`） |
| `chat_tool_calls` | `schema.ts:90-103` | 一轮对话里的一次工具调用：工具名、状态、入参、出参与计费 | `id` | `thread_id`（`:92` → `chat_threads.id`）、`message_id`（`:93` → `chat_messages.id`）、`account_id`（`:96`，可空） | `input_json`（`:97`）、`output_json`（`:98`） |
| `agent_runtime_runs` | `schema.ts:111-123` | Agent 运行时的一次执行：状态机现场（`state`＝检查点）、待审批请求、最终结果 | `id` | `thread_id`（`:113` → `chat_threads.id`，可空）、`account_id`（`:114`，可空） | `input_json`（`:117`）、`state_json`（`:118`）、`pending_approval_json`（`:119`）、`result_json`（`:120`） |
| `agent_runtime_events` | `schema.ts:125-132` | 一次 Agent 运行的事件流水（`type` 是事件类型，供 `.../events` 增量拉取） | `id` | `agent_run_id`（`:127` → `agent_runtime_runs.id`，**非空**） | `data_json`（`:130`） |

### 3.6 设置 / 定位 / 用量

| 表 | 定义 | 用途一句话 | PK | 关系字段 | JSON blob |
| --- | --- | --- | --- | --- | --- |
| `app_settings` | `schema.ts:105-109` | 一个 key-value 设置表：执行环境、权限、品牌、提示词、指标与模型网关设置都落在 `value_json` 里 | `key` | 无 | `value_json`（`:107`） |
| `positions` | `schema.ts:378-385` | 一个"帐号定位"档案（人设、写作管控、内容策略、平台定制、RSS、绑定帐号） | `id` | 被 `knowledge_base.position_id`（`:160`）、`dify_connections.position_id`（`:173`）引用 | `data_json`（`:382`，**整个定位档案的主体都在这里**） |
| `usage_records` | `schema.ts:241-254` | 一次 AI 调用的用量流水（供应商、模型、`kind`、token、字数），是"用量"页面的数据源 | `id` | `account_id`（`:251`，可空）、`content_item_id`（`:252`，可空，让一次改写能对回它服务的内容） | 无 |

### 3.7 模型运行时（AI Runtime 冻结面的存储，8 张表，不属于内容/发布业务核心）

| 表 | 定义 | 用途一句话 | PK | 关系字段 | JSON blob |
| --- | --- | --- | --- | --- | --- |
| `ai_model_providers` | `schema.ts:267-279` | 供应商（OpenAI、通义千问…）：名称、区域、文档地址、启用位 | `id` | `provider_id` 唯一（`:269`），被 endpoint / model / capability 链引用 | 无 |
| `ai_model_endpoints` | `schema.ts:281-296` | 供应商的一个可调用入口：协议、base URL、签名凭证引用与探测状态 | `id` | `endpoint_id` 唯一（`:283`）、`provider_id`（`:284`）、`credential_ref`（`:288`） | 无 |
| `ai_models` | `schema.ts:298-311` | 注册表里的一个模型：类型、上下文窗口、启用位、来源与同步时间 | `id` | `provider_id`（`:300`）、`endpoint_id`（`:301`，**空串代表未绑定**，见 `schema.ts:256-266` 注释） | 无 |
| `ai_model_capabilities` | `schema.ts:313-322` | 模型能力矩阵：一行一个"模型 × 能力"，回答"谁能做 VISION + TOOL_CALLING" | `id` | `model_row_id`（`:315` → `ai_models.id`）、`capability`（`:316`） | 无 |
| `ai_model_preferences` | `schema.ts:324-333` | 能力默认选择：`(scope, capability)` 决定用哪个模型 | `id` | `model_row_id`（`:328`）、`provider_id`（`:329`）、`model_id`（`:330`） | 无 |
| `ai_sync_records` | `schema.ts:335-344` | 一次模型清单同步的结果记录 | `id` | `provider_id`（`:337`）、`endpoint_id`（`:338`） | 无 |
| `ai_probe_results` | `schema.ts:346-354` | 一次能力探测的结果（延迟、结论） | `id` | `model_row_id`（`:348`）、`capability`（`:349`） | 无 |
| `ai_credential_keys` | `schema.ts:361-376` | 一条凭证里单个密钥的健康状态（冷却、失败次数）；用 SHA-256 指纹标识，**不存密钥本身** | `id` | `credential_ref`（`:363`）+ `fingerprint`（`:365`）组合标识；`provider_id`（`:364`） | 无 |

### 3.8 成本与质量（CI-P7-01 新增，2 张表）

这两张表一起回答「这次 AI 调用花了多少钱、钱花在哪」。它们**不替换** `usage_records`：后者是「一次成功的生成一行」的聚合口径（`用量统计` 页的数据源），前者是「一次模型**尝试**一行」的账本口径（失败、重试、切换供应商都在里面）。两张表并存是**有意**的，因为把账本语义压进 `usage_records` 会让 6 个既有写入点与 `用量统计` 页同时变得二义。

| 表 | 定义 | 用途一句话 | 主键 | 关系字段 | JSON blob |
| --- | --- | --- | --- | --- | --- |
| `ai_usage_ledger` | `schema.ts:508-555` | 一次模型**请求**的账本行（CI-P7-01-04 起口径为「运行时实际发出的每一个请求」，含被拒的 Key、被降级的模型与自纠重试）：谁真正签发了请求、用了多少、花了多少、属于哪个业务任务、失败原因是什么 | `id` | `task_id` / `run_id` / `node_id`（`:523-525`，均为空串而非 NULL）、`parent_usage_id`（`:527`，同一次调用里紧邻的前一行）、`output_asset_id`（`:529`）、`content_item_id`（`:530`） | `quantity_json`（`:544`，非 token 计量的单位）、`pricing_json`（`:551`，**冻结的价格快照**） |
| `ai_model_prices` | `schema.ts:564-590` | 价格目录的一行：某供应商某模型在某时刻起的**某一种计量维度**的单价；只增不改，靠 `effective_from` 换代 | `id` | `provider_id`（`:566`）、`model_id`（`:568`，`*` = 该供应商兜底价） | 无（非 token 维度的价在 `unit_price` + `unit_label` 列上，不塞 JSON） |

**三条必须原样保留的语义（写代码前先读这里）**：

1. `cost_amount` **可 NULL**。NULL 表示「这笔钱说不出来」，而不是 0。四种状态由 `cost_source` 区分：`provider-reported`（厂商自己报的费用）/ `computed`（用量 × 本行 `pricing_json` 快照）/ `unpriced`（调用确实发生，但这个供应商+模型没有价格）/ `unknown`（根本没测到）。**汇总时只把前两种计入合计**，后两种分别计进 `unpricedAttempts` / `unmeasuredAttempts`，并把 `costIsComplete` 置 false。
2. `completeness` 由「有没有收到 usage 对象」决定，**不由 token 是否为 0 决定**。供应商报了一个全 0 的 usage 是 `reported`，什么都没报才是 `unknown`。
3. `credential_label` 只存掩码（形如 `****1234`），与 `ai_credential_keys` 一样**不存密钥本身**；完整提示词也不进账本。
4. **一条价格只计价一个计量维度**（CI-P7-01-05）。`metered_kind` 既在价格目录的唯一键 `(provider_id, model_id, metered_kind, effective_from)` 里，也在取价条件里：**文本价不会给图片计价**。`resolveModelPrice(providerId, modelId, at, meteredKind)` 的第四个参数是**必填**；维度不匹配、或价格行缺该维度的单位/单价时，费用是 `unpriced` + NULL，绝不退化成一个 `computed` 的 0。单位价行必须给出 `unit_label`（`image` / `second` / `character` / `call`）且不得携带 token 单价；token 行必须同时给出输入与输出单价，**一整行都是 0 时必须显式 `declaredFree`**（漏填不等于免费）。
5. **价格目录只增不改，且新价不倒算历史**（CI-P7-01-05 的界面把这条落成了不可编辑的操作）：改价是新增一条 `effective_from` 更晚的行；账本行上冻结的 `pricing_json` 才是它当次的算法依据。同刻同维度重复会被拒（`AI_PRICE_CONFLICT` / 409），**不会**覆盖既有行。

写入/读取落点：写入器 `src/lib/ai-usage-ledger-recorder.ts`（一次业务调用 → 每个尝试一行）；纯函数 `src/lib/ai-usage-ledger.ts`（费用可述性、完整度、窗口汇总、**按维度的单位价**）；仓储 `repository.ts:1219-1580` 的 7 个函数（价格目录部分：`createAiModelPrice` / `listAiModelPrices` / `resolveModelPrice`）；barrel `src/db/repositories/ai-usage-ledger.ts`。价格目录的**写入路径**：`GET/POST /api/models/prices`（`src/app/api/models/prices/route.ts`，边界校验 `aiModelPriceInputSchema`）与界面 `src/components/system/model-price-panel.tsx`（系统 → 模型管理 → 价格目录）。

## 4. 关键关系明细（谁写、谁读、证据）

| # | 关系 | 实现方式 | 可空 | 写入者 | 读取者 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | 帐号 → 排程 | 列 `schedules.account_id` | 是 | `createSchedule` / `updateSchedule` | 排程列表、日历、schedulerTick | `schema.ts:33`；`repository.ts:546`、`:566`；`scheduler-service.ts:34` |
| R2 | 排程 → 运行 | 列 `runs.schedule_id` + blob `runs.params._scheduledFor` / `_scheduleId` | 是 | `schedulerTick` 创建运行时写入 | 排程去重、运行列表 | `scheduler-service.ts:30-38`（`:30` 用 `params._scheduledFor` 去重） |
| R3 | 帐号 → 运行 | 列 `runs.account_id` | 是 | `createRun`（手动与排程两条路） | 运行上下文构造（拿帐号与 profile） | `schema.ts:49`；`runner.ts:45`、`:50` |
| R4 | **运行 → 内容** | **blob** `runs.params.contentItemId`（`runs` 表没有该列） | 是 | 手动触发路由 / 排程参数 | `runThreads` 取要发布的内容 | `schema.ts:46-60`（无该列）；`runner.ts:170` |
| R5 | 排程 → 内容 | **双写**：列 `schedules.content_item_id` + blob `schedules.params.contentItemId` | 是 | `/api/agent/schedules` 同时写两处 | 列：日历视图；blob：运行时 | `schema.ts:38`；`src/app/api/agent/schedules/route.ts:34`（blob）与 `:36`（列）；`calendar.ts:175` |
| R6 | 内容 → 发布事实 | 列 `publish_records.content_item_id` | 是 | `recordPublishSuccess` 先建记录 | 指标同步、发布记录列表 | `schema.ts:193`；`publish-facts.ts:46-59` |
| R7 | 内容状态随发布事实变更 | `content_items.status = 'posted'` | — | `markContentItemPosted`（`recordPublishSuccess` 的第二写） | `findNextReadyContentItem`（只取 `ready`） | `repository.ts:446-450`；`publish-facts.ts:61`；`repository.ts:435-444` |
| R8 | 帐号 → 发布事实 | 列 `publish_records.account_id` + 快照列 `account_name` / `platform` | 是 | 同上（快照来自草稿 receipt 的帐号） | 发布记录列表、指标同步 | `schema.ts:183-185`；`publish-facts.ts:47-49` |
| R9 | 发布事实 → 指标快照 | 列 `metric_snapshots.publish_record_id` | **否** | 指标采集器 | 趋势图 | `schema.ts:212`；`repositories/metrics.ts:75-115` |
| R10 | 运行 → 运行日志 | 列 `run_events.run_id` | **否** | `appendRunEvent`（`createRun` 与运行过程都会写） | 运行详情 / SSE | `schema.ts:64`；`repository.ts:659`、`:618`；`runner.ts:52` |
| R11 | 对话线程 → 消息 → 工具调用 | 列 `chat_messages.thread_id`、`chat_tool_calls.thread_id` / `message_id` | 否 | `createAgentChatMessage`、`createAgentToolCall` | 聊天室渲染与审批查询 | `schema.ts:81,92,93`；`repository.ts:811`、`:844` |
| R12 | 对话线程 → Agent 运行 → Agent 事件 | 列 `agent_runtime_runs.thread_id`（可空）、`agent_runtime_events.agent_run_id`（非空） | 部分 | `createAgentRuntimeRun`、`appendAgentRuntimeEvent` | 恢复路由、事件流 | `schema.ts:113,127`；`repository.ts:912-937`、`:968-985` |
| R13 | 内容 → AI 用量 | 列 `usage_records.content_item_id`（可空） | 是 | 各生成/改写路由 | 用量页面 | `schema.ts:252`；`repository.ts:1090-1123` |
| R14 | 运行 → 产物文件 | 列 `runs.artifact_path`（文件路径，不是 blob） | 是 | `updateRunStatus`（值来自执行体） | 运行详情 | `schema.ts:55`；`repository.ts:626`、`:635`；`threads.ts:108-109`（截图落在 `artifacts/`） |
| R15 | 内容 / 业务任务 → AI 成本 | 列 `ai_usage_ledger.content_item_id`（可空）、`task_id` / `run_id` / `node_id`（均为空串而非 NULL）、`parent_usage_id`（同一次调用里紧邻的上一条账本行，构成调用链） | 是 | `recordAiUsageCall()` / `recordAiUsageFailure()`（`src/lib/ai-usage-ledger-recorder.ts`）；**14 个生产调用点全部接入**（逐条清单见 `coolpilot-capability-integration-plan.md` §附录 B-11 §4） | 无（P7-02 的调用明细页将读它） | `schema.ts:523-530`；`repository.ts:1219-1405`；`src/lib/ai-usage-ledger.ts` |
| R16 | 供应商+模型 → 单价 → 账本行 | `resolveModelPrice()` 按 `(provider_id, model_id, effective_from<=at)` 取最新一行，`*` 兜底；结果以 `pricing_json` **快照**写进账本行 | 否（`cached_input_per_million` 可空） | `createAiModelPrice()`（**目前无写入者：目录为空**） | `recordAiUsageCall()` 的取价步骤 | `schema.ts:564-582`；`repository.ts:1387-1405` |

## 5. 素材（Asset）当前没有独立表

32 张表里没有 `assets` / `artifacts` / `files` 之类的表（`schema.ts` 全文；对照 §3）。素材目前是**"文件路径字符串 + 目录约定"**：

| 素材种类 | 存放位置（数据库） | 证据 |
| --- | --- | --- |
| 内容图片（有序列表，第一张是封面） | `content_items.metadata_json.images` —— **事实来源** | `src/lib/content-images.ts:3-17` |
| 内容封面（发布管线用的镜像） | `content_items.image_path` | `schema.ts:23`；`src/lib/content-images.ts:5-8`（回退链：列表为空时用 `imagePath`） |
| 内容影片 | `content_items.metadata_json.videoPath` | `src/lib/video-library.ts:73-76` |
| 产品图 | `products.image_path` | `schema.ts:142` |
| 运行产物（截图等） | `runs.artifact_path` | `schema.ts:55`；`src/lib/threads.ts:108-109` |

文件目录由 `src/lib/paths.ts` 统一解析（P5-B0 冻结面）：

| 目录 | 访问器（解析，无副作用） | 初始化器（写入者才调用） | 用途 |
| --- | --- | --- | --- |
| `dataRoot` | `dataRoot()` `:27` | `ensureDataRoot()` `:31` | 工作区根（dev＝仓库 `web-data/`） |
| `browser-profiles/<accountId>` | `accountProfilePath()` `:69` | 无（`ensureBrowserProfilesRoot()` `:40` 只建父目录） | Playwright 持久化登录态 |
| `artifacts/` | `artifactsRoot()` `:82` | `ensureArtifactsRoot()` `:86` | AI 生成图、运行截图等共享素材 |
| `uploads/product-images/` | `productImagesRoot()` `:100` | `ensureProductImagesRoot()` `:104` | 产品照片 |
| `uploads/brand-logos/` | `brandLogosRoot()` `:109` | `ensureBrandLogosRoot()` `:113` | 品牌 logo |
| `videos/` | `videosRoot()` `:91` | `ensureVideosRoot()` `:95` | 待发布影片 |

> 直接结论：素材没有身份、没有归属、没有引用计数——同一条内容删掉后图片仍留在磁盘上，另一条内容可以指向别人的图片路径。这正是 P1-01 要解决的问题，本卡只记录事实。

## 6. 状态字段的分布（同一件事有 5 套并行词表）

这是"内容草稿状态"（P0-04）与"发布事实"（P0-05）容易读错的地方：状态不集中在一处，而是分散在 6 张表、5 套词表里。

| 字段 | 词表 | 词表定义 | 默认值（从哪来） | 谁改它 |
| --- | --- | --- | --- | --- |
| `content_items.status` | `draft` / `ready` / `posted` / `failed` | `types.ts:81`；zod 同集 `validation.ts:108` | 建表 `draft`（`schema.ts:25`）；`createContentItem` 默认写 `ready`（`repository.ts:400`） | `markContentItemPosted` → `posted`（`repository.ts:450`）；内容编辑路由 |
| `accounts.status` | `active` / `paused` / `needs_login` | `types.ts:79` | 建表 `needs_login`（`schema.ts:11`） | 帐号路由 / 健康检查 |
| `schedules.status` | `scheduled` / `queued` / `running` / `posted` / `failed` / `missed` / `cancelled` | `types.ts:125` | 建表 `scheduled`（`schema.ts:37`） | `schedulerTick`：`missed`（`scheduler-service.ts:27`）、`queued`（`:42`）、`running`（`:46`）、`posted`/`failed`（`:50`） |
| `runs.status` | `queued` / `running` / `success` / `warning` / `failed` / `cancelled` | `types.ts:13-20` | `createRun` 写 `queued`（`repository.ts:614`） | `updateRunStatus`（`repository.ts:622-642`）；`claimNextQueuedRun` → `running`（`:644-657`） |
| `run_events.level` | `info` / `success` / `warning` / `error` | 仅默认值，无联合类型 | 建表 `info`（`schema.ts:65`） | `appendRunEvent`（`repository.ts:659-677`），由 `ctx.log` 调用（`runner.ts:51-53`） |
| `publish_records.status` | 6 值：`queued` / `running` / `published` / `drafted` / `failed` / `cancelled` | `types.ts:159-168`（`publishRecordStatuses`） | 建表 `queued`（`schema.ts:188`）；仓库层默认也是 `queued`（`repository.ts:1033`） | **两条生产写入路径 + 一个改记录接口**（勘误 E1 修正）：① 辅助发布路径 `recordPublishSuccess` → 固定 `published`（`publish-facts.ts:46,53`）；② 自动 / 直接发布路由 `POST /api/publish` → 三个分支各写一行：`:30` 帐号不存在 `failed`、`:57` 登录受阻 `failed`、`:76` 按 `recordStatusByResult`（`:11-17`）映射 `published` / `drafted` / `failed`（UI 调用者 `posts-composer.tsx:95`、`videos-composer.tsx:320`）；③ `PATCH /api/publish-records/[id]` → `updatePublishRecord`（`route.ts:22`），补丁 schema 允许改 `status`（`validation.ts:360-365`），仓内 UI 未见该 PATCH 的调用者。→ 6 值中 `published` / `drafted` / `failed` **有**生产写入路径，`queued` / `running` / `cancelled` 没有（`queued` 只是建表与仓库层默认值）；**C2 的"先写记录、再移状态"语义只在路径 ① 上成立**（见 §7-11） |
| `publish_records.metric_status` | 默认 `pending` | 无集中定义 | 建表 `pending`（`schema.ts:206`） | 指标采集器（`repositories/metrics.ts:177-204`） |
| `chat_tool_calls.status` | `pending` / `running` / `completed` / `failed` | `types.ts:272`（`AgentToolStatus`） | `createAgentToolCall` 默认 `pending`（`repository.ts:866`） | `updateAgentToolCall`（`repository.ts:886-910`）；`/api/agent/schedules` 写 `failed`（`:17`）/ `completed`（`:40`） |
| `agent_runtime_runs.status` | `queued` / `running` / `paused` / `success` / `failed` / `cancelled` | `types.ts:276`（`AgentRunStatus`） | `createAgentRuntimeRun` 默认 `queued`（`repository.ts:926`） | `updateAgentRuntimeRun`（`repository.ts:945-966`） |

三处状态是**联动**的：排程命中 → `schedules.status` 走 `queued`→`running`，`runs.status` 走 `queued`→`running`→终态，排程最后按 run 的终态翻译成自己的 `posted`/`failed`（`scheduler-service.ts:23,42,46,50`）。注意 `runs` 的 `success`/`warning` 在排程里被压成 `posted`/`failed` 二值（`:50`），"warning"这一档在排程视角下会丢失。

## 7. 盘点发现（只报告，未改动任何文件）

1. **没有外键、没有级联，悬空引用是设计而不是事故。** `publish_records.content_item_id` 与 `account_id` 都可空，内容被删后发布记录保留（`schema.ts:193`；`src/lib/publish-facts.ts:38-40` 明确说明"发布确实发生过"）。任何"加外键约束"的想法都会与 C2 冻结语义冲突，需要单独批准。
2. **素材没有表**（§5）：图片/影片的身份是路径字符串，删除内容不会清理文件，也不阻止另一条内容引用同一路径。
3. **排程与内容的关系被写了两遍，而运行时只认 blob 那一份。** `/api/agent/schedules` 同时写列 `content_item_id`（`:36`）和 `params.contentItemId`（`:34`）；`schedulerTick` 只用 `...schedule.params` 造 run（`scheduler-service.ts:37`）；列只有日历读（`calendar.ts:175`）。直接改库只改列，排程执行时看不到。
4. **`runs` 表没有 `content_item_id` 列**，"这次运行发布了哪条内容"只能从 `runs.params.contentItemId` 读（`runner.ts:170`）。`runs.params` 还兼了排程去重键 `_scheduledFor` 与 `_scheduleId`（`scheduler-service.ts:37`）——JSON blob 在承担外键与索引键的角色。
5. **`publish_records.account_name` / `platform` 是快照冗余**（`schema.ts:184-185`）。列表不 join `accounts`，所以改帐号名字不会回填历史记录；这是有意的（记录要描述"当时"），但做"按帐号聚合"时要明确按 `account_id` 而不是按名字。
6. **产品/热点与内容的关联目前只是字符串**（`content_items` 没有任何 `product_id` 列；JSON blob 与 `source_urls_json` 承担了来源表达）。与 `docs/dev-exec-list.md` A06 的"待验证"判断一致。
7. **指标有两份数据**：`publish_records` 上的 `views/likes/…` 是"最新值缓存"，`metric_snapshots` 是时间序列（`schema.ts:197-208` vs `:210-227`）。列表页读前者，趋势图读后者；两者由同一次采集写（`repositories/metrics.ts:177-204` + `:75-115`）。
8. **`accounts.profile_path` 已降级为历史字段**：真正路径由 `accountProfilePath()` 从帐号 id + 当前工作区派生（`paths.ts:50-71`）。备份/恢复时该列会指向旧工作区，不能当作恢复依据（P0-07 关注点）。
9. **JSON blob 共 25 列、跨 17 张表**（§3 的 JSON blob 栏合计 + CI-P7-01 新增的 `ai_usage_ledger.quantity_json` / `pricing_json`）。数据库不校验其内部结构，唯一校验发生在写入方的 zod/手写解析，读旧数据时依赖各处的 `parseJson` 兜底默认值。
10. **`app_settings` 与 `positions.data_json` 是两个"宽表"**：设置与定位档案的主体都不在列里。任何对定位字段的盘点/迁移都要解开 `data_json`（`schema.ts:382`；读写见 `repositories/settings.ts:67-99`、`repositories/positions.ts:32-118`）。
11. **发布事实有两条生产写入路径，而不是"只有一个写入者"（勘误 E1，2026-10-09 修正）。** `createPublishRecord`（`repository.ts:1009-1044`）在全仓有 **4 个生产调用点**，分属两条发布路径：
    - **辅助发布路径（C2，已冻结）**：`recordPublishSuccess`（`src/lib/publish-facts.ts:46`）→ 固定写 `status: "published"`（`:53`），并作第二写把内容移到 `posted`（`:61`）。C2 的"先写记录、再移状态"语义**只在这条路径上**由该模块保证。
    - **自动 / 直接发布路径**：`POST /api/publish`（`src/app/api/publish/route.ts`）三个分支各写一行——`:30` 帐号不存在 → `failed`；`:57` 登录受阻 → `failed`；`:76` 按 `recordStatusByResult`（`:11-17`）把浏览器结果映射为 `published` / `drafted` / `failed`。UI 调用者：`src/components/creation/posts-composer.tsx:95`、`videos-composer.tsx:320`。这条路径**不经过 `recordPublishSuccess`、也不改内容状态**（发布后 `content_items` 不会变 `posted`），两条路径的记录契约因此不同——这正是 P1-04 PE05 的核实范围。
    - **记录管理接口**：`PATCH /api/publish-records/[id]`（`src/app/api/publish-records/[id]/route.ts:22`）调用 `updatePublishRecord`（`repository.ts:1046-1062`），补丁 schema 允许改 `status`（`validation.ts:360-365`）；仓内 UI 未见该 PATCH 的调用者（记录页只有列表与删除）。→ **"`updatePublishRecord` 没有生产调用方"的原结论不成立。**
    - **取值覆盖**：`published` / `drafted` / `failed` 有生产写入路径；`queued` / `running` / `cancelled` 没有（`queued` 只是建表 `schema.ts:188` 与仓库层默认值 `repository.ts:1033`）。
    - **仍然成立的部分**：后续自动发布（P1-04 PE05）若改用别的方式写记录，会直接破坏 C2 的"先写记录、再移状态"语义，必须先单独申请范围；另外 `POST /api/publish` 目前**没有路由级测试**（`src/app/api/publish/` 下只有 `draft` / `verify` 的 `route.test.ts`）。
    - **修正说明（保留可追溯性）**：原文为"`createPublishRecord` 的唯一调用方是 `recordPublishSuccess`；`publishRecordStatuses` 里的 `queued` / `running` / `drafted` / `failed` / `cancelled` 没有生产写入路径；`updatePublishRecord` 也没有调用方"。该结论只在**辅助发布路径**上成立，作为全局事实不准确。P0-08 勘误 E1（2026-10-09）按源码修正本节与 §6 的对应行，**只改本文档，未改源码 / 数据库 / 配置 / 冻结契约**。

## 8. 本文档与后续阶段的关系

| 后续阶段 | 用本文档的哪一节 |
| --- | --- |
| P1-01 统一 Asset 素材管理（A01～A10） | §5（素材没有表、身份是路径）、§7-2、§7-9 |
| P1-02 草稿状态与保存一致性（D01～D04） | §6 的 `content_items.status` 行、§4-R7 |
| P1-03 Draft Evidence / P1-04 Publish Evidence（DE/PE） | §4-R6～R8、§6 的 `publish_records.*` 行 |
| P1-04 PE05 自动发布独立核实 | §7-1、§7-3、§7-4、§7-11 |
| P0-06 Agent 执行基础 | §3.5、§4-R11/R12 |
| P0-07 备份与恢复 | §5 的目录表（数据库文件必须与 `dataRoot` 下各目录一起备份）、§7-8 |

## 9. 停止边界

- 本次**只读**：新增的只有本文件，未新增字段、未做迁移、未改任何代码、未删任何数据。
- 本文档不包含：性能与索引分析、迁移方案、外键设计建议、素材表设计（属于 P1-01）。
- 若后续任务需要改数据库结构，必须先按 `docs/dev-exec-list.md` §十一.2 的规定停止并单独申请。

## 10. 子阶段冻结记录（P0-02）

- 子阶段 ID：P0-02
- 子阶段名称：盘点核心业务数据模型
- 完成日期：2026-10-09
- 最终 Commit：**未提交**。工作区已存在用户既有的 P5-C2 / C2-1a 未提交改动，本次不代为提交；本次新增仅本文件，另有 `docs/dev-exec-list.md` 的三处状态回填。
- 修改文件：
  - `docs/data-model-inventory.md`（新增）：本卡的唯一交付物。
  - `docs/dev-exec-list.md`（3 处）：§四 表 P0-02 状态改为「已完成」并给出证据、§四 P0-02 卡片状态行同步、§十 队列第 1 行状态改为 `P0-01/02/03/04/05 已完成`。
- 行为变化：**无**。没有改源码、没有改数据库、没有改配置。
- 数据库变更：无（§十三 停止边界：不新增字段、不做迁移）。
- 配置变更：无。
- 测试命令与结果（§三 的直连二进制）：
  - `node_modules\.bin\tsc.cmd --noEmit` → `TSC_EXIT=0`（无类型错误）。
  - `node_modules\.bin\vitest.cmd run` → **88 个测试文件 / 574 个用例全部通过**（15.57s）。
  - `node_modules\.bin\eslint.cmd .` → **0 error / 1 warning**；唯一告警在 `src/components/agent-chat/chat-conversation.tsx:146`（`react-hooks/exhaustive-deps`），该文件本次未触碰、也不在工作区改动列表中，属既有告警。
- 人工验收结果：**待产品负责人确认**。工具侧自检已按 §十一.4 完成（每张表有用途一句话、关键关系带 `file:line` 证据、只读）。
- 未解决问题（记录，不在本卡修）：
  1. `publish_records.status` 的 6 个取值里，`published` / `drafted` / `failed` 有生产写入路径，`queued` / `running` / `cancelled` 没有（勘误 E1 修正后的口径，§7-11）。
  2. `schedules.content_item_id` 与 `params.contentItemId` 双写，运行时只认后者（§7-3）。
  3. 素材没有独立表，「身份」只是路径字符串（§5、§7-2）。
  4. `runs` 表没有 `content_item_id` 列，关系藏在 JSON blob 里（§7-4）。
  5. 自动发布路径的状态写入尚未独立核实（转 P1-04 PE05）。
- 勘误修正记录（E1，2026-10-09）：§6 `publish_records.status` 行与 §7-11 的"发布事实只有一个写入者"结论已按源码修正（`createPublishRecord` **4 个生产调用点**、`updatePublishRecord` **有**生产调用方，见 §7-11）；原始结论以"修正说明"保留在 §7-11 末尾以维持可追溯性；本次**只读源码**，未改代码 / 数据库 / 配置 / 冻结契约，也未重排本文件条目编号。
- 明确不包含的工作：Asset 表设计、外键/索引设计、迁移方案、性能分析、自动发布核实。
- 冻结边界：本文件**只描述现状**。后续任何任务不得据本文件直接改表结构或加约束；§5/§7 列出的问题属于 P1-01/P1-04 的范围。
- 下一阶段前置条件：产品负责人确认 P0-02 后，按 `docs/dev-exec-list.md` §十 执行 **P0-06（第一优先）**，其结论必须回填 §六 P2 的状态列。
