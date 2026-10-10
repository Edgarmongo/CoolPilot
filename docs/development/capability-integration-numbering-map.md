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
| P1-04 定义视频模板与渲染任务 | `CI-P1-04` | **done** | §附录 B-4（含 3 条已知限制） |
| **P1-05 工作流编排内核（erxes）** | **无** | —（新清单新增） | 新清单 §三 第 193–209 行 |
| P2-01 选题管理 | `CI-P2-01` | **done** | §附录 B-5 |
| P2-02 品牌资料管理 | `CI-P2-02` | **done** | §附录 B-6 |
| P2-03 整合文章创作流程 | `CI-P2-03` | **done**（含 2 项部分完成） | §附录 B-7 §4 |
| P2-04 内容生命周期与日历 | `CI-P2-04` | **done**（本轮交付，见 §4.3） | §4.3 证据表 + 主线 §5 本卡交付记录 |
| P2-05 多平台内容模型 | `CI-P2-05` | **done（仅模型与 API 契约；无 UI 消费者、无真实 HTTP 冒烟，见 §4.4）** | 主线 §1 第 **49** 行（本表原记「第 47 行」为位移前旧值）+ §4.4 证据表 |
| **P2-06 创作者资料与内容分群（erxes）** | **无** | —（新清单新增） | 新清单 §四 第 275–291 行 |
| **P2-07 多平台内容版本管理 UI（我方实现层补充，清单无对应条目）** | **`CI-P2-07`** | **todo**（2026-10-10 作者授权立项，见 §4.5） | `CI-P2-05` 的**界面消费者**；`CI-P2-06` 已被清单 §四 第 279 行占用，故取下一空位 |
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
| P8-05 质量指标与成本优化建议 | `CI-P7-04` | **todo** | 主线 §13 第 434–438 行 |
| P8-06 覆盖所有 AI 能力与扩展契约 | `CI-P7-05` | **部分就绪**（`metered_kind` + `quantity_json` 表/键/计价函数已在，缺非文本维度录价表单） | 主线 B-11 §7 第 3 条 |
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

