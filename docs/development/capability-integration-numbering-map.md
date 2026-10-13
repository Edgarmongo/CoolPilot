# 新旧开发清单编号对照与工作区基线（2026-10-10）

> **用途**：在两份开发清单并存期间，保证历史交付记录（引用 `CI-P*-**` 编号）与最新清单（引用 `P*-**` 编号）可以互相追索，并固定本轮开始时的未提交工作，避免被清理或覆盖。
>
> **本文件只记录事实与对照**，不改写任何一份清单，也不改业务代码。

## 1. 工作区基线（保护记录）

| 项 | 实测值 |
| --- | --- |
| 分支 | `main` |
| HEAD | `3b48126b34ec4472f8b1ee904f651d35b30b3072`（自建立本记录起未移动） |
| 与 `origin/main` 的关系 | 落后 **0** / 领先 **35**（`git rev-list --left-right --count origin/main...HEAD` → `0 35`） |
| 暂存区 | **空**（`git diff --cached --shortstat` 无输出） |
| stash | **空**（`git stash list` 无输出） |
| 未提交条目 | **214** = 已修改 **82** + 未跟踪 **132**（无删除、无重命名） |
| 相对 HEAD 的差异 | `82 files changed, 6772 insertions(+), 370 deletions(-)`（**不含** 132 个未跟踪文件的内容） |
| 未跟踪内容分布 | `src/lib` 30、`src/app` 14、`src/components` 11、`src/db` 8、`src/features` 2、`docs/*.md` 若干，以及仓库根目录约 **30 个 `tmp-*` 中间文件**（`tmp-e2e-baseline*`、`tmp-p1-0*`、`tmp-probe-*`、`tmp-vitest-*`、`tmp-tools-live-probe.ps1` 等；`.gitignore` 目前**不忽略**它们） |

**保护承诺（默认长期遵守）**：不 `git add`、不 `git commit`、不 `git stash`、不 `git checkout -- .`、不 `git clean`、不删除或覆盖上述任何条目。需要落盘检查点时，先取得明确授权。

> 重新生成基线：`git status --porcelain | ForEach-Object { $_.Substring(0,2) } | Group-Object`；`git --no-pager diff --shortstat HEAD`；`git rev-list --left-right --count origin/main...HEAD`。

## 2. 两份清单的关系与正文完整性

| 文件 | 来源 | 编号 | 状态 |
| --- | --- | --- | --- |
| `docs/coolpilot-capability-integration-plan.md` | 仓库现有主线（8 个开源项目） | `CI-P0-01` … `CI-P7-05` | **完整**：含 §0 命名空间与冻结边界、§1 任务状态表、§附录 A-1…A-3、B-1…B-11 交付记录。**不得覆盖、不得删除其历史证据** |
| `docs/development/CoolPilot-开发清单-10个开源项目整合版.md` | 最新版清单（标题仍写 10 个参考项目，索引表实际 **11 行**） | `P0-01` … `P8-07` | **2026-10-10 已入库**（867 行 / 53,584 字节，SHA256 `CD12B742…01A9`，与作者原件字节一致，完整性核对**通过**，见 2.1）；**同日按作者指令追加 Anki**（§零 第 11 行 + 文末附录 Z）→ 现为 **1,022 行 / 69,043 字节 / SHA256 `16D8B698…B7BF`**，相对原件是**纯插入（+155 行 / −0 行）**，**不再字节一致**（见 2.2）；原件未被改动 |

### 2.1 正文完整性检查结果：**通过（2026-10-10 复核）**

作者已把完整正文放进仓库，本次按下表核对，结论为**通过**：

| 核对项 | 实测 |
| --- | --- |
| 来源 | `docs/CoolPilot-开发清单-10个开源项目整合版_2.md`（作者原件，**未移动、未删除**） |
| 入库 | `docs/development/CoolPilot-开发清单-10个开源项目整合版.md` |
| 规模 | **867 行 / 53,584 字节 / 24,238 字符** |
| 字节一致性 | 原件与入库件 SHA256 均为 `CD12B742E4B14C33D0416E70A2D2C58B85837CE6A65EA374D418B0B3C05B01A9` → **字节级拷贝，零改写** |
| 卡片编号连续性 | P0-01…06、P1-01…05、P2-01…06、P3-01…03、P4-01…07、P5-01…06、P6-01…04、P7-01…03、P8-01…07 **全部出现且无缺口** |
| 章节完整性 | 零（索引）、一（阶段）、二 P0、三 P1、四 P2、五 P3、六 P4、七 P5、八 P6、九 P7、九-A P8（含 P8-07 的 5 个子项与「不在本项范围内」）、十、十一、十二 **全部存在** |
| 截断/占位痕迹 | 无 `truncated`、空节等痕迹；全文以完整句子结尾（第 867 行） |

**历史记录（保留，不删）**：上一轮经消息传输时，正文在 `P2-03` 之后被工具截断约 13,580 字符（缺 P3–P8-06 中段），当时按「不得根据残缺文本补造」**拒绝写入**；本次改为**直接读仓库内文件**核对，不再经消息传输。

### 2.2 2026-10-10 追加 Anki 参考条目（本次，**纯插入**）

| 核对项 | 实测 |
| --- | --- |
| 追加内容 | §零 索引表**新增第 11 行 `Anki（扩展参考）`**；索引表下新增「本表口径」说明；文末新增 **`附录 Z：Anki 设计借鉴条目（A1–A7）`**（含 Z.1 逐项核查状态、Z.2 的 A1–A7、Z.3 速查表、Z.4 与既有十项的关系、Z.5 下一步） |
| 是否改写原文 | **否**：`git --no-pager diff --no-index --numstat` 实测 **`155 0`**（+155 行 / −0 行）；原有 10 行索引、`### Cline 使用这些参考项目的规则` 5 条、§一–§十二 全文与既有结构**一字未改** |
| 追加后规模 | **1,022 行 / 69,043 字节 / SHA256 `16D8B698458995B7FC7CE970D73012F8C1A8DE365F7B4B6691DEB7A62132B7BF`**；行尾仍为 **LF（CRLF=0）**、无 BOM |
| 作者原件 | `docs/CoolPilot-开发清单-10个开源项目整合版_2.md` 仍为 **867 行 / 53,584 字节 / SHA256 `CD12B742…01A9`**，**未移动、未删除、未修改** |
| 保留的既有口径差异 | 文档名与 §零 标题仍写「10 个」而索引为 11 行（第 10 行 Spanlens、第 11 行 Anki 均自标「扩展参考」）；§十二 执行指令原文仍写「原有 8 个来源、ego-lite 和 erxes」。**不自行裁决**，见 §5 |
| 未做的事 | 未改任何业务代码、未新增表 / 迁移、未改卡片编号与状态、**未**执行 `git add` / `commit` / `reset` / `clean` |

> 复测命令（注意本机陷阱：`Get-Content` 默认编码会把该文件读成 371 行，**必须加 `-Encoding UTF8`** 才是真实的 867 → 1,022 行）：
> ```powershell
> $f='docs\development\CoolPilot-开发清单-10个开源项目整合版.md'
> $b=[System.IO.File]::ReadAllBytes((Resolve-Path $f).Path)
> $t=[System.Text.Encoding]::UTF8.GetString($b)
> "$($b.Length) bytes, LF=$(([regex]::Matches($t,"`n")).Count), CRLF=$(([regex]::Matches($t,"`r`n")).Count)"
> (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash
> git --no-pager diff --no-index --numstat -- 'docs/CoolPilot-开发清单-10个开源项目整合版_2.md' $f
> ```

## 3. 新旧编号对照表（含仓库**真实**完成状态）

状态列同时给出**主线 §1 任务状态表的登记值**与本次实测依据；两者不一致时按下文 §4 的规则**报告差异，不自行裁决、不改主线文件**。

| 最新清单卡片 | 旧编号（主线） | 主线 §1 登记状态 | 实测依据 / 备注 |
| --- | --- | --- | --- |
| P0-01 … P0-06 | `CI-P0-01` … `CI-P0-06` | **done** | 主线 §附录 A-1 / A-2 / A-3；`docs/coolpilot-integration-contracts.md` §1–§3 |
| P1-01 统一媒体产物管理 | `CI-P1-01` | **done** | §附录 B-1 |
| P1-02 统一长任务管理 | `CI-P1-02` | **done** | §附录 B-2 |
| P1-03 统一媒体工具注册 | `CI-P1-03` | **done** | §附录 B-3 |
| P1-04 定义视频模板与渲染任务 | `CI-P1-04` | **done**（子项 **`CI-P1-04-07`** 于 2026-10-12 补登：视频渲染**面板** + 两个**读取**路由；子项**不占**一级卡号、主线 §1 未改，见 §23） | §附录 B-4（4 条已知限制中**已知限制 3 已由 `CI-P1-04-07` 关闭**；补登记录见 §附录 B-4 §8） |
| **P1-05 工作流编排内核（erxes）** | **无** | —（新清单新增） | 新清单 §三 第 193–209 行 |
| P2-01 选题管理 | `CI-P2-01` | **done** | §附录 B-5 |
| P2-02 品牌资料管理 | `CI-P2-02` | **done** | §附录 B-6 |
| P2-03 整合文章创作流程 | `CI-P2-03` | **done**（含 2 项部分完成） | §附录 B-7 §4 |
| P2-04 内容生命周期与日历 | `CI-P2-04` | **done**（本轮交付，见 §4.3） | §4.3 证据表 + 主线 §5 本卡交付记录 |
| P2-05 多平台内容模型 | `CI-P2-05` | **done（仅模型与 API 契约；无 UI 消费者、无真实 HTTP 冒烟，见 §4.4）** | 主线 §1 第 **49** 行（本表原记「第 47 行」为位移前旧值）+ §4.4 证据表 |
| **P2-06 创作者资料与内容分群（erxes）** | **无** | —（新清单新增） | 新清单 §四 第 275–291 行 |
| **P2-07 多平台内容版本管理 UI（我方实现层补充，清单无对应条目）** | **`CI-P2-07`** | **done**（2026-10-12 按作者授权修正：本表原记 `todo` 为 2026-10-10 立项时的旧值，与主线 §1 第 50 行的 `done` 不一致；交付事实见 §4.5、主线 §15。**本次只改该状态字段**，未动历史行号与其它差异） | `CI-P2-05` 的**界面消费者**；`CI-P2-06` 已被清单 §四 第 279 行占用，故取下一空位 |
| **营销线索与成交（我方实现层补充，清单无对应条目）** | **`CI-LEAD-01`** | **done**（2026-10-12 作者直派立项；作者原给建议编号 `CI-P2-06A`，全仓冲突核验后改取**独立支线** `CI-LEAD-*`，理由见 **§24**） | 清单里**没有**对应条目（**非 8 个开源项目来源**）；只新增 `marketing_leads` 一张本地表，内容/发布关系复用 `content_items` / `publish_records` |
| P3-01 研究素材管理 | `CI-P3-01` | **done** | §附录 B-8 |
| P3-02 转写与摘要 | `CI-P3-02` | **done**（主卡曾 `partial`，B-10 收尾） | §附录 B-9 / B-10 |
| P3-03 研究结果进入创作 | `CI-P3-03` | **done**（RAG 预留按计划不做） | §附录 B-10 |
| P4-01 … P4-04 | `CI-P4-01` … `CI-P4-04` | **todo** | 主线 §1 第 50 行 |
| **P4-05 扩展与插件契约（erxes）** | **无** | —（新清单新增） | 新清单 §六 第 396–414 行 |
| **P4-06 Agent Workspace 与并行任务隔离（ego-lite）** | **无** | —（新清单新增） | 新清单 §六 第 416–432 行 |
| **P4-07 可复用 Skill 与执行经验沉淀（ego-lite）** | **无** | —（新清单新增） | 新清单 §六 第 434–448 行 |
| P5-01 … P5-03 三条业务闭环 | `CI-P5-01` … `CI-P5-03` | **in_progress** | 阶段 1 基线 `docs/e2e-baseline-inventory.md` |
| P5-04 Agent 自动化闭环 | `CI-P5-04` | **todo** | 主线 §1 第 52 行 |
| **P5-05 工作流业务闭环 / P5-06 扩展包导入导出** | **无** | —（新清单新增） | 新清单 §七 第 507–528 行 |
| P6-01 … P6-04 | `CI-P6-01` … `CI-P6-04` | **todo** | 主线 §1 第 53 行 |
| **P7-01 … P7-03 Marketplace 生态** | **无** | —（新清单新增） | 旧主线**没有** Marketplace 阶段，见下方「编号错位」 |
| **P8-01 统一 AI 使用账本与采集器** | **`CI-P7-01`** | **`in_progress`**（账本底座、14/14 调用点、价格目录录入入口均已落地；只差用户录价） | 主线 §1 第 54 行 + §附录 B-11；详见 §4 |
| **P8-02 一级菜单与成本总览** | `CI-P7-02` | **`in_progress`**（菜单改名 + 成本总览首屏已落地，见 §4.1；同卡的调用明细/追溯归 P8-03，未开工） | 主线 §13 第 418–425 行；**菜单改名与首个真实费用界面同卡交付，不可拆**（§13 第 405 行） |
| P8-03 全链路调用明细与业务归因 | `CI-P7-02-04` / `CI-P7-02-05` | **`done`**（调用明细 + 追溯 + 单篇内容成本已落地，见 §4.2；导出与「产物是否被采用」不在本卡范围） | 旧 P7-02 一卡含新 P8-02+P8-03，属粒度差异 |
| P8-04 生成前成本预估与预算控制 | `CI-P7-03` | **`done`**（预估层 + 自然月预算 + 请求发出前闸门 + 执行中预留已落地并实测；`P7-03-04` 三种执行策略**未交付**、暂停/恢复是「终止 + 重跑」、并发仅 `in-process-soft`，逐条记录见主线 **§附录 D**，卡体仍为 §13 第 442–447 行） | 主线 §13 第 **442–447** 行（原卡无「完成标准」行）；完成标准来源 = 作者裁定稿 `docs/development/ci-p7-03-design-draft.md` §2；**行号更正（2026-10-10，经作者授权）**：本表原记「427–432」、主线 §附录原记「第 433 行起」、本文档 §4.4 原记「实际标题行 437」，三者均为插入交付记录前的过期行号，实测块为 **442–447**、标题行 **442**（本次交付记录落在**文件末尾的 §附录 D**，**未插入 §13**，因此上述行号**保持不变**）；本卡期间曾把仓库根 `tmp-*` 整批误删（**60** 个：**38** 个此前各卡的取证文件已按 Cline 检查点快照 `981594f` 逐字节还原并验证，**22** 个为本任务自身临时产物、未恢复且无文档引用），详见主线 §附录 D「工作区操作事故与恢复」 |
| P8-05 质量指标与成本优化建议 | `CI-P7-04` | **`done`**（2026-10-11 交付并实测：真实质量 / 成本读数 + 单位合格产出成本（目标函数）+ 可解释建议 + 一键应用「执行档位」；`人工修改幅度` 的「幅度」在本安装中**不存在记录**，页面按「无法计量」如实呈现；**未**跑浏览器渲染验证，逐条记录见主线 **§附录 L** 与本文档 §14） | 主线 §13 第 **465–469** 行（标题行 **465**）；**行号更正（2026-10-11）**：本表原记「434–438」，系插入 `CI-P7-02` 交付记录行与 `CI-P2-07` 行之前的过期值，实测为 465–469 |
| P8-06 覆盖所有 AI 能力与扩展契约 | `CI-P7-05` | **部分就绪**（`metered_kind` + `quantity_json` 表/键/计价函数已在，缺非文本维度录价表单；**`CI-P7-05-02`（Agent / Workflow 节点级调用记录 + 运行总成本 + 失败 / 重试成本）已于 2026-10-11 交付并实测**，见主线 **§附录 M** 与本文档 **§15**；**`CI-P7-05-03`（Marketplace 扩展的扩展标识 / 任务标识与调用费用归属）已于 2026-10-11 交付并实测**：账本新增 `extension_id`、归属规则收敛到单一裁决点（已上架 position 清单 > 目录 agent > `''`）、成本中心新增按扩展的费用明细与筛选，见主线 **§附录 N** 与本文档 **§16**；**`CI-P7-05-04`（无法准确计量的服务必须**显式标记**，而不是漏记）已于 2026-10-11 交付并实测**：**不新增列、不回填**——`src/lib/ai-metering.ts` 的 `meteringReasonFor()` 只读行内既有证据（`outcome` / `completeness` / 价格快照 / 用量单位）派生 10 条原因，成本中心新增「未述明原因」列与**六维度恒列出的「计量覆盖」表**（video / embedding `no-runtime-path`、agent 按 text 行计量、真实库 image 1 行为 `quantity-unit-mismatch`），见主线 **§附录 P** 与本文档 **§18**；`-01` **未交付**） | 主线 B-11 §7 第 3 条 + 主线 §13 第 **471–476** 行（`CI-P7-05` 卡体，行号本轮实测） |
| **P8-07 可观测性 / Trace / 评估（Spanlens）** | **无** | —（新清单新增） | 新清单 §九-A 第 696–743 行（含 5 个子项） |

**编号错位（必须注意）**：旧主线的 `CI-P7` = **成本与质量优化中心**，对应新清单的 **P8**；新清单的 **P7** = **Marketplace 生态**，旧主线**没有**这个阶段（旧编号 `CI-P7-05` 里出现的「Marketplace」只是成本覆盖范围的一小项）。引用历史交付记录时，看到 `CI-P7-*` 一律按「新 P8-*」读，不要当成 Marketplace。

## 4. P8-01（= CI-P7-01）状态：主线登记 `in_progress`，实测底座已落地

> **差异先报告（按项目规则不自行裁决）**：主线 §1 第 54 行把 `CI-P7-01` 登记为 **`in_progress`**，同一行给出的理由是——「账本底座、**14/14 调用点**与**价格目录录入入口**均已落地；账本要报出金额只差用户录入价格」。本文件上一版把 P8-01 写成「已完成」，属**本文档与主线的表述差异**，现按主线口径更正为 `in_progress`；实测证据并列如下，供作者判定是否该翻成 `done`（**本文档不改主线文件**）。

`P8-01 统一使用账本与采集器` 对应仓库的 `CI-P7-01`。以下为**实测**（以代码为准）：

| 要件 | 证据 |
| --- | --- |
| 账本表 | `src/db/schema.ts:508`（`ai_usage_ledger`，一次模型尝试一行，含失败与重试） |
| 价格目录表 | `src/db/schema.ts:564`（`ai_model_prices`，只增不改；含 `metered_kind` / `unit_price` / `unit_label` / `declared_free`） |
| 纯函数层 | `src/lib/ai-usage-ledger.ts`（P8-01 时 35 例；P8-02 增补 `byCostSource`/`costByCurrency`/`byDay` 后为 39 例；P8-03 增补调用明细/分组/追溯读法后为 **48 例**） |
| 写入器 | `src/lib/ai-usage-ledger-recorder.ts`（7 例） |
| 接入现有 AI Runtime（P8-01 明确要求） | **通过 AI Runtime 接入，实测 14 个 `AiUsageCallContext` 归因点**（13 个文件；`src/lib/scraper.ts` 两处），生产侧 `recordAiUsageCall(` 调用点 15（多出的 2 处是 `image-generation` 与 `scraper` 的失败路径补记） |
| 价格目录录入入口 | `src/app/api/models/prices/route.ts`、`src/components/system/model-price-panel.tsx`，页签接线见 `src/app/[locale]/(console)/system/models/page.tsx:3-9` |
| 唯一键扩维迁移 | `migrateAiModelPriceCatalog`（`src/db/client.ts`，含 `addedColumns` / `droppedIndexes` / `indexRebuilt` 三态报告） |
| 验证结果 | 上一轮全量：eslint exit 0、`tsc --noEmit` exit 0、**132 文件 / 996 用例全通过** |

> **新清单 §十 的顺序表已滞后于仓库实际状态**：其第 1–9 项（P0-01…P0-06、P8-01、P1-01…P1-03、P2-01/P2-02、P3-01…P3-03、P2-03）在主线中均为 `done` / `in_progress`（§3 已逐行标注）。按该顺序逐项走，**第一张真正未开工的卡是第 9 项 `P2-04` / `P2-05`**（第 10–14 项里 P1-04 也是 `done`）。
>
> 由此存在**两条并行且互不阻塞**的候选下一张卡（主线 §附录 B-11 §7 第 2、4 条自己就是这么写的）：
>
> * **P8-02（= CI-P7-02）一级菜单与成本总览**：一级菜单改名与第一个真实费用界面**同卡交付、不可拆**（主线 §13 第 405 行、B-11 §7 第 2 条）。
> * **P2-04（= CI-P2-04）内容生命周期与日历**：既有主线的下一项（B-11 §7 第 4 条、主线 §10 顺序表第 8 项）。
>
> 两者都未开工，需作者指定其一；按项目规则「一次只做一张卡」，**不并行开工**。

## 4.1 P8-02（= CI-P7-02）状态：菜单改名与成本总览同卡交付（本次）

主线 §1（`CI-P7-02` 行）与 §13 第 418–425 行仍把该卡登记为 `todo`；本轮按 §13 第 405 行「菜单改名与第一个真实的费用界面**同卡交付**」执行，交付范围 = `CI-P7-02-01 / 02 / 03 / 06`；`CI-P7-02-04 / 05`（调用明细与追溯）属 §3 第 78 行的 **P8-03**，仍未开工。**本文档不改主线文件**，差异在此并列，供作者裁定。

| 要件 | 证据（以代码为准） |
| --- | --- |
| 一级菜单改名（P7-02-01） | `src/components/console-layout-shell.tsx:193`：`navAiCostCenter` → `/system/cost-center`，图标 `WalletCards`（替换原「用量统计 / `BarChart3`」，该图标导入已删除）。**叶子数与子项顺序不变**，故移动端「系统」页签落点仍是 `/system/models` |
| 顶部概览卡片 + 二级导航（P7-02-01） | `src/components/cost-center/cost-center-client.tsx`：页签 `overview` / `calls` / `budget` / `quality`（成本总览 / 调用明细 / 预算与预估 / 质量与优化）。未开工的三个页签只写「未开工 + 对应卡片号」，**不画占位数字**；路由 `src/app/[locale]/(console)/system/cost-center/page.tsx` 以 `resolveTab` 解析 `?tab=`，缺省 `overview` |
| 成本总览（P7-02-02） | 同文件：**按币种分别列出**的 API 成本、账本 token、成功交付产出、单篇平均成本、`cost_source` 四态计数、按 `purpose` 与模型的分解、按本机日历日的趋势、价格目录覆盖 |
| 业务产出降级为辅助指标（P7-02-03） | 同文件末张卡片保留旧「用量统计」口径：文章数 / 累计字数 / 篇均字数 + 按模型表（数值来自 `usage_records` 视图，**不并入成本口径**） |
| 措辞纪律（P7-02-06） | `costCenterIntro`（三语）明写「用户自带 API Key 时，这些金额是按供应商用量核算的估算，不是 CoolPilot 的实际扣款」；金额一律以 `provider-reported` / `computed` / `unpriced` / `unknown` 命名来源，`computed` 不表述为供应商实收 |
| 金额不跨币种相加 | 类型 `AiUsageLedgerCurrencyTotal` + `summarizeLedgerCurrencies()`（`src/lib/ai-usage-ledger.ts`）；页面按币种成列，本机无汇率故不做换算；分组表（`purpose` / 模型）**忽略币种**并已标注「仅供比较，不加总」 |
| 旧路径不 404 | `src/app/[locale]/(console)/system/usage/page.tsx` 改为 `redirect()` 到 `/system/cost-center`；旧指标不丢弃，改由成本中心页承载 |
| 只读数据通道 | `src/app/api/ai-cost-center/route.ts`（GET、`runtime = "nodejs"`、`dynamic = "force-dynamic"`）：一次请求返回**同一窗口**的账本视图 + `usage_records` 视图 + 价格目录覆盖（`pricedKinds` 由 `markInForceModelPrices` 服务端计算，未生效价格不计入）。不写库；响应不含凭据与完整提示词 |
| 验证结果（本轮实跑） | `tsc --noEmit` → exit 0（修复缺陷后复跑仍 0）；`vitest run src/lib/ai-usage-ledger.test.ts src/app/api/ai-cost-center/route.test.ts` → **43 用例全通过**（39 单测 + 4 路由）；`vitest run src/lib/i18n-coverage.test.ts` → 3 用例通过（三语键集对齐）；全量 `vitest run` → **133 文件 / 1004 用例全通过**（exit 0）；`eslint .` → 除既有 `tmp-probe-*.cjs`（2026-10-09 遗留的未追踪探针脚本，非本卡产物）3 个 error 与 `chat-conversation.tsx` 1 个既有 warning 外，**无新增问题** |
| 开发态实测（dev server `:3000`，**非打包产物**） | `/zh-cn`、`/zh-hk`、`/en` 的 `/system/cost-center` 均 **200**；`?tab=calls` 与非法 `?tab=bogus`（回落 `overview`）均 200；`/zh-cn/system/usage` → **307**，`location: /zh-cn/system/cost-center`；服务端渲染出的 HTML 内含「成本总览」「用量统计」与措辞纪律句「不是 CoolPilot 的实际扣款」（`id="__next_error__"` 不存在）；同日志内浏览器侧 `GET /api/ai-cost-center?range=7` → **200**。**打包版 Electron 未验证**（本机未产出安装包） |
| 本轮实测抓到并修复的运行期缺陷 | 服务端组件从 `"use client"` 模块导入**运行期**数组只会拿到 client reference → `costCenterTabs.find is not a function`，dev server 对 `/system/cost-center` 返回 **500**，而 `tsc` 与单测都发现不了（类型层面仍是 `readonly CostCenterTab[]`）。已按 `system/models/page.tsx` 的既有写法改为「页面自带 `?tab=` 校验清单 + 客户端本地渲染清单」，客户端不再导出该数组；修复后 dev server 三语 200（见上一行）。**教训：本卡只靠 `tsc` + 单测不足以证明页面可渲染，必须实跑一次路由。** |
| 本卡遗留（可延后，非阻塞） | `provider-reported` 暂无写入者（§7 第 5 条）→ 页面只能出现 `computed` / `unpriced`；非文本计量维度无录价表单（§7 第 6 条）→ 图片/视频/语音/Embedding 恒为 `unpriced`；`duration_ms` 恒为 0（§7 第 7 条）→ **不做「耗时」列**；打包版 Electron 界面**未验证**（本轮做到 dev server 三语实测 + `tsc` / `vitest` / `eslint`，未产出安装包；菜单在打包产物里的呈现与路由行为仍待打包验证） |


<!-- P8-03-SECTION -->

## 4.2 P8-03（= CI-P7-02-04 / 05）状态：调用明细与业务归因（本次）

交付范围 = **`CI-P7-02-04`（一次调用一行）+ `CI-P7-02-05`（内容 → 业务任务 → 执行节点 → 模型调用 + 单篇内容成本）**，即 §3 第 78 行那一张卡，也是 §4.1 里 P8-02 未做完的那一半。`CI-P7-02-06` 的措辞纪律在本页同样成立（每一行的金额都标明来源，`computed` 不表述为供应商实收）。**未做**：账本导出（新清单 P8-03 第 5 条）与「产物是否被采用 / 人工修改 / 质量检查」结果信号（属 P8-05 / P8-07），见 §7。

| 要件 | 证据（以代码为准） |
| --- | --- |
| 一次调用一行（P7-02-04） | `src/app/api/ai-cost-center/calls/route.ts`：每次**请求**一行，失败与重试同样单独成行；列含实际 `provider_id` / `model_id` / `endpoint_id` / 掩码 `credential_label` / 状态 / 用量完整度 / `cost_source` / 金额。**重试不并入赢家**：`parentUsageId` 链把同一次调用的每个请求各自成行 |
| 重试类型不靠序号推断（纪律） | `classifyCallRetry()`（`src/lib/ai-usage-ledger.ts:509` 起）：读**前一行的 `outcome`**——前行成功 → `self-correction`；前行未成功 → `after-failed-request`；前行不在扫描窗口内 → `unresolved-predecessor`（**不猜**）。`attemptIndex > 0` 但无 `parentUsageId` 也归为 `unresolved-predecessor`。差异只报**事实**（`provider` / `model` / `endpoint` / `credential` 是否变化），不报原因 |
| 整次调用的金额含重试 | `summarizeLedgerCallGroup()` + 页签「所属调用」栏：`{attempts, failedRequests, index}` 与按币种金额；只要有一次请求无法给出金额即标为下界（`≥`） |
| 内容 → 业务任务 → 执行节点 → 模型调用（P7-02-05） | `buildTrace()`：`contentItemId` → 既有 `getContentItem()`；`taskId`（回退 `runId`）→ **既有任务库** `findTaskView()`（`playbook` / `agent` / `schedule`）；`nodeId` / `outputAssetId` 按记录原样展示。解析不到就写「解析不到」：内容不存在 → `found: false`；任务解析不到 → `task: null`；`''` 的内容归属**单独成组、不丢弃** |
| 单篇内容成本（P7-02-05） | `summarizeLedgerByContent()`：按内容分组（`''` = 未归类），金额**按币种**分列、未定价与未测量分别计数、有一次不能给出即标下界；同时列出该内容关联的任务 id 与节点名 |
| 只读且不泄密 | 路由无写操作；响应里只有掩码密钥标签（`****0002`），无 prompt / response / 真实凭据；`scan.truncated`、`scan.traceCapped` 明示「扫描上限」与「关联解析上限」 |
| 复用既有架构 | 只走既有 `listAiUsageLedgerEntries()`（未改建表、未新建账本）、既有 `content_items` 与任务库；**未引入云端代理、未改 AI Runtime、未新增数据库依赖** |
| 验证结果（本轮实跑） | `tsc --noEmit` → exit 0；`vitest run src/lib/ai-usage-ledger.test.ts src/app/api/ai-cost-center/calls/route.test.ts` → **52 用例全通过**（48 纯函数 + 4 路由）；全量 `vitest run` → **134 文件 / 1017 用例全通过**；`eslint .` → 仍只有既有 3 个 `tmp-probe-*.cjs` error 与 `chat-conversation.tsx` 1 个 warning（**无新增问题**） |
| 开发态实测（dev server `:3000`，**非打包产物**） | `/zh-cn`、`/zh-hk`、`/en` 的 `/system/cost-center?tab=calls` 均 **200**（SSR HTML 含新页签文案，无 `__next_error__`）；`/api/ai-cost-center/calls?range=7` → **200**（`limit` 缺省 25、`matched=0`、`scan.truncated=false`）；带 `purpose/limit/offset/retry/outcome/source` 的请求 200；`/zh-cn/system/usage` → **307** 到 cost-center（旧路径无回归） |
| 浏览器实测（Playwright，**非打包产物**） | 以**真实路由产出的 payload**（临时库：失败 → 成功 → 自纠，共 3 次请求）渲染 `/zh-cn/system/cost-center?tab=calls`：内容标题、「自纠重试」、「前一次请求未成功后的重试」、「≥ CNY 0.75」下界、「未定价」徽标均进入 DOM；展开详情后「业务归因 / 任务 `playbook · research_extraction` / 节点 `planner` / 本行没有价格快照 / 耗时未测量 / 掩码密钥」全部渲染，`pageerror` 为空，控制台错误为 0。**行渲染是被真实跑过的，不是推断的** |
| 本轮实测抓到并修复的缺陷 | `readCount()` 用 `Number(null)` 判缺省 → **缺省 `limit` 被当成 0、再被夹成 1 行**（裸 `?range=7` 只返回 1 条）。路由测试断言「3 行」时暴露，已改为「先判空再转数」（`route.ts:101`）。**教训：默认值这类缺陷 `tsc` 看不见，只有真发一次请求才发现** |
| 本卡遗留（可延后，非阻塞） | ① `duration_ms` 恒为 0 → 「耗时」只能显示「未测量」，本轮**不给单个请求加计时**（不改 AI Runtime，见 §7 第 7 条）；② 账本导出未做；③「产物是否被采用 / 人工修改 / 质量检查」结果信号未做（属 P8-05 / P8-07）；④ 打包版 Electron 界面**未验证**（本机未产出安装包） |

## 4.3 P2-04（= CI-P2-04）状态：内容生命周期与日历（本轮交付）

主线 §1 第 46 行原把 `CI-P2-04…CI-P2-05` 合并登记为 `todo`；本卡交付后已拆成两行（`CI-P2-04` = `done`，`CI-P2-05` 仍 `todo`），并在 §5 追加一行交付记录。**需求条目本身一字未改。**

| 要件 | 证据（以代码为准） |
| --- | --- |
| 盘点现有状态与发布记录（P2-04-01） | 四套既有词表原样复用、**未新增表/列/迁移**：`content_items.status`（`draft`/`ready`/`posted`/`failed`）、`schedules.status` + `enabled`、`runs.status`、`publish_records.status`；关联列 `schedules.content_item_id`、`runs.params_json.contentItemId`（`src/worker/runner.ts:176` 写入）、`publish_records.content_item_id` + `account_id`/`platform` |
| 状态映射规则（P2-04-02） | `src/lib/content-lifecycle.ts`：唯一词表 `contentLifecycleStages`（`draft`/`pending`/`scheduled`/`publishing`/`published`/`failed` = 草稿/待处理/已排期/发布中/成功/失败）定义在 `src/lib/types.ts:143`；`resolveContentLifecycleStage()` 的**优先级逐条写进注释并逐条有测试**：① 内容 `posted` 或**有 `published` 记录** → published；② 有 `queued`/`running` 记录或运行 → publishing；③ 内容 `draft` → draft（计划不能让草稿变成可发布）；④ 内容 `failed`／最近一条记录 `failed`/`cancelled`／最近一次运行 `failed`/`warning` → failed；⑤ **有启用中的**排程发生 → scheduled（暂停的计划不算「已排期」）；⑥ 最近一条记录是 `drafted` 或什么都没有 → pending |
| 区分内容状态与发布任务状态（P2-04-07） | 行对象同时带 `contentStatus`（`content_items.status` 原样，内容不存在时为 `null`）与 `stage`/`plan`/`publish`；**「有记录」永远不等于成功**：`publish.byStatus` 只统计各行自己的状态，`hasOnlyUnfinishedRecords` 在无 `published` 行时为 `true`，测试固定「queued → publishing」「drafted → pending」「记录存在 ≠ 已发布」。修掉既有缺陷：`content/library/page.tsx` 原先把 `posted`/`failed` 一律显示为「草稿」（原 `:232` / `:280` 的 `status === "ready" ? ready : draft`），现按四态标签渲染（`src/components/creation/content-labels.ts`，标签落在 `page.tsx:254` / `:302`） |
| 按计划发布时间查询内容（P2-04-03） | `GET /api/content/lifecycle`（`src/app/api/content/lifecycle/route.ts`，只读、`runtime=nodejs`）：`?from`/`?to` 按**计划发布时间**选内容（内容关联排程的发生 + 该内容在窗口内的运行），缺省窗口 `[now, now+30d]` 并回报 `range.source="default"`；窗口超过 366 天会**截断并回报** `range.clamped=true`；`?stage`/`?platform`/`?contentItemId`/`?limit`/`?offset` 逐项校验，**空值/非法值视为缺省而不是 0**（P8-03 踩过的 `Number(null)` 坑）；`scan` 回报三个读取上限与 `referencedContent`/`missingContent`/`truncated` |
| 发布记录 ↔ 内容 ↔ 目标平台（P2-04-06） | 同一路由的 `publish.platforms[]`：按 `accountId`（回退 `platform`）分组，给出每组的 `records`/`published`/`lastStatus`/`lastAt`/`url`；`latest` 是最近一条记录（无论状态）；内容侧面板 `src/components/creation/content-lifecycle-panel.tsx` 逐平台展示状态徽标、时间与「打开链接」 |
| 日历或排期视图（P2-04-04，不回归 + 内容归属） | 既有 `/schedules/calendar` 与 `/api/calendar` 保持原语义；新增 `CalendarEntry.contentTitle`（`src/lib/calendar.ts`，纯函数 `contentTitles?: Map` 注入）与运行条目的 `contentItemId`，路由按 `contentTitleBudget=200` 解析标题并回报 `contentTitles.{requested,resolved,budget,capped}`；日历日程式条目给出「打开内容」深链 `?open=<contentItemId>`（内容中心据此直接打开详情） |
| 修改计划发布时间（P2-04-05） | 复用既有 `PATCH /api/schedules/[id]`（未新增写接口）；新增 `src/components/calendar/schedule-reschedule-dialog.tsx`，payload 与对话框一致：`{ scheduleTimes: [{ type: "once", at }] }`。**不假装只移动一天**：`/api/schedules` 读回当前规则，若原计划是周期规则，保存前明确提示「整份时间规则会被单次执行取代」；排程已不存在时只报告、不写入 |
| 调用链路 | 页面 → `GET /api/content/lifecycle` → `listSchedules()` / `listRuns(2000)` / `listPublishRecords(2000)` / `listAccounts()`（既有读取）→ `collectContentPlans()`（复用 `expandScheduleTimes()`）/ `collectContentRuns()` / `collectContentPublishRecords()` → `buildContentLifecycleRow()` → 唯一新增仓储函数 `listContentItemRefs(ids)`（`inArray`，只读）。**未改 schema、未改 C2、未触碰 `src/features/ai-runtime`** |
| 验证结果（本轮实跑） | `tsc --noEmit` → exit 0（输出 0 字节）；新增测试 32 例：`src/lib/content-lifecycle.test.ts`（21，纯函数）、`src/app/api/content/lifecycle/route.test.ts`（7）、`src/app/api/calendar/route.test.ts`（2）、`src/app/api/schedules/[id]/route.test.ts`（2，含对话框实际 payload）；全量 `vitest run` → **138 文件 / 1049 用例全通过**（P8-03 基线 134/1017 → +4 文件 / +32 用例）；`eslint src` → 0 error / 1 既有 warning；`eslint .` → 仍只有既有 3 个 `tmp-probe-*.cjs` error 与同一 warning（**无新增问题**） |
| 开发态实测（dev server `:3000`，**非打包产物**，全部只读） | `GET /api/content/lifecycle?limit=1` → **200**（`range.source=default`、`scan.schedules=0/runs=8/publishRecords=3`、`truncated=false`、`rows=[]`——真实库无内容关联排程，就诚实回空）；`?from=&to=&stage=bogus&limit=` → 200 且 `filters.stage=""`、`limit=50`、`source=default`（空值未被当成 0）；`GET /api/calendar` → 200（`entries=11`、`contentTitles=req 2 / res 2 / budget 200 / capped false`）；`/zh-hk|zh-cn|en` 的 `/content/library` 与 `/zh-cn|en/schedules/calendar`、`/zh-hk/system/cost-center` 均 **200** |
| 浏览器实测（Playwright，**非打包产物**） | `/zh-hk/content/library`：列表状态标签与真实 `content_items.status` 一致（取真实库首条 `ready` → 「已就緒」）；`?open=<真实内容 id>` 深链打开详情，「生命週期 / 待處理 / 內容狀態 已就緒 / 計劃發佈時間（沒有排程指向這條內容。）/ 發佈記錄（沒有發佈記錄指向這條內容。）/ 0 筆記錄 · 0 筆成功 · 區間內 0 次執行 / 讀取最新 2000 筆發佈記錄（目前 3 筆。）」全部进入 DOM；`/zh-hk/schedules/calendar` 渲染正常；`pageerror` **为空** |
| 本卡**未**通过真实 UI 验证的部分（诚实记录） | ① 真实库里 `schedules` 表为 **0 行**，因此「修改時間」按钮与日历上的内容深链在 dev server 上**没有可点的数据**（都只在有内容关联排程时出现）；这两条走的是路由级测试：`src/app/api/calendar/route.test.ts` 固定「计划条目带 `contentTitle`」，`src/app/api/schedules/[id]/route.test.ts` 固定「对话框 payload 移动计划时间、`nextRunAt` 重算、内容关联/账号不变」。② 打包版 Electron 界面**未验证**（本机未产出安装包） |
| 复用既有架构 | 未新增数据表/列/迁移；未新增写路由（改期复用 `PATCH /api/schedules/[id]`）；唯一的仓储新增是只读 `listContentItemRefs()`；发布成功契约（C2）**只读不改** |

## 4.4 P2-05（= CI-P2-05）状态：多平台内容模型——**模型与 API 契约已交付，UI 未接入**（本轮交付）

主线 §1（`CI-P2-05` 行）本轮由 `todo` 改为 `done`，但**完成范围限于模型与 API 契约**：交付 = `CI-P2-05-01…06`（六条子项全部落在模型/契约层）。按作者要求，本文件把「**契约完成**」与「**用户可操作的功能完成**」**分开记录**：前者已完成并实测；后者**未完成**（没有任何界面入口）。主线 §5 已补本卡交付记录；**本文档不改主线文件**。

| 要件 | 证据（以代码为准） |
| --- | --- |
| 平台无关基础字段（P2-05-01） | `PlatformContentVersionPayload`（`src/lib/types.ts:413`）= `contentItemId` + `base{title,body,postReadyText,imagePath,images,videoPath,fingerprint,updatedAt}` + `profiles[]` + `versions[]` + `unreadable`；构造器 `buildPlatformContentVersionPayload()`（`src/lib/platform-content.ts:397`）。item 的 `imagePath` 可缺省，载荷里不省略（`content.imagePath ?? ""`，第 411 行） |
| 平台差异适配层（P2-05-02） | `PlatformContentProfile`（`types.ts:343`）：`composerEntry`（`new-post`/`direct-url`/`generic`，读 `publishPageUrl` + `newPostSelectors`）、`videoRoute`（`video-tab-then-input`/`file-input`/`not-supported`，读 `videoInputSelectors` + `videoTabSelectors`）、`titleField`/`bodyField`（读 `titleSelectors`/`contentSelectors`）、`textLimit`/`titleLimit`；`buildPlatformContentProfile()`（`platform-content.ts:117`）、`listPlatformContentProfiles()`（:136，按 `accountPlatforms` 顺序） |
| 「有多少说多少」的预算（P2-05-06） | `enforcedTextLimits`（`platform-content.ts:65`）**只有 Threads** = `threadsPostMaxLength`(450) − `threadsPostTrailingSpace`(1) = **449**（`post-format.ts` 的 `truncateThreadsPost` 默认额度）；`enforcedTitleLimits`（:74）**为空** → 所有平台 `titleLimit` 为 `null`（「本层不限额」≠「平台无限额」）。`imageInputSelectors` / `videoUploadWaitMs` **不建模**（发布路径不读） |
| 基础内容 → 平台版本（P2-05-03） | `adaptContentToPlatform()`（`platform-content.ts:228`）+ `formatPlatformField()`（:168）：规范化 / 截断 / 字段不存在（`text-not-offered`、`title-not-offered`）；封面随每个版本走，视频只在 profile 有入口时走（否则 `media-not-included`）；路由 `POST` 另支持 `mode:"save"`（作者手写，媒体留空） |
| 来源关系（P2-05-04） | `baseFingerprint`（`platformBaseFingerprint()` :219，FNV-1a over `title\0text`）+ `isPlatformContentVersionStale()`（:392）；`source` 取 `derived`（适配产出）/ `edited`（作者改过），见 `platformContentVersionSources`（`types.ts:360`）。**编辑不重算指纹**（`PATCH` 保持原 `baseFingerprint`）、**基础内容变动不自动刷新版本**（只报 `stale`），两者都有测试固定 |
| 适配与发布分离（P2-05-05） | 版本落在 `content_items.metadata_json` 的 `platformVersions` 键（`platformVersionsMetadataKey` = `platform-content.ts:54`），经既有 `updateContentItem` **合并写**（其它 metadata 键与不可读条目原样保留）；**不写 `publish_records`、不改 `content_items.status`**：`route.test.ts` 直接断言 derive / save / patch / delete 之后 `listPublishRecords()` 仍为 `[]`、状态仍为 `ready` |
| 不虚构未接通能力（P2-05-06） | `isKnownPlatform()`（`platform-content.ts:82`）只认 `accountPlatforms`；未接入平台 → `400 INVALID_PAYLOAD`；`profiles` 只列已接入平台；`supported` = 「该平台是否有专属 `PlatformPublishProfile`」，无专属 profile 时为共享 `generic` 回退 |
| 存储与容错 | `readPlatformContentVersions()`（:344）逐条容错：不可读条目**保留在 metadata 里**并计入 `unreadable`，不阻断读取；`upsertPlatformContentVersion()`（:368）/ `removePlatformContentVersion()`（:379）只动 `platformVersions` 一个键；`DELETE` 删除不存在的版本是 **no-op（不报错）** |
| HTTP 面 | `src/app/api/content/[id]/platform-versions/route.ts`（146 行，`runtime="nodejs"`、`dynamic="force-dynamic"`）：`GET` 读模型、`POST` derive（缺省）/ save、`PATCH` 只改文本并置 `edited`、`DELETE ?platform=` 删除。拒绝面：未知平台 400、`save` 缺 title/body 400、缺 `platform` 400、内容项或版本不存在 404 |
| 复用既有架构 | **未新增数据表 / 列 / 迁移**；**未新增仓储函数**（只用既有 `getContentItem` / `updateContentItem` / `listPublishRecords`）；**未新建 AI 调用路径**（本卡不调用模型，`src/features/ai-runtime` 未被触碰）；C2 发布成功契约（`recordPublishSuccess`）**只读不改** |
| 验证结果（本轮实跑） | `tsc --noEmit` → exit 0；新增 34 例：`src/lib/platform-content.test.ts`（19，纯函数）+ `src/app/api/content/[id]/platform-versions/route.test.ts`（15，路由）；全量 `vitest run` → **140 文件 / 1083 用例全通过**（P2-04 基线 138/1049 → +2 文件 / +34 用例）；`eslint src` → 0 error / 1 既有 warning（`chat-conversation.tsx:146`，非本卡引入） |
| 本卡**未**验证 / **未**做的部分（诚实记录） | ① **无 UI 消费者**：`src/app/**` 与 `src/components/**` 无任何调用方（全仓只有 `src/lib/platform-content.ts`、`src/lib/types.ts`、`src/lib/validation.ts` 与两个测试文件引用这些类型）→ 用户**无法在界面上**查看 / 派生 / 保存 / 编辑 / 删除平台版本，**端到端用户流程未完成**；② **无真实 HTTP 冒烟**：验证止于 Next.js handler 级路由测试，**未**在 dev server 上真实请求过该端点；打包版 Electron 界面**未验证**（本机未产出安装包）；③ 手写 `save` 版本**不携带媒体**（`imagePath` / `videoPath` 为空，模型尚无手写媒体字段）；④ **版本 → 版本** 的跨平台派生不支持；⑤ 平台**真实**限额（非 CoolPilot 自己施加的）一律不建模，`null` 只表示「本层不限额」 |

**下一步**：多平台版本 UI 已按作者授权**立项为独立卡 `CI-P2-07`**（编号依据见 §4.5）；随后进入 **`CI-P7-03`（生成前预估与预算控制）**——**设计稿与最小切片评审先行**（`docs/development/ci-p7-03-design-draft.md`），**评审通过后**才进入业务代码。**行号更正（2026-10-10，经作者授权）**：本文件 §3 原写「主线 §13 第 427–432 行」、主线 §附录 原写「第 433 行起」、本句原写「实际标题行 437」，**三者均为插入交付记录前的过期行号**；实测为**块 442–447、标题行 442**（`### CI-P7-03：生成前预估与预算控制`），已按实测值更正（旧值保留于此，不视为从未存在；§3 第 101 行与主线 §5 第 213 行同步更正）。**更新（2026-10-10，本卡交付后）**：`CI-P7-03` 已按作者裁定稿交付并实测（`done`；记录见主线 **§附录 D**，它**追加在文件末尾**，因此上述 §13 行号 442–447 / 449 / 455 **保持不变**），本句的「评审通过后才进入业务代码」已完成，下一步编号为 **`CI-P7-04`**；`P7-03-04` 三种执行策略仍未交付，待作者裁定。

> **同源过期引用（本轮实测，尚未更正、待作者裁定）**：本文件 §3 对照表第 **100** 行（记「§13 第 418–425 行」与「§13 第 405 行」）与第 **103** 行（记「§13 第 434–438 行」）；§4.1 正文第 **130** / **137** 行（同样记 405 / 418–425）；§4.6 第 **286** 行（记「§13 第 440 行」）；§3 与 §7 中指向主线 §1 的旧值（第 **90** / **95** / **97** / **99** / **111** / **300** 行分别记 §1 第 50 / 52 / 53 / 54 行，实测 P4 / P5-04 / P6 / P7-01 行在 §1 第 **54 / 56 / 57 / 58** 行，且本轮插入 `CI-P2-07` 行后 P3-01 及其后各行再 +1）。主线侧实测：§13 标题 **412**，`CI-P7-01` **420**、`CI-P7-02` **431**、`CI-P7-03` **442**、`CI-P7-04` **449**、`CI-P7-05` **455**；「菜单改名与第一个真实的费用界面**同卡交付**」句在主线**第 418 行**（本文件 §4.1 记的 405 行是过期值）；主线 §附录 C 第 **1610** 行记「§13 第 440 行」，实测为 **449**。**本文件不擅自改写这些引用，仅登记差异。**

## 4.5 P2-07（= CI-P2-07）状态：多平台内容版本管理 UI（2026-10-10 交付，done）

作者 2026-10-10 裁定：**批准创建 `CI-P2-07：多平台内容版本管理 UI`**，作为 `CI-P2-05`（多平台内容模型，done，限模型与 API 契约）的**界面消费者**独立立项。

**编号依据（先核对再定号）**：`CI-P2-06` **已被占用**——`docs/development/CoolPilot-开发清单-10个开源项目整合版.md` §四 第 **279** 行 = 「`P2-06：创作者资料与内容分群（erxes Contacts / Segments）`」；全仓 docs + src 无 `CI-P2-06` / `CI-P2-07` 字样，故取下一个空位 **`P2-07`**。**不改**上述清单文件（`P2-07` 是我方实现层补充卡，需求原文 `P2-05` 不动）。

**宿主选择原则（先核查后定唯一宿主，禁止同时改两处）**：优先评估内容中心 `src/app/[locale]/(console)/content/library/page.tsx`（已有内容详情入口、`ContentLifecyclePanel` 与对话框模式）；若数据获取方式或交互模式更适合，可选**其他现有页面**；**不得**同时改内容中心与发布向编辑器，除非有证据证明单一宿主无法满足需求（证据须进交付记录）。**宿主在开工前先核查并报告，再由作者确认。**

**子项与完成标准（暂定，随实现更新）**：

| 子项 | 范围 | 备注 |
| --- | --- | --- |
| `P2-07-01` 版本列表与基础内容展示 | 展示基础内容、平台版本及版本状态；妥善展示**不可读条目**（沿用 `unreadable` 计数，不静默丢弃） | 只读 |
| `P2-07-02` 平台版本派生 | 从基础内容选择目标平台并创建派生版本（走既有 `POST /api/content/[id]/platform-versions`） | 不新增路由 |
| `P2-07-03` 版本编辑与保存 | 支持编辑、保存，并保留**来源关系**（`derived` / `edited`、`baseFingerprint`）与编辑状态 | `PATCH` **不重算**指纹 |
| `P2-07-04` 平台适配信息展示 | 展示标题支持情况、文本限制、媒体信息等**已有契约信息**（`PlatformContentProfile`）；**不得虚构平台能力**（`titleLimit` 全为 `null` 时如实显示「本层不限额」） | 事实只从既有代码推导 |
| `P2-07-05` 版本删除与发布隔离 | 删除指定平台版本，并**验证**不创建发布记录、不修改内容发布状态、不创建排程 | 与 C2 发布契约隔离 |
| `P2-07-06` 完整链路验证 | 覆盖组件交互、API 调用、错误处理与**真实服务链路** | 见下「验证要求」 |

**完成标准（作者裁定）**：用户可以在界面中完成平台版本的**查看、派生、编辑、保存和删除**，且**来源关系正确**、**发布行为隔离**、**真实 API 链路通过验证**。

**验证要求（不得以「组件渲染成功」代替）**：① 组件交互测试（含不可读条目、`stale` 状态与错误分支）；② 路由级测试沿用既有 `platform-versions` 测试；③ **真实链路验证**：dev server 上对该端点做真实 HTTP 请求并记录状态码与 payload；若本机限制导致无法进行，必须在交付记录中**明写未做**，不得只写「测试通过」；④ 打包版 Electron 行为按项目规则另行标注是否验证。

**范围与非范围**：本卡**只做界面消费**——不新增数据表 / 列 / 迁移，不新增发布路径，不改 C2 与 AI Runtime；模型层缺口（手写 `save` 版本不带媒体、版本 → 版本派生不支持）**不在本卡修复**，如需修复另立卡。

**交付记录（2026-10-10，本轮，作者已授权宿主为内容中心）**

- **改动文件**：新增 `src/lib/platform-version-view.ts`（178 行，纯逻辑）、`src/components/creation/platform-versions-view.tsx`（347 行，纯展示：无取数 / 无状态 / 无 API 调用）、`src/components/creation/platform-versions-panel.tsx`（178 行，容器：SWR + `apiPost`/`apiPatch`/`apiDelete`）、`src/lib/platform-version-view.test.ts`（252 行 / 18 例）、`src/lib/platform-versions-render.test.ts`（281 行 / 21 例，`react-dom/server` 静态渲染冒烟）、`scripts/platform-versions-ui-smoke.ts`（217 行，Chromium 真实交互冒烟）；修改宿主 `src/app/[locale]/(console)/content/library/page.tsx`（第 20 行导入、第 396 行挂载 `<PlatformVersionsPanel>`，**唯一宿主**，未改发布向编辑器）；`src/locales/{en,zh-cn,zh-hk}.json` 各 **+65** 个 `pv*` 键（三文件均 2159 行、键数一致）。
- **完成标准对照**：界面内**查看 / 派生 / 编辑保存 / 删除**闭环已实现；来源关系（`derived` / `edited`、`baseFingerprint` 不因编辑重算）已断言；发布隔离已实测（不写 `publish_records`、不改内容 `status`、不建排程）；真实 API 链路已通过。
- **验证要求逐条回应**：① 组件交互——交互分支由**纯逻辑单测**覆盖（`unreadable` 计数、`stale` 判定、错误码 → 文案、无标题字段不发 `title`、全空草稿拒发），组件层为**静态渲染冒烟**（`environment: node`，仓库无 jsdom / happy-dom / @testing-library；按作者批准方向**不新增依赖、不改 `vitest.config.ts`**，故**不称为 DOM 交互测试**）；② 路由级测试——沿用 `CI-P2-05` 既有 `route.test.ts`（未改），全量 `vitest run` → **142 文件 / 1122 用例全部通过，exit 0**；③ 真实链路——**已做**：`tsc --noEmit` exit 0；`eslint .` 本卡新增/修改文件 0 问题（剩 3 error + 1 warning 均为非本卡的既有项：`tmp-probe-db.cjs`、`tmp-probe-zod-json-schema.cjs` 为 2026-10-09 遗留未跟踪脚本、warning 在 `chat-conversation.tsx:146`）；隔离库下真实 HTTP 冒烟 22 项状态码 / payload 全部符合预期；并用 Chromium 对 **zh-cn / en / zh-hk 三语各 28 项**真实交互断言全过（三次 exit 0）；**未做项已明写**：无 DOM 单测、打包版 Electron 行为未验证、`unreadable` / `stale` / 错误分支未在真实浏览器里构造；④ 打包版 Electron 行为——**未验证**（本卡不涉及打包面）。
- **隔离与干扰记账**：冒烟全程 `SOCIAL_AUTO_POST_DB_URL=file:<temp>/smoke.db`，真实库 `web-data/social-auto-post.db` 的 `Length` / `LastWriteTime` 前后**完全一致**（995328 B / `2026-10-10T04:58:25.6920388+08:00`）；冒烟期间**经作者授权**短暂停用其 3000 dev server 并**按原命令原样重启**（旧日志已备份到 `%TEMP%\cp-dev-server-before-ci-p2-07.log`）；临时仓库副本、目录联接与隔离库**均已删除**；未改 `.env.local`，未执行任何 `git add` / `commit` / `stash` / `clean`。
- **一次环境纠错（作者可见）**：首次重启 3000 时本会话残留的 `SOCIAL_AUTO_POST_DB_URL` 被继承，该实例一度指向临时库（0 条内容）；发现后**立即**停掉、清空该变量后按原样重启，复核 `GET /api/content?page=1&pageSize=3` → `total=19`（作者真实内容），真实库全程未被写入。教训已登记：**代他人启动进程前先清空本会话作用域变量**。
- **为什么不在既有 dev server 上直接冒烟**：3000 实例持有 Next dev 锁（第二个实例直接退出）；仓库副本 + **目录联接**复用 `node_modules` 时 Turbopack 报 `Symlink [project]/node_modules is invalid, it points out of the filesystem root`，改用 `--webpack` 后服务端可用但**客户端水合失败**（`invariant expected layout router to be mounted`）。最终采用「真实仓库 + 隔离临时库 + 独立端口」。
- **本节行号影响（供后续引用核对）**：以上内容为 §4.5 内**追加**，其后的章节整体下移，实测新行号：§5 → **254**、§6 → **267**、§7 → **300**（§4.5 标题仍为第 219 行）；本文件不代改其它文档中既有的行号引用，只登记事实。

## 5. 来源清单与计数口径（待作者确认）

清单已入库，现按**实际正文行号**记录口径：

- 仓库 `docs/open-source-capability-map.md` §2.1–2.8 共 **8 个**来源，其中**第 8 个就是 ego-lite**。
- 新清单 §零「10 个参考开源项目索引」的表**恰有 10 行**：1 Remotion、2 AIGCPanel、3 BrightBean Studio、4 ALQQ / Meiti AI、5 BiliNote、6 DouyinLiveRecorder、7 OpenSEO、8 ego-lite、9 erxes、**10 Spanlens（第 32 行，行内自标「（扩展参考）」）** → 与上一行正好对齐：**8（已含 ego-lite）+ erxes + Spanlens = 10**。
- 但同一份清单另有两处与之不同：
  * 第 108 行（§二 P0-02 完成标准）：「10 个主参考来源…；**Spanlens 作为后续补充的可观测性扩展参考单独记录**」——把 Spanlens 排除在「10 个主参考」之外，则主参考只剩 9 个（8 + erxes）。
  * 第 809–810 行（§十二）：「包括**原有 8 个来源、ego-lite 和 erxes** 的高价值能力」——若「原有 8」已含 ego-lite（与仓库 §2.8 一致），此句即把 ego-lite 列了两次，且未提 Spanlens。
- **三处口径互不一致，本文件不擅自裁决**（按项目规则先报告差异）。`docs/open-source-capability-map.md` 只**追加** §2.9 / §2.10 / §2.11，不重编 §二/§三 既有编号与标题。
- **2026-10-10 追加（本次）**：按作者明确指令，新清单**新增** §零 **第 11 行 `Anki（扩展参考）`** 与文末 **`附录 Z：Anki 设计借鉴条目（A1–A7）`**。实测为**纯追加**（`git diff --no-index --numstat` → `155 0`：只加行、零删除，见 §2.2），**不替换、不删除**任何原有项目；因此上一版写的「新清单原文**一字不改**」自本次起改为「**只追加、不改写既有内容**」。
- 由本次追加产生的两处（属既有性质的）口径差异，**照旧登记、不自行裁决**：① §零 现为 **11 行**，而文档名与 §零 标题仍写「10 个」；② §十二 执行指令原文仍写「包括**原有 8 个来源、ego-lite 和 erxes** 的高价值能力」，未提 Spanlens 与 Anki。是否改名 / 改句由作者决定。

## 6. 新来源的借鉴范围与许可证核查状态

详见 `docs/open-source-capability-map.md` 新增的 §2.9（erxes）与 §2.10（Spanlens）以及 §七 的核查表。要点：

| 来源 | 许可证（已核实） | 核查依据 | 归类 |
| --- | --- | --- | --- |
| **erxes** | **AGPLv3**（另有例外：`ee/` 下 `-ee` 插件为 Enterprise Edition；并附「不得作为 SaaS 与 erxes Inc. 竞争」的限制） | 仓库根 `LICENSE.md` 原文（2026-10-10 取 `main` 分支） | **参考重写**（第 3 类）：AGPLv3 是带网络条款的强 copyleft，**不得复制、修改或链接其实现代码** |
| **Spanlens** | **MIT** | 仓库页面侧栏与 README 末尾（2026-10-10） | 可评估**直接集成**，但仍须逐个核查其第三方依赖、模型与素材许可 |

> 除上表各行外，其余来源的核查状态**仍为未核查**（`docs/open-source-capability-map.md` §二 各节的勾选框未打勾），不得声称「许可证已通过」。

### 6.1 Anki（2026-10-10 追加，设计参考 → 条目 A1–A7）

| 来源 | 许可证（已核实） | 核查依据 | 归类 |
| --- | --- | --- | --- |
| **Anki** | **AGPL-3.0-or-later**（仓库代码；另列例外：`statsbg.py` CC BY 4.0；`mpv.py` / `winpaths.py` MIT；MathJax Apache 2；jQuery / jQuery-UI / `plot.js` MIT；`protobuf.js` BSD-3；`docs-site` 文档 CC BY-SA 4.0；Logo AGPL3 且另有受限替代许可） | 仓库根 `LICENSE` 原文（`https://raw.githubusercontent.com/ankitects/anki/main/LICENSE`，`main` 分支，2026-10-10 读取） | **参考重写（第 3 类）**：强 copyleft + 网络条款，**只借鉴设计思想**，不得复制 / 修改 / 链接其实现代码 |

本文件**不重复** Anki 的借鉴条目正文。**权威正文**：`docs/development/CoolPilot-开发清单-10个开源项目整合版.md` **附录 Z**（A1–A7，含官方链接与逐项核查状态）；**卡片映射**：`docs/coolpilot-capability-integration-plan.md` **附录 C**。

A1–A7 → 卡片编号（与主线附录 C 同源，这里只列编号便于在本文件内追索）：

| 参考项 | 最新清单卡片 | 主线编号 / 状态 |
| --- | --- | --- |
| A1 内容主体与生成产物分离 | P2-04（§四 第 248 行起）；后续 P2-05（第 263 行）、P2-06（第 275 行） | `CI-P2-04`（done）、`CI-P2-05`（done，限模型与 API 契约，见 §4.4） |
| A2 生命周期、计划时间与历史记录分离 | P2-04；后续 P1-02、P1-05（第 193 行） | `CI-P2-04`（done） |
| A3 稳定业务 API 与数据访问边界 | 全局约束（相关 P6-04 第 570 行、P4-01-06 第 345 行） | 主线 §0 冻结边界 / §附录 A-1（无独立卡） |
| A4 扩展机制与 Marketplace 契约 | P1-05、P5-06（第 519 行）、P7-01 / P7-02（第 583 / 597 行） | `CI-P4-*`（todo）、`CI-P7-05-03` |
| A5 导入、导出、备份与迁移 | P5-06、P6-03-05（第 557 行）、P6-04-04（第 570 行）、P8-07-04（第 721 行） | `CI-P7-05-04` |
| A6 统一检索、标签与跨模块过滤 | P2-06-03（第 281 行）、P7-02-01（第 599 行）、P3-01-03（第 301 行） | 储备（不要求当前卡实现） |
| A7 基于真实历史反馈的质量优化 | P8-05（第 677 行） | `CI-P7-04`（§13 第 440 行，todo） |

> 以上映射**只是计划映射**：不改变任何卡的状态、顺序与验收口径，也**不自动创建新卡**。

## 7. 未解决问题（截至本记录）

1. ~~最新版清单正文缺失~~ **已解除**：2026-10-10 完整正文入库 `docs/development/CoolPilot-开发清单-10个开源项目整合版.md`（867 行 / 53,584 字节，SHA256 `CD12B742…01A9`，与作者原件**字节一致**；原件 `docs/CoolPilot-开发清单-10个开源项目整合版_2.md` **未被移动、未被删除**）。见 §2.1。**2026-10-10 追加（本次）**：同一文件按作者指令**追加** §零 第 11 行与文末附录 Z 后**不再与原件字节一致**（纯插入 +155 / −0，新 SHA256 `16D8B698…B7BF`，见 §2.2）；原件仍为上述数值、仍未被改动。
2. **来源计数口径仍未统一**：清单内部 §零（**现为 11 行**：第 10 行 Spanlens、第 11 行 Anki，均自标「扩展参考」；标题仍写「10 个」）与 §十二（「原有 8 个来源、ego-lite 和 erxes」）冲突，§5 已给出三处行号并登记本次追加带来的两处新差异；不自行裁决。
3. **未提交改动仍无检查点**：基线 **214**（82 M + 132 ??，见 §1）；P8-03 收尾时 **222**（84 M + 138 ??）；**本卡（P2-04）后为 235**（89 M + 146 ??）= **+13**：8 个新未跟踪路径（`src/lib/content-lifecycle.ts`、`src/lib/content-lifecycle.test.ts`、`src/app/api/content/lifecycle/`（目录计一条）、`src/app/api/calendar/route.test.ts`、`src/app/api/schedules/[id]/route.test.ts`、`src/components/creation/content-labels.ts`、`src/components/creation/content-lifecycle-panel.tsx`、`src/components/calendar/schedule-reschedule-dialog.tsx`）+ 5 个本轮首次变动的已跟踪文件（`src/app/api/calendar/route.ts`、`src/lib/calendar.ts`、`src/components/calendar/calendar-shared.tsx`、`src/components/calendar/content-calendar.tsx`、`src/app/[locale]/(console)/content/library/page.tsx`）。这是当前最高的工程风险，需要一次明确授权的落盘动作；本轮**未**执行 `git add` / `git commit` / `reset` / `clean`。
4. **文档与代码的规模数字不一致**（`docs/data-model-inventory.md` 记 `schema.ts` 582 / `client.ts` 675 / `repository.ts` 1405 / 仓储 25 文件；实测 **593 / 879 / 1580 / 26**；HEAD 版为 358 / 535 / 1058）。本次**只报告，未改文档**。
5. **`provider-reported` 目前没有写入者** → 系统内不存在「供应商实收」；所有金额只能是 `computed` 或 `unpriced`。
6. **非文本计量维度缺录价表单** → 图片 / 视频 / 语音 / Embedding 的成本恒为 `unpriced`。
7. **`duration_ms` 恒为 0**（未测量）。P8-03 的调用明细把这一列显示为「未测量」，并明写「0 不代表瞬间完成」；**给单个请求加计时需要改 AI Runtime 的轨迹契约，本卡不做**。
8. **下一张卡待作者指定**：截至本记录，**P2-04（`CI-P2-04`，见 §4.3）与 P2-05（`CI-P2-05`，见 §4.4）均已交付**，主线 §1 第 48/49 行分别为 `CI-P2-04 = done` 与 `CI-P2-05 = done（限模型与 API 契约）`。**2026-10-10 更新**：P2-05 按契约交付后（多平台内容模型，主线 §5 第 210 行起；与 P2-04 同属内容工作流，平台适配层只读 `accounts.platform` 与 `post-format.ts`/`publish-profiles.ts`），**其 UI 尚未实现，需另立新卡**；主线候选线只剩下面一条：**P8-04（生成前成本预估与预算控制 = `CI-P7-03`，主线 §13 第 442 行起；旧记录写的 433 为插入交付记录前的行号，本轮实测为 442）**；按「一次只做一张卡」指定后推进。**2026-10-10 作者裁定（本次）**：① 多平台版本 UI **已立项为 `CI-P2-07`**（见 §4.5；`CI-P2-06` 已被清单 §四 第 279 行占用）；② **`CI-P7-03` 先做设计稿与最小切片方案评审**（`docs/development/ci-p7-03-design-draft.md`），**评审通过后**才进入业务代码；③ §3 第 101 行与 §4.4 末句的过期行号已按授权更正（另见 §4.4 的登记句）。另需**一次明确授权**处理第 3 条的 235 条未提交改动。
9. **本轮按作者要求同步了主线状态表**（P8-03 开工前核对项）：`docs/coolpilot-capability-integration-plan.md` §1 第 55 行原把 `CI-P7-02…CI-P7-05` 合并登记为 `todo`，本轮**只拆出 `CI-P7-02` 一行并标注 `done` + 证据指向**（§4.1 / §4.2），`CI-P7-03…CI-P7-05` 仍为 `todo`；§13 只追加一行交付记录，未改动需求条目本身。除此之外的主线内容**未动**。
10. **本机验证环境的限制（记录以免重复踩坑）**：Next 16 的 `next dev` **每个项目目录只允许一个实例**（第二个直接退出并提示已有实例），而 Turbopack 又**拒绝联结（junction/symlink）到项目外的 `src` / `node_modules`**（报 `Symlink … points out of the filesystem root`），因此「另起一个指向临时数据库的独立 dev server 并灌入种子数据」在本机不可行（`node_modules` 实测 **835 MB**，整体复制不划算）。P8-03 的浏览器验证改用**请求拦截**：脚本在临时库里用真实路由产出 payload，再由 Playwright 把该 payload 提供给页面渲染；**未改动本机 :3000 的 dev server，也未写入其真实数据库**。P2-04 复用了本机已运行的 :3000（**全部只读 GET**），Playwright 直接跑真实页面 + 真实数据。
11. **P2-04 留下的边界（已登记，非阻塞）**：① **「只跳过某一次发生」不存在**——计划模型（`scheduleTimes` 规则列表）没有 occurrence 例外语义，因此改期对话框把规则列表整体替换为单次执行，并**在保存前明写**这一点；要做「跳过一天」需要一个新概念，属新卡。② 计划/执行归因只读 `schedules.content_item_id` 与 `runs.params.contentItemId`；`POST /api/publish` 的直接发布路径**不写计划**，因此那类内容在没有排程时只能靠发布记录体现（本卡**不补写计划**，也就没有伪造排期）。③ 内容中心列表只修了四态状态标签，**未**加「生命周期阶段」筛选（`GET /api/content/lifecycle?stage=` 已支持，接 UI 可作后续小卡）。④ 真实库 `schedules` **0 行** → 日历上的「打开内容」深链与「修改時間」按钮在 dev server 上没有可点数据（两条均已由路由级测试固定，见 §4.3「未通过真实 UI 验证」行）。⑤ 打包版 Electron 界面**未验证**（本机未产出安装包）。
12. **本卡测试时发现、但**未**修改的既有事实**：① `PATCH /api/schedules/[id]` 把一句**句子**交给 `fail()`（`src/app/api/schedules/[id]/route.ts:12`），而 `fail()` 只把 `AppErrorCode` 当 code（`src/lib/api.ts:18-26`），因此无效 payload 的响应是 `code: "UNKNOWN_ERROR"` + `error: "Invalid schedule payload"`，与其它路由「传 code」的写法不一致；本卡只在新测试里如实固定现状，**不改契约**。② `eslint .` 的 3 个 error 全部来自**既有的**未跟踪临时文件 `tmp-probe-db.cjs` / `tmp-probe-zod-json-schema.cjs`（2026-10-09 生成，属基线 222 里的一部分，P8-03 记录已载明），`eslint src` 为 **0 error / 1 既有 warning**，本卡**无新增 lint 问题**，也**未删除**这些用户文件。
13. **验证流程自身的坑（记录以免重复）**：全量 `vitest run` **运行期间不要编辑仓库文件**——一次运行中修改 `src/app/api/content/lifecycle/route.ts` / `src/lib/types.ts` 造成该文件 7 例失败（HTTP 500），未被中断地重跑即 **138 文件 / 1049 用例全通过**；这是编辑与运行重叠的工具副作用，不是代码缺陷。另：`vitest --reporter=basic` 在 vitest 4 已移除（报 `Failed to load custom Reporter from basic`），用默认 reporter。

14. **2026-10-10 追加 Anki 参考条目（纯文档，本次）**：① **改动文件 4 个**——`docs/development/CoolPilot-开发清单-10个开源项目整合版.md`（§零 新增第 11 行 + 索引口径说明 + 文末 `附录 Z`；原文一字未改，+155/−0）、`docs/open-source-capability-map.md`（新增 §2.11 与 §7.1 一行 Anki、修正该处「两行 → 上表各行」措辞）、`docs/coolpilot-capability-integration-plan.md`（§0 参考条目命名空间、§1 表下说明、A-2 尾注、文末新增 `附录 C`）、本文件（§2 表格行、新增 §2.2、§5 追加说明、新增 §6.1、§7 第 1/2 条的补充与本条）。② **未改**任何业务代码、未新增表 / 迁移 / 写路由，**未改**任何卡片的编号、顺序、状态与历史交付记录（`CI-P2-04` 仍为 done、`CI-P2-05` 仍为 todo），**未**执行 `git add` / `commit` / `reset` / `clean`。③ 本轮**已核实**的 Anki 事实只有：仓库可访问、`docs/architecture.md` 原文（pylib/rslib/Qt/ts 分层、protobuf 非公开 API）、`pylib/anki/collection.py` 的文件头许可与导入/方法名（**中段被截断，未逐行审阅**）、`docs-site/addons/` 的**文件名清单**、`LICENSE` 原文（**AGPL-3.0-or-later**）；**未逐篇读取 add-on 文档，故不描述其权限模型**，A1–A7 一律按「设计借鉴」表述，不写成已验证能力。④ 遗留（**非阻塞**）：清单文档名与 §零 标题仍写「10 个」而索引实为 **11 行**，§十二 执行指令原文仍写「原有 8 个来源、ego-lite 和 erxes」，且 `AGENTS.md` / `.clinerules/01-coolpilot.md` 第 1 节第 3 条仍记「867 行」——这些文案是否同步改由作者决定，本文件**不代改**（只登记事实）。
15. **CI-IA-01（菜单信息架构重整）的两个副作用（本次，如实登记）**：① **工作区基线**：`git status --porcelain` 实测 **253**（92 M + 161 ??，2026-10-10），本卡新增未跟踪路径 3 条——`src/lib/console-nav.ts`、`src/lib/console-nav.test.ts`、`docs/development/menu-information-architecture.md`；该数字与第 3 条登记的 **235**（89 M + 146 ??，P2-04 时点）**不可直接相减**（中间还有 P2-05 / P2-07 / P7-03 等卡的改动），仅作时点记录；**未执行**任何 `git add` / `commit` / `push`。② **行号位移**：主线 `docs/coolpilot-capability-integration-plan.md` §1 新增 `CI-IA-01` 一行（第 **61** 行，插在 `CI-P7` 行之后），因此主线**第 61 行之后的所有行号整体 +1**；本文件与主线各处指向「§2 之后」的行号引用（例：主线 §13 起 442、§5 的 192 / 210）随之**全部偏 1**。按规则「先报告差异、不顺手修正」**未批量改写**，与主线 §附录 D 末尾「顺带发现」已登记的同类过期引用一并交由作者裁定。本卡自身的交付记录见本文件 **§8** 与主线 **§附录 E**。

16. **CI-IA-02（菜单商业排序 + 移动端短标签）的两个副作用（本次，如实登记）**：① **工作区基线**：`git status --porcelain` 实测 **253**（92 M + 161 ??，2026-10-10），与 §7 第 15 条（CI-IA-01 时点）**数字完全相同**——本卡**未新增任何路径**，改动全部落在 CI-IA-01 已登记的同一批文件上（`src/lib/console-nav.ts`、`src/lib/console-nav.test.ts`、`src/components/console-layout-shell.tsx`、`src/locales/{zh-cn,zh-hk,en}.json`、未跟踪目录 `docs/development/` 内的 `menu-information-architecture.md`、`docs/menu-inventory.md`、`docs/coolpilot-capability-integration-plan.md`）；**未执行**任何 `git add` / `commit` / `push` / `reset` / `clean`。② **行号位移**：主线 `docs/coolpilot-capability-integration-plan.md` §1 新增 `CI-IA-02` 一行（第 **62** 行，插在 `CI-IA-01` 行之后），因此主线**第 62 行之后的行号整体再 +1**；叠加 CI-IA-01 的位移后，**第 61 行之后的引用相对 CI-IA-01 之前共偏 +2**。按规则「先报告差异、不顺手修正」，本文件与主线各处既有行号引用（例：主线 §13 起 442、§5 的 192 / 210）**未批量改写**，交由作者裁定。本卡自身的交付记录见本文件 **§9** 与主线 **§附录 F**。
17. **CI-P7-03 补完记录（2026-10-10 追加；只改测试文件与文档，如实登记）**：① **改动面**：7 个测试文件（本轮 `src/app/api/content/[id]/rewrite/route.test.ts`、`src/lib/article-generation.test.ts`、`src/lib/scraper.test.ts`、`src/lib/agent/{langgraph-engine,local-tools,chat-thread-title}.test.ts`，其中后三者同时修掉「静态 import 使被测模块按**安装自己的**库解析 URL」的隔离缺陷）——**未改任何产品代码**、未加表 / 列 / 迁移、未改冻结面（AI Runtime / C2 发布语义）；② **主线新增 `§附录 G`**（**追加于文末**，故 §1 / §13 / 附录 A–F 行号**均未移动**；§附录 D 第 1745 行仅**同行加字**指向它）：登记闸门落点实测「**14 文件 / 15 处 `beginAiBudget*`**」（与 §附录 D 第 1740 行「首次交付 5 处 / 4 文件」并存，以前者为准，已在附录 G 说明）、逐调用点拒绝用例（路由 7 / 服务 5 / worker 3 / extraction 4）、一个**未修发现**（`src/lib/transcription/providers.ts:190` 经 `@/features/ai-runtime` 的 `transcribe` 调**远端语音转写**，既无预算闸门也无账本行 / 计价维度，且**不在**设计稿 §10 的 14 条内，属 `CI-P7-03` 范围之外，待作者裁定）；③ **数字口径（实测）**：全量 `vitest run` **148 文件 / 1218 用例（exit 0）**、`tsc --noEmit` exit 0、本轮触碰的 12 个测试文件 `eslint` exit 0（全仓基线 3 error + 1 warning 不变），仓库根 `?? tmp-*` 仍为 **38**；④ **本条目为单行插入**，使本文件 §8 起行号 +1（按规则「先报告差异、不顺手修正」，不批量改写既有引用）；⑤ **未执行** `git add` / `commit` / `push` / `reset` / `clean`。
18. **CI-P7-03-A 交付记录（2026-10-10；本轮为产品代码 + 测试 + 文档，如实登记）**：① **改动面**：新增 **2 张表**（`ai_budget_reservations` / `ai_budget_decisions`）+ 账本新列 `ai_usage_ledger.budget_reservation_id`（均由 `src/db/client.ts` 建表机制与 `src/db/schema.ts` 定义落地，**无** drizzle-kit 迁移文件）；`src/lib/ai-budget-guard.ts` 的进程内 `Map` 预留**整体删除**，改为「一条原子 INSERT 取预留 → 幂等 UPDATE 结算 → TTL 清扫 + 保留期裁剪 → 决策留痕 → 按预留 id 对账」；`aiBudgetEnforcement` 由 `in-process-soft` → **`cross-process-atomic`**（预算面板 + 三语 locale 同步为同一口径）；**15 处闸门落点全部接线**（13 个调用文件加 `identity: usageCall` / `usageCall.budgetReservationId` / `await budget.release()`，`worker/runner.ts` 两处步骤闸门加 `identity: { runId: run.id }`）；**未触碰** `src/features/ai-runtime` 与 C2 发布语义，未加/改迁移脚本，未改任何冻结面结论。② **主线新增 §附录 H**（**文末追加**，§1 / §13 / 附录 A–G 行号**零移动**）。③ **数字口径（实测）**：`tsc --noEmit` **exit 0**；全量 `vitest run` **exit 0，151 文件 / 1235 用例**（对照 §附录 G 的 148 / 1218 → **+3 文件 / +17 用例**；既有断言只做新语义同步，**无删除**）；本卡触碰文件 `eslint` **exit 0（0 error / 0 warning）**。④ **跨进程实测（真实子进程 `tsx`，非 mock）**：8 个进程抢「只够 4 个」的额度 → **恰好 4 个通过、4 个拿到 `AI_BUDGET_EXCEEDED`**；两个进程并发结算同一预留 → **恰好一个 `settled: true`**；崩溃进程留下的预留被新进程按 `expires_at` 计量、并被下一次闸门调用标记 `expired`（不删除）。⑤ **事务能力先测后用**：新增 `src/db/client.transaction.test.ts`（3 例）证明本机 `file:` 库上 `db.transaction` 可回滚/可提交、单条语句可带参并精确返回 `rowsAffected`。⑥ **真实库副作用（如实登记）**：`web-data/social-auto-post.db` 的 `LastWriteTime` 变为 `2026-10-10T12:36:05+08:00` —— 应用在连接时应用 schema（`ensureDatabase()`），本机 dev server 因源码改动重编译即会触发；只读复核确认：**两张新表与账本新列已建，但新表 0 行、账本 0 行** → **未写入任何行**，仅新增式 DDL（本次只读复核未再改动 mtime）。⑦ **工作区基线**：`git status --porcelain` 实测 **271（104 M + 167 ??）**；仓库根 `?? tmp-*` 仍为 **38**（未新增临时文件，日志全部写在 `%TEMP%\cp-p7-03-a\`）。⑧ **本条目为单行插入**，使本文件 §8 起行号 **+1**（按规则「先报告差异、不顺手修正」，不批量改写既有引用）。⑨ **未执行** `git add` / `commit` / `push` / `reset` / `clean` / `stash`。

19. **CI-IA-03（菜单归属与命名修订）的两个副作用（本次，如实登记）**：① **工作区基线**：本卡**未新增、未删除任何文件**，改动全部落在 CI-IA-01 已登记的同一批文件上（`src/lib/console-nav.ts`、`src/lib/console-nav.test.ts`、`src/locales/{zh-cn,zh-hk,en}.json`，以及未跟踪的 `docs/development/menu-information-architecture.md`、`docs/menu-inventory.md`、`docs/coolpilot-capability-integration-plan.md` 与本文件）；本卡**未运行** `git status`（不触碰用户未提交工作），故不给出新的条目数，基线沿用 §7 第 18 条时点的 **271（104 M + 167 ??）**；**未执行**任何 `git add` / `commit` / `push` / `reset` / `clean` / `stash`。② **行号位移**：主线 `docs/coolpilot-capability-integration-plan.md` §1 新增 `CI-IA-03` 一行（第 **63** 行，插在 `CI-IA-02` 行之后）→ 主线**第 63 行之后整体再 +1**；叠加 CI-IA-01 / 02 的位移，**第 61 行之后的引用相对 CI-IA-01 之前共偏 +3**。本文件 §7 新增本条（连同前置空行共 **+2 行**）→ 本文件 **§8 起行号再 +2**（与第 17 / 18 条同一处理，按规则「先报告差异、不顺手修正」，**不批量改写**既有引用）；本次「§11 追加于文末」**不影响任何既有行号**。③ **真实库与运行实例**：本卡冒烟全部为只读 GET，**未写入** dev server 数据库、**未重启** `:3000` 实例；**未**新增任何表 / 列 / 迁移，**未触碰**冻结面（AI Runtime / C2 发布语义）。④ 一处**顺带的事实更正**（非本卡功能）：IA 文档 §11.2 原把 CP-IA-02 的日志文件写成 `vitest-final.log`，实际为 `vitest-full.log`（另存在 `vitest-full2.log`），已按实测更正。

20. **本轮（能力探测接入预算与账本；编号待作者指定）的事实与副作用（2026-10-11，如实登记）**：① **改动面**：**1 个新文件**（`src/app/api/ai/models/probe/route.test.ts`，293 行 / 7 用例）+ **3 个变更文件**（`src/features/ai-runtime/probe.ts` 262 行、`src/app/api/ai/models/probe/route.ts` 84 行、`src/lib/ai-metering.ts` 204 → 208 行）；**未改**任何数据模型（无新表 / 列 / 迁移）、**未触碰**发布语义 C2。② **闸门落点实测**：`beginAiBudgetCall(` 的调用点在 `src` 下 = **15 处 / 13 个文件**，**本卡只新增 1 处**（`src/app/api/ai/models/probe/route.ts:38`），其余 14 处一行未碰；另有 `src/lib/ai-budget-guard.ts:623`（闸门内部自身调用）与 `src/test/ai-budget-probe.ts:42`（测试探针）不计入。③ **数字口径（实测）**：全量 `npx vitest run` **exit 0 / 170 文件 1483 用例**（§18 上一轮 169 / 1476 → **+1 文件 / +7 用例**）；`npx tsc --noEmit` exit 0；本卡 4 个文件 `npx eslint` exit 0；`git diff --check` exit 0。④ **行号位移：零** —— 主线 **§附录 Q** 整体追加于文件末尾，§1 **未加行**，唯一触碰既有行的地方是 §附录 P · P.8「下一步编号」的**同行加字**（无位移）→ 主线既有引用**不需要修正**。本文件 **§7 新增本条与第 21 条**（连同空行 **+4 行**）→ 本文件 **§8 起行号 +4**（按规则「先报告差异、不顺手修正」，**不批量改写**既有引用）。⑤ **未执行** `git add` / `commit` / `push` / `reset` / `clean` / `stash`。
21. **待编号候选卡登记：Embedding 能力端到端接入（2026-10-11，未开工）**：① **登记位置** = 主线 **§附录 R** + 本文件 **§20**；② **不代填编号**（尤其**不**占 `CI-P7-05-05`）——两侧清单都没有它的号（`CI-P7-05-01` / 新清单 `P8-06` 第一条只管计量与**录价**；`CI-P3-03` / `P3-03-05` 的 RAG 预留是**有意未做**，见 §附录 B-10 §4）；③ **阻塞项** = 设计稿 `docs/model-layer-spec.md` **§15 Q1「向量存储放哪」**未决：(a) `ai_embeddings` 表 + JSON 列 + 内存暴力检索 / (b) `sqlite-vec` 类扩展（本仓库用 `@libsql/client`，有构建与分发风险）/ (c) 独立本地索引文件（自研，工作量最大）；比较材料见主线 **§附录 R.3**，**结论由作者给**；④ 本轮**未改业务代码 / 未建表 / 未发任何 AI 调用**；⑤ **未执行** `git add` / `commit` / `stash`。（**2026-10-11 追加**：该卡的阻塞项 **Q1 向量存储已裁定为方案 (a)** —— 裁定正文写入设计稿文末 **§15-Q1 决策记录**，执行拆分登记为主线 **§附录 S（阶段 0–7）**；仍未开工，仍无编号。）

22. **Q1 向量存储裁定 + Embedding 执行清单登记轮（2026-10-11）的事实与副作用（如实登记）**：① **改动面（纯文档 3 个文件）**：设计稿 `docs/model-layer-spec.md` 文末新增 **§15-Q1 决策记录**（裁定 = **方案 (a)：SQLite JSON 持久化向量 + TypeScript 内存暴力检索**）并**就地标注 3 处**（§15 表格 Q1 行、落地检查清单那一行、§11.4 第 ⑦ 步）；主线计划新增 **§附录 S：Embedding 开发执行清单**（阶段 0–7 的执行拆分，S.1–S.10）；本文件 **§19 下一步③ / §20 状态与阻塞项行 / §7 第 21 条**同轮更新 + **§7 本条**。② **行号位移**：设计稿**零位移**（§15 表格 `:972`、落地检查清单 `:987–993` 仍指向原内容 —— 这正是把裁定正文**追加于文末**而不插进 §15 表格下方的原因；新增节在 `:1002` 起）；主线计划**零位移**（§附录 S 追加于文件末尾，§附录 R 内 7 处均为**同行替换**）；本文件因**新增本条（+2 行）**，**§8 起行号 +2** —— 按规则「先报告差异、不顺手修正」，**不批量改写**既有引用。③ **不替作者勾选**：落地检查清单那一行是「§15 的 Q1–Q5 全有结论」，Q2–Q5 仍无结论 → 只就地标注现状，**勾选框保持未勾选**。④ 本轮**未改业务代码 / 未新增表 / 列 / 迁移 / 未写任何实现代码 / 未发任何 AI 调用**；⑤ **未执行** `git add` / `commit` / `push` / `reset` / `clean` / `stash`。

## 8. CI-IA-01（控制台菜单信息架构重整）状态：done（2026-10-10）

> **卡片来源**：作者 2026-10-10 的菜单重整要求（「把左侧导航按用户业务目标分成 8 组、统一命名、三语同步，不新增没有真实页面的占位菜单」）。**它不来自 10 个开源项目整合清单**，因此本文件 §3 的新旧编号对照表**不含本卡**，也不占用任何 `CI-P*` 卡号。

| 项 | 内容 |
| --- | --- |
| 交付范围 | 左侧导航 **9 个顶层项 → 8 个业务分组**（工作台 / 数据与资产 / 内容创作 / 发布与渠道 / 自动化 / 应用与市场 / 运营管理 / 系统设置），叶子仍为 **30** 条；**路由、权限、API、数据库、业务逻辑零改动** |
| 代码改动 | **新增** `src/lib/console-nav.ts`（菜单树唯一事实来源：`consoleNavItems` / `consoleMobileNavIds` / `consoleNavOffMenuRoutes` + 5 个纯函数）与 `src/lib/console-nav.test.ts`（10 例不变式）；改 `src/components/console-layout-shell.tsx`（改为消费共享模型，删掉内联导航数组与本地助手）；三语 locale 新增 4 个分组 key、改名 9 个标签（**key 名一律未改**） |
| 文档改动 | **新增** `docs/development/menu-information-architecture.md`（依据与原则 / 8 组结构 / **每页职责证据** / **旧→新 30 条逐项映射** / 与建议稿的 12 条差异及理由 / i18n 对照 / 路由权限兼容性 / 验证 / 遗留 / 今后治理规则）；`docs/menu-inventory.md` 新增 **§2.1**（原 §2 盘点表原样保留为历史证据）；主线新增 **§附录 E** 与 §1 一行（`CI-IA-01`）；本文件新增本节与 §7 第 15 条 |
| 验证结果（本轮实跑） | `tsc --noEmit` → **exit 0**；全量 `vitest run` → **147 文件 / 1198 用例全通过**（本卡 +1 文件 / +10 用例，**既有用例零改动**）；`eslint .` → 与基线逐条相同的 3 error + 1 warning（`tmp-probe-db.cjs` / `tmp-probe-zod-json-schema.cjs` / `chat-conversation.tsx:146`，**本卡触碰的文件零问题**）；真实浏览器（Playwright，dev server `:3000`，`zh-cn` / `zh-hk` / `en`）→ **111/111 通过**（8 组名称与顺序、每组件数 2/6/6/6/3/1/3/3、30 叶子且 href 无重复、href 集合与改动前逐条相同、分组收起/展开、深链 `/system/cost-center` 自动展开与分组+叶子高亮、跨 4 组点击的 URL/标题/高亮、5 个改名标签渲染、控制台零 error、移动端 5 页签与 `/content/library` 落点） |
| 证据位置 | 逐项见 `docs/development/menu-information-architecture.md` §4（映射）/ §5（差异与理由）/ §6（i18n）/ §7（兼容性）/ §8（验证）；日志与冒烟脚本在 **`%TEMP%\cp-ia-01\`**（`tsc.log` / `vitest-nav.log` / `vitest-full.log` / `eslint-changed.log` / `menu-smoke.log` / `menu-smoke.mjs`），仓库根**未新增** `tmp-*` |
| 未做（刻意） | 不改任何路由；不改权限（侧边栏本无权限判断，也未新增）；不动左下角帐号菜单（7 项）；不新增「Agent 市场 / Workflow 市场 / 模板市场 / 视频创作 / 工作流·自动化任务 / 预算管理 / 媒体资产」等**无真实页面**的菜单；不做商业分层入口；底层页面与数据模型一律未动 |
| 遗留（无阻塞） | 详见 `docs/development/menu-information-architecture.md` §9：移动端长标签（发布与渠道）若收窄需新增「移动端短标签 key」（需作者批准新增 key）；`navOperationLogs` 的 key 名与显示名「执行历史」不再字面一致；`navSmartConfig` 因空容器删除而降为无引用 key（连同既有 `navSites` / `navContent`）；「AI写作 / 文章创作」能力重叠待**产品裁定**（导航层已按「不擅自删页面」保留两条入口）；帐号菜单副标题仍用 `navSettings` 属**既有**占位实现；侧边栏渲染层无 DOM 单测（vitest 无 DOM 环境），本卡以真实浏览器实测覆盖 |
| 下一步 | 待作者指定；本卡不改动任何卡的编号、顺序与状态（主线 §1 仅**新增** `CI-IA-01` 一行，并在 §附录 E 登记由此产生的行号位移，见 §7 第 15 条） |

## 9. CI-IA-02（控制台菜单按商业/产品架构重排 + 移动端短标签）状态：done（2026-10-10）

> **卡片来源**：作者 2026-10-10 的第二轮菜单要求（在 CI-IA-01 的 8 组之上确定**商业排序与命名**，并给移动端 5 个页签补**独立短标签**）。与 CI-IA-01 一样**不来自** 10 个开源项目整合清单，因此本文件 §3 的新旧编号对照表**不含本卡**，也不占用任何 `CI-P*` 卡号。

| 项 | 内容 |
| --- | --- |
| 交付范围 | 8 个分组**改序**为 工作台 → 内容创作 → 品牌与资产 → 发布与渠道 → 自动化 → 数据与成本 → 扩展市场 → 系统设置；6 处显示名改动（3 个分组名 + 3 个叶子/其他名）；移动端 5 页签改用**新增的短标签 key**。叶子仍 **30** 条；**路由、权限、API、数据库、业务逻辑与页面实现零改动** |
| 代码改动 | `src/lib/console-nav.ts`（重排 `consoleNavItems`；`consoleMobileNavIds` 改为 workbench · creation · assets · publishing · system；新增 `mobileLabelKey` 字段与 `mobileName` 解析）；`src/components/console-layout-shell.tsx`（底部导航改读 `mobileName`）；`src/lib/console-nav.test.ts`（新增 `expectedGroupOrder`、重排 `expectedOwnership` / `expectedMobileTabs`，新增组序 / 移动页签短标签 / 标签唯一性不变式，**+2 用例**）；三语 locale 新增 **5 个 key**、改 **6 个显示值**（**既有 key 名一律未改**） |
| 文档改动 | `docs/development/menu-information-architecture.md`（重写 §2、扩写 §3，新增 §4.1 / §5.1 #13–21 / §7.1 / §8.2 / §9 #8–10 / §11.3，并同步 §6 / §10 / §11）；`docs/menu-inventory.md`（新增 §2.2 与 §4.1，原 §2 盘点表与 §4 旧移动端表**原样保留为历史证据**）；主线新增 **§附录 F** 与 §1 一行（`CI-IA-02`）；本文件新增本节与 §7 第 16 条 |
| 验证结果（本轮实跑） | `tsc --noEmit` → **exit 0**；全量 `vitest run`（默认 reporter）→ **exit 0**，`Test Files 147 passed (147)` / `Tests 1200 passed (1200)`（基线 147 / 1198，本卡 **+2 用例**，**既有用例零改动**）；`eslint <本卡 3 个改动源文件>` → **exit 0 无输出**；`eslint .` → 与基线逐条相同的 3 error + 1 warning（全部在未改动的 `tmp-probe-db.cjs` / `tmp-probe-zod-json-schema.cjs` / `chat-conversation.tsx:146`）；真实浏览器（Playwright / Chromium，dev server `:3000`，`zh-cn` / `zh-hk` / `en`）→ **各 40 项，120/120 通过（exit 0）**：三语组名与顺序、每组件数 2/6/6/6/3/3/1/3、30 叶子且 href 与改动前逐条相同、收起/展开、深链自动展开与高亮、跨 4 组点击的标题与高亮（分组序号 2/5/7/8）、3 个改名标签渲染、控制台零 error、移动端 390px 5 页签短标签与 5 个落点 |
| 证据位置 | 逐项见 `docs/development/menu-information-architecture.md` §4.1（变化表）/ §5.1（判断与差异）/ §6（i18n）/ §7.1（兼容性核查）/ §8.2（验证与实际结果）；日志与冒烟脚本在 **`%TEMP%\cp-ia-02\`**（`tsc.log` / `vitest-final.log` / `eslint-changed.log` / `menu-smoke.log` / `menu-smoke.mjs`），仓库根**未新增** `tmp-*` |
| 未做（刻意） | 不改任何路由（30/30 逐条相同）；不改权限（侧边栏本无权限判断，也未新增）；不动左下角帐号菜单；不新增「Agent 市场 / Workflow 市场 / 模板市场 / 视频创作 …」等**无真实页面**的菜单（「扩展市场」只承载今天真实存在的 `/app-store`）；不合并「AI 写作 / 文章创作」；不改「影片 / 帐号」用词（另立术语统一卡）；**未改**任何卡片的编号、顺序与状态 |
| 遗留（无阻塞） | IA 文档 §9 第 8–10 条：菜单「AI 对话」与页面标题「Agent 聊天室」不一致；「生成记录」归组属**待裁定判断**（内容资产历史 vs 执行审计）；「影片 / 帐号」术语统一需单独一张卡。IA 文档 §9 第 1 条（移动端长标签）**已由本卡关闭** |
| 下一步 | 待作者指定；本卡不改动任何卡的编号、顺序与状态（主线 §1 仅**新增** `CI-IA-02` 一行，并在 §附录 F 登记由此产生的行号位移，见 §7 第 16 条） |


## 10. `CI-AI-IMG-CONFIG` 卡族（文本与图片模型独立配置）状态：**-03 已交付**（2026-10-10 补记）

> **卡片来源**：作者直接授权的支线（截图现象：图片与文本**共用**同一 Base URL 与 Key）。与 CI-IA-01/02 一样**不来自** 10 个开源项目整合清单，因此本文件 §3 的新旧编号对照表**不含本卡族**，也不占用任何 `CI-P*` 卡号。
>
> **补记缘由（2026-10-10 复核）**：此前本文件与主线 `docs/coolpilot-capability-integration-plan.md` 内 `CI-AI-IMG` 命中数**均为 0**——即"架构文档已完成、主线与编号对照表无记录"。现按作者要求补记：主线 §1 新增 5 行 + **§附录 I**，本文件新增本节。

| 卡片 | 范围 | 状态 | 证据位置 |
| --- | --- | --- | --- |
| CI-AI-IMG-CONFIG-01 | 只读审计与设计（现状证据 / 方案 A·B·C / 推荐 B+C 的 Gemini 结论 / 冻结面清单 / 四阶段 / 测试矩阵） | done（**未改**代码 · 库 · 迁移） | `docs/architecture/independent-image-provider-configuration.md` |
| CI-AI-IMG-CONFIG-02 | 阶段 1：`openAIImageBaseUrl` / `openAIImageKey` / `geminiImageKey` 字段与校验、图片 Key 走独立 `credentialRef`、设置页独立输入（**不触 runtime**） | done | `docs/architecture/ci-ai-img-config-02-delivery.md` |
| CI-AI-IMG-CONFIG-03 | 阶段 2：`openai-image` / `gemini-image` provider 与端点行、图片模型绑图片 provider、`image-generation` 的 pin 映射、保存即对账（**触冻结面**） | done（CR **已批准并实施**） | CR `docs/architecture/ci-ai-img-config-03-freeze-surface-change-request.md:3`；交付 `docs/architecture/ci-ai-img-config-03-delivery.md` |

| 项 | 内容 |
| --- | --- |
| 冻结面 | `src/features/ai-runtime/registry.ts`（F1）、`src/lib/agent/image-generation.ts`（F3）；`contracts.ts` 经核实**无需改动**（F2）。CR §0~§7 正文**未改写**，仅在第 3 行追加实施后的事实标注 |
| 真实验证（作者 2026-10-10 验收：**功能实现成功**） | 用户本地安装 + 用户自配端点与凭据，1 次真实调用：`POST /api/images` → **HTTP 201（约 22s）**、`provider="openai-image"`、`model="gpt-image-2.5-sunburst"`；产物 1,668,289 字节、PNG 魔数正确、IHDR **1024×1024**、`GET /api/agent/artifacts` 200 `image/png`；账本 `provider_id="openai-image"` / `endpoint_id="openai-image/default"` / `cost_amount=NULL` + `cost_source="unknown"`（未写 0）；预算决策 `route_resolved=1`（落地前同库旧行为 `route-unresolved`）；文本端点 `api.deepseek.com` 全程未被使用。证据：`tmp-ci-img-03-live-verify.log`（凭据掩码）与 -03 交付记录 §3.2 |
| 未验证项（**不得写成通过**） | ① 真实安装上"清空图片 URL → 结构化失败（不回退）"（仅隔离环境自动化覆盖）；② **打包版 Electron**——设计稿 §9.3 验收标准 3 要求以打包产物验证，目前仅 dev server 实测，**该条验收标准未满足**；③ 真实 Gemini 图片调用（只验证端点/凭据独立与可路由）；④ 真实安装上端点"禁用 → 恢复"的 UI 操作；⑤ 真实端点上的图片 Key 轮换 / 多 Key 池 / 冷却。逐条见 -03 交付记录 §3.3 |
| 验证（自动化） | 定向：`src/app/api/images/route.test.ts` + `src/features/ai-runtime/image-provider-config.test.ts` = **26 通过 / 0 失败**；i18n 与冷启动回归 **7 文件 / 63 用例全通过**；`tsc --noEmit` exit 0；`eslint` exit 0 |
| 文档改动 | `docs/architecture/`（设计稿 + 02/03 交付记录 + CR）；主线新增 **§附录 I** 与 §1 五行及两条登记说明；本文件新增本节 |
| 未做（刻意） | 不做数据迁移（F5 经核实无需 `ALTER`：C1a/C1b 为加性写入）；不改文本 provider 的 seed / import / 路由（回归全绿）；**不自改设计文档**（与 Q4 冲突的行号只列不改，见 -03 交付记录 §5）；本卡族全程**未执行** `git add` / `git commit` / `git push` |
| 遗留（无阻塞） | ① 设计文档按 Q4 修订（§4.2/§5.1/§5.3/§6.3/§6.4）+ §10 Q1–Q4 回填 + 阶段 4「清理与文档」= **CI-AI-IMG-CONFIG-04**（建议编号，待作者确认）；② 图片计量与**定价** = **`CI-P7-05-01`**，与本文件 §7 第 6 条（非文本维度缺录价表单 → 恒为 `unpriced`）一致；③ 图片端点绑定边界（`ensureLegacyModel` 对"先存模型、后存 URL"不重绑 `endpointId`，`src/features/ai-runtime/registry.ts:603-637`）= **CI-AI-IMG-CONFIG-05**（建议编号）；④ `provider` 新值在账本/预算/用量分组与成本中心的归口口径，归 -04 |
| 下一步 | 作者指定：**先完成文档登记闭环 → 回到 `CI-P5-03` 发布业务闭环**；且 `CI-P5-03` 开工前必须先裁决"远程封面"处理策略（主线 §附录 I.5 已列出代码事实 `src/lib/publish.ts:34-40`、实测复现 `tmp-p5-01-import-url.log.json`、缺陷台账与三选一候选） |

## 11. CI-IA-03（控制台菜单归属与命名修订）状态：done（2026-10-10）

> **卡片来源**：作者 2026-10-10 的第三轮菜单要求（直接指定「**动态发布 → 动态创作，并移入内容创作**；影片发布保留在发布与渠道」）。与 CI-IA-01 / CI-IA-02 一样**不来自** 10 个开源项目整合清单，因此本文件 §3 的新旧编号对照表**不含本卡**，也不占用任何 `CI-P*` 卡号。
>
> **为什么只有一处改动**：本卡先做**只读盘点**（作者目标架构 8 组 × 逐叶子 vs 当前代码），结论是**除 `/creation/posts` 外，8 组的顺序、分组名与其余 29 条叶子的归属均已与目标架构一致**（CI-IA-01 / 02 已完成的部分不重做）。因此实际改动只有 1 处归属 + 1 处显示名。

| 项 | 内容 |
| --- | --- |
| 交付范围 | 叶子 `posts`（`/creation/posts`）由「发布与渠道」移入「内容创作」（组内**最后一条**）；显示名「动态发布 / 動態發佈 / Posts」→「动态创作 / 動態創作 / Post Creation」。组序、分组名、其余 29 条叶子**零改动**；叶子仍 **30** 条；**路由、权限、API、数据库、业务逻辑与页面实现零改动** |
| 代码改动 | `src/lib/console-nav.ts`（`posts` 归位；文件头 CI-IA-03 说明；该叶子与 `videos` 的归属注释同步）；`src/lib/console-nav.test.ts`（`expectedOwnership` 的 `creation` 追加 `posts`、`publishing` 去掉 `posts`；新增 1 例「CI-IA-03 作者决定」不变式；`describe` 标题同步）；三语 locale **改 1 个显示值、key 名零改动、未新增 key**（`navDynamicPublishing`） |
| 刻意保留（作者明示） | `/creation/videos`（影片发布）**留在发布与渠道**——三步骤影片发布组装而非创作工具，是对 IA-01 决策 2 的**唯一例外**；移动端 `consoleMobileNavIds` 与 5 个页签落点**未变**（`creation` 首项仍是 `/creation/ai-writing`） |
| 文档改动 | `docs/development/menu-information-architecture.md`（§1–§4 同步、新增 **§5.2** #22–24、§6 增 CI-IA-03 改名表、新增 **§7.2** 与 **§8.3**、§9 新增第 11 条、§11.1–§11.3 补记）；`docs/menu-inventory.md`（新增 **§2.3**）；主线新增 **§附录 J** 与 §1 一行（`CI-IA-03`）；本文件新增本节与 §7 第 19 条 |
| 验证结果（本轮实跑） | `tsc --noEmit` → **exit 0**；定向 `vitest run src/lib/console-nav.test.ts` → **exit 0**（`Tests 13 passed (13)`，CI-IA-02 为 12 例 → **+1 例**）；全量 `vitest run` → `Test Files 153 passed / 1 failed (154)`、`Tests 1263 passed / 2 failed (1265)`——**2 条失败全在 `src/worker/runner.test.ts`**（`expected 'paused' to be 'failed'`），属作者**在途未提交**的 `src/worker/runner.ts`（CI-P7-03 系列；主线 §附录 B-10 第 1385 行已登记同一基线失败），**本卡未触碰该文件**；`eslint <本卡 2 个改动源文件>` → **exit 0 无输出**；真实浏览器（Playwright / Chromium，dev server `:3000`，`zh-cn` / `zh-hk` / `en` 各 26 项）→ **78/78 通过（exit 0）** |
| 证据位置 | 逐项见 `docs/development/menu-information-architecture.md` **§5.2**（判断与差异）/ **§6**（i18n）/ **§7.2**（兼容性核查）/ **§8.3**（验证与实际结果）；日志与冒烟脚本在 **`%TEMP%\cp-ia-03\`**（`menu-smoke.log` / `menu-smoke.mjs`），仓库根**未新增**任何 `tmp-*` |
| 未做（刻意） | 不改任何路由（30/30 逐条相同）；不改权限；不动左下角帐号菜单；**未**把「影片发布」移出发布与渠道；未替「内容创作」补建「视频创作」入口（磁盘实测无该页面）；未新增任何菜单 / 占位页；未改「发布排程」「执行伫列」用词（另立术语统一卡）；**未改**任何卡片的编号、顺序与状态 |
| 遗留（无阻塞） | 术语差异 2 处：目标稿「发布排期」vs 实际「发布排程」（`navSchedules`）；目标稿「执行队列」vs `zh-cn` 实际「执行伫列」（「伫」为繁体字形，CI-IA-01 曾刻意对齐既有 `queueRun` 译法）= IA 文档 §9 第 11 条，与第 10 条合并另立卡。IA 文档 §9 其余条目（「AI 对话」vs 页面标题「Agent 聊天室」、「生成记录」归组待裁定）**未由本卡关闭** |
| 作者验收与关闭（2026-10-10） | **通过并关闭（done/closed）**。作者逐维度确认：8 组 / 30 叶子、`posts` 归「内容创作」、三语同步、路由与权限边界未改、移动端 5 个落点未变、定向 13/13、浏览器冒烟 78/78。**本卡不再扩展，也不立即启动新的菜单调整卡**；「智能画布」的**信息架构判定**（留在「内容创作」）成立，其**产品价值判定**另立**只读能力盘点**（不塞进本卡）；全量 2 条 `src/worker/runner.test.ts` 失败仍归 **CI-P7-03 系列**独立跟踪；IA 文档 §9 两项遗留（「AI 对话」vs 页面标题「Agent 聊天室」、「生成记录」归组）**继续留在待裁定清单**，不因本卡关闭而立即启动术语统一卡。完整登记见主线 §附录 J「作者验收与关闭（2026-10-10）」 |
| 下一步 | ①「智能画布」已有能力**只读盘点**（AI 生成结果能否保存 / 复用、能否转化为文章大纲或视频脚本，**以实际代码为准、不预设结论**）；② 由作者据盘点结果与真实缺口指定下一张卡。本卡不改动任何卡的编号、顺序与状态（主线 §1 仅**新增** `CI-IA-03` 一行，并在 §附录 J 登记由此产生的行号位移，见 §7 第 19 条） |



## 12. CI-SC-01（智能画布产物进入文章编辑器最小闭环）状态：见 §1 登记（2026-10-10，作者授权支线）

> **卡片来源**：作者在「智能画布」只读盘点（CI-IA-03 关闭时立的分派）之后**直接授权**的支线，`CI-SC` = **S**mart **C**anvas。与 CI-IA-01 / 02 / 03 及 `CI-AI-IMG-CONFIG-*` 一样**不来自** 10 个开源项目整合清单，因此本文件 §3 的新旧编号对照表**不含本卡**，也不占用任何 `CI-P*` 卡号。登记见主线 **§1**（新增 1 行 + 1 条登记依据说明）与 **§附录 K**。

| 项 | 内容 |
| --- | --- |
| 卡片 | `CI-SC-01` 智能画布产物进入文章编辑器最小闭环 |
| 立项依据（作者 2026-10-10 裁定，三个决策点） | ① 画布产物 `metadata.type = "article"`，来源用 `source: "mindmap"` / `"whiteboard"` 区分（不新造 `type` 值）；② 导图入库的正文**只保留子节点**，`mindMapToMarkdown()` 新增 `includeRoot` 参数且**默认 `true`**（既有汇出与 AI 往返行为不变）；③ 来源映射抽成纯函数并单测，固定各来源的展示行为 |
| 代码改动 | ① `src/app/api/content/whiteboard/route.ts`（补 `metadata.type`，默认 `article`，守卫用与 `listContentItems()` 同一条 `/^[a-z0-9-]+$/i`，保留 `source: "whiteboard"` 与 `{ item }`/201 响应形状）；② 新增 `src/mindmap/mindmap-content.ts`（`mindMapContentDraft()`：正文 = `postReadyText` = 三级标题子节点大纲，标题取根主题、空则回退；根无子节点时回退整棵树）；③ `src/mindmap/mindmap-canvas.tsx`（工具栏「存入内容库」按钮 + `saveToLibrary()`，POST 到既有 `/api/content`）；④ 新增 `src/lib/content-source.ts`（`contentSourceKey()`，`mindmap`/`whiteboard` 优先，其余分支与原实现逐条一致）+ `articles-workspace.tsx` 改用它；⑤ `src/lib/validation.ts` `contentCreateSchema` 增加 `source`（可选、默认 `""`）+ `src/app/api/content/route.ts` 仅在**提供**时写入 `metadata.source`（默认不写入 → 既有调用方 metadata 不变）；⑥ `src/app/[locale]/(console)/content/library/page.tsx` 详情对话框新增「在编辑器中打开」（复用 `articleEditorHref()` 与既有 `awOpenEditor` 文案，仅 `type === "article"` 时渲染）；⑦ 三语 locale 各新增 5 个 key（`arSourceMindmap` / `arSourceWhiteboard` / `mmSaveToLibrary` / `mmSaveToLibraryDone` / `mmSaveToLibraryFailed`），**key 名零改动** |
| 新增测试 | `src/app/api/content/whiteboard/route.test.ts`（6）、`src/app/api/content/route.test.ts`（2）、`src/mindmap/mindmap-content.test.ts`（5）、`src/lib/content-source.test.ts`（5）、`src/mindmap/mindmap-markdown.test.ts`（+1）= **+19 例**（白板一例覆盖「创建 → 编辑器式 PATCH → 仍可被 `?type=article` 检索」） |
| 刻意不改（作者明示的非目标） | 画布本身的重写；新顶级菜单；AI 写作素材链；视频脚本生成；AI Runtime / 预算闸门 / 使用量账本 / 数据库表结构；Drawnix 客户端与它的 5 语言 i18n；`src/components/content-type-workspace.tsx`（0 引用死代码，**只登记不删除**）；不修改列表过滤规则与发布语义 |
| 验证结果 | 单测/静态逐条命令与结果见主线 **§附录 K.5**；**真实浏览器端到端**（Playwright + 真实 Chromium 打用户 dev server）见 **§附录 K.8**（首轮 20/21、测试条目已清理）与 **§附录 K.9**（软导航修复后**复跑 21/21 通过、0 FAIL**，测试条目 2 条已删、`remaining=(none)`） |
| 遗留（**原 1 项阻断已关闭**） | ① `src/worker/runner.test.ts` 的 2 条失败是作者**在途未提交**的 `src/worker/runner.ts`（CI-P7-03 系列）既有基线，本卡未触碰该文件；② ~~内容库「在编辑器中打开」软导航不消费 `?edit=`~~ → **已由后继卡 `CI-ARTICLE-NAV-01` 定位并修复**（根因不是 hook 未交付参数，而是「已消费」守卫在请求在途时被置位 + cleanup 作废在途请求；见主线 §附录 **K.9**），作者验收套件复跑 **21/21**；③ `POST /api/content/whiteboard` 无 CORS `OPTIONS`（Drawnix 客户端与宿主**同源**，属继承风险，本卡不扩大范围）；④ 打包版 Electron 行为仍未验证（dev server 实测） |
| Git | 全程**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`；作者在途的 `src/worker/runner.ts` 等未提交改动**未被触碰** |

## 13. CI-ARTICLE-NAV-01（修复文章编辑器查询参数软导航）状态：done（2026-10-10，作者直派的后继支线）

> **卡片来源**：作者在 CI-SC-01 的唯一失败项（真实浏览器 B3：内容库「在编辑器中打开」的软导航不消费 `?edit=`）上**直派**的后继支线。与 CI-SC-01 一样**不来自** 10 个开源项目整合清单，因此本文件 §3 的新旧编号对照表**不含本卡**，也不占用任何 `CI-P*` 卡号。登记见主线 **§1**（新增 1 行 + 1 条登记依据说明）与 **§附录 K.9**。

| 项 | 内容 |
| --- | --- |
| 卡片 | `CI-ARTICLE-NAV-01` 修复文章编辑器查询参数软导航（内容库「在编辑器中打开」点击进入不再丢失 `?edit=`） |
| 根因（实测） | **不是** `useSearchParams()` 未交付参数（该假设已被推翻）：参数已交付、工作区 effect 已发出取条目请求并拿到 200，但「已消费」守卫 ref 在 `await` **之前**就被置位，而 effect 重跑时的 cleanup 把这次**唯一**在途请求作废（`live=false`）→ 响应回来时 `setEditingItem` 被跳过、又不允许重试 → 页面停在列表且无报错。可控证据：临时日志轨迹 `start → cleanup(live=true) → skip-consumed → resolved(live=false)`（软导航）vs `start → resolved(live=true)`（硬加载） |
| 修复 | 只改 `src/components/creation/articles-workspace.tsx` 的 `?edit=` effect：把「已消费」的写入从请求**开始前**移到请求**落地后**（成功/失败两分支），与 AI 写作向导 `?topicId=` 入口既有写法一致（`ai-writing-workspace.tsx:50-71`）。**未**改 `useSearchParams`，**未**改路由配置，**未**改数据模型 / AI Runtime / 发布链路 |
| 改动文件 | `src/components/creation/articles-workspace.tsx`（effect 内 3 处 `if (!live) return;` + ref 位置移动）、`scripts/creator-editor-link-smoke.ts`（新增「点击内容库链接」「历史前进」两条真实触发路径断言） |
| 新增/更新测试 | `scripts/creator-editor-link-smoke.ts`（Playwright + 自建自删 fixture，`exit 0`；并已**反向验证**：回退修复后该脚本恰在「点击后编辑器没打开」处失败） |
| 验证结果 | 真实浏览器（用户 dev server，未另起/未终止进程）：本卡探针 **9/9**；作者验收套件 `e2e-acceptance.cjs` 复跑 **21/21 PASS / 0 FAIL**；`tsc --noEmit` exit 0；定向 `eslint`（2 文件）exit 0；定向 `vitest`（`src/lib/editor-link.test.ts` + `src/lib/content-source.test.ts`）exit 0 |
| 兄弟入口评估 | `?topicId=`（AI 写作向导）**无同样问题**（既有写法本就是「settle 后再记」），真实浏览器复核软导航后素材已预填 → **本卡未改**；`ai-writing-step-output.tsx:127` 的既有 `?edit=` 入口需一次真实生成，**未运行** |
| 遗留 | ① 打包版 Electron 未验证（且该缺陷的触发器是 React **开发态**多跑的一轮 setup/cleanup，生产构建是否曾受影响**未测**、不得据此推断）；② 真实发布 `/api/publish` 未跑；③ 仅测 `zh-cn`；④ `src/worker/runner.test.ts` 的 2 条失败仍属作者在途 CI-P7-03 基线 |
| Git | 全程**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`；探针脚本与证据落在 `%TEMP%\cp-sc-01\`，仓库根未新增文件；测试数据（2 条内容 + 1 条临时选题）均按应用自身接口删除并复查（`get-after=404`、`topics` 计数回到 0） |


## 14. CI-P7-04（= P8-05）状态：done（2026-10-11）

> **卡片来源**：主线 §13 第 **465–469** 行（`### CI-P7-04：质量与成本优化`），三条子项 = ①首轮通过率 / 人工修改幅度 / 平均重试次数 / 内容采用率 ②单位合格产出的成本（优化目标函数）③基于真实数据提出优化建议、**用户确认后**才调整策略。卡片不来自 10 个开源项目整合清单的额外来源，因此本文件 §3 那一行**本来就存在**，本轮只是把状态与行号一并更正（见 §3 第 103 行）。逐条证据见主线 **§附录 L**。

| 项 | 内容 |
| --- | --- |
| 交付物（实测行数） | 新增 `src/lib/quality-cost.ts`（612）+ `quality-cost.test.ts`（500，27 例）、`src/db/repositories/quality-cost.ts`（140）、`src/app/api/ai-cost-center/quality/route.ts`（168）+ `route.test.ts`（331，10 例）、`src/components/cost-center/quality-panel.tsx`（511）；改写 `src/components/cost-center/cost-center-client.tsx`（+6/−18，接入面板并删掉「未开工」占位）、`src/lib/validation.ts`（+32/−3，`aiQualitySuggestionRequestSchema`）、三语 locale（各 +121/−2 键，其中**本卡新增 79 个 `quality*` 键**、删除 2 个占位键 `costCenterTaskQuality` / `costCenterStubNote`；同一 diff 里其余新增键属工作区**其他在途卡**） |
| 关键口径（写进类型与文案） | ①没有分母的比率一律 `null` 而非 `0`（无调用 / 无采用产出 / 无渲染版本）；②`首轮通过率` = 一次调用只发一个请求、且是该调用的**第一个**请求（`attemptIndex === 0`）、且成功，沿 `parentUsageId` 找不到前任的请求只计入 `calls` / `requests` 与 `unresolvedPredecessorRequests`，**不计入两个通过率**（保守口径）；③`人工修改幅度` 只报得到的那一半（人工重写过的渲染版本占比）+ 显式 `magnitudeRecorded: false`；④目标函数按**币种分别**算，未归因金额不丢弃、单列 `unattributedByCurrency`，缺价时单位成本标为下限 `≥`；⑤采用 = 内容状态到 `posted` |
| 唯一的写动作 | 建议只有三种动作：`strategy`（唯一会写设置的，写预算 `strategy` 档位）、`link`（价格目录 / 预算页签）、`none`（明说没有开关）。`POST` **只带一个建议 id**，档位在请求到达时由服务端**重新推导**：premise 不成立 → `409 suggestion-not-applicable`（无写入），body 非法 → `400 INVALID_PAYLOAD`；写入成功后返回**写完之后的窗口**，页面不再自行猜测 |
| 验证结果（本轮实跑） | `npx vitest run src/lib/quality-cost.test.ts src/app/api/ai-cost-center/quality/route.test.ts` → **exit 0**（2 文件 / **37 用例**）；全量 `npx vitest run` → **exit 0**（**167 文件 / 1408 用例**，净增 2 文件 / 37 用例全部来自本卡）；`npx tsc --noEmit` → **exit 0**；`eslint` 本卡 8 个改动文件 → **exit 0（初跑 2 条 warning 已在卡内修掉）**；三语键集合**完全一致**、各 2378 键，被删键 `qualitySuggestionRule` 及其引用 **0 命中**；真实 dev server（作者在跑，未另起 / 未终止）`GET /api/ai-cost-center/quality?range=7` → **200** 真实 payload（`calls 6 / requests 6 / retries 0 / 通过率 1`；`content created 20 {draft 7, ready 13, posted 0} / adoptionRate 0`；`humanEdits editRate null + magnitudeRecorded false`；`objective adoptedOutputs 0 / tokensPerOutput null / byCurrency [] / unpricedRequests 5`；`suggestions [record-prices(link), review-adoption(none)]`；`budget {policy off, monthlyLimit null, strategy balanced}`）；`POST {"suggestionId":"review-adoption"}` → **409**（无写入） |
| 未验证（如实登记） | ①**未跑浏览器（Playwright）渲染验证**于新页签，UI 层只有 `tsc` + `eslint` + 接口契约测试；②**未**在真实库上真的点一次「应用」（会改写作者真实预算档位），写入路径只在临时库单测覆盖；③`人工修改幅度` 的**幅度**在本安装中**不存在**（无前后文本、条目 `updatedAt` 因任何写入而变），属**数据缺失**而非实现缺失；④真实库自然状态下只走到空态 / 降级态（`posted = 0`、价格目录为空），非空目标函数表与 `applied` 提示条只在临时库单测里走过；⑤打包版 Electron 未验证（各卡共通基线） |
| Git | 未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status` / `git diff` 取证）；日志与证据落在 `%TEMP%\cp-p7-04\`，仓库根 `?? tmp-*` 仍为 **73**、本卡未新增 |
| 下一步 | **`CI-P7-05` 覆盖全部 AI 能力与 Marketplace**（主线 §13 第 **471** 行起）；其中 `CI-P7-05-01`（图片 / 视频 / 语音 / Embedding 接入同一计量与**定价**，即 §7 第 6 条与 §附录 I 的遗留）正是本卡在真实库上暴露的那条缺口：`unpricedRequests` 非零时「单位合格产出的成本」只能是下限或「无法计量」 |

## 15. CI-P7-05-02（= P8-06 的第二条）状态：done（2026-10-11）

> **卡片来源**：主线 §13 第 **471–476** 行（`### CI-P7-05：覆盖全部 AI 能力与 Marketplace`，标题行 **471**，行号本轮实测）。本轮交付的是其中**第 474 行**这一条 —— `P7-05-02`「Agent / Workflow 的**节点级调用记录**、**总成本**与**失败重试成本**」。同卡族的 `-01` / `-03` / `-04` **未交付**，故 `CI-P7-05` 整体仍为「部分就绪」（§3 第 104 行已同步补记）。逐条证据见主线 **§附录 M**。

| 项 | 内容 |
| --- | --- |
| 交付物（本卡改动实测） | 类型：`src/lib/types.ts` 新增 `AiUsageRunNodeCost`（1100–1117）/ `AiUsageRunCost`（1132–1164）+ `AiCostCenterCallsPayload.byRun`（1199）；纯函数：`src/lib/ai-usage-ledger.ts` 新增 `summarizeLedgerByRun`（配套 `rollLedgerRows` / `ledgerEntryRepeatsCall` / `summarizeRunNodes`）；接口：`src/app/api/ai-cost-center/calls/route.ts` **+4 行**（`byRun: summarizeLedgerByRun(inWindow)`）；页面：`src/components/cost-center/cost-center-client.tsx` 的 `callByRun`（204）/ `amountCell`（234–247）/ `retryText`（250–261）/ 卡片（789–882）；单测：`src/lib/ai-usage-ledger.test.ts` 新增 `describe("run and node cost readers (CI-P7-05-02)")` **6 例**、`src/app/api/ai-cost-center/calls/route.test.ts` 新增 **1 例**；文案：三语各新增 **17** 个 `costCenterRuns*` 键（同 diff 的其余 123 个键属工作区其他在途卡） |
| 关键口径（写进类型与文案） | ①**运行总额 = 它自己的节点行之和**，节点是一份**划分**（每条请求恰好进一个桶，`''` 桶保留为「未归类 / 未记录节点」而不是折进命名节点或丢行）；②**失败成本与重试成本是同一批请求的两种读数，永不相加**（一笔请求可以既重试又失败；唯一的总和是账面金额），卡片下方常驻说明；③失败的请求按**自己报出的**金额与 token 计入，失败≠免费；④未计价 / 未计量的行进 `unpricedAttempts` / `unmeasuredAttempts`，对应读数标 `≥` + 徽标，**一条金额都没有时写「无金额读数」而不是 0**；⑤前任落在读取行之外的重试仍计入 `retries`，另报 `unresolvedRetries` 且不编造它重复了什么；⑥金额按币种分别给出，不跨币种相加；⑦与 `byContent` 同读一条 `inWindow`，读数**不随上表筛选 / 翻页跳动**；⑧**纯只读**，本卡无任何写入路径 |
| 验证结果（本轮实跑） | 定向 `npx vitest run`（账本 + 路由 + i18n 覆盖，3 文件）→ **exit 0 / 70 用例**；全量 `npx vitest run` → **167 文件 / 1429 用例全通过**（本卡净增 7 例，其余增量属其他在途卡）；`npx tsc --noEmit` → **exit 0**；`npx eslint` 本卡 6 个源文件 → **exit 0 / 0 problems**；三语键集合**完全一致**、各 **2395** 键（本卡新增 17 个 `costCenterRuns*`）；真实 dev server（作者在跑，未另起 / 未终止）`GET /api/ai-cost-center/calls?range=7` → **200**、10326 字节，`byRun` 1 组：`runId ""`、`attempts 6` = **节点行之和 6**、`totalTokens 6156`、`costByCurrency []`、`unpricedAttempts 5 / unmeasuredAttempts 1`、`costIsComplete false`（本安装尚未录价、6/6 条请求未记 run / node，读数与库内真实状态一致）；**真实浏览器（Playwright）三语冒烟 → exit 0、72 项断言 0 失败**（探针拦下页面自身请求的 payload 后逐格核对 DOM：合计 = 节点之和 = `attempts`、失败 / 中断 / Token / 重试逐格一致、未归类组按本语言文案出现、无金额读数如实呈现、无运行时错误） |
| 未验证（如实登记） | ①真实库里 **6/6** 条请求 `runId` / `nodeId` 为空 → 实际页面只有**一个未归类组 + 一行节点**，多节点形态、未解析重试标注、`≥` 下限分支**未在真实库自然状态下出现**（由临时库单测与探针 payload 分支覆盖）；②真实库 `retries / failures / interrupted` 全为 **0**；③金额读数为空 → 「无金额」以外的金额渲染只在单测走过，**根因是范围外的 `-01`（非文本维度录价）未交付**；④窗口边缘被切开的一次运行两侧各计一次（既有取舍）；⑤打包版 Electron 未验证（各卡共通基线） |
| Git | 未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status` / `git diff` 取证）；`git status --porcelain` 实测 **127** 条（含其他在途卡）；仓库根 `?? tmp-*` 为**此前各卡遗留**，**本卡未新增**（探针 / 取证脚本 / live 响应 / 日志均在 `%TEMP%\cp-p7-05-02\`） |
| 下一步 | `CI-P7-05-01`（图片 / 视频 / 语音 / Embedding 接入同一计量与**定价**）——本卡与 §附录 L 已从两个方向暴露这条缺口：价格目录为空时，运行成本只能是「无金额读数」；随后 `-03`（Marketplace 归属）、`-04`（无法计量显式标记） |

## 16. CI-P7-05-03（= P8-06 的第三条）状态：done（2026-10-11）

> **卡片来源**：主线 §13 第 **471–476** 行（`### CI-P7-05：覆盖全部 AI 能力与 Marketplace`，标题行 **471**，行号本轮实测）。本轮交付的是其中**第 475 行**这一条 —— `P7-05-03`「Marketplace 扩展的扩展标识、任务标识与调用费用归属」。同卡族的 `-01` / `-04` **未交付**，故 `CI-P7-05` 整体仍为「部分就绪」（§3 第 104 行已同步补记）。逐条证据见主线 **§附录 N**。

| 项 | 内容 |
| --- | --- |
| 交付物（本卡改动实测） | 数据：`src/db/schema.ts` 新增 `extensionId`（**540**，注释 **536–539**，身份列约定注释 **503–505**）；迁移：`src/db/client.ts`（**714** `ALTER`、**719** 索引 `idx_ai_usage_ledger_extension_created`，**不回填历史行**）；仓储：`src/db/repository.ts`（**1251 / 1317 / 1362**）；类型：`src/lib/types.ts`（**779** `AiUsageLedgerEntry.extensionId`、**1089** `AiUsageCallContext`、**1198–1225** `AiUsageExtensionCost`、**1277** `byExtension`、**1285** `options.extensions`）；归属规则（新文件）：`src/lib/marketplace-attribution.ts`（**36** `MarketplaceExtensionSource`、**52** `marketplaceExtensionIdOf`）；货架 id 同源：`src/lib/app-store-catalog.ts`（**72 / 78 / 90**）+ `src/app/api/app-store/route.ts`（**14**）；真实调用点：`src/lib/article-generation.ts`（**93 / 181–187**）、`src/app/api/content/generate/route.ts`（**181**）、`src/app/api/knowledge-base/ai-parse/route.ts`（**63–77 / 104**）；读数：`src/lib/ai-usage-ledger.ts`（**498** 筛选、**932–990** `summarizeLedgerByExtension`）；接口：`src/app/api/ai-cost-center/calls/route.ts`（**101 / 206–208 / 286**）；页面：`src/components/cost-center/cost-center-client.tsx`（**80 / 177 / 207 / 399–439 / 905–1010**）；文案：三语各 **10** 个键（9 个 `costCenterExtensions*` + 1 个 `costCenterCallsFilterExtension`）；单测：新文件 `src/lib/marketplace-attribution.test.ts` **5 例** + 既有 5 个文件新增 **14 例**（账本读数 7、账本写入 1、成本中心接口 1、文章生成 2、知识库解析 1、货架目录 2）= 本卡 **19 例 / 1 个新文件** |
| 关键口径（写进类型与文案） | ① 归属规则**只有一个裁决点** `marketplaceExtensionIdOf()`：**已上架 position 的清单 id（`position-<id>`）> 目录里真实存在的 agent id > `''`**；② **草稿 position 不是清单**（有 id、有名字，但货架没有它）；③ **picker 专用 id 不是清单**（`general` / `marketing` 是选择器默认值，`extensionAgentId` 专为把两者分开而存在）；④ `''` 是**读数不是缺口**：未归属行照样进明细并显示「未归属」，不折进命名扩展、不丢行；`options.extensions` 不把空串当选项；查询参数传空 = **不筛选**；⑤ 每组总计 = 其自身行之和，**重试与失败是同一批请求的两种读数、永不相加**；⑥ 一条请求只有一个身份（不合并、不拆分）；⑦ 无金额时如实写「无金额」而不是 0；⑧ **不伪造 Marketplace 执行条目**——不安装、不建任务实体，账本里每个非空 `extension_id` 都能在货架找到同名 id |
| 验证结果（本轮实跑） | 定向 `npx vitest run`（本卡 7 文件）→ **exit 0 / 125 用例**；全量 `npx vitest run` → **exit 0 / 168 文件 1448 用例全通过**（§15 记录上一张卡 167 / 1429，差额 1 文件 / 19 用例与本卡增量一致）；`npx tsc --noEmit` → **exit 0**（首轮如实报出 1 个错误：新夹具用了不属于 `aiUsageCostSources` 的 `"unmeasured"`，改为词表内 `"unknown"` 后复跑通过）；`npx eslint` 本卡 21 个文件 → **exit 0 / 0 problems**；`git diff --check` 无空白告警（仅 Windows `autocrlf` 换行提示）；三语键集合 **2405 / 2405 / 2405 完全一致**（missing 0 / extra 0）、各新增 10 键、无 BOM、客户端 139 个 `costCenter*` 引用 **0 未解析**；真实 dev server（作者在跑，未另起 / 未终止）`GET /api/ai-cost-center/calls?range=7` → **200** / 11131 字节、答复含 `byExtension`（**1 组**：`extensionId ""`、`attempts 6` = `totals.attempts`、`totalTokens 6156`、`costByCurrency []`、`unpriced 5 / unmeasured 1`、`costIsComplete false`）、`options.extensions []`、`filters.extensionId ""`；`?extensionId=`（空）→ **200 / matched 6**（= 不筛选） |
| 未验证（如实登记） | ① 真实库**没有非空扩展 id**：未上架任何 position、本轮未在真实库跑文章生成与知识库解析 → live 6/6 行都是 `''`（部分是加列前的历史行 = 「当时没有记」；部分属下面第 ② 条）；因此 `position-<id>` / 目录 agent 分组**只在临时库单测出现**；② 只接线了「调用时真知道自己是谁」的两条链路（文章生成、带 `positionId` 的解析），工作区另有 **12 个**账本写入模块（13 条写入路径）未接线而一律 `''`（agent 运行时 `langgraph-engine` / `local-tools`、`image-generation`、`transcription/providers`、`scraper`、`content/[id]/rewrite`、`content/[id]/translate`、`content/mindmap`、`metrics/insights`、`research-extraction`、`chat-thread-title`、`positions/generate`）——其中 agent 运行时与图片生成在真实使用中可能正跑在某个已上架 position 的工作流内，这是 `-03` 的**剩余面**，本卡不猜测该关系；反向说明 `positions/generate` 本就该是 `''`；③ **未跑真实浏览器三语冒烟**（本卡页面验证 = live payload 逐字段 + 临时库单测 + 键集合脚本 + tsc / eslint）；④ 打包版 Electron 未验证（各卡共通基线）；⑤ 金额读数为空属范围外的 `-01` |
| Git | 未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status` / `git diff` / `git ls-files --eol` 取证）；`git status --porcelain` 实测 **140** 条（含其他在途卡）；仓库根 `?? tmp-*` / `?? dev-server.*` 等为**此前各卡遗留**，**本卡未新增**（证据全在 `%TEMP%\cp-p7-05-03\`） |
| 下一步 | `CI-P7-05-01`（图片 / 视频 / 语音 / Embedding 接入同一计量与**定价**）与 `-04`（无法计量必须显式标记）；`-03` 自身剩余面 = 把其余调用点接到同一裁决点（需要「run → 清单」关系落地）+ 下拉从「窗口内出现过的 id」升级为「货架里的清单」 |

## 17. CI-P7-05-03「剩余面」（Marketplace 扩展标识：改写 / 翻译 / 效果解读 / 文章配图 接线与归属单测）状态：done（2026-10-11）

> **卡片来源**：主线 §13 第 **475** 行那一条（`CI-P7-05-03`）的**剩余面**，即主线 **§附录 N.6 第 2 条 / N.7** 自己写下的「把其余调用点接到同一裁决点」那一半：首次交付（§附录 N 与本文 **§16**）只接线了「调用时真的知道自己是谁」的两条链路，本轮把**改写 / 翻译 / 效果解读 / 文章配图**接上，其余 9 条写入路径**仍如实 `''`**并逐条登记。逐条证据见主线 **§附录 O**；`CI-P7-05` 整体仍为「部分就绪」（§3 第 104 行未再改动，`-01` / `-04` 未交付）。

| 项 | 内容 |
| --- | --- |
| 交付物（本轮改动实测） | 归属桥（**新文件**）：`src/lib/content-item-listing.ts`（**1–2** 依赖、**6–26** 口径注释、**29–51** `contentItemListingProvenance`、**63–69** `marketplaceExtensionIdOfContentItem`）——只读**已存 provenance**（`metadata.positioningId` + `metadata.agentId`）并交给同一个裁决点 `marketplaceExtensionIdOf()`，非字符串一律 `""`；调用点：`src/app/api/content/[id]/rewrite/route.ts`（**7 / 69–79 / 123 / 150**）、`src/app/api/content/[id]/translate/route.ts`（**7 / 50–56 / 93 / 119**）、`src/app/api/metrics/insights/route.ts`（**6 / 53–63 / 89 / 100**，由 `record.contentItemId` 指向的文章取归属）、`src/lib/article-generation.ts`（**18 / 183–190 / 221–229 / 213 / 282**）+ `src/lib/article-images.ts`（**70–76 / 130**）+ `src/lib/agent/image-generation.ts`（**73–82 / 104–111 / 138 / 148 / 157**，只在非空时把 id 带进账本上下文）；单测 **5 个文件 / 14 例**（改写 3、翻译 3、效果解读 3、文章配图 2、文章生成 3），合计 **+542** 行 |
| 关键口径（本轮钉住） | ① 归属只读**已存的 provenance**，不读页面 / 对话框 / 标题 / 平台名；② **一次请求一个身份**：成功 / 重试 / 失败三种行带同一个 id（自纠重问两行同 id）；③ **一篇文章一个身份**：文章行与它的封面行由问过一次的同一个答案给出，不分叉；④ `''` 是**读数不是缺口**（照进明细、显示「未归属」、不被折进别的扩展）；⑤ **「被拒绝」≠「失败」**：预算闸门拒绝不写行，provider 失败照写并带 id；⑥ **不猜**：谁真的不知道自己是谁就继续 `''` |
| 13 条路径的最终状态 | **已归属 4 条**（本轮）：改写（**123 / 150**）、翻译（**93 / 119**）、效果解读（**89 / 100**）、文章配图（`image-generation` **138 / 148 / 157**，仅覆盖「调用方交 id」的那一半）；**仍 `''` 9 条**：`scraper` 改写（**105 / 115**）与选题成文（**168 / 173**）＝只带 `runId`（**84 / 145**）、`langgraph-engine`（**193 / 198**，只有 `runId` + `nodeId` **170**）、`local-tools`（**233 / 238**，**197**）、`content/mindmap`（**108 / 117**，主题字符串不指文章 **82**）、`research-extraction`（**212 / 215**，`runId` **181**）、`chat-thread-title`（**107 / 115**，`runId` **72**）、`transcription/providers`（**344 / 351**，`307`）、`positions/generate`（**89 / 106**，**本就该是 `''`**，那一刻还没有清单 **62**）；另有**独立配图 `/api/images`** 与 `local-tools` 里那条生成图片的路径仍 `''`（payload 只有 `prompt` / 只有 `runId`）。首次交付已接线的两条（`article-generation` **213 / 282**、`ai-parse` **104 / 132**）口径未改 |
| 验证结果（本轮实跑） | 定向 `npx vitest run`（本卡 5 文件：改写路由 / 翻译路由 / 效果解读路由 / `article-images` / `article-generation`）→ **exit 0 / 5 文件 73 用例**；其中 `article-images` + `article-generation` → **exit 0 / 2 文件 36 用例**；`npx vitest run 'src/app/api/content/'` → **exit 0 / 10 文件 96 用例**；全量 `npx vitest run` → **exit 0 / 168 文件 1462 用例全通过**（§16 记录上一轮 168 / 1448，差额 **+14 用例** = 3+3+3+2+3，**文件数不变**）；`npx tsc --noEmit` → **exit 0**（首轮即通过）；`npx eslint`（5 个测试文件 + 7 个接线源文件）→ **exit 0 / 0 problems**；**隔离修复**：两处新 `describe` 的 `beforeEach` 先 `allowEveryAiBudgetCall()` 再 `resetRuntime()`——预算行是**存储状态**，`resetRuntime()` 清不掉同一文件前面那条拒绝用例留下的拒绝（首轮如实报出 6 例 402 而非 200）；**读数口径**：第一次全量运行曾在与另一条 `npx tsc` / 上一轮 vitest 并跑时报 2 例失败（两轮共用被 pin 的临时库），单独复跑全绿，记录以 **168 / 1462** 为准 |
| 未验证（如实登记） | ① 13 条路径里 **9 条仍 `''`**，其中 agent 运行时与**独立配图 `/api/images`** 在真实使用中很可能正跑在某个已上架 position 的工作流内，但**「run → 清单」这条关系今天并不存在**（本轮只读取证：`POST /api/images` payload 只有 `prompt`；`POST /api/agent/chat` 只有 `threadId` / `site` / `params` 与随后的 `runId`）——**不编造**，继续 `''`；② 本轮**未取真实库 / live 读数**，真实的 `position-<id>` 与目录 agent 分组**仍只在临时库单测出现**，§附录 N.5 的 live 结论未被新实测覆盖；③ 本轮未改源与文案，也未跑真实浏览器三语冒烟（三语键集合不变：各 2405 键）；④ 打包版 Electron 未验证（各卡共通基线）；⑤ 金额读数为空仍属范围外的 `-01` |
| Git | 未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status --short` / `git diff --stat` 取证）；本轮改动 = 5 个测试文件（**+542** 行）+ 主线文档**附录 O**（未跟踪文件，不出现在 `git diff`）+ 本文件 **§17**；`src/lib/content-item-listing.ts`、3 个路由与 3 个 lib 的接线属同一张卡剩余面的源改动，**未提交** |
| 下一步 | `CI-P7-05-01`（图片 / 视频 / 语音 / Embedding 接入同一计量与**定价**）与 `-04`（无法计量必须显式标记）；`-03` 自身剩余面 = 让「run → 清单」关系落地，再把 agent 运行时 / 独立配图 / 采集（改写与选题成文）/ 思维导图 / 研究抽取 / 会话标题 / 转录接到同一裁决点 |

---

## 18. CI-P7-05-04 AI 服务可计量性边界状态：done（2026-10-11）

> **卡片来源**：主线 §13 第 **476** 行那一条 —— 「`P7-05-04` 无法准确计量的服务必须**显式标记**，而不是漏记」。本卡与 §17 无关（那条是 `-03` 的剩余面），是 `CI-P7-05` 卡体四子项里**从未开工**的一条。
> **一句话**：账本一直如实记着「金额说不出来」（`cost_amount` NULL + `cost_source` 四态 + `completeness` 三态），却从没说过**为什么**；本卡把「为什么」变成账本自己就能陈述的读数，并把**六个计量维度全部列出**——其中 video / embedding 在本运行时**没有任何调用路径**，它们被**点名**而不是从列表里消失。逐条证据见主线 **§附录 P**。
> **登记**：§3 第 **104** 行本轮**在同一行内**补记本卡（行号不变）；**§17 那句「§3 第 104 行未再改动」是当轮的登记**，本轮已按同一约定补记，特此并列（不改写 §17 的历史记录）。

| 项 | 内容 |
| --- | --- |
| 交付物（本轮改动实测） | **2 个新文件**：`src/lib/ai-metering.ts`（**204** 行：`meteringReasonFor()`、`summarizeLedgerMeteringCoverage()`、`aiMeteredKindProducers` 维度声明）+ `src/lib/ai-metering.test.ts`（**234** 行 / **12 例**）；**6 个变更文件**：`src/lib/types.ts`（原因词表第 **645–685** 行 + 覆盖类型与 `catalog.metering` 第 **975–1044** 行 + `AiUsageCallView.reason`）、`src/app/api/ai-cost-center/calls/route.ts`（第 **4 / 259–262** 行）、`src/app/api/ai-cost-center/route.ts`（第 **3 / 33–66** 行，总览改为一次读取后 `summarizeAiUsageLedger` + `summarizeLedgerMeteringCoverage`，两个读数同源）、`src/components/cost-center/cost-center-client.tsx`（原因列 + 计量覆盖表）、两个路由测试（各 +1 例）；**3 个 locale**（**+25 键 ×3**，2405 → **2430**）；主线 **§附录 P** + 本 **§18**。**另净增 14 例**（12 + 1 + 1） |
| 关键口径（本轮钉住） | ① **不新增数据库列、不做迁移、不回填**——原因所需的证据（`outcome` + `completeness` + `pricing_json` + `quantity_json`）**已在行上**，读侧按同一规则派生，**历史行同样可读**（真实库那行 image 就是这么读出原因的）；② **只读行内证据**：绝不读 purpose / 模型名 / 页面 / `extensionId`，`extensionId` 为空**不参与任何计量判断**；③ **证据不足就留白**：`not-recorded`，不推断（含「可用用量落在被存成 `unknown` 的历史行上」这种形状）；④ **按词表而不是按数据建表**：六维度恒列出，`video` / `embedding` = `no-runtime-path`、`agent` = `metered-through-text`，与「本窗口没调用」**分开表述**；⑤ **不重复建模**：`cost_source` / `completeness` 原样复用，四个既有读数列一字未改；⑥ **金额算法、预算、闸门、runtime 路由 / 重试 / 故障转移 / 密钥轮换一行未碰** |
| 原因词表（10 条） | `no-price-for-dimension` / `price-kind-mismatch` / `price-unit-unspecified`（未定价一侧）→ `usage-not-reported` / `quantity-not-recorded` / `quantity-unit-mismatch` / `quantity-unusable` / `attempt-failed`（未测量一侧）→ `call-interrupted`（部分未知）→ `not-recorded`（不推断）。逐条触发证据与「用户该做什么」见主线 §附录 P.2 |
| 界面 | 调用明细新增「**未述明原因**」列（`colSpan` 11 → 12）；成本总览「价格目录覆盖」卡内新增「**计量覆盖**」表（维度 / 本窗口行数 / 已述明·未定价·未述明 / 生效价格 / 状态与原因）。判定顺序：维度声明缺口 → 本窗口无调用 → 该维度行上真实存在的原因 |
| 验证结果（本轮实跑） | 定向 `npx vitest run`（7 文件：`ai-metering` / `ai-usage-ledger` / `ai-usage-ledger-recorder` / `dictionaries` / 成本中心 `route` / `calls` / `quality`）→ **exit 0 / 7 文件 118 用例**；全量 `npx vitest run` → **exit 0 / 169 文件 1476 用例全通过**（§17 记录上一轮 168 / 1462，差额 **+1 文件 / +14 用例**，与本卡净增一致）；`npx tsc --noEmit` → **exit 0**；`npx eslint`（8 个变更文件）→ **exit 0 / 0 problems**；`git diff --check` → **exit 0** |
| 真实接口（本轮实测，与临时库分开报告） | 作者正在跑的 dev server `127.0.0.1:3000`，**只读 GET**（未另起实例、未终止用户进程、未发真实模型请求、未写真实库）：`GET /api/ai-cost-center?range=7` → **200 / 2585 字节**（改动前同端点 1678 字节，差额 = 新增 `catalog.metering`），`pricedKinds []`、`metering` 逐维度：text 5 行全 `no-price-for-dimension`、image 1 行 `quantity-unit-mismatch`、video/embedding `no-runtime-path`、speech 0 行无缺口、agent `metered-through-text`；`GET /api/ai-cost-center/calls?range=7&limit=25` → **200 / 11335 字节**，6 行逐行 `reason` 与库一致（覆盖表计数 = 总额计数）。证据：`%TEMP%\cp-p7-05-04\live-{overview-2,calls-2}.json`（改动前存 `live-overview.json` / `live-calls.json` 作对照） |
| 未验证（如实登记） | ① **未跑真实浏览器三语渲染**（+25 键由 `dictionaries.test.ts` 与 `tsc` 的 `TranslationKey` 兜底，页面渲染本身未验证）；② **未在真实库触发新的 AI 调用**，故真实库中没有失败行 / 中断行 / 写对单位键的图片行，那三类只在临时库单测验证；③ **`POST /api/ai/models/probe` 仍未接入账本**：它真的发一次供应商请求（`probe.ts` 第 **72–95** 行）却没有行、也没有闸门 —— 本卡**如实登记为显式缺口**（补写需先定义其身份与轨迹，属新卡）；④ `provider-reported` / `interrupted` 仍无生产者；⑤ 打包版 Electron 未验证（各卡共通基线） |
| Git | 未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status --short` / `git diff --stat` / `git diff --check` 取证）；**如实登记**：`git diff --stat` 里这些文件**同时含有此前各卡的未提交改动**（如 `budget/route.ts`、`budget-panel.tsx`，本卡未碰），故**不用聚合 diff 数字**声称本卡行数增量；主线计划文档**未被 git 跟踪**，本 **§18** 所在文件是**已跟踪**文件 |
| 下一步 | `CI-P7-05` 卡体**只剩 `-01`**（图片 / 视频 / 语音 / Embedding 接入同一计量并**录价**）——本卡的覆盖表已把它的后果摆在界面上（真实安装 `pricedKinds []`、text 5 行全 `no-price-for-dimension`）；`-03` 自身剩余面（「run → 清单」）仍待做；本卡新增候选：**把模型能力探测接入账本** |

## 19. 能力探测（`POST /api/ai/models/probe`）预算闸门与账本接入状态：done（2026-10-11；**编号待作者指定**）

> **卡片来源**：主线 **§附录 P** 与本文件 **§18** 的「下一步」里登记的**同一张候选卡**（「把模型能力探测接入账本」）。主线 §1 / §13 里**没有**它的编号行，本次也**不代填**。逐条证据见主线 **§附录 Q**。
> **一句话**：探测是这个产品里**唯一**绕过预算与账本的供应商调用路径（用户自己的 Key、真实付费）；本卡把闸门放在**发出请求之前**、账本行放在**请求之后**，两处都复用既有的 `beginAiBudgetCall` / `recordAiUsageCall`。
> **登记**：主线 §1 **未新增行**、§13 **一字未动**；主线 **§附录 P · P.8 的「下一步编号」同一行内加字**指向 §附录 Q（行号不变）。

| 项 | 内容 |
| --- | --- |
| 交付物（本轮改动实测） | **1 个新文件**：`src/app/api/ai/models/probe/route.test.ts`（**293** 行 / **7** 用例）；**3 个变更文件**：`src/features/ai-runtime/probe.ts`（**262** 行：端口 `ModelProbeMetering` / `ModelProbeTarget` / `ModelProbeMeteringSession` + `modelProbeMaxOutputTokens = 32` + `attempts` 轨迹 + `finally` 里的记账与还预留）、`src/app/api/ai/models/probe/route.ts`（**84** 行：`meteredProbe()` 里的 `beginAiBudgetCall` 落点 + `budgetReservationId`）、`src/lib/ai-metering.ts`（204 → **208** 行：把探测路由登记为该维度的生产者）；主线 **§附录 Q** + 本 **§19** |
| 关键口径（本轮钉住） | ① **闸门在线上之前**：估算用这次探测**自己的**请求（真实输入文本 + 线上同一个上限 **32** + 用户选中的 provider / model + 要验的 capability），不是解析器可能改选的模型；② **被拒绝 = 什么都没发生**：402 + `AI_BUDGET_EXCEEDED`，无请求、无 `PROBE_TEST` 标记、无探测记录、无账本行；③ **一行一请求**：账本按 runtime 自己的 `ModelAttempt[]` 轨迹写，被拒的密钥也是行；④ **说不出来就留空**：没报用量 → `unknown` + NULL；没有价格 → `reported` + `unpriced` + NULL 且**不占额度**；⑤ **`identity` 有意留空**：探测不属于任何运行 / 任务，不编造业务 id；⑥ **依赖方向不变**：端口只**定义**在冻结面内，`src/lib` 的实现只在**调用方（路由）**侧 import，不产生 runtime ↔ lib 环；⑦ 不需要计量能力的探测（如 `image_generation`）在闸门**之前**返回 `unsupported`，不占额度也不写行 |
| 落点计数（实测） | `beginAiBudgetCall(` 的**调用点** = **15 处 / 13 个文件**（不含 `import`、注释与函数定义）；**本卡只新增 1 处**（`route.ts:38`），其余 14 处一行未碰。另有 `src/lib/ai-budget-guard.ts:623` 是闸门内部自身调用、`src/test/ai-budget-probe.ts:42` 是测试探针。§附录 G 记的「14 文件 / 15 处 `beginAiBudget*`」用的是**前缀**口径，两者不做加减 |
| 验证结果（本轮实跑） | 定向 `npx vitest run src/app/api/ai/models/probe/route.test.ts` → **exit 0 / 1 文件 7 用例**；全量 `npx vitest run` → **exit 0 / 170 文件 1483 用例全通过**（§18 上一轮 169 / 1476，差 **+1 文件 / +7 用例**）；`npx tsc --noEmit` → **exit 0**；`npx eslint`（4 文件）→ **exit 0 / 0 problems**；`git diff --check` → **exit 0**（仅三份 locale 的 LF/CRLF 既有 warning） |
| 用例覆盖 | ①发请求 → 定价 → 还预留（`costAmount = 5`、线上 `max_tokens: 32`、预留 id 在行上且在途为空）；②闸门 402 且完全不写；③被拒请求自成一行的失败行；④供应商不报用量 → `unknown` + NULL（**不写 0**）；⑤无价格 → `unpriced` + NULL + 不留预留；⑥`unknownCostPolicy: block` 时 402 且无行；⑦不可探测能力 → 200 `unsupported`、无请求无行、记录仍落库 |
| 未验证（如实登记） | ① **未发真实供应商请求**（临时库 + 被替换的传输；真实库没有本卡写入的行，也未新增列 / 表 / 迁移）；② **探测不归属触发它的用户动作**（`identity` 留空是有意的取舍，「谁触发了这次付费探测」账本目前答不出来）；③ **vision 探测的图片字节不计入输入 token**（1×1 PNG 是字节不是文本，估算偏保守；行仍以供应商回报用量为准）；④ 打包版 Electron 未验证（各卡共通） |
| Git | 未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status` / `git diff --numstat HEAD` / `git diff --check` 取证）；**如实登记**：`probe.ts` / `route.ts` 相对 HEAD 的 `+152/−7`、`+63/−2` **含此前各卡未提交改动**，不作为本卡增量；`ai-metering.ts` 与 `route.test.ts` 是**未跟踪**文件；主线计划文档**未被 git 跟踪**，本文件是**已跟踪**文件 |
| 下一步 | ① **编号已裁定并正式确认（2026-10-11，见 §21 / §22）**：支线 **`CI-EMB-01`（正式编号；不占任何 `CI-P*` 卡号）**；登记方式 = 主线 §1 **同行追加**（第 72 行）+ 卡体 = 主线 **§附录 T**，**零位移**（**不是**原预案的「§1 一行 / +1 位移」）；确认时**未改名**，三处引用**同行更新**；② `CI-P7-05` 卡体仍只剩 **`-01`**（图片 / 视频 / 语音 / Embedding 接入同一计量并**录价**）；③ 本轮新登记 **§20**：**Embedding 能力端到端接入**（其阻塞项「设计稿 §15 Q1 向量存储」**已于 2026-10-11 裁定为方案 (a)**，执行清单登记于主线 **§附录 S**）；**实现与验证结果见 §22** |

## 20. Embedding 能力端到端接入（**支线 `CI-EMB-01`，编号已正式确认（2026-10-11 作者裁定）**）状态：**已实现（阶段 0–4 落地；阶段 5 定向 + 全量验证通过；真实 Provider 未验证）；Q1 已裁定**（2026-10-11）

> **卡片来源**：本记录与主线 **§附录 R** 共同登记。**两侧清单都没有它的编号**：`CI-P7-05` 家族管的是**计量与录价**（`-01` 仍未交付），新清单 `P8-06` 的第一条同样是计量；`CI-P3-03` / `P3-03-05` 的 RAG 预留是**有意未做**（见 §附录 B-10 §4）。因此它需要**新编号**，而**编号由作者指定**——本记录与主线 §附录 R 都**不**代填（尤其**不**占 `CI-P7-05-05`）。 **2026-10-11 作者裁定**：编号归属 = **独立支线 `CI-EMB-*`**（**建议编号 `CI-EMB-01`，待作者确认**；**不归入任何 `CI-P*` 阶段**）；登记方式 = 主线 §1 第 **72** 行**同行追加** + 卡体 = 主线 **§附录 T**（**零位移**）；**不分配** `CI-P7-05-05` / `CI-P3-04`。裁定与登记结果见 **§21**。
> **一句话**：`embedding` 是本安装里**唯一「有价格与计量设计、没有任何调用路径」**的维度（`src/lib/ai-metering.ts:77` 声明 `no-runtime-path`）；而知识库现在的取用规则是「启用 + 定位 + 权重 + 最近更新」（`src/lib/knowledge-base.ts:147–158`），**没有语义检索**。
> **阻塞项已解除（2026-10-11）**：设计稿 `docs/model-layer-spec.md` **§15 Q1「向量存储放哪」**——**作者已裁定：方案 (a)**（`ai_embeddings` 表 + JSON 列存向量 + 内存暴力检索），**否决** (b) `sqlite-vec` 类扩展（本仓库用 `@libsql/client`，**构建与分发风险**）与 (c) 独立本地索引文件（自研，工作量最大）。**裁定正文** = 该设计稿文末 **§15-Q1 决策记录**（`:1002` 起）；三方案比较材料与「建议的比较维度」**保留**在主线 **§附录 R.3**；**执行拆分（阶段 0–7）** = 主线 **§附录 S**。
> **登记**：§3 **不新增行**（两支清单都没有它的编号）；**§1 同行追加**（主线第 **72** 行，**零位移**）+ 卡体 = 主线 **§附录 T**；§13 **不动**（仅第 **473** 行同行追加一句边界说明）。**2026-10-11 已按作者裁定登记完成**：支线 **`CI-EMB-01`（建议编号，待作者确认；不占任何 `CI-P*` 卡号）**，本节标题已同步；原「补 §1 一行（+1 位移）」的预案**未采用**。

| 项 | 内容 |
| --- | --- |
| 已具备（实测） | 计量维度 `embedding` 已在 `aiUsageMeteredKinds`；`aiUsageKindUnits.embedding = []` → **按输入 token 计价**；`computeUsageCost()` 已有 embedding 定价用例（`ai-usage-ledger.test.ts:335`）；`embedding` 已是合法模型能力值（`validation.ts:712`）；维度缺口已被 §附录 P 的覆盖表**点名**（不是漏记） |
| 缺失（实测） | `src/features/ai-runtime` 下 **0 处** `/embeddings` 或 embedding 适配代码；`knowledge_base` 表**没有向量列**（`schema.ts:195–209`）；知识库**没有检索 / 搜索端点**（只有 `route` / `ai-parse` / `import-products` / `upload` / `[id]`）；探测对 embedding 返回 `unsupported`（设计如此） |
| 建议顺序（登记，不实施） | ① Q1 决策记录 —— **已完成（2026-10-11，方案 (a)）**，且执行拆分已细化为**主线 §附录 S 的阶段 0–7**（S.1–S.8；收尾 S.9 顺序与范围控制 / S.10 最终验收）→ ② 打通调用链（复用 Provider / 密钥 / 闸门 / 账本 / 价格目录，批量向量化；完成标准：账本出现 `metered_kind: embedding` 行，无价格时如实 `unpriced` + NULL）→ ③ 接入知识库语义检索并**保留**现有规则路径做对照（完成标准：两者可对比、结论有数据）→ ④ 闭环验证（导入 / 向量化 / 召回 / 计量 / 删除 / 重索引 + 换模型的维度变化不混算） |
| 边界 | **必须经过**冻结面 AI Runtime，不新建旁路；不改 C2 发布语义；不做完整 RAG 系统、不做 Marketplace、不做跨维度混算；**不占用** `CI-P7-05-01` 的录价职责（在那之前 embedding 行会如实 `unpriced`） |
| Git | 本轮及 Q1 裁定登记轮**只改文档**：未改业务代码、未新增表 / 列 / 迁移、未新开任何 AI 调用、未写任何实现代码；未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（Q1 裁定登记轮改动 = 设计稿文末 **§15-Q1** + 主线 **§附录 S** + 本 **§20 状态更新** 与 **§7 第 22 条**） |

## 21. Embedding 支线卡编号裁定与登记记录（2026-10-11；纯文档，**零位移**）

### 21.1 作者裁定原文口径（2026-10-11）

1. 编号归属：**独立支线 `CI-EMB-*`**，**不归入任何 `CI-P*` 阶段**。
2. **§1 同行追加**，不新增独立行；状态写「**建议编号，待作者确认**」，**不**把建议编号写成已正式分配编号。
3. 卡体**追加到主线文件末尾独立附录**（= 主线 **§附录 T**），既有行号**零位移**。
4. **不分配** `CI-P7-05-05`、**不分配** `CI-P3-04`；**不改**其他卡号；**不批量修复**已发现的既有引用漂移。
5. 实现范围：Embedding Runtime 调用、模型能力声明、SQLite JSON 向量持久化、TypeScript 内存相似度检索、知识库召回集成、相关测试。
6. 预算门禁 / 用量账本 / 成本计算 / 计量覆盖率**复用 `CI-P7-05-01` 已有机制**，不重复建设；Embedding **必须真实接入**这些机制。
7. 先完成文档登记并报告变更位置、行号影响与差异，**再**启动阶段 0；阶段 0 只做现状核对与接口确认。
8. 保持未提交的其他代码与文档不受影响；不执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`。

### 21.2 登记结果与文档变更位置（实测，**零位移**）

| 文档 | 变更 | 位移 |
| --- | --- | --- |
| 主线 `docs/coolpilot-capability-integration-plan.md` | ① §1 第 **72** 行**同行追加**登记段（支线卡 `CI-EMB-01`，建议编号待作者确认，不占任何 `CI-P*` 卡号，卡体见 §附录 T）；② §13 第 **473** 行**同行追加**一句边界说明（`P7-05-01` 仍只管**计量与录价**；Embedding 的**调用路径 / 存储 / 召回**归本支线卡，两卡不重叠）；③ 文件末尾新增 **`## 附录 T：CI-EMB-01 Embedding 端到端接入登记`**（T.1–T.9） | **0** —— 2980 → 2980 + 附录 T 行数；`§1` 第 35–60 行与 `§13` 第 436 / 447 / 458 / 465 / **471–476** 的既有引用**全部保持有效** |
| 本文件 | §19 下一步 **①**、§20 标题 /「卡片来源」/「登记」共 **4 处同行替换** + 本节新增 | **0** —— §8 起仍为上一轮已登记的 **+2** 位移，本次**未再位移** |

### 21.3 编号事实（复核，未新造任何号）

- 支线族 `CI-EMB-*`：主线与本文件实测 `CI-EMB` 命中 **0**（新前缀，无冲突）。
- **建议编号 = `CI-EMB-01`**（支线族第一个）；**状态 = 建议编号，待作者确认** → **在作者确认前，不得把它当作已正式分配的编号引用**。若作者改名，只需同行替换三处：主线 §1 第 **72** 行、主线 **§附录 T** 标题、本文件 **§20** 标题（+ 本节说明）。
- **明确不占用**：`CI-P7-05-05`（`CI-P7-05` 家族只剩 `-01`；依据 = 主线第 **2796** / **2863** 行、本文件 §7 第 **21** 条与 **§20**）、`CI-P3-04`、任何 `CI-P*` 与 Marketplace `P7-*` 号。
- **支线登记依据（既有明文先例，本轮未改）**：主线 §1 第 **76** 行（`CI-SC-01`）、第 **78** 行（`CI-ARTICLE-NAV-01`）= 作者授权支线**不占任何 `CI-P*` 卡号**；第 **74** 行 = **计量与定价不新造卡号，归 `CI-P7-05-01`**；第 **72** 行 = §1 只登记 `CI-` 任务卡且**唯一进度来源**。

### 21.4 实现边界（正文见主线 §附录 T，本节只摘要）

- **归本卡**：Runtime 调用路径、模型能力声明、SQLite JSON 向量持久化、内存余弦检索、知识库召回集成、测试。
- **归 `CI-P7-05-01`（复用、不重造）**：预算门禁 `beginAiBudgetCall`（`src/lib/ai-budget-guard.ts:432`）、账本 `recordAiUsageCall` / `recordAiUsageFailure`（`src/lib/ai-usage-ledger-recorder.ts:214` / `:262`）、成本计算（`aiUsageKindUnits.embedding = []` 已按输入 token 就绪）、计量覆盖率（`src/lib/ai-metering.ts`）；完成后 `embedding` 必须从 `no-runtime-path` 变为**有真实生产者与调用行**，未录价时如实 `unpriced` + 金额 NULL。
- **数据关联（现状实测）**：只可能以 `knowledge_base.id` 为键 —— `src/db/schema.ts:195–209` **无切片表**（召回时才 `content.slice(0,300)`，`src/lib/knowledge-base.ts:157`）；业务隔离沿用 `position_id`；失效触发器 = `content` / `updated_at` 变化、`enabled` 切换、删除、`position_id` 变化、换模型或维度变化（不得混算）。
- **召回语义**：`knowledgeMode` 只有 `["position","off"]`（`src/lib/ai-writing.ts:172`），本卡**不改**其含义；查询向量化本身是**一次计费调用**，须过闸门 + 记账，且 Embedding 故障须有明确回退（不得让增强变单点故障）。
- **建表机制**：新表按既有路径 = `src/db/client.ts#ensureDatabase()` 的 `CREATE TABLE IF NOT EXISTS`（`knowledge_base` 在 `:242`）+ `src/db/schema.ts` 定义；`drizzle.config.ts` 指向的 `./src/db/migrations` **不存在**（仓库无迁移文件），列变更走同文件内 pragma 式手工迁移（`migrateAiModelPriceCatalog()` `:939`）。
- **不扩边界**：不新建 AI 调用旁路、不改 C2 发布语义、不做完整 RAG / Marketplace、不做跨维度混算、不重构无关模块。

### 21.5 引用影响（实测）

- 本次**零位移** → 主线内 `§1 第 N` / `§13 第 N` 类引用（主线自身 **21** 行：59 / 60 / 229 / 1636 / 1678–1680 / 1687 / 1751 / 1753 / 1769 / 2298 / 2299 / 2355 / 2361 / 2417 / 2423 / 2498 / 2504 / 2597 / 2707；本文件 **15** 行：90 / 95 / 97 / 99 / 100 / 102 / 111 / 130 / 137 / 178 / 215 / 217 / 296 / 309 / 310；`docs/development/ci-p7-03-design-draft.md` **2** 行：5 / 55；`docs/development/CoolPilot-开发清单-10个开源项目整合版.md` **2** 行：991 / 1017）**全部继续有效**。
- **反事实（若改用「§1 新增独立行」）**：主线第 **71** 行之后全部 +1 → 上述 `§13` 类引用（428 起全部）与主线自身那 21 行引用将**同时失效**；这正是本轮采用「同行追加 + 文末附录」的理由。
- **本轮未批量修复的既有漂移（报告不修）**：本文件第 **100** / **130** / **137** 行把「菜单改名与首个真实费用界面同卡交付」记为 **`§13` 第 405 行**，但实测主线第 405 行属 **§10 顺序说明末段**（`§13` 自第 **428** 行起）—— 疑似前缀笔误或位移残留。**本轮不修**，交作者裁定。

### 21.6 未做的事（如实登记）

未改业务代码、未新增表 / 列 / 迁移、未发任何 AI 调用、未写任何实现代码；未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（如需取证只用只读 `git status` / `git diff`）；未改任何既有卡号、顺序与状态；未改写 §7 第 21 / 22 条与 §20 的历史表述（§20 仅标题与三行做同行更新）。

### 21.7 下一步

**阶段 0（只读现状核对与接口确认）不在本轮执行**（作者裁定：先登记并报告，再启动）。启动条件**已满足**：① 登记完成（主线 §1 第 72 行 + §附录 T + 本 §19 / §20 / §21）；② 三处接口对象已定位（Runtime / 存储 / 召回，见 §21.4）；③ 全程只读 —— 不触碰用户运行中的 dev server，不对真实库写入。

## 22. `CI-EMB-01` 实现与验证记录（2026-10-11；**零位移**，追加于文件末尾）

> **定位**：§21 记的是**编号裁定与登记**，§22 记的是**实现与验证**。既有各节一行未改（仅 §20 标题 / §20 下一步 / §21 标题相关三处**同行更新**，见下）。**未**新增其他卡的条目、**未**修漂移。

### 22.1 编号状态（正式确认）

- `CI-EMB-01` **正式编号**（2026-10-11 作者确认）。确认前复核：本文件与主线计划内 `CI-EMB` **仅出现在本卡登记段**（本文件 8 处、主线 5 处，全为本卡自身引用），**0 冲突**；未分配 `CI-P7-05-05` / `CI-P3-04`，未改任何其他卡号。
- 编号**未改名**，故三处引用均**同行替换**：主线 §1 第 **72** 行、主线 **§附录 T** 标题、本文件 **§20** 标题（+ 本节新增）。既有行号 **零位移**。

### 22.2 落地文件（本卡新增 / 修改）

| 层 | 文件 | 内容 |
| --- | --- | --- |
| Runtime | `src/features/ai-runtime/contracts.ts`、`adapters.ts`、`runtime.ts`、`index.ts` | `EmbeddingRequest` / `EmbeddingResponse`、`AdapterEmbedOptions` / `AdapterEmbedResult`、`ProtocolAdapter.embed?`、OpenAI-compatible `/embeddings` 实现（向量数 / 数值 / 一致性校验）、`aiRuntime.embed()`、导出 |
| 错误码 | `src/lib/app-errors.ts` | 新增 `MODEL_EMBEDDING_INVALID`（请求空批次 400 / 响应不可用 502） |
| 纯契约 | `src/lib/knowledge-embedding/embedding.ts`、`source.ts` | 常量与版本、失败码、请求 schema、规范化、确定性分块、输入文本、chunk id、四态判定、余弦；`source.ts` 单独承载 `node:crypto` 哈希（避免客户端组件经 `lib/knowledge-base` 传染 `node:crypto`） |
| 存储 | `src/db/schema.ts`、`client.ts`、`repositories/knowledge-embeddings.ts`、`repositories/knowledge-base.ts` | 新表 `knowledge_embeddings` + 三个索引（含 `(knowledge_id, chunk_index, provider_id, model_id)` 唯一索引）；按模型作用域的 replace 写入；知识记录删除级联清理 |
| 召回 | `src/lib/knowledge-base.ts`、`src/lib/knowledge-embedding/recall.ts` | 语义排序（业务过滤 → 兼容性 → stale → 余弦 → 记录级聚合 → 组合排序）、查询文本构造、独立闸门 + 台账 + 具名降级；`position` / `off` 语义未变 |
| 批量任务 | `src/lib/knowledge-embedding/embedding-task.ts`、`src/worker/runner.ts` | `knowledge_embedding` playbook：规划 → 分批 → 每批闸门 + 台账 → 记录级整写；注册进 `aiSpendingPlaybooks`（并因此进入 `budgetPausablePlaybooks`）；`BUDGET_EXCEEDED` → `StepBudgetRefusal`（暂停而非失败） |
| 入口 | `src/app/api/knowledge-base/embeddings/route.ts`、`src/components/smart-config/knowledge-base/knowledge-base-workspace.tsx`、`src/lib/validation.ts` | `GET`（只读摘要 + 任务列表）/ `POST`（建任务并启动）；知识库工作台「生成向量 / 重建全部向量」按钮 + 索引状态行；请求 schema |
| 文案 | `src/locales/{en,zh-cn,zh-hk}.json` | `awKnowledgeModeSemantic`、`playbookKnowledgeEmbedding`、`kbBuildIndex` / `kbRebuildIndex` / `kbIndexHint` / `kbRebuildIndexHint` / `kbIndexStarted` / `kbIndexFailed` / `kbIndexSummary` / `kbIndexUnavailable` |
| 计量 | `src/lib/ai-metering.ts` | `embedding` 的 `gap` 由 `no-runtime-path` → `""`，`producers` = `recall.ts` + `embedding-task.ts`（原先断言该 gap 的两处测试**同轮更新**：`src/lib/ai-metering.test.ts:173`、`src/app/api/ai-cost-center/route.test.ts:222`） |
| 测试基建 | `src/test/route-harness.ts` | `prepareEmbeddingModel()`、`embeddingRoute()`（按请求体逐条作答）、`embeddingCalls()`；`StubRoute.respond` 收到该次调用（URL + init）；`resetRuntime()` 一并清 `embedding` 默认值 |

### 22.3 验证结果（实跑，逐条）

| 命令 | 结果 |
| --- | --- |
| `npm exec vitest run src/features/ai-runtime/runtime.test.ts` | **exit 0 / 23 用例**（本卡新增 8 条：真实调用 + usage、无 usage 不写 0、`dimensions` 不一致拒绝、短/非数值向量拒绝、空批次 400、无凭证 400、能力缺失 409、协议无 `embed` 409） |
| `npm exec vitest run src/lib/knowledge-embedding src/db/repositories/knowledge-embeddings.test.ts src/lib/knowledge-base.test.ts` | **exit 0**（13 + 8 + 12 用例） |
| `npm exec vitest run src/lib/knowledge-embedding/recall.test.ts` | **exit 0 / 6 用例**（查询文本来源、独立台账行、无模型降级、stale 降级、**预算拒绝不外降级**、空查询不碰闸门） |
| `npm exec vitest run src/lib/knowledge-embedding/embedding-task.test.ts` | **exit 0 / 6 用例**（分批 + 台账 `runId`、已最新则 0 调用、编辑后尾块清理、rebuild 幂等、预算拒绝保留已建索引、摘要只读） |
| `npm exec vitest run src/app/api/knowledge-base/embeddings/route.test.ts` | **exit 0 / 4 用例**（201 + `lookup`、同 key 复用 200、GET 只读 0 调用、无模型如实报 `missing`、非法 scope 400） |
| `npm exec vitest run src/lib/article-generation.test.ts src/lib/ai-metering.test.ts src/app/api/ai-cost-center/route.test.ts src/app/api/content/generate/route.test.ts` | **exit 0**（14 + 计量与成本中心回归） |
| **全量** `npm exec vitest run` | **exit 0 / 175 文件 / 1537 用例全通过** |
| `npm exec tsc -- --noEmit` | **exit 0** |
| `npm run lint` | **exit 0**（本卡文件 0 error / 0 warning） |

### 22.4 未验证（如实登记）

① **未调用真实 Embedding Provider**（临时库 + 替换传输；真实库无本卡写入行，**未**新增/修改真实数据库结构之外的内容 —— 表由 `ensureDatabase()` 的 `CREATE TABLE IF NOT EXISTS` 建立，无需用户删库）；② Gemini 协议 `embed` **未实现**（与 `transcribe` 同一先例），按 `MODEL_CAPABILITY_UNAVAILABLE` 拒绝；③ 分块上限为**字符**（`800`）而非 token；④ 数千切片规模未做性能基准；⑤ 真实 Provider 的用量/价格完整性未验证（本卡只保证「不报用量 / 无价格」如实落为 NULL）。

### 22.5 Git 边界

本轮**未**执行任何 Git 写操作；开工基线 `git status --porcelain` = **158** 条，收工时新增文件均为本卡文件与既有未提交改动并列，未触碰、未回滚他人改动（交付报告第 7 节列明归属）。


> **本节的定位**：§7 第 **21 / 22** 条与 **§20** 是**历史记录**，本条**不改写**它们（沿用本文档既定约定：新记录并列说明）。**§7 不新增条目** —— 若再插入一行会使 §8 起的行号再次位移，故本轮登记落在本节（文件末尾，**零位移**）。


## 23. `CI-P1-04-07`（`CI-P1-04` 的**子项**，非独立卡）状态：done（2026-10-12）

> **定位**：这是 `CI-P1-04` 的**子项补登**，**不占**一级卡号。主线 §1 的 `CI-P1-04` 行**一字未改**（仍为 `done`）；交付内容追加在主线 **§附录 B-4 §8**（B-4 的 §1–§7 原文保留），接口形状追加在 `docs/coolpilot-integration-contracts.md` **§1.1 第 5 条 + 新增 §4**。本节只记**编号事实、落地文件、验证归属与行号影响**；§3 表格第 **78** 行**同行更新**（未新增行，故本文件自 §4 起各行号**零位移**）。

### 23.1 编号状态

- `CI-P1-04-07` 由作者 **2026-10-12 指定**；指令口径 = **不新建一级卡、不重开 CI-P1-04、不改 `CI-P1-04-01`…`CI-P1-04-06` 的编号与验收记录**。
- **冲突复核（本卡开工前实测）**：`docs/` 下全部 `.md` 检索 `P1-04-07` → **0 命中**（既有子项只到 `P1-04-06`）；`src/` 内 7 处命中全部是**本卡自己写下的代码注释**，不是别处的编号。同轮检索 `videos/renders` 在 `docs/*.md` 内 → **0 命中**（新路由此前未登记）。→ **无编号冲突，未新造任何号**。

### 23.2 落地文件（本子项新增 / 修改）

| 层 | 文件（行数实测） | 内容 |
| --- | --- | --- |
| 读模型（**Node-free**） | `src/lib/videos/video-render-artifacts.ts`（新增 **248** 行） | 槽位↔日志阶段映射、`videoRenderArtifactFiles()`、`videoRenderArtifacts()`、`videoRenderTemplateCatalog()`、`videoRenderEncoded()`、`isRenderArtifactFileName()`、`renderArtifactContentType()`、`videoRenderToolPath` |
| 读取路由 | `src/app/api/videos/renders/route.ts`（新增 **61** 行）、`src/app/api/videos/renders/[id]/route.ts`（新增 **88** 行） | 清单 + 历史；侧车只从**本任务日志**的白名单内取（契约 §4） |
| 界面 | `src/components/creation/video-render-panel.tsx`（新增 **505** 行）；宿主 `src/app/[locale]/(console)/creation/videos/page.tsx`（**第 11 行**挂载，唯一宿主） | 发起渲染（经确认对话框）＋ 模板/素材选择 ＋ 渲染历史与产物下载/播放 |
| 文案 | `src/locales/{en,zh-cn,zh-hk}.json` | 各 **+32** 个 `vr*` 键（三语键数一致） |
| 测试 | `video-render-artifacts.test.ts`（**14** 例）、`renders/route.test.ts`（**6** 例）、`renders/[id]/route.test.ts`（**8** 例） | 含"写入口路径"钉死用例：`videoRenderToolPath === "/api/tools/" + 注册表工具名` |

**未改**：AI Runtime、C2 发布语义、`video-render-tool.ts` / `video-renderer.ts` / `video-render-task.ts`、`runs` / `run_events` 与任何状态词、`/api/videos`（白名单与 `Range` / `206` 未变）、工具返回值的 `url: ""`（CI-P1-04-04 语义未变）。

### 23.3 验证结果（**交付时 2026-10-12 实跑**；本轮为文档收尾，**未重跑**）

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0** |
| 定向 `vitest run`（`src/lib/videos` + `src/app/api/videos`） | **9 文件 / 65 用例通过**；本子项 3 个用例文件按文件实测 **14 + 6 + 8 = 28 例** |
| 全量 `vitest run` | **178 文件 / 1565 用例全通过** |
| `eslint`（本子项 8 个文件） | **exit 0**（仓库级 `eslint .` 仍有 3 条既有 error，来自未跟踪的 `tmp-probe-db.cjs` / `tmp-probe-zod-json-schema.cjs`，**非本卡**） |
| 真实 `next dev`（真实工作区，只读探测） | 读路由 **200**、侧车 `.srt` → **200 `application/x-subrip; charset=utf-8`**、`.json` → **200 `application/json; charset=utf-8`**、`/zh-cn/creation/videos` → **200** |

### 23.4 已知限制 3 的关闭

- 主线 B-4 §6 **已知限制 3（`.srt` / `.json` 不可寻址）已于 2026-10-12 由本子项关闭**，关闭依据与代码级证据写在该处与契约 §4.3 / §4.4；打开方式为**新增按用途路由**，**未**扩 `/api/videos` 白名单。
- 同节 **已知限制 1 / 2 / 4**（worker 路径 `resultUrl`、产物 `source`、无认领锁）**未变**。
- 另有一处**本节不改**的过期文档（如实登记）：`docs/e2e-baseline-inventory.md:280`（「`videos/` 里的 `.srt` / `.json` … 已知限制（无服务路由）」）、`docs/e2e-stage2-execution-record.md:158` / `:204`、`docs/e2e-stage2-acceptance-conclusion.md:37` 仍把"`.srt` / `.json` 不能从 `/api/videos` 取（404）"记为**现状或已知限制** —— 那些记录针对的是 `/api/videos`，**今天仍然成立**；但其中"**没有侧车读取入口**"这一条已被本子项改变（新入口是**另一个**路由）。它们属**其他卡的记录**，按既定约定**只报告、不代改**。

### 23.5 行号影响（登记事实，不代改其它文档）

| 引用对象 | 本卡前实测 | 本卡后实测 |
| --- | --- | --- |
| 主线计划总行数 | 3058 | **3113**（B-4 内净增 **55** 行） |
| 主线 `## 附录 B-5` 标题行 | 947 | **1002** |
| 主线 B-10 的「全量单测 … 152 文件 / 1247 用例」行 | 1392 | **1447** |

- 三处**既有**引用写作「主线 **§附录 B-10 第 1385 行**」（`docs/coolpilot-capability-integration-plan.md:2131`、本文件 §396、`docs/development/menu-information-architecture.md:405`）在本卡开工前**已**与实测 1392 相差 7 行（早于本轮即已漂移）；本卡使其进一步下移到 1447。**本卡不代改这三处**，只在此登记。

### 23.6 未做的事（如实登记）

- 本轮**只改文档**：未改任何业务代码 / 测试代码 / 配置 / 数据库结构，**未重跑测试**（§23.3 是交付时的实跑口径，并已逐条标明），**未**重启或停止 dev server。
- **未验证**：打包版 Electron 行为；运行中任务的进度轮询（面板不轮询）；编码能力（`encoded` 恒为 `false`，取决于 P1-04-06 决策）。
- **Git 边界**：本轮**未**执行 `git add` / `commit` / `push` / `stash` / `reset` / `clean`；工作区既有未提交改动未被触碰、未被回滚。

## 24. `CI-LEAD-01` 营销线索与成交（2026-10-12）：授权修正 + 立项登记 + 交付记录

> 本轮作者下达两件事：① **授权一处最小文档修正**（§24.1）；② **立项并开发**「营销线索与成交」（§24.2–§24.6）。两件都在同一轮完成，交付主体是**代码与测试**。

### 24.1 授权修正：`CI-P2-07` 状态 `todo` → `done`

- **授权来源**：作者 2026-10-12 明确授权「将 §3 中 CI-P2-07 的 `todo` 修正为 `done`，与主线计划保持一致」，并限定边界：只改这一处状态字段及必要的最小上下文、**不调整历史行号**、**不顺手修复**其它差异、不改业务代码 / 测试 / 数据库 / 其它任务状态、不执行 Git 写操作。
- **改动位置与内容**：§3 第 **86** 行**同一行内**，状态由 `**todo**（2026-10-10 作者授权立项，见 §4.5）` 改为 `**done**（2026-10-12 按作者授权修正：本表原记 `todo` 为 2026-10-10 立项时的旧值，与主线 §1 第 50 行的 `done` 不一致；交付事实见 §4.5、主线 §15。**本次只改该状态字段**，未动历史行号与其它差异）`。**未新增 / 未删除行**，本文件此前的行号**零位移**（§4.5 与其后章节的行号不受影响）。
- **修改后一致性核对**：与 ① 主线 §1 第 **50** 行（`CI-P2-07 = done`）、② 本文件 §4.5 交付记录、③ 主线 §15 交付记录，三处**一致**。
- **本次未改**：§3 其它行、§4.5 正文、任何历史行号引用、本文件其它章节、`docs/` 内其它文档的既有差异。

### 24.2 立项前的编号核验（2026-10-12，`docs/**` + `src/**` 全量检索）

| 候选 | 命中 | 结论 |
| --- | --- | --- |
| `CI-LEAD` | **0** | **采用 `CI-LEAD-01`**（独立支线族首个） |
| `CI-P2-08` | **0** | 可用，但**未采用** |
| `CI-P2-06A`（作者建议） | **0** | **未采用**：`CI-P2-06` 已被清单 §四 第 279 行「创作者资料与内容分群」保留为那张卡的槽位；`P2-06A` 会被读成「该卡的子项」，而线索/成交与该卡不是同一件事 |
| `CI-P3-04` | 已有（被 `CI-EMB-01` 明确**不占用**） | 不使用 |
| `CI-P2-06` | 3 处（均为「该号已被清单占用」的说明） | 不使用 |

**为什么走独立支线**：本文件与主线对本类「不来自清单、作者直接授权」的卡已有先例 —— `CI-SC-01`、`CI-AI-IMG-CONFIG-*`、`CI-ARTICLE-NAV-01`、`CI-EMB-01` 全部使用独立前缀。`CI-P2-*` 是清单 §四「内容生产工作流」的槽位，而本卡记录**业务结果**（发布 → 咨询 → 成交），不是内容生产步骤；占用同族号会误导后续编号。**作者若偏好 `CI-P2-08`，改名成本 = 6 个文件的一次文本替换**（主线 §附录 U、主线 §1 第 71 行、本文件 §3 第 87 行与本节、`src/db/schema.ts` 表注释、`src/lib/app-errors.ts` 两条注释）。

### 24.3 交付登记（改动内容 / 调用链路）

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 数据模型 | `src/db/schema.ts`、`src/db/client.ts` | 唯一新表 `marketing_leads` + 3 索引；**未改任何既有表 / 列** |
| 纯逻辑 | `src/lib/leads.ts`（新增 287 行）、`src/lib/types.ts` | 词表 / 金额最小单位 / 成交裁决 / 关联裁决 / 汇总 / 错误码映射 |
| 错误词表 | `src/lib/app-errors.ts` | `LEAD_DEAL_RECORDED`、`LEAD_DEAL_CURRENCY_MISSING` |
| 校验 | `src/lib/validation.ts` | `marketingLeadCreateSchema` / `marketingLeadUpdateSchema` |
| 仓储 | `src/db/repositories/leads.ts`（新增 139 行） | 四个动词 + 写入前 `resolveMarketingLeadDeal` 守卫 |
| 路由 | `src/app/api/leads/route.ts`、`src/app/api/leads/[id]/route.ts`（新增） | `GET`/`POST`、`GET`/`PATCH`/`DELETE` |
| 界面 | `src/components/marketing-leads-workspace.tsx`（新增 600 行）、`src/app/[locale]/(console)/publishing/leads/page.tsx` | 列表 / 统计 / 内容维度 / 新建·编辑·删除 |
| 导航 | `src/lib/console-nav.ts` + `src/lib/console-nav.test.ts` | 发布与渠道组新增叶子 `leads`（紧随「发布记录」），不变式测试**有意更新 2 行** |
| 三语 | `src/locales/{en,zh-cn,zh-hk}.json` | 各 **+80** 键，三键集相同（`i18n-coverage` 把守） |

**调用链路**：页面 → `GET /api/leads` → `listMarketingLeads()`（唯一新表读）→ 既有 `listContentItemRefs()` / `listPublishRecords()` 解析线索命名的 id → `summarizeMarketingLeads()` 一次返回。写入 → 对话框（本地把金额文本转最小单位）→ `POST /api/leads` 或 `PATCH /api/leads/[id]` →（只有命名记录时才）`getPublishRecord()` → `resolveMarketingLeadContentItem()` → 仓储写入（`resolveMarketingLeadDeal()` 通过后才落库），拒绝时 `400 LEAD_*`。**未经过 AI Runtime、未写 `runs` / `publish_records` / `content_items`。**

### 24.4 验证结果（**本轮 2026-10-12 实跑**）

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**（输出 0 字节） |
| 定向 `vitest run`（`src/lib/leads.test.ts` + `src/app/api/leads`） | **3 文件 / 35 用例通过**（`leads.test.ts` 15、`leads/route.test.ts` 10、`leads/[id]/route.test.ts` 10） |
| 全量 `vitest run` | **181 文件 / 1600 用例全通过**（本文件 §23.3 记上一张卡 178 / 1565 → **+3 文件 / +35 用例**，恰为本卡三个用例文件） |
| `eslint src` | **exit 0 / 0 error / 1 warning**（唯一 warning 为**既有** `src/components/agent-chat/chat-conversation.tsx:146`，非本卡） |
| `eslint .`（仓库级） | **本轮未跑**（如实标注）；仓库根既有 3 条未跟踪脚本 error 与前几张卡记录一致，**非本卡** |

**关键用例**：未记录金额 ≠ 0（`wonWithoutAmount` 单列且不入合计）；金额整数化（`"1200.5"` → `120050`，三位小数 / 分隔符 / 负号一律 invalid）；币种不混算；成交不得被静默删除（`PATCH` 改状态 → `400 LEAD_DEAL_RECORDED` **且复查库中金额/币种/时间/备注仍在**）；清除必须显式 `dealCleared`；金额必须带单位；关联由命名的发布记录裁决（含 `null` 解除关联）；不存在的记录不写并复查行数未变；空库返回全 0；菜单不变式全过。

### 24.5 未做的事（如实登记）

- **未做（可延后）**：① **批量导入** —— 作者功能表里的「支持现有数据结构的导入方式」只做到「手动录入 + API 接受现有字段形状」，**CSV / 表格导入未实现**（仓库内无任何导入 UI 先例，如需请另立卡）；② **真实 dev server HTTP 冒烟**与**打包版 Electron 验证** —— 本轮未起任何服务、未停/未重启作者的 dev server（路由用例是**真实路由处理器 + 真实 SQLite 临时库**，但**不是** HTTP 层）；③ **按内容直接关联的界面选择器** —— API 接受 `contentItemId`，界面只提供发布记录下拉（`/api/content` 的 `pageSize` 上限为 20，没有可用的内容全量列表端点）。
- **阻塞**：无。
- **界面状态未做 DOM 测试（如实登记）**：加载 / 成功 / 失败 / 空态与「成交但未记录金额」提示均由组件实现，但**无 DOM 级用例** —— 本仓 vitest 无 DOM 环境（无 jsdom / happy-dom / @testing-library），与 `CI-P2-07` 的既定做法一致；可测的界面分支已抽到 `src/lib/leads.ts` 纯函数（15 条用例覆盖）。
- **口径提醒（不是实现）**：`dealAmountMinorScale = 100` 对所有币种一律两位小数（JPY / KRW 会被显示成 `.00`）；已写进代码注释与本节，属**已知限制**。
- **未改**：`docs/coolpilot-integration-contracts.md`（本卡不新增媒体产物 / 长任务类型 / 工具注册，不触发三份契约）；AI Runtime、C2 发布语义、指标采集、视频生产、既有任务状态与编号**一律未动**。

### 24.6 行号影响（登记事实，不代改其它文档）

| 引用对象 | 本卡前实测 | 本卡后实测 |
| --- | --- | --- |
| 本文件总行数 | 695 | **773** |
| §3 的 `CI-P2-07` 行（**同行内**状态修正） | 86 | **86**（零位移） |
| §3 新增的 `CI-LEAD-01` 行 | — | **87** |
| `## 4.5` 标题行 | 219 | **220** |
| `## 5.` 标题行 | 254 | **255** |
| `## 24.` 标题行 | — | **697** |

- §3 **新增一行**使 **87 行之后**的既有引用整体下移 **1** 行（§4.3 / §4.4 / §4.5 / §5 与文末既有章节）；§24.1 的状态修正是**同行内替换**，不产生位移。
- 本卡**不代改**上一张卡 §23.5 登记的既有漂移（三处「主线 §附录 B-10 第 **1385** 行」），也**不代改**主线 §附录 U §U.7 登记的主线内部漂移；两处都只在本节登记事实。





