# CoolPilot 能力集成开发计划（8 个开源项目能力集成）

> **本文是当前开发主线**。审计文档（`docs/dev-exec-list.md`、`docs/p0-acceptance-and-p1-sequencing.md`、`docs/p1-card-01-*.md` 等）降为辅助资料：只作事实查证，不再作为推进门槛。
> 本轮目标：优先把 8 个开源项目中有价值的能力集成进 CoolPilot，打通主要业务流程，再集中开展系统测试、缺陷修复和体验优化。

## 0. 命名空间与冻结边界（必读，避免任务号冲突）

仓库里**已存在**一套编号相似的文档，用于此前的基线审计与 Creator Workflow 卡 1：

| 既有文档 | 既有编号 | 状态 |
| --- | --- | --- |
| `docs/dev-exec-list.md` | P0-01～P0-08 / P1-01～P1-05（A/D/DE/PE/WF） / P2～P5 | 旧审计序列，**P0 与 P1 卡 1 已冻结关闭** |
| `docs/p0-acceptance-and-p1-sequencing.md` | 卡 1～卡 9、A01～A10、B1～B6、DE/PE | 卡 1 关闭；卡 2/卡 3 未开始 |
| `docs/open-source-capability-map.md` | P0（锁定基线）/ P1…P5（产品能力阶段） | 研究文档，8 个开源项目能力清单在这里 |

**本计划的编号是一个新命名空间**，与本文件内小节的 P0…P6 一一对应；为避免歧义，在提交信息、代码注释与其他文档中引用时统一写作 **`CI-P0-01` … `CI-P6-04`**（CI = Capability Integration）。

**参考条目命名空间（2026-10-10 追加）**：`A1`–`A7` 是 Anki 的设计借鉴条目（权威正文见 `docs/development/CoolPilot-开发清单-10个开源项目整合版.md` 附录 Z）。它们是**参考项、不是任务卡**：不占 `CI-` 卡号、不进入 §1 状态表、不自动生成新卡，也不改变任何既有卡片的编号、顺序与状态。与现有卡的映射见本文 **§附录 C** 与 `docs/development/capability-integration-numbering-map.md` §6.1。

**冻结边界（不因本计划而重开）**：

- `docs/p0-acceptance-and-p1-sequencing.md` 的 P0 结论、P1 卡 1 结论、D1（F1 + F3）关闭结论、F3-f 未达成项（保留为 F5）。
- **发布语义（C2 发布成功契约）**：`PE05`（`POST /api/publish` 建记录与内容状态更新的关系）只能复核，不得改语义。
- AI Runtime（`src/features/ai-runtime`）为冻结面：能力集成**必须经过**它，不得旁路新建模型调用路径。
- 工作区未提交改动（本轮开始时 `git status --porcelain` = **49 条**）不得覆盖、不得清理、**不得 `git commit`**。

**执行原则**（与指令一致）：不完整搬运开源项目、只提取能力；优先复用现有模块/API/数据模型/文件存储；先最小可运行版本；每个任务有可验证完成标准；不做大规模重构与 UI 精修。

## 1. 任务状态表（唯一进度来源）

状态取值：`todo` / `in_progress` / `blocked` / `done` / `deferred`。

| 任务 | 名称 | 状态 | 完成报告 |
| --- | --- | --- | --- |
| CI-P0-01 | 盘点现有模块与入口 | done | 见 §附录 A-1 |
| CI-P0-02 | 建立开源能力映射表 | done | 见 §附录 A-2 |
| CI-P0-03 | 确定统一媒体产物契约 | done | `docs/coolpilot-integration-contracts.md` §1 |
| CI-P0-04 | 确定统一长任务契约 | done | `docs/coolpilot-integration-contracts.md` §2 |
| CI-P0-05 | 确定工具调用契约 | done | `docs/coolpilot-integration-contracts.md` §3 |
| CI-P0-06 | 保护现有功能和工作区 | done | 见 §附录 A-3 |
| CI-P1-01 | 统一媒体产物管理 | done | 见 §附录 B-1 |
| CI-P1-02 | 统一长任务管理 | done | 见 §附录 B-2 |
| CI-P1-03 | 统一媒体工具注册 | done | 见 §附录 B-3 |
| CI-P1-04 | 定义视频模板与渲染任务 | done | 见 §附录 B-4 |
| CI-P2-01 | 选题管理 | done | 见 §附录 B-5 |
| CI-P2-02 | 品牌资料管理 | done | 见 §附录 B-6 |
| CI-P2-03 | 整合文章创作流程（选题 + 品牌 → 生成 → 编辑 → 配图） | done（含 2 项部分完成，见 §附录 B-7 §4） | 见 §附录 B-7 |
| CI-P2-04 | 内容生命周期与日历 | done（只读生命周期读模型 + `GET /api/content/lifecycle` + 内容侧/日历侧展示与改期；未新增表、未改 C2，见 §5 第 192 行本卡交付记录） | 见 §5 CI-P2-04 交付记录（2026-10-10） |
| CI-P2-05 | 多平台内容模型 | done（**限模型与 API 契约**：`src/lib/platform-content.ts` + `GET/POST/PATCH/DELETE /api/content/[id]/platform-versions`；**无 UI 消费者、无真实 HTTP 冒烟**，见 §5 第 210 行起本卡交付记录） | 见 §5 CI-P2-05 交付记录（2026-10-10） |
| CI-P2-07 | 多平台内容版本管理 UI（`CI-P2-05` 的界面消费者） | done（内容库详情对话框内**查看 / 派生 / 编辑保存 / 删除**闭环；三语 i18n；纯逻辑单测 + 静态渲染冒烟 + 真实 HTTP 冒烟 + 真实浏览器交互冒烟（zh-cn / en / zh-hk 各 28 项全过）；**无 DOM 单测**（vitest 无 DOM 环境、不新增依赖），见 §15 本卡交付记录） | 见 §15 CI-P2-07 交付记录（2026-10-10）；立项与编号依据见 §14 / `docs/development/capability-integration-numbering-map.md` §4.5 |
| CI-P3-01 | 研究素材管理与创作流程集成 | done | 见 §附录 B-8 |
| CI-P3-02 | 音视频转录 → 摘要（P3-02-01…07） | done（转写主卡见 §附录 B-9；摘要与引用收尾见 §附录 B-10） | 见 §附录 B-9 / B-10 |
| CI-P3-03 | 研究结果进入创作 | done（P3-03-05 的 RAG 预留按原计划不做，见 §附录 B-10 §4） | 见 §附录 B-10 |
| CI-P4-01…CI-P4-04 | Agent Tool / Skill / 外部服务 / 浏览器自动化 | todo | — |
| CI-P5-01…CI-P5-03 | 创作 / 视频 / 发布 三条业务闭环验证（CI-P1-05 集中式 E2E） | in_progress | 阶段 1 基线：`docs/e2e-baseline-inventory.md` |
| CI-P5-04 | Agent 自动化闭环验证 | todo | — |
| CI-P6-01…CI-P6-04 | 自动化测试 / 浏览器回归 / 数据与文件安全 / 生产就绪评估 | todo | — |
| CI-P7-01 | 统一使用账本与真实成本核算 | in_progress（账本底座、**14/14 调用点**与**价格目录录入入口**均已落地；账本要报出金额只差用户录入价格，见 §附录 B-11 §5） | 见 §附录 B-11 |
| CI-P7-02 | 成本中心首页与全链路明细 | done（-01/-02/-03/-06 见 §13 与编号映射 §4.1；-04/-05 见 §13 与编号映射 §4.2） | 见 §13 第 418–425 行 |
| CI-P7-03…CI-P7-05 | 预估与预算 / 质量与成本优化 / 全能力覆盖 | in_progress（**`CI-P7-03` 已于 2026-10-10 交付并实测**：预估层 + 自然月预算 + **请求发出前**闸门 + 执行中预留；`P7-03-04` 三种执行策略**未交付**、完成标准 5 为「终止 + 重跑」而非可恢复暂停、并发只到 `in-process-soft`，详见 §附录 D。`CI-P7-03-A`（持久化预算预留 / 预算决策 / 逐运行·节点对账）已于同日交付并实测（**并发保证随之由 `in-process-soft` 收口为 `cross-process-atomic`**：预留持久化 + 一条语句原子准入 + 幂等结算 + 按预留 id 对账，见 §附录 H）；`CI-P7-04` 已于 **2026-10-11 交付并实测**（质量与成本优化：真实质量 / 成本读数 + 单位合格产出成本 + 可解释建议 + 一键应用「执行档位」；`人工修改幅度` 按「本安装未记录」如实呈现，见 §附录 L）；**`CI-P7-05-02` 已于 2026-10-11 交付并实测**（按运行与节点的成本：运行总额 = 其节点行之和、失败成本与重试成本是**同一批请求的两种读数**、永不相加，未记录运行 / 记录不到节点的行各自成组显示为「未归类」；窗口内没有金额读数时如实写「无金额」而不是 0，见 §附录 M）；**`CI-P7-05-03` 已于 2026-10-11 交付并实测**（Marketplace 扩展标识与费用归属：账本新增 `extension_id`（加列 + 索引、**不回填历史行**），归属规则收敛到 `src/lib/marketplace-attribution.ts` 的**单一裁决点**——**已上架 position 的清单 id > 目录 agent id > `''`**（草稿与 picker 专用 id 一律不归属），三个真实调用点逐条接线，成本中心新增「按 Marketplace 扩展归属的成本」明细卡与 `extensionId` 筛选；`''` 作为「未归属」照常入表、传空 = 不筛选；**只登记真实身份，不伪造任何 Marketplace 执行条目**，见 §附录 N）；**`CI-P7-05-04` 已于 2026-10-11 交付并实测**（AI 服务可计量性边界：**不新增数据库列、不回填**——原因改由 `src/lib/ai-metering.ts` 的 `meteringReasonFor()` **只读行内既有证据**（`outcome` + `completeness` + 价格快照 + 用量单位）派生，10 条原因逐条对应 `computeUsageCost()` 真实的「说不出来」分支；成本中心新增「未述明原因」列与**六个计量维度恒列出的「计量覆盖」表**——video / embedding 在本运行时**没有调用路径**、agent 按 text 行计量，一律**显式点名**而不是漏记；`extensionId` 为空**不参与**任何计量判断，见 §附录 P）；`CI-P7-05-01` 仍为 todo） | **§附录 D** / **§附录 L** / **§附录 M** / **§附录 N** / **§附录 P** + §13 第 442 行起 |
| CI-IA-01 | 控制台菜单信息架构重整（8 组 / 30 入口，**只动导航与三语文案**） | done（新增 `src/lib/console-nav.ts` 单一菜单模型 + 10 例不变式测试；路由、权限、业务逻辑与数据**零改动**；`tsc --noEmit` exit 0、全量 `vitest run` **147 文件 / 1198 用例全通过**、真实浏览器三语冒烟 **111/111**，见 §附录 E 与 `docs/development/menu-information-architecture.md`） | 见 §附录 E（2026-10-10） |
| CI-IA-02 | 控制台菜单按商业/产品架构重排（8 组改序 + 6 处改名 + 5 个移动端短标签 key，**只动导航与三语文案**） | done（组序为 工作台→内容创作→品牌与资产→发布与渠道→自动化→数据与成本→扩展市场→系统设置；30 条路由与全部 i18n **key 名零改动**；`tsc --noEmit` exit 0、全量 `vitest run` **147 文件 / 1200 用例全通过（exit 0）**、真实浏览器三语冒烟 **120/120（exit 0）**，见 §附录 F 与 `docs/development/menu-information-architecture.md` §4.1 / §8.2） | 见 §附录 F（2026-10-10） |
| CI-IA-03 | 控制台菜单归属与命名修订（`/creation/posts` 由「发布与渠道」移入「内容创作」，改名「动态发布」→「动态创作」；**只动导航与三语文案**） | done/closed（**作者 2026-10-10 验收通过并关闭**，见 §附录 J「作者验收与关闭」；按作者 2026-10-10 直派执行：8 组的顺序与命名**逐组与目标架构一致**，唯一结构性改动就是这一条叶子；30 条路由、全部 i18n **key 名**、页面 / 权限 / 数据模型**零改动**；`tsc --noEmit` exit 0、定向单测 **13/13**、全量 `vitest run` **153 文件 / 1263 用例通过**（另有 2 条失败在 `src/worker/runner.test.ts`，属作者**在途未提交**的 `src/worker/runner.ts`（CI-P7-03 系列）既有基线失败，与本卡无关）、真实浏览器三语冒烟 **78/78（exit 0）**，见 §附录 J 与 `docs/development/menu-information-architecture.md` §5.2 / §8.3） | 见 §附录 J（2026-10-10） |
| CI-SC-01 | 智能画布产物进入文章编辑器最小闭环（**作者 2026-10-10 授权支线，非 8 个开源项目来源**）：白板导出补 `metadata.type` + 思维导图新增「存入内容库」出口 + 来源映射抽取 + 内容中心续编入口 | **done**（实现 + 单测/静态验证完成；**作者要求的真实浏览器端到端 2026-10-10 复跑：21/21 通过、0 FAIL** —— 原 20/21 的唯一失败 = 内容库「在编辑器中打开」的**软导航**不消费 `?edit=`，**已由后继卡 `CI-ARTICLE-NAV-01` 定位、修复并复跑转 PASS**；根因随之**更正**为：参数**确实已交付**（工作区 effect 已发出取条目请求并拿到 200），失败原因是「已消费」守卫 ref 在请求在途时即被置位、而 effect 重跑时的 cleanup 把这次唯一请求作废 → 见 §附录 **K.9**。**仍未验证**：打包版 Electron 行为） | 见 §附录 K（本卡交付记录，2026-10-10；真实浏览器验收见 **K.8**，软导航修复见 **K.9**） |
| CI-ARTICLE-NAV-01 | 修复文章编辑器查询参数软导航（**作者 2026-10-10 直派的 CI-SC-01 后继支线**）：内容库「在编辑器中打开」**点击进入**不再丢失 `?edit=` | **done**（实测定位根因 + 最小修复 `src/components/creation/articles-workspace.tsx` 的 `?edit=` effect；真实浏览器本卡探针 **9/9**、作者验收套件复跑 **21/21**、回归脚本 `scripts/creator-editor-link-smoke.ts` **exit 0**（并已反向验证该断言能抓住旧缺陷）、`tsc --noEmit` exit 0、定向 `eslint` exit 0、定向 `vitest` 2 文件 exit 0；**未**改数据模型 / AI Runtime / 发布链路 / 路由配置） | 见 §附录 **K.9**（2026-10-10） |
| CI-AI-IMG-CONFIG-01 | 文本与图片模型独立配置：审计与设计（**作者授权支线，非 8 个开源项目来源**） | done | `docs/architecture/independent-image-provider-configuration.md`；见 §附录 I |
| CI-AI-IMG-CONFIG-02 | 图片配置层分离（阶段 1：字段 / 校验 / UI / 图片 Key 独立存储，**不触 runtime**） | done | `docs/architecture/ci-ai-img-config-02-delivery.md`；见 §附录 I |
| CI-AI-IMG-CONFIG-03 | 图片运行时身份 / 端点 / 凭据独立（阶段 2：触冻结面，CR **已批准并实施**） | done（作者 2026-10-10 验收：**功能实现成功、真实安装端到端通过**；**1 项设计稿验收标准未满足** = §9.3-3 要求打包版 Electron 验证，仅 dev server 实测，见 §附录 I.2） | `docs/architecture/ci-ai-img-config-03-delivery.md`；见 §附录 I |
| CI-AI-IMG-CONFIG-04 | 设计文档按 Q4 修订（§4.2 规则 1/3、§5.1、§5.3、§6.3、§6.4 + §10 Q1–Q4 + 阶段 4 清理与文档）+ `provider` 新值在成本中心的归口口径 | todo（**建议编号**，待作者确认） | — |
| CI-AI-IMG-CONFIG-05 | 图片端点绑定边界（`ensureLegacyModel` 对"先存模型、后存 URL"不重绑端点；旧图片模型行清理提示） | todo（**建议编号**，待作者确认；作者已裁定为**独立后续事项**） | — |
| CI-LEAD-01 | 营销线索与成交（**作者 2026-10-12 直派的支线，非 8 个开源项目来源**）：线索录入 / 跟进状态 / 成交记录 / 内容关联 / 统计视图 | **done**（本地新表 `marketing_leads` + `GET`·`POST /api/leads` + `GET`·`PATCH`·`DELETE /api/leads/[id]` + `/publishing/leads` 页面与侧边栏入口；**未触** AI Runtime / C2 发布语义 / 指标采集 / 视频生产；**未做**批量导入与打包版验证，见 §附录 U） | 见 §附录 U（2026-10-12） |

> **本表只登记 `CI-` 任务卡**（唯一进度来源）。2026-10-10 追加的 Anki 设计借鉴条目 `A1`–`A7` 是**参考项**，**不进入本表**、不占卡号、不改变任何卡的顺序与状态；其与现有卡的映射见 §附录 C。**2026-10-11 追加登记**（本行**同行追加**、**零位移**）：支线卡 **`CI-EMB-01`**（Embedding 端到端接入）——**编号已于 2026-10-11 由作者正式确认**（**阶段 0 冲突核验**：本文件与 `docs/development/capability-integration-numbering-map.md` 内 `CI-EMB` 仅出现在本卡登记段，**0 冲突**；**仍不占任何 `CI-P*` 卡号**）；状态由「建议编号」转为**实现中**（**同行更新**，**零位移**）；卡体见 **§附录 T**（实现记录见 **T.10**）。
>
> **`CI-AI-IMG-CONFIG-*` 的登记依据（2026-10-10 补记）**：该卡族是**作者直接授权的支线**（文本与图片模型独立配置），不落在 §3~§9 的任何 P0–P6 小节内，因此此前只在 `docs/architecture/*` 有记录，**本表与本文正文 `CI-AI-IMG` 命中数为 0**（2026-10-10 复核）。但它同样是 `CI-` 任务卡，按同一规则登记在本表；状态、真实证据、未验证项与后续依赖见 **§附录 I**。图片计量与定价**不新造卡号**，归 `CI-P7-05-01`（§13）。
>
> **`CI-SC-01` 的登记依据（2026-10-10 补记）**：本卡是**作者在「智能画布」只读盘点之后直接授权的支线**（`CI-SC` = Smart Canvas），**不来自** 10 个开源项目整合清单，因此 `docs/development/CoolPilot-开发清单-10个开源项目整合版.md` **不含本卡**，本文件 §3~§9 也无对应小节。它是 `CI-` 任务卡，按同一规则登记在本表并写入 **§附录 K**；不占任何 `CI-P*` 卡号，也不改动任何既有卡的编号、顺序与状态。
>
> **`CI-ARTICLE-NAV-01` 的登记依据（2026-10-10 补记）**：作者在 `CI-SC-01` 的唯一失败项（真实浏览器 B3：内容库「在编辑器中打开」的软导航）上**直派的后继支线**，同样**不来自** 10 个开源项目整合清单，按同一规则登记在本表并写入 **§附录 K.9**；它只处理该导航问题与其必要测试，不占任何 `CI-P*` 卡号。

## 2. 总体开发阶段

| 阶段 | 名称 | 交付 |
| --- | --- | --- |
| CI-01 | 基础能力集成 | 媒体产物引用、任务状态与进度、工具注册与结构化结果 |
| CI-02 | 创作与研究能力集成 | 选题、品牌资料、研究素材、转写与摘要、文章和图片的关联 |
| CI-03 | 视频、发布与自动化集成 | 视频任务接口、内容日历、多平台内容适配、Agent Tool/Skill、浏览器自动化 |
| CI-04 | 统一回归与生产就绪评估 | 完整业务链路测试、数据与文件安全验证、缺陷清单、生产部署检查 |

## 3. P0：集成前的必要准备（只做一次，最小范围）

P0 完成标准：找到实际代码落点、识别重复能力、明确最小接口、形成可执行任务清单。**不新增生产业务功能。**

> **P0 结论（已达成）**：落点见附录 A-1（实测：30 页面 / 88 API / 29 表 / 4 个文件根 / 6 个媒体写入方 / 3 套任务入口 / 9 个已注册工具 / MCP 不存在）；映射见附录 A-2；最小接口见 `docs/coolpilot-integration-contracts.md`（媒体产物、长任务、工具调用三份契约）；工作区保护见附录 A-3。**P0 未改动任何生产代码**。

### CI-P0-01 · 盘点现有模块与入口

- 定位现有页面、API、服务、数据表、文件目录和相关测试。

### CI-P0-02 · 建立开源能力映射表

- 8 个来源分别对应现有模块、计划改动点、依赖和验收标准。

### CI-P0-03 · 确定统一媒体产物契约

- 先盘点已有图片、视频、封面、字幕的存储与访问方式，不急于新建 Asset 表。

### CI-P0-04 · 确定统一长任务契约

- 统一任务 ID、状态、进度、错误、日志和结果的表达方式。

### CI-P0-05 · 确定工具调用契约

- 统一工具名称、参数 Schema、结果、错误和执行记录的基本格式。

### CI-P0-06 · 保护现有功能和工作区

- 记录现有 Git 状态；禁止覆盖用户改动，不自动提交代码。

## 4. P1：媒体工具与长任务基础设施

主要提取 AIGCPanel、DouyinLiveRecorder 和 Remotion 的共同能力。

### CI-P1-01：统一媒体产物管理

- P1-01-01 盘点现有图片、视频、音频、封面、字幕的生成与存储路径。
- P1-01-02 定义统一产物引用：产物 ID（如适用）、类型、文件路径或 URL、MIME 类型、来源任务及元数据。
- P1-01-03 兼容现有 `content_items.metadata_json.images` 和 `image_path` 封面镜像，不破坏已有数据。
- P1-01-04 为产物提供统一查询与访问入口；鉴权和路径校验沿用现有安全边界。
- P1-01-05 将新生成的媒体结果登记到统一产物引用中。
- P1-01-06 验证历史图片、封面和现有文章中的图片仍能正常访问。

完成标准：图片与其他媒体能够被统一引用，已有图片展示和文章内容不受影响。

### CI-P1-02：统一长任务管理

- P1-02-01 定义任务状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`；如有等待人工审批等状态，沿用现有语义，不随意合并。
- P1-02-02 定义任务基础字段：任务 ID、任务类型、输入参数、状态、进度、错误摘要、创建与更新时间。
- P1-02-03 支持创建任务、查询任务、查询进度和查询最终结果。
- P1-02-04 统一任务日志结构，关联任务 ID、执行阶段、时间和错误信息。
- P1-02-05 支持取消任务；只有底层任务可安全停止时才返回成功。
- P1-02-06 评估服务重启后的任务恢复策略；无法安全恢复的任务应明确标记，不能假装继续运行。
- P1-02-07 将现有可长时间运行的媒体操作接入任务状态管理。

完成标准：长任务有明确的生命周期、进度、错误、取消结果和可追踪日志。

### CI-P1-03：统一媒体工具注册

- P1-03-01 定义工具注册信息：工具名称、描述、输入参数 Schema、输出 Schema 和执行入口。
- P1-03-02 实现工具发现与调用入口。
- P1-03-03 统一参数校验、执行错误和结构化返回值。
- P1-03-04 支持同步工具直接返回结果、长任务工具返回任务 ID。
- P1-03-05 将现有图片生成或媒体处理能力接入工具注册机制。
- P1-03-06 保留现有模型凭据、权限检查和运行时配置，不复制一套凭据管理系统。

完成标准：至少一个现有媒体工具通过统一注册机制完成调用，并能正确返回结果或任务 ID。

### CI-P1-04：定义视频模板与渲染任务

- P1-04-01 定义视频模板的标识、版本、参数和默认值。
- P1-04-02 定义渲染任务输入：模板、素材引用、参数和输出要求。
- P1-04-03 定义渲染任务状态、进度、错误与取消接口。
- P1-04-04 定义渲染产物：视频文件、封面、字幕和相关元数据。
- P1-04-05 建立一个可调用的模拟渲染器或测试适配器，验证整个任务链路。
- P1-04-06 根据实际模板需求和部署环境，再决定是否引入 Remotion 或其他渲染引擎。

## 5. P2：内容生产工作流

主要提取 ALQQ / Meiti AI 与 BrightBean Studio 的能力。

### CI-P2-01：选题管理

- P2-01-01 建立选题新增、编辑、查询和归档能力。
- P2-01-02 为选题记录标题、描述、关键词、来源和状态。
- P2-01-03 支持从研究素材创建选题。
- P2-01-04 支持从选题进入文章创作。
- P2-01-05 记录选题与后续内容之间的关联。

完成标准：用户能够建立选题，并从选题进入内容创作，而不需要重复录入信息。

### CI-P2-02：品牌资料管理

- P2-02-01 定义品牌资料：品牌名称、简介、目标受众、语气、关键词和禁用表达。
- P2-02-02 支持品牌资料新增、编辑和选择。
- P2-02-03 将选定的品牌资料注入写作上下文。
- P2-02-04 在文章中保留使用的品牌资料引用或版本信息（以便追溯）。
- P2-02-05 验证不同品牌配置能够影响生成结果，且不会串用其他品牌资料。

完成标准：写作流程能够选择品牌资料，并将其作为明确的生成输入。

### CI-P2-03：整合文章创作流程

- P2-03-01 串联选题、品牌资料、文章生成和编辑。
- P2-03-02 串联图片生成、图片选择、封面选择与文章关联。
- P2-03-03 保持现有文章编辑器的保存格式和历史正文兼容性。
- P2-03-04 统一展示生成状态、失败原因和可重试入口。
- P2-03-05 支持保存草稿、重新打开和继续编辑。
- P2-03-06 避免重复点击造成重复创建文章或重复提交同一个任务。

完成标准：从选题到文章、图片、保存和重新编辑，形成可重复操作的闭环。

### CI-P2-04：内容生命周期与日历

- P2-04-01 盘点现有内容状态和发布记录，不先重建状态体系。
- P2-04-02 明确草稿、待处理、已排期、发布中、成功和失败等状态的映射规则。
- P2-04-03 支持按计划发布时间查询内容。
- P2-04-04 提供日历或排期视图。
- P2-04-05 支持修改计划发布时间。
- P2-04-06 将发布记录与对应内容及目标平台关联。
- P2-04-07 区分“内容状态”和“发布任务状态”，避免把创建发布记录误认为发布成功。

完成标准：内容可排期、可查看、可追踪发布结果；不改变已冻结的 C2 发布成功契约。

> **交付记录（2026-10-10）**：`CI-P2-04-01…07` 已落地并实测：新增纯读模型 `src/lib/content-lifecycle.ts`（六态映射 + 发布汇总，21 例）、只读路由 `GET /api/content/lifecycle`（7 例路由测试）、日历内容归属与改期入口（`/api/calendar` + 2 例、`PATCH /api/schedules/[id]` + 2 例）、内容侧生命周期面板与四态内容状态标签（修掉「已发布被显示成草稿」）。**未新增表、未加列、未改迁移**，C2 发布成功契约只被读、未被改。`tsc --noEmit` exit 0；`vitest run` **138 文件 / 1049 用例全通过**（基线 134/1017）；`eslint .` 无新增问题（`eslint src` → 0 error / 1 个既有 warning）；dev server 三语页面与两条 API 实测 200；内容详情面板在真实数据下经 Playwright 渲染验证。逐条证据见 `docs/development/capability-integration-numbering-map.md` **§4.3**；§1 状态表已同步。本卡**未做**：工作流内核、预算拦截、质量评估（属 P2-05/P4/P8 各自卡片），以及「跨平台内容版本」与「一次排程只跳过一次发生」的语义（模型不支持，见 §4.3 遗留项）。

### CI-P2-05：多平台内容模型

- P2-05-01 定义平台无关的基础内容字段。
- P2-05-02 为平台差异定义适配层，如标题长度、正文格式、媒体要求和平台专属字段。
- P2-05-03 支持将一份基础内容转换为指定平台的内容版本。
- P2-05-04 保留各平台版本之间的来源关系。
- P2-05-05 将平台适配与实际发布执行分离。
- P2-05-06 优先实现现有系统已经支持的平台，不虚构未接通的平台能力。

完成标准：同一份基础内容能够生成平台适配版本，并分别保存、编辑和追踪。

> **交付记录（2026-10-10）**：`CI-P2-05-01…06` 按**模型与 API 契约**范围交付。新增纯模型 `src/lib/platform-content.ts`（423 行；`buildPlatformContentProfile` / `listPlatformContentProfiles` / `formatPlatformField` / `adaptContentToPlatform` / `platformBaseFingerprint` / `platformBaseText` / `read|upsert|remove|findPlatformContentVersion` / `isPlatformContentVersionStale` / `buildPlatformContentVersionPayload`，19 例）、适配层类型 `src/lib/types.ts`（`PlatformContentProfile` 第 343 行、`PlatformComposerEntry`、`PlatformVideoRoute`、`platformContentAdaptationCodes` 7 种、`PlatformContentVersion{Source}`、`PlatformContentVersionPayload` 第 413 行），以及路由 `GET/POST/PATCH/DELETE /api/content/[id]/platform-versions`（`route.ts` 146 行、`route.test.ts` 15 例）与校验 `platformVersionUpsertSchema` / `platformVersionPatchSchema`（`src/lib/validation.ts` 第 157 / 165 行）。版本写在内容项自己的 `metadata_json.platformVersions` 键内（经既有 `updateContentItem` 合并；不可读条目**保留并计数**）：**未新增表、未加列、未改迁移**。
> 平台事实只从既有代码推导，不虚构（P2-05-06）：`composerEntry` 读 `publishPageUrl` + `newPostSelectors`（`new-post` / `direct-url` / `generic`）；`videoRoute` 读 `videoInputSelectors` + `videoTabSelectors`；title/body 字段有无读 `titleSelectors` / `contentSelectors`（Threads 是唯一拿不到标题的平台）；`textLimit` 只给 Threads（`threadsPostMaxLength` − `threadsPostTrailingSpace` = **449**，唯一被 `post-format.ts` 真实约束的额度）；`titleLimit` **全为 `null`**（无依据不编数字）；`imageInputSelectors` / `videoUploadWaitMs` 明确**不建模**（发布路径不读它们）。两条分离均可观测：派生 / 保存 / 编辑 / 删除版本都**不改**内容项的标题正文状态，`publish_records` **保持为空**（路由测试直接断言），C2 发布成功契约（`recordPublishSuccess`）与 `src/features/ai-runtime` **未被触碰**。`tsc --noEmit` → exit 0；新增 34 例通过；全量 `vitest run` → **140 文件 / 1083 用例全通过**（P2-04 基线 138/1049）；`eslint src` → 0 error / 1 既有 warning。
> **本卡按契约收口，不等于多平台内容功能端到端可用**（诚实边界）：① **无 UI 消费者** —— `src/app/**` 与 `src/components/**` 无任何调用方（全仓只有 `platform-content.ts`、`types.ts`、`validation.ts` 与两个测试文件引用这些类型），用户在界面上**看不到、也用不了**平台版本；② **无真实 HTTP 冒烟** —— 验证止于 Next.js handler 级路由测试，**未**在 dev server 上真实请求过该端点，打包版 Electron 未验证；③ 手写 `save` 版本**不携带媒体**（`imagePath` / `videoPath` 为空，因模型尚无手写媒体字段），**跨平台版本互相派生（版本 → 版本）不支持** —— 两者都是模型未支持，不是缺陷；④ 「分别保存、编辑和追踪」只在 API 层成立，**端到端用户流程未完成**。
> 编号对照与逐条证据见 `docs/development/capability-integration-numbering-map.md` **§4.4**；§1 状态表已同步。下一步：多平台版本 UI 已按作者授权**立项为独立卡 `CI-P2-07`**（`CI-P2-06` 已被开发清单 §四 第 279 行占用，故取下一空位；见 §14），随后进入 **`CI-P7-03`**（生成前预估与预算控制，**§13 第 442 行起、块 442–447**；旧记录写的 437 为本卡交付记录插入前的行号）。

## 6. P3：研究素材与知识输入

主要提取 BiliNote 的素材采集、转写、摘要和来源追踪能力。

### CI-P3-01：研究素材管理

- P3-01-01 定义素材类型：网页、视频、文本、音频及本地文件。
- P3-01-02 记录原始来源、标题、URL 或文件路径、采集时间和素材状态。
- P3-01-03 支持素材新增、查看、检索和归档。
- P3-01-04 保留素材与来源之间的关联，避免只保存处理后的文本。
- P3-01-05 对重复导入的素材进行识别或提示，不强制改变现有存储架构。

完成标准：能登记并重新打开研究素材，且可以追溯原始来源。

### CI-P3-02：转写与摘要

- P3-02-01 为需要处理的音视频素材建立转写任务。
- P3-02-02 将转写任务接入 P1 的长任务管理。
- P3-02-03 保存转写文本及其来源素材关联。
- P3-02-04 在转写结果可用时，保存视频时间戳或片段起止时间。
- P3-02-05 支持基于素材生成摘要。
- P3-02-06 区分原始转写文本与 AI 生成的摘要，不互相覆盖。
- P3-02-07 在摘要或摘录中保留可定位到原始素材的引用信息。

完成标准：从音视频素材得到转写和摘要，并能从结果追溯到素材及相关时间位置。

### CI-P3-03：研究结果进入创作

- P3-03-01 支持将素材或摘要添加到选题。
- P3-03-02 支持将选定的研究内容作为文章生成的上下文。
- P3-03-03 在创作流程中区分用户输入、原始素材和 AI 生成内容。
- P3-03-04 允许用户查看研究来源后再使用相关内容。
- P3-03-05 为后续 RAG、向量检索或知识库扩展预留接口，但本轮不以建设完整 RAG 系统为前置条件。

## 7. P4：Agent Tool、Skill 与浏览器自动化

主要提取 OpenSEO 和 ego-lite 的能力，扩展现有 Agent Runtime，不重新开发一套 Agent 内核。

### CI-P4-01：Agent Tool 注册与执行

- P4-01-01 盘点现有 Agent 工具、Function Calling 和 MCP 接入能力。
- P4-01-02 统一工具名称、描述、参数 Schema 和结果 Schema。
- P4-01-03 支持工具发现、参数验证、执行和错误返回。
- P4-01-04 为工具调用记录输入摘要、执行状态和结果摘要。
- P4-01-05 对具有副作用的工具增加权限和确认机制。
- P4-01-06 将现有可复用工具迁移到统一注册入口，而非复制其实现。

完成标准：Agent 能够通过统一入口发现并调用至少一个现有业务工具，执行结果可追踪。

### CI-P4-02：Skill 管理

- P4-02-01 定义 Skill 的标识、名称、描述、输入和执行入口。
- P4-02-02 支持 Skill 注册、发现和调用。
- P4-02-03 让 Skill 组合现有工具完成一项明确的业务任务。
- P4-02-04 记录 Skill 执行步骤和失败原因。
- P4-02-05 区分 Skill 的流程定义与底层 Tool 的具体执行。
- P4-02-06 避免为了引入 Skill 概念而重构整个 Agent Loop。

完成标准：至少有一个 Skill 能够复用现有工具完成一项完整业务操作。

### CI-P4-03：外部服务集成

- P4-03-01 盘点现有外部服务适配器与凭据管理。
- P4-03-02 为外部服务定义统一的输入、输出、超时和错误映射。
- P4-03-03 将可复用的外部服务能力注册为工具。
- P4-03-04 区分可重试错误与不可重试错误。
- P4-03-05 防止日志泄露 API Key、Cookie 和其他敏感凭据。

完成标准：至少一个外部服务能够通过统一工具接口调用，并具备明确的失败处理。

### CI-P4-04：浏览器自动化

- P4-04-01 盘点现有浏览器自动化库和登录态管理能力。
- P4-04-02 定义浏览器会话、页面地址、页面状态和操作结果。
- P4-04-03 支持执行一次基础浏览器操作并返回结构化结果。
- P4-04-04 记录操作失败、超时和页面状态不符合预期的情况。
- P4-04-05 支持在登录、验证码、权限授权等场景暂停并请求人工接管。
- P4-04-06 人工接管后允许继续执行，并记录接管前后的任务状态。
- P4-04-07 对发布、删除、提交等高风险操作设置确认边界。

完成标准：浏览器操作有可观测的状态和结果，遇到需要人工处理的情况不会静默失败或无限重试。

## 8. P5：统一业务流程与系统回归

> **本卡执行基线（2026-10-09，E2E 阶段 1）**：四条闭环的资产盘点、跑前指纹、接口覆盖与"不可达边界"见 **`docs/e2e-baseline-inventory.md`**（CI-P1-05 阶段 1 交付物）。该文件同时给出阶段 2 的执行顺序、每条用例的写入面与所需授权；**未经验证的真实发布、真实图片生成、真实视频编码一律不得写作通过**。

### CI-P5-01：创作业务闭环

- P5-01-01 创建选题。  - P5-01-02 选择品牌资料。  - P5-01-03 添加研究素材或摘要。  - P5-01-04 调用 AI 生成文章。
- P5-01-05 生成或选择图片与封面。  - P5-01-06 保存文章并重新打开。  - P5-01-07 修改文章并再次保存。
- P5-01-08 检查正文、图片引用和关联数据是否保持一致。

完成标准：创作数据在生成、编辑、保存和重新打开后保持完整。

### CI-P5-02：视频生产闭环

- P5-02-01 选择视频模板。  - P5-02-02 输入素材与模板参数。  - P5-02-03 创建渲染任务。
- P5-02-04 查询任务状态和进度。  - P5-02-05 测试失败、取消和可恢复场景。  - P5-02-06 将最终视频与封面等产物登记到媒体管理中。
- P5-02-07 验证视频能够从 CoolPilot 的业务界面访问。

完成标准：从创建视频任务到获得可访问的产物，接口和存储链路完整；真实渲染引擎的接入程度单独记录。

### CI-P5-03：发布业务闭环

- P5-03-01 从已有内容创建排期。  - P5-03-02 检查平台适配后的内容。  - P5-03-03 执行受控的发布流程或测试发布。
- P5-03-04 验证成功、失败和重复请求的处理。  - P5-03-05 验证内容状态与发布记录状态一致且不混淆。
- P5-03-06 验证发布记录可追溯到原内容和目标平台。
- P5-03-07 单独复核已知的 PE05：`POST /api/publish` 创建发布记录与内容状态更新之间的关系。

完成标准：发布记录、内容状态和实际发布结果有明确对应关系。未经过验证的真实发布不得作为通过条件。

### CI-P5-04：Agent 自动化闭环

- P5-04-01 Agent 接收一项明确的业务目标。  - P5-04-02 选择并调用合适的 Tool 或 Skill。  - P5-04-03 对长任务返回可追踪的任务 ID。
- P5-04-04 记录执行步骤、错误与最终结果。  - P5-04-05 遇到高风险操作时暂停并请求确认。
- P5-04-06 浏览器或外部服务需要人工接管时能够暂停和继续。
- P5-04-07 验证失败重试不会意外重复发布、重复创建或重复产生副作用。

完成标准：Agent 执行链路可观测、可控制、可追踪，不只是返回一段看似成功的文本。

## 9. P6：统一测试、缺陷修复与生产就绪评估

### CI-P6-01：自动化测试

- P6-01-01 运行 TypeScript 类型检查。  - P6-01-02 运行 ESLint，区分新增问题与既有警告。
- P6-01-03 运行 Vitest 全量测试，避免并行执行导致不稳定。  - P6-01-04 为新增任务管理、工具调用、内容关联和媒体产物接口补充测试。
- P6-01-05 对关键 API 验证参数错误、权限拒绝、超时和失败返回。  - P6-01-06 验证数据库和文件系统中的新增、更新、失败及恢复行为。

### CI-P6-02：浏览器端回归

- P6-02-01 验证主要页面能够正常打开。  - P6-02-02 验证选题、文章、图片、视频和研究素材的操作链路。
- P6-02-03 验证长任务进度、错误提示、取消和恢复。  - P6-02-04 验证日历、发布记录与平台内容版本。
- P6-02-05 检查浏览器控制台错误、网络请求失败和资源加载失败。

### CI-P6-03：数据与文件安全

- P6-03-01 验证路径校验，防止越权访问和路径穿越。  - P6-03-02 验证文件覆盖、删除和失败回滚策略。
- P6-03-03 验证 API Key、Cookie 等敏感信息不进入普通日志。  - P6-03-04 验证任务恢复不会重复执行高风险操作。
- P6-03-05 验证备份和恢复流程，不只确认备份文件存在。  - P6-03-06 检查真实发布接口、凭据和权限边界。

### CI-P6-04：生产就绪评估

- P6-04-01 检查生产环境配置、环境变量和密钥管理。  - P6-04-02 检查服务启动、关闭、日志和异常恢复。
- P6-04-03 检查后台长任务的资源占用与并发限制。  - P6-04-04 检查数据库迁移和历史数据兼容。
- P6-04-05 检查上传文件、媒体产物和临时文件的生命周期。
- P6-04-06 整理 P0/P1 冻结边界以外的已知缺陷和未实现能力。
- P6-04-07 输出生产就绪评估：通过项、阻塞项、风险项和后续优化项。

## 10. 建议的实际开发顺序

| 顺序 | 开发任务 | 主要交付 |
| --- | --- | --- |
| 1 | P0-01～P0-06 | 实际代码落点与集成映射 |
| 2 | P1-01 | 统一媒体产物引用 |
| 3 | P1-02 | 统一长任务管理 |
| 4 | P1-03 | 统一媒体工具注册 |
| 5 | P2-01、P2-02 | 选题与品牌资料 |
| 6 | P3-01～P3-03 | 研究素材、转写、摘要及来源关联 |
| 7 | P2-03 | 文章和图片创作闭环 |
| 8 | P2-04、P2-05 | 内容日历、多平台内容模型 |
| 9 | P1-04 | 视频模板与渲染任务 |
| 10 | P4-01～P4-03 | Agent Tool、Skill、外部服务 |
| 11 | P4-04 | 浏览器自动化与人工接管 |
| 12 | P5-01～P5-04 | 业务闭环验证 |
| 13 | P6-01～P6-04 | 统一回归、缺陷修复和生产评估 |
| 14 | P7-01 | 统一使用账本（成本与质量中心的地基，**可与 P2-04 并行**） |
| 15 | P7-02 | 成本中心首页、一级菜单升级与全链路明细 |
| 16 | P7-03 | 生成前预估与预算控制 |
| 17 | P7-04 | 质量与成本优化 |
| 18 | P7-05 | 覆盖全部 AI 能力与 Marketplace |

> **顺序说明（P7）**：P7-01 只新增表与写入器，不改任何既有表的语义，因此**不排在 P2-04 之后**也能安全推进；但 P7-02 起的任何界面都必须建立在 P7-01 的真实账本上。**调用点已全部接完（14/14），价格目录的录入入口也已交付（P7-01-05，系统 → 模型管理 → 价格目录）**，所以账本行是否 `unpriced` 现在取决于**用户有没有录价**，而不是产品缺功能：目录为空时成本中心**可以**显示用量与「说不出来」的金额，但**不允许**把 `unpriced` 显示成 0 元，也不允许用「先上线再说」代替录价。

这里不是要求前一个阶段的所有边缘问题都解决后才能继续。只要接口稳定、核心链路可运行、没有数据安全阻塞，就可以继续下一个任务。但涉及真实发布、文件删除、凭据和数据迁移的高风险问题必须先验证。

## 11. 每个开发任务统一采用的交付标准

每个任务完成时，必须输出：

1. **改动内容**：新增、修改了哪些文件和功能。
2. **调用链路**：页面、API、服务、数据库或文件之间如何连接。
3. **验证结果**：实际运行过哪些测试，结果是什么；没有运行的项目明确标注。
4. **遗留问题**：仅记录真实发现的问题，区分阻塞项和可延后项。
5. **下一步任务**：只推进当前清单中的下一个任务，不随意扩展范围。

本轮暂不要求每个小任务都完成全量回归；全量回归放在 P6。但不能跳过必要的定向测试，也不能把未运行的测试写成通过。

## 12. 执行指令（原文留档）

> 请依据 `docs/coolpilot-capability-integration-plan.md` 开始实施 8 个开源项目的能力集成。
>
> **总目标**：优先集成现有项目缺失的核心能力，打通业务流程，再统一进行回归测试、缺陷修复和生产就绪评估。
>
> **执行要求**：1) 先检查当前工作区、已有模块、API、数据模型、文件存储和测试，建立任务与实际代码落点的映射；2) 不得假设规划中的模块或接口已经存在，必须以实际代码为准；3) 优先复用和扩展现有实现，避免重复造轮子和大规模重构；4) 按依赖顺序推进，但不要因为普通非阻塞缺陷停止全部集成；5) 每完成一个任务，验证其最小调用链路，并记录实际测试结果；6) 不擅自改变已冻结的发布语义，不重新打开已关闭的 P0 和 P1 Card 1；7) 不覆盖或清理现有未提交修改，不执行 Git commit；8) 对文件删除、数据迁移、真实发布、凭据和权限等高风险操作，必须先检查影响并完成必要验证；9) 不把模拟实现描述为真实能力（模拟渲染器只能证明任务接口可用）；10) 不要为了完善文档而反复暂停开发，仅维护必要的任务状态、接口约定、测试结果和风险记录。
>
> **每个任务的执行流程**：检查现有实现 → 确定最小改动范围 → 实施代码变更 → 运行必要的定向测试 → 更新任务状态和遗留问题 → 继续下一个可执行任务。
>
## 13. P7：AI 成本与质量优化中心（2026-10-10 新增主线）

> **来源**：用户提议把「用量统计」升级为一级菜单「AI 成本与质量优化中心」，并把**统一使用账本**作为优先级最高的底层能力。本节把该提议落成可执行卡片；左侧编号避开既有 P0～P6，不与任何已冻结任务号冲突。
>
> **与既有主线的顺序关系**：P7-01 是底层能力，**不阻塞** P2-04 / P2-05，可随时推进；P7-02 的界面必须建立在 P7-01 的真实账本之上。
>
> **为什么不先改菜单**：把菜单名改成「AI 成本与质量优化中心」，而页面拿不出任何一笔费用，就是一次无法兑现的承诺。**菜单改名与第一个真实的费用界面同卡交付（P7-02）**，本轮只做账本。

### CI-P7-01：统一使用账本与真实成本核算

- P7-01-01 账本表 `ai_usage_ledger`（**一次模型尝试一行**，含失败与重试）+ 价格目录表 `ai_model_prices`（价格以快照冻结在账本行上，不就地改价）。
- P7-01-02 纯函数层 `src/lib/ai-usage-ledger.ts`：费用可述性、用量完整度、窗口汇总。
- P7-01-03 写入器 `src/lib/ai-usage-ledger-recorder.ts`：一次业务调用 → 每个尝试一行。
- P7-01-04 接入**全部** AI 调用点：**14/14 已完成**（逐条清单见 §附录 B-11 §4）。每个调用点带 `purpose` 与业务身份；抛错的调用把「实际发出的请求轨迹」随错误带出并照样记账，「自纠重试」按请求拆成独立行。
- P7-01-05 价格目录的录入入口（落在**系统 → 模型管理 → 价格目录**，不是设置页：价格的身份是「供应商 + 模型」，与「供应商与密钥」「模型配置」同页更好找，见 §附录 B-11 §5）。
- P7-01-06 官方服务的计量声明规范：未来新增 AI 功能必须声明计量方式与费用归属。

完成标准：任意一次 AI 调用（含失败、重试、中断）都能在账本里找到独立记录，且每笔金额都标明可信程度。

### CI-P7-02：成本中心首页与全链路明细

- P7-02-01 一级菜单「AI 成本与质量优化中心」：顶部概览卡片 + 二级导航（成本总览 / 调用明细 / 预算与预估 / 质量与优化）。
- P7-02-02 成本总览：估算 API 成本、Token、成功交付内容数、单篇平均成本、费用构成。
- P7-02-03 业务产出区保留文章数 / 累计字数 / 平均字数——从「用量统计的核心指标」降级为「分析成本效益的辅助指标」。
- P7-02-04 调用明细：一次调用一行（实际提供商 / 模型 / 端点 / 耗时 / 是否重试 / 用量完整度 / 费用来源）。
- P7-02-05 追溯：内容 → 业务任务 → 执行节点 → 模型调用，以及单篇内容成本。
- P7-02-06 措辞纪律：用户自带 API Key 时只能写「估算 API 成本 / 按供应商用量核算」，**不得**写成 CoolPilot 实际扣款。

> **交付记录（2026-10-10）**：`CI-P7-02-01 / 02 / 03 / 06`（菜单改名 + 成本总览）与 `CI-P7-02-04 / 05`（调用明细 + 追溯 + 单篇内容成本）已分别落地并实测：`tsc --noEmit` exit 0、`vitest run` **134 文件 / 1017 用例全通过**、`eslint .` 无新增问题、dev server 三语路由与 API 实测通过、调用明细页签以真实 payload 在浏览器（Playwright）渲染通过。逐条证据见 `docs/development/capability-integration-numbering-map.md` **§4.1** 与 **§4.2**；§1 状态表已同步为 `done`。本卡**未做**：账本导出、以及「产物是否被采用 / 人工修改 / 质量检查」结果信号（后者属 P8-05 / P8-07）。

### CI-P7-03：生成前预估与预算控制

- P7-03-01 预估：预计模型、节点数、输入输出用量与费用区间；明确「预估不是保证价格」。
- P7-03-02 预算上限与超额提醒（本月预算、已用、预计月末支出、高成本任务）。
- P7-03-03 执行中持续累计实际成本，达到阈值暂停后续节点并交由用户决定（**不能只在前端显示提示**）。
- P7-03-04 三种执行策略（省成本 / 均衡 / 质量优先）必须真正影响工作流执行规则，而不是只切换一个模型名。

### CI-P7-04：质量与成本优化

- P7-04-01 首轮通过率、人工修改幅度、平均重试次数、内容采用率。
- P7-04-02 单位合格产出的成本（优化目标函数）。
- P7-04-03 基于真实数据提出优化建议；用户确认后才自动调整策略。

### CI-P7-05：覆盖全部 AI 能力与 Marketplace

- P7-05-01 图片 / 视频 / 语音 / Embedding 接入同一计量（`metered_kind` + `quantity_json`）。（Embedding 的**调用路径 / 向量存储 / 召回集成**已另立支线卡 `CI-EMB-01`，见 **§附录 T**；本条仍只管**计量与录价**，两卡不重叠、不互替。）
- P7-05-02 Agent / Workflow 的节点级调用记录、总成本与失败重试成本。
- P7-05-03 Marketplace 扩展的扩展标识、任务标识与调用费用归属。
- P7-05-04 无法准确计量的服务必须**显式标记**，而不是漏记。

### 产品原则（自本节起作为约束，后续卡片必须遵守）

1. **所有 AI 支出必须可追踪**：每次调用独立记录，每笔费用可追溯到业务来源。
2. **所有金额必须标明可信程度**：区分供应商实际用量、按用量计算的费用、预算估算与未知成本。**金额为 NULL 时不得写 0 冒充。**
3. **预算控制覆盖完整工作流**：含失败、重试、子任务与后续节点，而不仅是单次请求。
4. **优化目标是降低合格产出的成本**：不为减少 Token 而牺牲内容质量。
5. **本地优先与数字主权不退让**：使用记录与成本分析默认存放在用户的本地 Workspace。
6. **未来新增 AI 功能必须遵循统一接入规范**：声明计量方式、费用归属及用量上报能力。
7. **账本不无差别收集用户数据**：API Key、Cookie、完整敏感提示词不写入账本。
8. **统一采集不等于所有服务都按 Token 计价**：文本按输入/输出/缓存/推理 Token，图片按张数与分辨率，视频按时长与分辨率，语音按字符数或时长，Embedding 按输入 Token，Agent/Workflow 按节点汇总。
9. **「依目录估算」永远不等于「供应商实收」**（CI-P7-01-05）：由价格目录算出的金额是**我们的算术**（`computed`），不是供应商确认的账单。界面必须如实标注来源，**不允许**因为目录里有价格就把它显示成「实际费用」；只有供应商自己回报的费用（`provider-reported`）才是实收。同理，**一条价格只计价它自己那个计量维度**——文本价不得给图片计价，维度或单位不匹配时费用必须保持 NULL 与 `unpriced`，而不是算出一个看起来精确的数字。

## 附录 A：P0 交付物（实际代码落点）

### A-1 · CI-P0-01 现有模块与入口盘点（实测，非推断）

命令：`Get-ChildItem` 递归计数 + `Select-String` 落点检索；数据来自本轮真实工作区（HEAD `3b48126`）。

**页面（30 个 `page.tsx`）**

- `src/app/page.tsx`：根路由，`/` → 307 → `/zh-cn/dashboard`。
- `src/app/[locale]/(console)/**`：29 个控制台页面，分组为 creation（文章/图片/视频/帖子/产品/AI 写作）、publishing（accounts/records）、schedules（calendar/list）、content（library）、automation（generations/logs/nodes）、system（models/usage/workspace）、smart-config（knowledge-base/positioning）、dashboard、data-center、chatroom、mindmap、whiteboard、runs/queue、app-store。菜单与页面映射的既有盘点见 `docs/menu-inventory.md`。

**API（88 个 `route.ts`）**

按前缀分组：`agent/*`(5)、`ai/*`(7)、`ai-writing/generate`、`app-store`、`backup/*`(3)、`browser-profiles/[accountId]/*`(5)、`calendar`、`content/*`(7)、`dify/*`(3)、`hot-topics`、`images/*`(4)、`internal/scheduler/tick`、`knowledge-base/*`(5)、`metrics/*`(8)、`models/*`(2)、`positions/*`(4)、`products/*`(3)、`publish/*`(5)、`publish-records/*`(2)、`runs/*`(3)、`schedules/*`(2)、`settings/*`(5)、`usage-records`、`videos/*`(2)、`workspace/manifest`、`account-health`、`accounts/*`(2)。

**数据表（DB 内 29 张）**

- `src/db/schema.ts`（drizzle）定义 **27 张**：`accounts`、`content_items`、`schedules`、`runs`、`run_events`、`chat_threads`、`chat_messages`、`chat_tool_calls`、`agent_runtime_runs`、`agent_runtime_events`、`publish_records`、`metric_snapshots`、`account_metric_snapshots`、`products`、`knowledge_base`、`positions`、`app_settings`、`usage_records`、`dify_connections`、`ai_model_providers`、`ai_model_endpoints`、`ai_models`、`ai_model_capabilities`、`ai_model_preferences`、`ai_sync_records`、`ai_probe_results`、`ai_credential_keys`。
- 另有 **2 张存在于运行库、但不在 drizzle schema 中的历史表**：`ai_providers`、`sites`（`/api/workspace/manifest` 一直把它们报为 `unknownTables`）。直接查 `sqlite_master` 实测 `TABLE_COUNT=29`（27 + 2），与工作区 manifest 报出的 29 张一致。
- 表/字段级细节见 `docs/data-model-inventory.md`（27 张时期的版本，含 5 套并行状态词表的记录）。
- 以上是 **P0 快照**（27 张 schema 表 + 2 张历史表 = 29）。此后 CI-P2-01 加 `topics`、CI-P2-02 加 `brands`，当前实测为 **31**（29 张 schema 表 + 同样两张历史表），见 §附录 B-6 的验证表。

**文件目录（`src/lib/paths.ts` 是唯一边界定义）**

- 数据根：`resolveAppDataDir()`（`src/lib/runtime-config.ts:15-23`），环境变量 `SOCIAL_AUTO_POST_DATA_DIR` 未设时默认 `<cwd>/web-data`。实测目录：`artifacts/`、`browser-profiles/`、`uploads/`（`product-images/`、`brand-logos/`）、`videos/`、`social-auto-post.db`。
- 设计约束（P5-B0-2.5）：“解析路径不建目录，只有写入方 `ensure*Root()` 才创建”，本计划新增的媒体/任务模块必须遵守；`uploadsRoot()` 故意没有 initializer。

**媒体文件写入方（唯一真实清单，共 6 处）**

| 写入方 | 目标根 | 文件命名 |
| --- | --- | --- |
| `src/app/api/images/upload/route.ts:31` | `artifacts/` | `upload-*`（上传图片） |
| `src/lib/agent/image-generation.ts:49` | `artifacts/` | `agent-image-<ts>-<rand>.<ext>`（AI 生图，经 `aiRuntime.generateImage`） |
| `src/lib/article-images.ts:14`（`copyIntoArtifacts`） | `artifacts/` | `writing-<ts>-<rand>.<ext>`（产品图/素材复制入产物目录） |
| `src/lib/remote-image.ts:115`（`fetchRemoteImageToArtifacts`） | `artifacts/` | `online-<ts>-<rand>.<ext>`（远程图片本地化，含 SSRF 守卫 `isFetchableImageUrl`） |
| `src/app/api/videos/upload/route.ts:29` | `videos/` | 用户视频（≤5GB，`src/lib/video-library.ts` 定扩展名/MIME） |
| `src/app/api/products/image/route.ts:64`、`src/app/api/settings/brand/logo/route.ts:69` | `uploads/product-images/`、`uploads/brand-logos/` | 产品图 / 品牌 logo |

删除方：`src/lib/image-library.ts:18`（`deleteArtifactImageFiles`，basename + 扩展名白名单，越界名直接跳过）。

**媒体文件读取方**

- `GET /api/agent/artifacts?file=<name>`（`src/app/api/agent/artifacts/route.ts`）：`path.basename` 强校验 + 扩展名白名单（`.png/.jpg/.jpeg/.webp/.gif`），越界返回 404；`GET` **不创建**目录。
- `GET /api/videos?file=<name>`、`GET /api/images*`（图片库列表/搜索）、`src/lib/image-library.ts`（列表）。
- URL 规约：`src/lib/artifact-image-url.ts` 的 `artifactImageUrl()` / `resolveArtifactImageSrc()`（远程 `http(s)` 原样返回，其余退化成 basename 交给 artifacts 路由；**该字符串形状已被写进历史文章正文，不得更改**）。
- 发布侧解析：`src/lib/publish.ts:27-40` 的 `resolveLocalImagePath()`（**已知缺陷**：远程封面 URL 会被静默丢弃，见 `docs/e2e-core-loop-verification.md` §8.1）。

**长任务落点（当前有 3 套并行）**

1. `runs` + `run_events`：`src/db/repository.ts:586-680`（`listRuns`/`getRun`/`createRun`/`updateRunStatus`/`appendRunEvent`），API `GET|POST /api/runs`、`GET /api/runs/[id]`、`GET /api/runs/[id]/events`；状态词表 `queued|running|success|warning|failed|cancelled`（`src/lib/types.ts:13-20`），7 个 playbook。
2. `agent_runtime_runs` + `agent_runtime_events`：Agent 执行记录，状态词表 `queued|running|paused|success|failed|cancelled`（含 `paused`，`src/lib/types.ts`），API `GET /api/agent/runs/[id]/events`、`POST /api/agent/runs/[id]/resume`。
3. `schedules` + `/api/schedules`、`/api/internal/scheduler/tick`：定时触发（状态含 `missed`）。
4. `chat_tool_calls`：工具调用记录表（与 `agent_runtime_events` 并行）。

**工具调用落点**

- 契约：`src/lib/agent/contracts.ts` 的 `AgentToolDefinition`（`name`/`description`/`inputSchema`/`outputSchema`/`requiresApproval`/`execute`）、`AgentExecutionContext`（含 `agentRunId`、`site`、`profilePath`、`settings.agentPermissions`、`emit`）。
- 注册/执行：`src/lib/agent/tool-registry.ts` 的 `ToolRegistry`（`register`/`get`/`has`/`list`/`execute`/`requiresApproval`；**execute 会做 input/output zod 双向校验**）。
- 已注册工具 9 个（`src/lib/agent/local-tools.ts`）：`browser_open_page`、`browser_click`、`browser_type`、`browser_screenshot`、`generate_social_post_draft`、`generate_image_prompt`、`generate_image_file`、`threads_create_post`、`xiaohongshu_create_post`。
- 引擎：`src/lib/agent/langgraph-engine.ts`（`planToolCalls`、`LangGraphAgentEngine`，含审批暂停 `ApprovalRequiredError`、失败/取消状态写回）。
- **MCP：在 `src/` 中零命中**（`Select-String -Pattern 'mcp'` 无结果）→ CI-P4-01-01 的结论是“无 MCP 接入能力”，不得在文档里假设存在。

**测试与脚本基线**

- `*.test.ts(x)` 共 **90** 个；`src/lib` 125 个 `*.ts(x)`；`src/features` 27 个（`ai-runtime` 15 + `ai-settings` 11 + 其他）；`scripts/` 12 个（6 个 smoke + 6 个构建/图标/转换脚本）。
### A-2 · CI-P0-02 开源能力映射表（来源 → 实际代码落点 → 计划改动点 → 验收）

说明：来源侧的能力描述沿用 `docs/open-source-capability-map.md` §二；**映射的落点列是本轮实测的真实文件/表/路由**，不是规划中的模块。

| # | 来源 | 提取能力 | 现有代码落点（实测） | 本计划改动点 | 依赖 | 验收标准 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **AIGCPanel** | 媒体能力统一注册；长任务状态；执行日志与错误 | `ToolRegistry` + `AgentToolDefinition`（`src/lib/agent/`，当前与 `AgentExecutionContext` 强耦合）；`runs`/`run_events`；`scripts/*-smoke.ts` | CI-P1-03（媒体工具注册去耦合 + 发现/调用入口）；CI-P1-02（任务契约） | AI Runtime（冻结面，不得旁路） | 至少一个媒体工具经统一注册被调用，同步返回结果、长任务返回任务 ID |
| 2 | **DouyinLiveRecorder** | 长时任务进程管理；日志；Cookie/登录态 | `schedules` + `/api/internal/scheduler/tick`；Playwright 持久化 profile（`browser-profiles/`、`playwright-session.ts`）；`accounts.status`、`/api/account-health` | CI-P1-02-05/06（取消、重启恢复）；CI-P4-04（会话与人工接管） | 不引入真实录制引擎；`paths.ts` 边界 | 长任务可取消、可查进度；重启后不假装继续运行 |
| 3 | **Remotion** | 模板参数化；渲染任务生命周期；产物登记 | `videos/` + `GET /api/videos` + `POST /api/videos/upload` + `src/lib/video-library.ts`；`content_items.metadata.videoPath` | CI-P1-04（模板/渲染任务/产物契约 + 模拟渲染器） | CI-P1-01、CI-P1-02 | 无真实渲染引擎也能：建任务 → 查状态/进度 → 登记产物 → 界面可访问 |
| 4 | **ALQQ / Meiti AI** | 选题 → 素材 → 生成 → 图片 的编排 | `content_items`；`POST /api/content/generate`；`src/lib/ai-writing.ts`、`article-generation.ts`、`article-images.ts`；`positions`、`knowledge_base`、`creation/*` 页面 | CI-P2-01（选题）、CI-P2-02（品牌资料）、CI-P2-03（创作闭环） | AI Runtime、CI-P1-01 | 选题与品牌资料可作为明确输入进入生成；保存→重开→再保存数据一致 |
| 5 | **BrightBean Studio** | 内容日历；多平台分发/适配 | `schedules` + `GET /api/calendar` + `/schedule*` 页面；`publish_records`；`accounts.platform`（28 个平台词表）；`src/lib/post-format.ts`、`publish-profiles.ts` | CI-P2-04（状态映射与日历查询）、CI-P2-05（平台适配层） | 冻结的 C2 发布语义**只读** | 内容可排期、可追踪；平台版本可分别保存；发布语义不变 |
| 6 | **BiliNote** | 转写 → 摘要 → 来源追踪 | `knowledge_base` + `/api/knowledge-base/*`；`src/lib/scraper.ts`（`fetchArticleText` 抓正文/封面）；`/api/hot-topics` | CI-P3-01（素材登记与来源）、CI-P3-02（转写/摘要，接入长任务）、CI-P3-03（进入创作） | CI-P1-02、AI Runtime | 素材可重开且可追溯原始来源；转写与摘要分开存；结果能进入选题/写作 |
| 7 | **OpenSEO** | 外部服务调用；结构化结果与错误映射 | `src/lib/scraper.ts`；`/api/hot-topics`；`src/lib/credentials.ts`、`secrets.ts`（凭据）；`dify_connections` | CI-P4-01（Tool 契约统一）、CI-P4-03（外部服务工具化 + 可重试判定） | 凭据管理复用现有实现 | 至少一个外部服务经统一工具接口调用，失败分类明确且不泄露凭据 |
| 8 | **ego-lite** | 浏览器会话/页面状态；人工接管 | `src/lib/browser-preview-session.ts`（69KB，最复杂链路）、`playwright-session.ts`、`/api/browser-profiles/*`、agent 的 `browser_*` 工具 | CI-P4-04（会话契约、暂停与人工接管、高风险确认边界） | CI-P4-01 | 浏览器操作有可观测状态；需要人工时不静默失败、不无限重试 |

**重复能力识别（P0-02 要求“识别重复能力”，这是本轮的真实发现）**

1. **任务状态有 2 套词表**：`runs` 用 `queued/running/success/warning/failed/cancelled`，`agent_runtime_runs` 用 `queued/running/paused/success/failed/cancelled`。→ CI-P1-02 只做**映射与统一查询**，不改写任一套已有词表（`warning`、`paused` 都必须保留）。
2. **执行记录有 2 张表**：`run_events`（`level/message/data_json`）与 `agent_runtime_events`（`type/message/data`）；工具调用另存 `chat_tool_calls`。→ CI-P0-05 定义统一“工具调用记录”视图，不新建第 3 张表。
3. **媒体文件分 3 个根**：`artifacts/`（生成/上传/复制/远程本地化）、`videos/`（视频）、`uploads/{product-images,brand-logos}`（用户上传）。→ CI-P1-01 需要一个对上层屏蔽根差异的解析层，而不是新建 Asset 表。
4. **文件名前缀即来源**：`upload-`/`agent-image-`/`writing-`/`online-`。→ 可作为 `source` 判定依据（低成本、无迁移）。
5. **图片服务有 2 个入口**：`/api/agent/artifacts`（artifacts 根）与 `/api/images*`（图片库集合操作，含删除）。→ CI-P1-01-04 的“统一访问入口”应复用这两个路由，不新造第三个。
> **说明（2026-10-10 追加）**：A-2 是本轮 CI-P0-02 的**历史交付记录**，保持原样不改。此后新增的参考项目（Anki，见 §附录 C 与 `docs/development/CoolPilot-开发清单-10个开源项目整合版.md` §零 第 11 行）**不并入本表**，其设计借鉴条目与卡片映射另记于 §附录 C。

### A-3 · CI-P0-06 工作区保护记录（本轮 P0 基线）

**Git 状态（P0 开始时实测，只读检查，未 `git add`、未 commit）**

- HEAD：`3b48126`（`docs(p5-c3): name both commits in the freeze status line`）。
- 暂存区为空：`git diff --cached --name-only` → 0 行。
- 工作区变更：`git status --porcelain` → **基线 49 条**（本轮开始、未含本计划新增文档），写入本计划文档后复测为 **50 条**（28 条 ` M` 已跟踪文件修改 + 22 条 `??` 未跟踪文件）。
- 本计划新增的文件**只增不改**：`docs/coolpilot-capability-integration-plan.md`（本文件）、`docs/coolpilot-integration-contracts.md`（P0-03/04/05 契约）。除这两个新文件与后续任务明确列出的改动外，不触碰任何现有文件；**不执行 `git add` / `git commit` / `git stash`**。

**数据指纹（本轮实测，只读查询 `web-data/social-auto-post.db`）**

| 项 | 值 |
| --- | --- |
| `content_items` | 17 |
| `publish_records` | 3 |
| `runs` / `run_events` | 1 / 1 |
| `agent_runtime_runs` / `agent_runtime_events` | 5 / 39 |
| `chat_tool_calls` | 6 |
| 数据表总数 | 29 |
| `web-data/artifacts` 文件 | 37 |
| `web-data/uploads` 文件 | 0 |
| `web-data/videos` 文件 | 0 |
| `web-data/browser-profiles` 目录 | 7 |

**环境与目录边界**

- `SOCIAL_AUTO_POST_DATA_DIR`：User / Machine / 当前进程三个作用域**均为空**（上一轮 E2E 遗留的 `%TEMP%\coolpilot-a02-smoke` 污染已清除）。此变量一旦设置，DB 与 artifacts 根会一起漂移，是本项目最容易造成“数据看起来丢了”的坑 → 任何验证脚本都必须显式清空该变量。
- `web-data/` 在 `.gitignore:44` 中（`/web-data`）→ 数据目录不会进入 Git，也不会被 `git clean` 波及。
- 观察项（**未删除，仅记录**）：`web-data/_tmp-e2e.db`（0 字节）是某次 E2E 留下的空库残留；因为属于数据目录，本计划不清理，交由 CI-P6-04-05 统一处理“临时文件生命周期”。
- 后台进程：本轮取证用的 `next dev`（PID 41940/42060，`127.0.0.1:3000`）已停止，实测 `PORT_3000_FREE`。

**禁止事项（对后续所有任务生效）**

1. 不覆盖、不清理、不提交现有 50 条未提交变更。
2. 不重开 P0、P1 卡 1、D1 的冻结结论；`PE05` 只复核不改语义。
3. 不新增旁路 AI 调用（必须经 `ai-runtime`）。
4. 不删除用户数据文件；涉及删除/迁移/真实发布/凭据的任务必须先做影响评估并在报告中单列。
5. 不把模拟实现写成真实能力（模拟渲染器 ≠ 真实视频渲染）。

## 附录 B：任务完成报告

### B-1 · CI-P1-01 统一媒体产物管理（done）

**1. 改动内容（新增 5 个文件，未修改任何现有文件）**

| 文件 | 作用 |
| --- | --- |
| `src/lib/media-artifact-ref.ts`（新） | 统一产物引用的**纯解析层**：`MediaAssetRef`、`toMediaAssetRef()`、`isMediaAssetRefUsable()`、`isMediaAssetRoot()`、`MEDIA_ASSET_ROOTS`。无 Node 导入，路由/组件/任务共用 |
| `src/lib/media-artifact-library.ts`（新） | **清单层**：`listMediaAssets()` 合并四个根，用 `paths.ts` 的**非 ensure** 访问器 |
| `src/app/api/media/assets/route.ts`（新） | 统一查询入口：`GET /api/media/assets`（列表）、`?ref=`（解析）、`?root=`（限定根，非法值 400） |
| `src/lib/media-artifact-ref.test.ts`（新） | 12 个用例：7 种历史形态、幂等、远程显式、kind/mime、来源前缀、根推断、uploads 根 hint、不可用、穿越、不裁剪、根词表 |
| `src/lib/media-artifact-library.test.ts`（新） | 3 个用例：四根聚合与来源、缺失目录返回空且**不创建**、不可服务文件仍列出 |

对照 P1-01 子项：01 盘点＝契约 §1.1；02 契约＝`MediaAssetRef`；03 兼容＝未动 `metadata_json.images`、`image_path` 与 `artifact-image-url.ts`；04 入口＝新路由 + 复用现有两个二进制服务路由；05 登记＝**按需派生**（写入方已有命名前缀，`source` 由此判定，未新建表/未改写入方）；06 回归＝下节证据。

**2. 调用链路**

`GET /api/media/assets` → `listMediaAssets()` → `paths.ts` 四个根（resolve，不 initialize）→ `fs.readdir`（缺失即空）→ `toMediaAssetRef(name, {root})` → `artifactImageUrl()` / `videoUrl()` → 返回 `url`；浏览器请求该 `url` → 现有 `/api/agent/artifacts` 或 `/api/videos`（basename + 扩展名白名单）→ 文件字节。

**3. 验证结果（全部为本轮真实执行）**

| 验证 | 结果 |
| --- | --- |
| 定向单测 `vitest run src/lib/media-artifact-*.test.ts` | `EXIT=0`，**2 files / 15 tests passed** |
| 全量 `vitest run` | **92 files / 606 tests 全部通过，0 failed**（基线 90/591 + 本轮新增 2 文件 / 15 用例），Duration 16.33s |
| `tsc --noEmit` | `TSC_EXIT=0`（首次曾报 2 个错：route 的类型收窄 + `.next/dev/types/validator.ts` 未含新路由，修好后重跑为 0） |
| `eslint` 新增 5 文件 | `ESLINT_EXIT=0` |
| `GET /api/media/assets`（真实库） | `ok=true`，**37 个产物**：root 全为 `artifacts`；source `remote=33` / `uploaded=4`；kind `image=37`；`USABLE=37` |
| 解析结果真的可访问 | 取首个资产 `online-1791308469029-I_G_de_7.webp` → `GET /api/agent/artifacts?file=...` → **200**，`Content-Type: image/webp`，23262 字节 |
| `?ref=` 六种输入（真实请求） | 裸名 → 200；`?file=` URL 回灌 → 同一引用（幂等）；远程 URL → `external=true` 且保留 `remoteUrl`；`../../secret.png` → 收敛为根内 basename；`root=product-images` → `url:""`（诚实）；`root=bogus` → **400** + allowed 列表 |
| 现有行为未受影响 | `GET /api/images` 仍为 **37**；`/zh-cn/creation/images` → **200**；`web-data/artifacts` 仍 37 个文件；`uploads/`、`videos/` 未被创建/改动；`browser-profiles` 仍 7 |
| 数据指纹 | 与 §附录 A-3 一致（P1-01 全程只读，未写库、未写数据文件） |

**4. 遗留问题**

- **阻塞项：无。**
- 可延后 1：`uploads/product-images`、`uploads/brand-logos` 没有“按文件名取回”的路由，因此统一引用的 `url` 为 `""`。要让它们也能被统一访问，需要新增一个受同样白名单约束的服务路由（属 CI-P1-01-04 的剩余部分，本轮按“不新增功能”冻结）。
- 可延后 2：`resolveLocalImagePath()`（`src/lib/publish.ts:27-40`）仍会静默丢弃远程封面。新解析层现在能表达“这是远程引用”（`external:true`），修复点应放在发布侧（CI-P2-03 / CI-P5-03），**本轮未改发布语义**。
- 可延后 3：`content_items.metadata_json.images` 的三种历史形态仍是“混排”，本轮只提供解析，不做数据清洗（清洗属数据迁移，需单独评估）。
- 环境坑（本轮真实复现，已记入 §附录 A-3 同类问题）：用 `cmd /c set VAR= && ...` 启动服务会把变量设成**一个空格**，使数据根变成 `...\CoolPilot\ `，表现为“图片全没了、DB 却是真的”。正确写法是 `set "VAR="` 或干脆不设。

**5. 下一步任务**：CI-P1-02 统一长任务管理（契约见 `docs/coolpilot-integration-contracts.md` §2；已知缺口：无进度字段、无取消入口、无重启收敛）。

### B-2 · CI-P1-02 统一长任务管理（done）

**1. 改动内容（新增 7 个文件；修改 2 个现有文件，且只各加一个只读函数——不改表、不改列、不改任何写入方）**

| 文件 | 作用 |
| --- | --- |
| `src/lib/tasks/task-view.ts`（新） | **纯映射层**（无 DB / 无 Node 导入）：`TaskKind`/`TaskStatus`/`TaskView`/`TaskErrorSummary`/`TaskLogEntry`；三张状态映射表 `mapPlaybookStatus`/`mapAgentStatus`/`mapScheduleStatus`；`isKnownSourceStatus`、`deriveProgress`、`classifyRetryable`、`hasInterruption`、`runEventsToTaskLogs`、`agentEventsToTaskLogs`、`playbookRunToTaskView`/`agentRunToTaskView`/`scheduleToTaskView`、`taskKinds`/`taskStatuses`/`isTaskKind`/`isTaskStatus` |
| `src/lib/tasks/task-library.ts`（新） | **组合层**（只读三张表 + 两个受控写入点：取消、收敛）：`listTaskViews`、`getTaskView`、`findTaskView`、`listTaskLogs`、`cancelTask`、`reconcileInterruptedTasks`、`reconcileInterruptedTasksOnce` |
| `src/app/api/tasks/route.ts`（新） | `GET /api/tasks?kind=&status=&limit=`（统一查询 + 首次访问触发收敛）、`POST /api/tasks`（按需收敛，返回报告） |
| `src/app/api/tasks/[id]/route.ts`（新） | `GET /api/tasks/<id>?kind=` → `{ task, logs }`（`kind` 可省，按 `runs` → `agent_runtime_runs` → `schedules` 顺序找） |
| `src/app/api/runs/[id]/cancel/route.ts`（新） | `POST /api/runs/<id>/cancel`：可停 → `200 {cancelled:true}`；不可停 → `409 {cancelled:false, reason}`；未知 id → `404` |
| `src/lib/tasks/task-view.test.ts`（新） | 映射层用例 21 个：状态表逐行、未知字面量、`progress` 为 `null`、`retryable` 判定、日志 `stage`、三类转换器、未知 kind/status 词表 |
| `src/lib/tasks/task-library.test.ts`（新） | 组合层用例 22 个，跑在临时 SQLite 工作区：三表合一列表、日志合一、取消矩阵、重启收敛与幂等 |
| `src/db/repository.ts`（改，**只加**） | 新增 `listAgentRuntimeRuns(limit)`：表早已存在，只是补一个只读列举，与 `listRuns`/`listSchedules` 同形同风格 |
| `src/db/repositories/agent-runtime.ts`（改，**只加**） | 转出 `listAgentRuntimeRuns` |

**未动的东西**：三张表的列与取值、`run_events`/`agent_runtime_events` 的写入方、`/api/runs`、`/api/schedules`、`/api/agent/*` 的既有语义（取消入口按契约 §2.2 只新增 `/api/runs/[id]/cancel`，Agent 侧沿用已有 `resume({approved:false})`、排期沿用已有 `DELETE /api/agent/schedules/[id]`，**不造第二个写者**）。

**2. 对照 P1-02 子项**

- **01 状态词表**：契约 §2.2 的 8 个 canonical 值 → `taskStatuses`；三张映射表按源表逐行落地。`warning`、`paused`、`missed` **一律保留**（不并进 `succeeded`/`running`）；无法识别的字面量 → `failed` 且 `rawStatus` 保留原文，**永不猜成成功**。`schedules.scheduled` 是“已受理、等下一次”的空闲态 → `queued`（映射成 `failed` 会让每个空闲排期都像坏了）；`schedules.posted` → `succeeded`。
- **02 基础字段**：`TaskView` = `id`/`kind`/`type`（playbook id 或 agent mode，取自现有列）/`status`/`rawStatus`/`input`/`progress`/`error`（`{code,message,retryable}`）/`resultUrl`（`runs.artifact_path`）/`createdAt`/`startedAt?`/`finishedAt?`/`updatedAt`/`nextRunAt?`（排期专用）。`progress` 只由 `deriveProgress()` 从任务自己的事件里取显式信号（`data.progress` 或 `{current,total}`），**没有信号就是 `null`**，不做时间估算、不写 `0%`。
- **03 创建 / 查询 / 进度 / 结果**：创建**沿用现有入口**（`POST /api/runs`、Agent、`POST /api/schedules`），未新增第二个创建入口；查询 = `GET /api/tasks`、`GET /api/tasks/<id>`；进度 = `TaskView.progress`；最终结果 = `resultUrl` 与统一日志。
- **04 统一日志**：`{ taskId, at, level:"info"|"warn"|"error", stage, message, data }`；`run_events` 的 `stage` 取 `data_json.stage`（缺失 → `"run"`，`level` 原样映射），`agent_runtime_events` 的 `stage` 用其 `type`；**不新建第 3 张记录表**；`schedules` 没有自己的日志表 → `logs: []`（不臆造条目，其状态看它触发的 run）。
- **05 取消**：`cancelTask(kind, id)` 的判定矩阵——playbook `queued` → **真停**（写 `cancelled` + `finishedAt` + 1 条 `warn`，`data:{cancelled:true,cancelledFrom:"queued"}`）；playbook `running` → `not-safe-to-stop`（**不写状态**）；agent `paused` → `use-resume-endpoint`（审批走 `POST /api/agent/runs/[id]/resume`，`approved:false`）；agent `queued`/`running`、schedule `running` → 拒绝；schedule `scheduled`/`queued` → `enabled:false` + `status:"cancelled"`（与既有排期删除路由同语义）；重复取消 → `alreadyCancelled:true` 且**不产生第二次写入/事件**；终态 → `already-finished`；未知状态 → `unknown-status`。HTTP 入口按契约只做 playbook run。
- **06 重启恢复**：`reconcileInterruptedTasks({ staleAfterMs, processStartedAt })`——孤儿判定 = 最后活动（状态更新或最新事件）早于进程启动 **或** 静默 ≥ 30 分钟（可注入，默认 1800000ms）。收敛：playbook `running` → `failed`（`result_message` + 一条 `error` 事件）；agent `running` → `failed`（`result.error` 保留已有产出）；schedule `running`/`queued` → 一次性排期 `failed` / 周期排期 `scheduled`（且仅当它没有仍在跑的 run）。**不动** `queued` run、**不动** `paused` agent run。幂等靠事件里的 `data.interrupted = true` 标记（已标记的行不再追加第二条事件，收敛过的行也不再是候选）。触发点：`GET /api/tasks` 首次访问（进程内**记忆化**：第一个读者付费，后续读者复用同一 promise；失败则忘掉，下一个读者重试）+ `POST /api/tasks` 按需触发。**不自动重放任何有副作用的步骤**（发布/提交/删除），续跑必须由用户显式重试。
- **07 现有长任务接入**：**不加表、不加列**——现有长任务（`topic_article_generator`、`article_scraper_rewriter` 等含图片生成/抓取的 playbook，`threads_auto_post` 发布链）本来就写在 `runs`，因此天然出现在统一视图里，可直接查状态/进度/错误/取消/日志；视频上传是同步路径（`/api/videos/upload`）没有任务记录，属 CI-P1-04 的渲染任务范围（见遗留 4）。
**3. 调用链路**

`GET /api/tasks` → `reconcileInterruptedTasksOnce()`（首次访问，进程内记忆化）→ `listTaskViews(filter)` → `listRuns` / `listAgentRuntimeRuns` / `listSchedules` 三份**已存在**的读取 → 逐行 `playbookRunToTaskView` / `agentRunToTaskView` / `scheduleToTaskView` → 按 `updatedAt` 归并排序 → `{ tasks, total }`。进度与中断标记都从任务自己的事件里读：`listRunEvents` / `listAgentRuntimeEvents` → `deriveProgress()` / `hasInterruption()`。

`GET /api/tasks/<id>` → `findTaskView(id, kind?)`（三表按序查，命中即停）→ `listTaskLogs(kind, id)` → `{ task, logs }`；`schedule` 的 `logs` 恒为 `[]`。

`POST /api/runs/<id>/cancel` → `cancelTask("playbook", id)` → `getTaskView` → 判定矩阵（`queued` 写状态 + 追加 `warn` 事件／`running` 拒绝／终态拒绝／未知状态拒绝）→ `200` / `409` / `404`。

**4. 验证结果（全部为本轮真实执行，命令与退出码原样记录）**

| 验证 | 结果 |
| --- | --- |
| 定向单测 `vitest run src/lib/tasks` | `EXIT=0`，**2 files / 43 tests passed**（`task-view.test.ts` 21 + `task-library.test.ts` 22） |
| 旧调用方定向回归 `vitest run src/app/api/videos/route.test.ts src/db/repository.test.ts src/lib/media-artifact-library.test.ts src/lib/tasks` | **5 files / 55 tests passed**（含 `repository.ts` 被加函数后的既有用例） |
| 全量 `vitest run` | **94 files / 649 tests 全部通过，0 failed**，Duration 18.11s（P1-01 基线 92 files / 606 tests + 本轮 2 文件 / 43 用例，数字完全吻合） |
| `tsc --noEmit` | `TSC_EXIT=0`（无任何输出） |
| `eslint .` | `0 errors, 1 warning`——唯一警告在 `src/components/agent-chat/chat-conversation.tsx:146`（既有文件、与本任务无关，未改） |
| `eslint src/lib/tasks src/app/api/tasks src/app/api/runs/[id]/cancel/route.ts src/db/repository.ts src/db/repositories/agent-runtime.ts` | `ESLINT_EXIT=0` |

**5. 端到端实测（真实 HTTP；`next dev` 跑在 `127.0.0.1:3111`，指向真实库的临时副本 `web-data/_tmp-tasks-live.db`，全程不碰生产库）**

| 验证 | 结果 |
| --- | --- |
| `GET /api/tasks` | **200** / `ok=true`；6 条真实数据 = agent `succeeded`×5 + playbook `queued`×1，每条都带 `rawStatus`，`progress` 全为 `null`（无进度事件 ⇒ 不臆造） |
| 三表真的合一 | 向副本播种三张表后：`?kind=playbook` = 3、`?kind=agent` = 6、`?kind=schedule` = 2；`kind` 与 `type`（playbook id / agent mode）各自保留来源 |
| 参数校验（词表即契约） | `?kind=bogus` → **400** + `allowed:["playbook","agent","schedule"]`；`?status=nonsense` → **400** + 8 个 canonical 值；`?status=scheduled`（源表字面量）→ **400**（入口只认 canonical）；`?limit=0` → **400** |
| `GET /api/tasks/<id>` | **200** `{task, logs}`；孤儿 run 的日志 = `level:"error"`、`message:"Interrupted: the process running this task stopped before it finished. It was not retried automatically."`、`data:{interrupted:true, reason:"process-restart", lastActivityAt:…}`；`schedule` 的 `logs` = `[]` |
| `POST /api/tasks` 第 1 次（收敛） | `{staleAfterMs:1800000, checked:{playbook:2,agent:1,schedule:1}, converged:[playbook running→failed, agent running→failed, schedule running→scheduled], untouched:{queuedRuns:1, pausedAgentRuns:1}}` |
| `POST /api/tasks` 第 2 次（幂等） | `converged: []`，`checked:{playbook:1,agent:0,schedule:0}`；再查那条孤儿 run → `status=failed / raw=failed / logs=1`（**没有第二条事件**） |
| 只收敛该收敛的 | “进程启动后仍被触碰”的 `running` 保持 `running`；`paused` agent run 保持 `paused`；历史 `queued` run 仍 `queued`（只有 1 条 `Run queued` 日志）；周期排期由 `running` 回到 `scheduled` |
| 首次访问触发 + 记忆化 | 播种发生在第一次 `GET /api/tasks` 之后 → 之后的 `GET` 都不再扫描（孤儿仍是 `running`），直到 `POST /api/tasks` 才收敛：正是“第一个读者付费、后续读者复用同一 promise”的行为 |
| 取消（可停 → 200） | `POST /api/runs` 新建 queued run（`topic_article_generator`）→ `POST /api/runs/<id>/cancel` → **200** `{cancelled:true, alreadyCancelled:false, message:"Cancelled before it started."}`，行落 `cancelled` + `finishedAt` |
| 取消事件只写一次 | 统一视图 logs = 2：`info "Run queued"` + `warn "Cancelled before it started." data:{cancelled:true,cancelledFrom:"queued"}`；第 2、3 次取消 → **200** `alreadyCancelled:true`，logs 仍为 2（无第二遍写入） |
| 取消（不可停 → 409） | `running` run → **409** `{cancelled:false, reason:"not-safe-to-stop", status:"running"}`，行仍是 `running`、logs 为空（**没写 cancelled**）；`failed` run → **409** `already-finished` |
| 找不到就是 404 | `POST /api/runs/does-not-exist/cancel` → **404**；`GET /api/tasks/does-not-exist` → **404**；把 agent id 交给 playbook 取消入口 → **404**（另两套沿用产品已有入口） |
| 既有入口零回归 | `GET /api/runs?limit=5`、`GET /api/schedules`、`GET /api/videos?limit=1`、`GET /api/media/assets` 全部 **200 / ok=true**；`/api/runs` 返回的被取消 run 字段形状与旧版完全一致 |
| 数据安全 | 全程只写临时副本：真实 `web-data/social-auto-post.db` 的 mtime 停在验证前的 **08:20:37**（未被打开/写入）；副本 `_tmp-tasks-live.db` 与播种脚本用完即删；验证用 `next dev` 已 `taskkill /T` 结束，`Get-NetTCPConnection -LocalPort 3111` = **0** |

**6. 遗留问题**

- **阻塞项：无。**
- 可延后 1：**当前没有任何写入方写进度事件**，因此 `progress` 现状恒为 `null`——这是契约允许的诚实答案，不是缺陷。要真正有百分比，需要在 playbook/agent 的步骤事件里写 `run_events.data_json.progress` 或 `{current,total}`；属“把现有长任务接进任务状态管理”的后续增量，本轮按契约“禁止臆造进度”不做。
- 可延后 2：取消只有对 `queued` run 才是**真停**。`running` 的 playbook/agent 任务目前没有中止句柄（执行器未暴露 `AbortController`），所以入口如实回 `not-safe-to-stop` 而不改记录；让 `running` 变得可停需要执行器先提供句柄（独立任务，超出 P1-02 的“最小改动”）。
- 可延后 3：`agent_runtime_runs` 没有 `finished_at` 与错误码列（见 `docs/agent-execution-audit.md` AG07），agent 任务的终态时间只能取 `updated_at`；本轮按契约**不加列**，故 agent 视图的 `finishedAt` 恒缺省。
- 可延后 4：统一视图**没有配套前端页面**（本轮交付的是基础设施层），`src/` 中暂无 `/api/tasks` 消费方；界面留给后续闭环/UI 任务，属预期范围。
- 可延后 5：视频上传是同步路径、没有任务记录（属 CI-P1-04 渲染任务范围）；本轮**未**把视频渲染包装成任务，也没有引入模拟渲染器。
- 环境备注：本轮服务用 PowerShell 作用域变量启动 `$env:SOCIAL_AUTO_POST_DB_URL='file:./web-data/_tmp-tasks-live.db'`（与 §附录 A-3 / B-1 记录的 `cmd /c set` 空格坑对照），停服用 `taskkill /PID <cmd-pid> /T /F`。

**7. 下一步任务**：CI-P1-03 统一媒体工具注册（契约见 `docs/coolpilot-integration-contracts.md` §3）。验收要求“至少一个现有媒体工具通过统一注册机制完成调用，并能正确返回结果或任务 ID”，其中“任务 ID”可直接复用本轮新增的 `GET /api/tasks/<id>`。

### B-3 · CI-P1-03 统一媒体工具注册（done）

**1. 改动内容（新增 10 个文件，未修改任何现有文件）**

| 文件 | 作用 |
| --- | --- |
| `src/lib/tools/tool-call.ts`（新） | **纯契约层**（不导入 DB、不碰文件系统、不读时钟）：`ToolCallContext`/`ToolCallApprovals`/`ToolCallError`/`ToolCallResult`、`toolCallErrorCodes`（7 个码）、`toolCallErrorStatus()`、`asAgentContext()`、`invalidInputError()`/`unknownToolError()`/`approvalRequiredError()`/`taskNotFoundError()`/`cancelledError()`/`describeToolCallFailure()`、`readTaskId()`、`summarizeToolInput()`/`summarizeToolOutput()`、`inputJsonSchema()` |
| `src/lib/tools/media-tools.ts`（新） | **薄注册表**：按引用复用 Agent 注册表的 `generate_image_file`（不复制定义，两条路径不会分叉），新增只读 `media_list_assets`（输出即 CI-P1-01 的 `MediaAssetRef`）；`getMediaToolRegistry()` 记忆化，发现与执行共用同一个注册表 |
| `src/lib/tools/tool-library.ts`（新） | **入口层**：`listCallableTools()`（发现）、`callTool()`（调用）、`toToolTaskLink()`/`toolTaskLookup()`、`recordUnderHost()`；不含任何工具业务逻辑 |
| `src/app/api/tools/route.ts`（新） | `GET /api/tools` → `200 { ok:true, data:[{ name, description, inputSchema }] }` |
| `src/app/api/tools/[name]/route.ts`（新） | `POST /api/tools/<name>`，body `{ input?, taskId?, approvals? }`；HTTP 状态码由 `toolCallErrorStatus()` 决定，错误体即契约的 `ToolCallResult`（不是本仓库惯用的字符串 `error` 信封） |
| `src/lib/tools/tool-call.test.ts`（新，18 用例） | 纯契约：码→状态码映射、`retryable` 只来自 §2.2 瞬态模式、`asAgentContext()` 权限全为 `confirm`、摘要脱敏（敏感键、深度、条数、字符串长度上限，且不产生 `progress`/`current`/`total`/`interrupted` 形状）、`readTaskId()`、`inputJsonSchema()`（`io:"input"`；`z.date()` 等无法表达时返回 `null`） |
| `src/lib/tools/tool-library.test.ts`（新，15 用例） | 真实临时工作区 + 真实 SQLite：发现清单（不含 Agent 私有工具、复用是按引用、注册表记忆化）、执行前拒绝（`UNKNOWN_TOOL`、`INVALID_INPUT` 先于审批、`TASK_NOT_FOUND`(host)、已取消）、真实 `media_list_assets`（引用形状、filter/limit 与 total 的关系、无需审批也不写记录）、审批门 + 真实 `generate_image_file` 失败、自建 `media_test_write` 工具验证“走到 execute / 写记录 / 任务 ID 校验 / `INVALID_OUTPUT`” |
| `src/app/api/tools/route.test.ts`（新，4 用例） | `GET` 的 HTTP 行为：信封、schema 即契约、不出现 Agent 私有工具、重复调用同一答案 |
| `src/app/api/tools/[name]/route.test.ts`（新，6 用例） | `POST` 的 HTTP 行为：`200` 读取、`404` 未知工具（带 `available`）、`400` 非法输入/非法请求体/宿主任务不存在、`409` 未审批、已审批则 `500` 且带 `upstreamCode` |

对照 P1-03 子项：**01** 注册信息＝`AgentToolDefinition`（`name`/`description`/`inputSchema`/`outputSchema`/`execute`/`requiresApproval`）；**02** 发现与调用＝`GET /api/tools` + `POST /api/tools/<name>`；**03** 统一校验与结构化返回＝Zod `parse` 前置 + `ToolCallResult` + `toolCallErrorStatus()`；**04** 同步返回/长任务返回任务 ID＝同步工具直接返回 `data`，返回 `taskId` 时用 CI-P1-02 的 `findTaskView()` 解析为真实任务并给出 `lookup`，解析不到就是 `TASK_NOT_FOUND`；**05** 现有能力接入＝`generate_image_file` 按引用复用；**06** 凭据/权限/运行时配置＝工具仍走 AI Runtime 与既有审批判定，未复制任何凭据管理。

**2. 调用链路**

```
GET /api/tools
  → listCallableTools() → getMediaToolRegistry()（记忆化）→ registry.list()
  → z.toJSONSchema(tool.inputSchema, { io: "input" })（无法表达时为 null，工具仍可调用）

POST /api/tools/<name>   body { input?, taskId?, approvals? }
  → callTool(name, input, { taskId, approvals })，顺序固定：
     1. registry.has(name)                        否 → 404 UNKNOWN_TOOL（details.available = 已注册工具名）
     2. findTaskView(taskId)（CI-P1-02）          无 → 400 TASK_NOT_FOUND（details.role = "host"）
     3. context.signal 已中止                      是 → 400 CANCELLED（不产生副作用）
     4. tool.inputSchema.parse(input)             失败 → 400 INVALID_INPUT（details.issues = [{ path, code }]）
     5. registry.requiresApproval(..., asAgentContext(context))   需要且未获批 → 409 APPROVAL_REQUIRED
     6. registry.execute(name, input, agentContext)
          → 工具内部照旧走 AI Runtime；本机无可用图片模型时抛 AppError(MODEL_CAPABILITY_UNAVAILABLE)
          → 500 TOOL_FAILED（message 用产品自己的句子，details.upstreamCode 原样保留，retryable=false）
     7. readTaskId(output) + findTaskView()       返回的 taskId 无对应任务 → 400 TASK_NOT_FOUND（role = "result"）
     8. 记录：仅当宿主是 playbook 时 appendRunEvent(host.id, "Tool <name> completed|failed", info|error,
              { stage:"tool", tool, status, inputSummary, outputSummary, errorCode? })
  → 200 { ok:true, data:<工具输出> }
```

请求里的 `taskId` 与工具输出里的 `taskId` 是两件事：前者是**这次调用记在谁的日志下**（必须是真实任务），后者是**工具新建的任务**，一定会被解析成真实任务并把 `lookup: /api/tasks/<id>` 交给调用方（复用 CI-P1-02 的入口），因此调用方拿到任务 ID 就能直接轮询，不需要再猜接口。

**3. 验证结果（全部为本轮真实执行）**

| 验证 | 结果 |
| --- | --- |
| 定向单测 `vitest run src/lib/tools` | `EXIT=0`，**2 files / 33 tests passed** |
| 定向单测 `vitest run src/app/api/tools` | `EXIT=0`，**2 files / 10 tests passed** |
| 全量 `vitest run` | **98 files / 692 tests 全部通过，0 failed**，Duration 23.39s（本轮新增 4 文件 / 43 用例；扣除后为 94 文件 / 649 用例，该基线由相减得出、未单独重跑） |
| `tsc --noEmit` | `TSC_EXIT=0`（首次曾报 `tool-library.test.ts` 里 `createRun()` 可能为 `null` 的 8 处错误，补判空后重跑为 0） |
| `eslint src/lib/tools src/app/api/tools tmp-probe-registry.ts` | `ESLINT_EXIT=0` |
| 真实环境调用（工作区内已在运行的 `next dev`，`127.0.0.1:3000`，**真实工作区** 37 个产物；脚本 `tmp-tools-live-probe.ps1`） | 见下方逐条 |
| 数据安全 | 探测全程只读与拒绝：`web-data/social-auto-post.db` 的 mtime 停在 **09:23:03**（早于探测时刻）、`run_events` 仍为 **1 行**；未新建/删除数据文件；未执行任何 `git commit` |

真实调用逐条（HTTP 状态码 / 关键返回）：

| 请求 | 结果 |
| --- | --- |
| `GET /api/tools` | **200**，`data` 恰为 2 个工具：`generate_image_file`（`inputSchema.properties` = `prompt`/`provider`/`contentItemId`/`imagePrompt`，`required:["prompt"]`）、`media_list_assets`（`root` 枚举 4 个根、`limit` 1–500）；两者都带 `$schema: "https://json-schema.org/draft/2020-12/schema"` |
| `POST /api/tools/media_list_assets` `{"input":{}}` | **200** `assets=37 total=37 matched=37 byRoot={"artifacts":37}`；首个产物 `online-1791308469029-I_G_de_7.webp`：`kind:"image"`、`mimeType:"image/webp"`、`root:"artifacts"`、`source:"remote"`、`url:"/api/agent/artifacts?file=…"`、`external:false` |
| `POST …` `{"input":{"root":"videos","limit":2}}` | **200** `assets=[] total=37 matched=0`——本工作区没有 videos 文件，诚实回空，且 `total` 仍是全库（过滤/上限不会被伪装成“工作区变小”） |
| `POST /api/tools/browser_open_page` `{"input":{"url":"https://example.com"}}` | **404** `UNKNOWN_TOOL`，`details.available=["generate_image_file","media_list_assets"]` |
| `POST …` `{"input":{"root":"nowhere"}}` | **400** `INVALID_INPUT`，`details.issues=[{"path":"root","code":"invalid_value"}]`（只给机器可读信息，不回 Zod 的本地化文本） |
| `POST …` 非法 body（`not json at all`） | **400** `INVALID_INPUT`，`message:"Invalid request body for tool \"media_list_assets\": expected { \"input\": { … } }."`（请求坏了 ≠ 工具输入坏了） |
| `POST …` `{"input":{},"taskId":"no-such-task"}` | **400** `TASK_NOT_FOUND`，`details={ taskId, tool, role:"host" }` |
| `POST /api/tools/generate_image_file` `{"input":{"prompt":"a red fox at dawn"}}` | **409** `APPROVAL_REQUIRED`，`message:"Tool \"generate_image_file\" changes state and was not approved."` |
| 同上 + `approvals.grantedToolCallId` | **500** `TOOL_FAILED`，`message:"No usable model provides: image_generation"`，`details.errorName="AppError"`、`details.upstreamCode="MODEL_CAPABILITY_UNAVAILABLE"`，`retryable:false`——**本机确实没有可用的图片模型**，这是运行时的真实结构化失败，未被伪造成成功 |
| `POST /api/tools/media_list_assets` + 真实任务 ID `IdusjTjtygW3cCkFG0Q13`（`GET /api/tasks?kind=agent&limit=1` 取到） | **200**（宿主任务被解析为真实任务；agent 宿主不写 `run_events`，避免本入口成为 Agent 状态的第二个写入方） |

**4. 遗留问题**

- **阻塞项：无。** 验收要求“至少一个现有媒体工具通过统一注册机制完成调用”已达成：`media_list_assets` 走完 `POST /api/tools/media_list_assets` 并真实返回 37 条统一产物引用；`generate_image_file` 也走同一入口（审批门与运行时结构化失败均已在真实环境验证）。
- 可延后 1：本卡只发布**薄媒体注册表**（2 个工具）。另外 8 个 Agent 私有工具（`browser_open_page`/`browser_click`/`browser_type`/`browser_screenshot`、`generate_social_post_draft`、`generate_image_prompt`、`threads_create_post`、`xiaohongshu_create_post`）仍只在 Agent 注册表里：它们要读 `context.site`、`context.profilePath` 或 Agent 自己的 `systemPrompt`，通用入口给不出真值，而 §3.3 禁止用假值把 Agent 私有依赖变成公共能力。要公开它们，得先有真实的上下文来源（属 CI-P4-01 / CI-P4-04）。
- 可延后 2：`approvals` 目前只表示“调用方声明已获批”（`{grantedToolCallId}`）。真正的审批状态机（人在界面上确认、审批与 run 绑定、过期）仍由现有 Agent 审批流程负责；HTTP 入口不新建第二套审批系统。
- 可延后 3：`generate_image_file` 的**成功**路径未在真实环境跑通（结构化失败已跑通，见证据表），原因是本机没有可用的图片模型/凭据。这是环境问题，不是代码问题；配置好图片模型后，同一条 `POST /api/tools/generate_image_file` 即可验收成功路径。
- 可延后 4：`inputSchema` 由 `z.toJSONSchema(schema, { io: "input" })` 生成，因此含 `z.transform()` 的工具发布的是**输入形状**；含 `z.date()` 等无法表达的类型时为 `null`。调用方应把 `null` 读成“契约无法用 JSON Schema 表达”，而**不是**“没有输入”。
- 可延后 5：`GET /api/tools` 没有配套前端页面，`src/` 内暂无消费方（本卡交付基础设施层，界面属后续闭环任务）。
- 可延后 6：工具调用记录只写 playbook 宿主的 `run_events`；agent 宿主的记录仍在 `chat_tool_calls`（由 Agent 循环写），schedule 宿主没有日志表，因此 `recorded=false`——这是 §3.2 的有意边界，不是缺失。
- 环境备注：本轮探测复用了工作区里**已在运行**的 `next dev`（`127.0.0.1:3000`，指向真实数据库），因此只走读取与拒绝路径；探测脚本 `tmp-tools-live-probe.ps1` 留在工作区（与既有 `tmp-probe-*.ts|cjs` 同类，未删除）。

**5. 下一步任务**：CI-P1-04 定义视频模板与渲染任务（P1-04-01…06）。与本卡的衔接：视频目前是同步上传、没有任务记录；“长任务工具返回任务 ID”这一半已经就绪（`callTool()` 把返回的 `taskId` 解析为真实任务并给出 `lookup: /api/tasks/<id>`），CI-P1-04 的渲染任务只要返回真实 `taskId`，即可被同一入口原样透出。


## 附录 B-4：CI-P1-04 交付记录

**状态**：`done`（含 1 项**环境性未完成项**，见 §5）。**未提交 git commit**；沿用所有既有未提交修改。

### 1. 交付内容（P1-04-01 … 06；`CI-P1-04-07` 于 2026-10-12 补登，见本节 §8）

| 子项 | 落地 |
| --- | --- |
| P1-04-01 模板标识/版本/参数/默认值 | `src/lib/videos/video-template.ts`（纯模块）：`videoTemplateIds`、`videoTemplateVersion = 1`、`existingVideoPackageTemplate`（`materialsSchema` + `paramsSchema`）、`findVideoTemplate()`、`isSupportedTemplateVersion()`。默认值属于模板：`params` 省略时补 `subtitles: true` |
| P1-04-02 渲染任务输入 | `src/lib/videos/video-render.ts`：`videoRenderInputSchema = { template: {id, version?}, materials, params? }`，按模板逐分支写出（判别键嵌套，故用 `union` 而非 `discriminatedUnion`），类型不退化 |
| P1-04-03 状态/进度/错误/取消 | **复用 CI-P1-02**：渲染任务就是一行 `runs`（`playbook_id = "video_render"`）→ `GET /api/tasks/<id>` 可查状态/`rawStatus`/进度/错误摘要/`resultUrl`；进度来自任务自己 `run_events` 的显式 `{ current, total }`（4 阶段）；取消走既有 `POST /api/runs/<id>/cancel`（`queued` 可停 → `cancelled`；已在跑的如实拒绝）。**不新增任务表、状态词与取消入口** |
| P1-04-04 渲染产物 | `videoRenderArtifactsSchema`：`video`（真实文件，`/api/videos?file=` 可取字节 + Range）、`cover`（工作区既有图片，原样引用）、`subtitles`（真实 `.srt`，`videos/` 内，`url: ""` 哨兵值）、`metadata`（`render.json`，含 taskId/模板/渲染器/素材/参数/notes） |
| P1-04-05 模拟渲染器/测试适配器 | `src/lib/videos/video-renderer.ts`：`VideoRenderer` 接口 + 已安装的 `existing-video-package` 适配器（`encoded: false`）。真实写字节、真实 SRT、真实元数据；拒绝一律 `VideoRenderFailure`（稳定 code），绝不半成品报成功 |
| P1-04-06 是否引入 Remotion/其他引擎 | **本轮不引入**（决策点前置条件已备好：见 §5 环境事实 1 与 §7 下一步）。模板只发布适配器真能执行的 `existing_video_package`；需要编码的模板（如 `image_slideshow`）留到该决策之后 |
| P1-04-07 视频渲染可读面（2026-10-12 补登，**子项，不占一级卡号**） | 渲染面板 `src/components/creation/video-render-panel.tsx`（挂在 `/creation/videos` 上）+ Node-free 读模型与地址规则 `src/lib/videos/video-render-artifacts.ts` + `GET /api/videos/renders?limit=`（模板清单 / 渲染历史）与 `GET /api/videos/renders/<taskId>?file=`（**只**服务该任务日志列出的文件名）。渲染启动仍经 CI-P1-03 的唯一工具入口并保留显式确认；交付视频仍走 `/api/videos?file=`（Range/206 行为不变）；工具的 `url: ""` 冻结语义未改。**已知限制 3 由此关闭**。详见本节 **§8** |

**新增文件**：`src/lib/videos/{video-template,video-render,video-renderer,video-render-task,video-render-tool}.ts`、`src/lib/media-asset-schema.ts`（`MediaAssetRef` 的运行时 schema，供 CI-P1-03 媒体注册表与渲染工具共用，避免第二份契约）。

**修改文件**：`src/lib/tools/media-tools.ts`（薄注册表登记 `video_render`；改用共享 schema）、`src/lib/types.ts`（`playbookIds` += `video_render`）、`src/worker/runner.ts`（`case "video_render"` 分发到同一执行器）、`src/components/calendar/schedule-labels.ts` + `src/locales/{en,zh-cn,zh-hk}.json`（`playbookVideoRender` 标签，`Record<PlaybookId, …>` 是穷举表）。

**新增测试（5 文件 / 34 用例）**：`video-template.test.ts`(3)、`video-render.test.ts`(11)、`video-renderer.test.ts`(7)、`video-render-task.test.ts`(7，含经 `processRun` 的 worker 分发)、`video-render-tool.test.ts`(6，含经 `GET /api/tasks/<id>` 路由查询)。

**修改测试（CI-P1-03 既有断言，因工具清单从 2 变 3）**：`src/app/api/tools/route.test.ts`、`src/app/api/tools/[name]/route.test.ts`、`src/lib/tools/tool-library.test.ts` 三处 `available` 清单。


### 2. 调用链路（真实实现的形状）

```
POST /api/tools/video_render   body { input: { template, materials, params? }, approvals? }
  → callTool("video_render", …)                     （CI-P1-03 入口，顺序不变）
      … 未知工具 → 宿主任务 → 取消 → Zod 校验 → 审批门（本工具 requiresApproval 恒为 true）
  → 工具 execute：
      createVideoRenderTask()   → runs 行（playbook_id = "video_render", status = "queued"）
      executeVideoRenderTask()  → status=running（写 startedAt）
          → resolveVideoRenderInput(run.params)      模板版本、参数默认值、caption 语义（CODE 化拒绝）
          → installedVideoRenderer.render()          真实写：视频副本 → .srt → .json，每阶段一条 run_event（1/4…4/4）
          → updateRunStatus(success, message, artifactPath = 视频的 /api/videos?file=… 地址)
        失败 → updateRunStatus(failed, "<CODE>: <detail>") + error 事件（进度停在真实阶段，可能为 null）
      findTaskView(run.id)      → 回包 taskStatus/taskRawStatus/lookup（CI-P1-02 的规范状态，不自己映射）
  → callTool：readTaskId() + findTaskView() 二次校验（返回的 taskId 必须是真实任务）

查询：GET /api/tasks/<id>          → TaskView + 统一日志（run > materials > video > subtitles > package > done）
取件：GET /api/videos?file=<…>     → 真实字节（206 + Content-Range 支持）
取消：POST /api/runs/<id>/cancel   → queued 停止（cancelled）/ 已在跑如实拒绝
worker：pnpm worker | POST /api/internal/scheduler/tick → claimNextQueuedRun → processRun → case "video_render" → 同一 executeVideoRenderTask()
```

**与两张前卡的接口关系**：产物一律是 CI-P1-01 的 `MediaAssetRef`（解析走已冻结的 `toMediaAssetRef()`，不新造地址规则）；任务一律是 CI-P1-02 的 `runs` + 统一视图（不新增表/状态词）；入口一律是 CI-P1-03 的 `ToolRegistry`（不新建工具注册表）。

### 3. 验证结果（全部本轮真实执行）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `node_modules\.bin\vitest.cmd run src/lib/videos` | `EXIT=0`，**5 files / 34 tests passed** |
| 定向单测（含前卡） | `vitest.cmd run src/lib/videos src/lib/tools src/app/api/tools src/lib/tasks` | `EXIT=0`，**11 files / 120 tests passed** |
| 全量回归 | `vitest.cmd run` | `EXIT=0`，**103 files / 726 tests 全部通过，0 failed**，Duration 30.90s（基线 98 文件 / 692 用例；本轮 +5 文件 / +34 用例） |
| 类型检查 | `tsc --noEmit` | `TSC_EXIT=0` |
| ESLint | `eslint src/lib/videos src/lib/tools src/app/api/tools src/lib/media-asset-schema.ts src/worker/runner.ts src/lib/types.ts src/components/calendar/schedule-labels.ts` | `ESLINT_EXIT=0` |
| 真实调用 | `powershell -NoProfile -File tmp-video-live-probe.ps1`（`127.0.0.1:3000`，真实工作区） | `PROBE_EXIT=0`，逐条见 §4 |


### 4. 真实调用逐条（`tmp-p1-04-live2.log`，最终一次；`tmp-p1-04-live.log` 为修正失败措辞前的第一次）

| 步骤 | 结果 |
| --- | --- |
| `GET /api/tools` | **200**，`data` 恰为 3 个工具；`video_render` 的 `inputSchema` 898 字符，含 `template.id` 的 `const: "existing_video_package"`（另两个工具的 schema 不含该词，说明不是照抄） |
| `POST /api/videos/upload`（真实 2s mp4，30389 bytes） | **201** `fileName=video-1791513566386-TMyEVPXp.mp4`（真实素材；fixture 由本机 ffmpeg 生成，仅作测试素材） |
| `POST /api/tools/video_render`（未审批） | **409** `APPROVAL_REQUIRED`；`GET /api/tasks` 计数 **9 → 9**（未审批不产生任何任务/文件） |
| `POST /api/tools/video_render`（带 `approvals`） | **200** `taskId=88WbAGoxROTo-BVRBERSu`、`taskStatus=succeeded`、`taskRawStatus=success`、`lookup=/api/tasks/88WbAGoxROTo-BVRBERSu`、`renderer={existing-video-package, encoded:false}`、`videoBytes=30389`；`artifacts.video.url=/api/videos?file=render-1791513567794-C1rKt71H.mp4`、`artifacts.subtitles.url=""`、`artifacts.metadata.url=""`（哨兵值，不是缺文件） |
| `GET /api/tasks/88WbAGoxROTo-BVRBERSu` | **200** `kind=playbook`、`type=video_render`、`status=succeeded`、`rawStatus=success`、`progress=100`、`resultUrl=/api/videos?file=render-1791513567794-C1rKt71H.mp4`；日志阶段 `run > materials > video > subtitles > package > done` |
| `GET /api/videos?file=render-1791513567794-C1rKt71H.mp4` | **200 30389 video/mp4**，与素材字节数相同（`identical=True`）；`range: bytes=0-99` → **206**，`content-range: bytes 0-99/30389` |
| `POST /api/tools/video_render`（素材不存在） | **500** `TOOL_FAILED`，`message="Video render task 9WUI2DQ7BIF705zwbva4Y failed: MATERIAL_NOT_FOUND: … Its log is at /api/tasks/9WUI2DQ7BIF705zwbva4Y."`，`details={tool, errorName:"VideoRenderTaskError"}`；**没有返回成功** |
| `GET /api/tasks/9WUI2DQ7BIF705zwbva4Y` | **200** `status=failed`、`progress=null`（本次失败发生在第一个阶段之前，**没有臆造进度**）、`error.code=RUN_FAILED`、`error.message` 含 `MATERIAL_NOT_FOUND`，日志有 `stage: "error"` 与 `code: MATERIAL_NOT_FOUND` |
| `POST /api/runs {playbookId:"video_render", params}` | **201** `id=Ky5FL8bZtt5OBwugn4wMx`、`status=queued`（`playbookIds` 已含该 id，接口面变更见 §6） |
| `POST /api/runs/Ky5FL8bZtt5OBwugn4wMx/cancel` | **200** `{cancelled:true, message:"Cancelled before it started."}` |
| `GET /api/tasks/Ky5FL8bZtt5OBwugn4wMx` | **200** `status=cancelled`，日志含 `warn` "Cancelled before it started."（`{cancelled:true, cancelledFrom:"queued"}`） |
| 工作区状态（前 → 后） | `tasks` **9 → 12**（成功/失败/取消各 1）；`videos` 库列出的文件 **3 → 4**（新增 1 个交付视频；`.srt`/`.json` 按设计不在 `/api/videos` 白名单内）；`web-data/videos` 文件数 **5 → 8**；`social-auto-post.db` mtime **10:38:00 → 10:39:28**（本轮**故意写入**，与 CI-P1-03 的只读探测不同） |

**本轮探测在工作区留下的记录（作为证据保留，未删除）**：成功任务 `88WbAGoxROTo-BVRBERSu`、失败任务 `9WUI2DQ7BIF705zwbva4Y`、取消任务 `Ky5FL8bZtt5OBwugn4wMx`；素材 `video-1791513566386-TMyEVPXp.mp4`；交付物 `render-1791513567794-C1rKt71H.mp4`（30389 bytes）、`…srt`、`…json`。另有一次（措辞修正前）探测留下 `ZP3MM2nYrCilrybXYHUD3`（成功）、`kfxmHkeOiowlf-rLKPr9i`（失败）、`ePdp6NV9ai_WBs4RZKjZ_`（取消）与 `video-1791513479085-AzOtayxQ.mp4`、`render-1791513479877-4NlCpwFB.{mp4,srt,json}`。删除这些记录需同时删 `runs`/`run_events` 行，本轮未做（不在授权范围）。


### 5. 环境事实与未完成项（不标记为「完整通过」的部分）

**环境事实 1（P1-04-06 决策的关键输入）：本机确实装了 ffmpeg，但本轮不接线。**

- `Get-Command ffmpeg` 命中 `D:\workspace\software\videotools\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe`。
- 本轮只用它**生成探测素材**（一条 2 秒 mp4，经真实上传接口入库），应用代码**从不调用** ffmpeg：引入外部二进制等于给产品加一条未声明的运行时依赖（打包后的 Electron 目标机不一定有），而 P1-04-06 才是"是否引入编码引擎"的决策点。因此 `encoded: false` 是事实陈述，不是缺陷。
- 若决策引入：实现一个 `VideoRenderer`（`render(request, context) → CI-P1-01 引用`）挂到 `installedVideoRenderer` 的位置即可，任务契约、工具入口、产物契约都不变；届时才发布需要编码的模板（如 `image_slideshow`）。

**未完成项（1 项，环境性）：真实编码未验证。**

- ✅ 已验证：建任务 → 真实 `taskId` → `/api/tasks/<id>` 状态/进度/错误/取消 → 产物经统一媒体契约可读（含 Range 206）
- ❌ 未验证：编码/转码/合成——交付视频是素材字节的**副本**（pass-through 适配器），没有任何一帧被重新编码；`render.json` 与任务日志都写明 `encoded: false`
- 结论：本卡**不得**记成"视频渲染能力已验收通过"；它验收的是**渲染任务契约与真实任务链路**，编码能力取决于 P1-04-06。

### 6. 接口面变更与已知限制（供审阅者确认的差异）

**接口面变更 1（必要，已记录）**：`src/lib/types.ts` 的 `playbookIds` 新增 `"video_render"`。

- 影响：`POST /api/runs` 与 `POST /api/schedules`（都用 `z.enum(playbookIds)`）新增接受该值。
- 为什么必要：CI-P1-04-03 要求"渲染工具返回的 `taskId` 必须对应 CI-P1-02 可查的真实任务"，而唯一能进统一视图的是 `runs` 行，`runs.playbook_id` 又必须落在该联合类型里。用既有 id 冒充渲染任务属伪造，未采纳。
- 配套（缺一即产生假承诺）：`src/worker/runner.ts` 加了 `case "video_render"`，走**同一**执行器；否则 queued 行会被 `processRun` 判为 `Unsupported playbook`。
- UI 连带：`runs/queue` 剧本下拉多一项（显示原始 id）；`schedule-labels.ts` 是 `Record<PlaybookId, TranslationKey>` 穷举表 → 3 个 locale 文件加 `playbookVideoRender`。
- **未改**：`runs` 表结构、任何列、任何状态词、任何已有 URL 形状；历史数据格式不变；未执行 `git add` / `git commit`。

**已知限制 1（worker 路径的 `resultUrl`）**：经 worker 路径（`POST /api/runs`、排期产生的 queued 行）执行的渲染任务，`runs.artifact_path` 会被 `processRun` 结尾的统一 `updateRunStatus(id, status, message)` 覆盖为空（该函数 `artifactPath` 默认 `""`），这类任务的 `resultUrl` 因此为空；交付物地址仍可在任务日志 `done` 事件的 `data.resultUrl` 读到。工具路径（本卡主入口）无此问题。

- 一行可修：`processRun` 结尾保留既有 artifact（`updateRunStatus(run.id, status, message, (await getRun(run.id))?.artifactPath ?? "")`，与 CI-P1-02 中断收敛的写法一致）。**本轮未做**：它改的是 6 个既有剧本共用的 worker 结尾写入，属共享路径变更，按硬约束先记录、不擅自扩大范围。该行为已在 `video-render-task.test.ts` 中注明，修的时候测试要同步改。

**已知限制 2（产物 `source`）**：渲染产物的 `source` 是 `"uploaded"`——CI-P1-01 的 `sourceFor()` 对 `videos` 根是"整根 = uploaded"（已被测试钉住）。真实来源由 `render.json`（`renderer/template/taskId/materials`）与任务记录表达；改 `sourceFor` 属改冻结契约，本轮不动。

**已知限制 3（`.srt` / `.json` 不可寻址）** — **已于 2026-10-12 由 `CI-P1-04-07` 关闭**（下列原文保留当时的判断）：两者落在 `videos/`，按 CI-P1-01 规则返回 `url: ""`（"该根/扩展名暂无服务路由"的哨兵值）。它们是真实文件，但没有按文件名取回的入口；要可访问需扩 `/api/videos` 白名单或新增路由，属独立契约决策。

- **关闭方式（2026-10-12，`CI-P1-04-07`）**：采纳了当时的第二条路 —— **新增路由** `GET /api/videos/renders/<taskId>?file=<name>`（**未**扩 `/api/videos` 白名单：该路由今天仍拒绝非视频扩展名）。关闭依据：① 白名单是**该任务自己的日志**（`videoRenderArtifactFiles()` 只认渲染器记录产品的三个阶段 `video` / `subtitles` / `package`，材料阶段不算），不在名单内一律 404，**不许跨任务取件**；② 文件名必须是纯文件名（`isRenderArtifactFileName()`：非空、与 `trim()` 全等、无 `/`、`\`、`..`、无控制字符与 `"`，扩展名限于 `.mp4` / `.mov` / `.webm` / `.m4v` / `.srt` / `.json`）；③ 真实环境实测 `.srt` → **200 `application/x-subrip; charset=utf-8`**、`.json` → **200 `application/json; charset=utf-8`**（真库真文件，见 §8.4）。逐条契约见 `docs/coolpilot-integration-contracts.md` §4。
- **同期未改**：CI-P1-01 的 `url: ""` 哨兵语义、`videoRenderArtifactsSchema` 的产物形状与 `POST /api/tools/video_render` 的返回值（`subtitles` / `metadata` 仍照 CI-P1-04-04 原样返回 `url: ""`）；新地址只出现在新增的**读取**路由与面板里。

**已知限制 4（无认领锁）**：`executeVideoRenderTask` 用"状态不是终态"作幂等护栏（终态任务直接 `skipped`），但仓层没有 compare-and-set 认领，同一行理论上可被两个执行者同时进入（窗口 = 一次工具调用）。本轮不新增锁/表。


### 7. 下一步建议

1. **P1-04-06 决策（前置条件已齐）**：基于 §5 环境事实 1 决定是否引入编码引擎；引入后新增"需要编码"的模板（`image_slideshow` 等），保持同一 `VideoRenderer` 接口与同一产物契约（`video`/`cover`/`subtitles`/`metadata`）。届时 `encoded` 才可能为 `true`。
2. **可选修 已知限制 1**（worker 路径 `resultUrl`），同步更新 `video-render-task.test.ts` 里钉住该行为的断言。
3. **集中式端到端验证（CI-P5-01…）**：文章 → 图片 → 视频渲染 → 发布。注意本卡**未改** `src/lib/publish.ts` 与 `content_items.metadata.videoPath` 的既有发布链，视频发布回归应沿既有路径做。
4. **界面（2026-10-12 由 `CI-P1-04-07` 修订，本节保留修订前的原文口径）**：渲染能力**已有专属面板**（`src/components/creation/video-render-panel.tsx`，挂在 `/creation/videos` 上，与本地视频库同一页，是它的**唯一宿主**）：可选模板与素材、填写参数，**经确认对话框**（写明将写入的视频文件名）后走 CI-P1-03 的**唯一**工具入口 `POST /api/tools/video_render` 启动任务，并按任务查看状态 / 错误摘要与已生成的交付产物（每个产物一个下载链接，最新一包的交付视频内嵌播放）。模板清单经新读路由 `GET /api/videos/renders` 的 `templates` 字段暴露 —— 这是**只读清单**，**不是**模板管理路由：**未**新增 `GET /api/videos/templates` 之类，也**未**新增模板的写入口（模板仍是构建期注册表 `videoTemplates`）。渲染任务的状态 / 进度 / 取消仍由 CI-P1-02 的统一任务视图提供（面板**不**做独立的进度轮询）。
5. **环境备注**：探测脚本 `tmp-video-live-probe.ps1` 与日志 `tmp-p1-04-live{,2}.log`/`tmp-p1-04-*.log` 留在工作区（与既有 `tmp-probe-*`、`tmp-tools-live-probe.ps1` 同类，未删除、未提交）。


### 8. `CI-P1-04-07`（2026-10-12 补登）：视频渲染的可读面 —— 面板 + 两个读取路由

> **登记方式**：这是 `CI-P1-04` 的**子项**，**不占**一级卡号，也不重开 CI-P1-04 的既有结论 —— 主线 §1 的 `CI-P1-04` 行、本节 §2–§7 的原文**均未改写**；补登内容追加在本节末尾，另仅在本节 §1 表格新增一行、§6 已知限制 3 与 §7 第 4 条就地修订（两处修订都标了「2026-10-12」）。编号与登记事实见 `docs/development/capability-integration-numbering-map.md` §23，接口契约见 `docs/coolpilot-integration-contracts.md` §4。

**8.1 补登前的缺口（事实，不推断）**：CI-P1-04 交付了模板契约、渲染任务、pass-through 渲染器与 `POST /api/tools/video_render`，但**没有任何读取面**：`video_render` 只出现在 `GET /api/tools` 的工具清单与 `runs/queue` 的原始剧本 id 里 —— 用户既无法发起渲染，也看不到已经跑过的渲染；包内三个文件中只有交付视频有地址（`/api/videos?file=` 按设计只服务视频扩展名），`.srt` / `.json` 是「真实存在但取不到」的文件（即 §6 已知限制 3）。补登前在 `docs/*.md` 内检索 `P1-04-07` 与 `videos/renders` 均为 **0 命中**。

**8.2 本次改动（新增 4 个文件 + 修改 4 处；未触碰任何冻结面）**

| 件 | 落点 | 说明 |
| --- | --- | --- |
| 读模型（**Node-free**） | `src/lib/videos/video-render-artifacts.ts`（新增，248 行） | 从**任务自己的日志**读出三槽位文件名（`videoRenderArtifactFiles()`：只认渲染器记录产品的 `video` / `subtitles` / `package` 三个阶段，材料阶段永不算产物）、组装产物与真实地址（`videoRenderArtifacts()`）、模板清单现算（`videoRenderTemplateCatalog()`，源自 `videoTemplates`）、`encoded` 三态（`true` / `false` / `null`）、文件名白名单与内容类型（`isRenderArtifactFileName()` / `renderArtifactContentType()`）。**不 import `paths.ts` / `fs` / 数据库**，故服务端路由与客户端组件同用一份规则 |
| 读取路由 A | `src/app/api/videos/renders/route.ts`（新增，61 行） | `GET /api/videos/renders?limit=` → `{ templates, renders }`：模板清单 + 渲染历史（新→旧，每项含 CI-P1-02 任务视图、该任务日志列出的产物、`encoded`）。`limit` 默认 **20** / 上限 **100** / 非法值回落默认；扫描窗口 = 最近 **200** 条 run（与统一任务视图同口径），窗口内没有渲染任务时**如实回空列表** |
| 读取路由 B | `src/app/api/videos/renders/[id]/route.ts`（新增，88 行） | `GET /api/videos/renders/<taskId>` → `{ task, artifacts, encoded }`；`?file=<name>` → 该产物**字节**（安全边界与响应类型见契约 §4） |
| 界面 | `src/components/creation/video-render-panel.tsx`（新增，505 行）；`src/app/[locale]/(console)/creation/videos/page.tsx`（第 11 行挂载 `<VideoRenderPanel />`，在既有 `VideosComposer` 之前，**唯一宿主**） | 选模板 / 素材 / 封面 / 标题 / 字幕轨 → **确认对话框**（写明将写入的视频文件名）→ 经 CI-P1-03 的唯一工具入口启动；下方渲染历史：规范状态、时间、task id、错误摘要、`encoded: false` 如实标注，每个产物一个下载链接，**最新一包**的交付视频内嵌播放 |
| 文案 | `src/locales/{en,zh-cn,zh-hk}.json` | 各 **+32** 个 `vr*` 键（三语键集一致，含空态与确认对话框文案） |
| 测试 | `src/lib/videos/video-render-artifacts.test.ts`（14 例）、`src/app/api/videos/renders/route.test.ts`（6 例）、`src/app/api/videos/renders/[id]/route.test.ts`（8 例） | 含一条**写入口路径钉死**用例：`videoRenderToolPath === "/api/tools/" + 注册表工具名`，使「面板拼的路径」与「注册表发布的工具名」不能静默漂移 |

**未改（冻结 / 既有面）**：AI Runtime；C2 发布语义（`recordPublishSuccess` 的写入顺序与 verify 消费 receipt）；`video-render-tool.ts` / `video-renderer.ts` / `video-render-task.ts` 三个模块；`runs` / `run_events` 表结构与任何状态词；`playbookIds` 与 `worker/runner.ts` 的分发；`/api/videos` 路由（白名单与 Range / 206 行为**一字未改**）；工具的 `url: ""` 返回值（CI-P1-04-04 语义**未改**）。

**8.3 调用链路**

```
面板（/creation/videos）
  GET /api/videos                   → 素材下拉（既有：本地视频库）
  GET /api/images                   → 封面下拉（既有：workspace 图片）
  GET /api/videos/renders?limit=20  → templates + renders[].artifacts[].url        【本卡新增】
  → 确认对话框 → POST /api/tools/video_render  body { input, approvals: { grantedToolCallId } }
        → CI-P1-03 统一入口（顺序不变：未知工具 → 宿主任务 → 取消 → Zod → 审批门 → execute）
        → executeVideoRenderTask：写 视频副本 → .srt → .json，每阶段一条 run_event（1/4 … 4/4）
  → 提交后 mutate() 重读上面的读路由（失败任务也重读：它有 run 行与日志）

取件（交付视频）：GET /api/videos?file=<…mp4>                           既有路由，Range / 206 保留
取件（侧车）：    GET /api/videos/renders/<taskId>?file=<….srt | ….json>  【本卡新增】
```

**8.4 验证结果**（交付时 2026-10-12 实跑；本次文档补登**未重跑**）

| 项 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0** |
| 定向 `vitest run`（`src/lib/videos` + `src/app/api/videos`） | **9 文件 / 65 用例通过**；本子项 3 个用例文件在本轮文档核对时按文件实测为 **14 + 6 + 8 = 28 例** |
| 全量 `vitest run` | **178 文件 / 1565 用例全通过** |
| `eslint`（本子项 8 个文件） | **exit 0** |
| 真实 `next dev`（`127.0.0.1:3000`，真实工作区，只读探测） | `GET /api/videos/renders?limit=5` → **200** + 5 条真实渲染（成功包 `encoded: false` 且三产物齐全；失败 / 取消包无产物、`encoded` 为 `null`）；侧车 `.srt` → **200 `application/x-subrip; charset=utf-8`**、`.json` → **200 `application/json; charset=utf-8`**；`/zh-cn/creation/videos` → **200**（168,955 B HTML，含面板标题，无 `node:fs`、无错误浮层） |

**8.5 一次真实缺陷（单测与 `tsc` 都抓不到的那类）**：面板最初从 `@/lib/videos/video-render-tool` 导入工具名，而该模块**执行**渲染任务 → `db/repository` → `db/client` → `node:fs`，于是**客户端组件把数据库层拖进浏览器包**：dev server 上**所有**路由（含与面板毫无关系的 `/api/videos`）一律 500。单测在 Node 环境运行、`tsc` 只做类型检查，两者都照不到这个缺陷。修法是让 Node-free 的读模型自带写入口路径（`videoRenderToolPath`），并用渲染路由测试钉住它与注册表工具名一致。**结论**：本子项的界面接线必须用真实 dev server 验证，不得以「单测通过」代替。

**8.6 遗留（本子项不做，明确记下）**：① 面板不轮询运行中的任务（提交后重读列表，无进度刷新）；② 工具返回值里 `subtitles` / `metadata` 的 `url` 仍为 `""`（CI-P1-01 哨兵语义未动），新地址只出现在读取面；③ 只服务 `existing_video_package` 这类 `encoded: false` 的包（编码能力取决于 P1-04-06 决策）；④ 打包版 Electron 行为**未验证**（本子项只做 dev server 实测，按项目规则另行标注）。

**8.7 行号与工作区备注**：本节为**文件内追加**，B-5 … B-11 及以后各附录的行号整体下移：本次补登在 B-4 内**净增 55 行**（`## 附录 B-5` 标题实测 **947 → 1002**；B-10 里那条 runner 基线失败行实测 **1392 → 1447**），逐条登记见 `docs/development/capability-integration-numbering-map.md` §23.5。本卡**不代改**其它文档里既有的行号引用。dev server 日志落在仓库根 `tmp-p1-04-07-dev.log`（与既有 `tmp-p1-04-*.log` 同类，未删除、未提交）；原有 `dev-server.log` / `dev-server.pid` 属更早的实例，本子项未刷新它们。

## 附录 B-5：CI-P2-01 选题管理交付记录（done，2026-10-09）

### 1. 交付内容（P2-01-01 … 05）

| 条目 | 落点 | 说明 |
| --- | --- | --- |
| P2-01-01 新增 / 编辑 / 查询 / 归档 | 表 `topics`（`src/db/schema.ts` + `src/db/client.ts`）；`src/db/repositories/topics.ts`；`GET`、`POST /api/topics` 与 `GET`、`PATCH`、`DELETE /api/topics/[id]`；页面 `/creation/topics`（`src/components/creation/topics-workspace.tsx` + `topic-form-dialog.tsx`） | 归档是 `status: active｜archived`（同一行的状态，不是删除）；删除入口只用于误建。查询 = 关键词搜索 + 状态筛选（与产品库同做法：列表一次读回，筛选在页面上） |
| P2-01-02 字段 | `title` / `description` / `keywords_json` / `source` / `source_url` / `status` | 与 `products` 同一形状（关键词存 JSON 数组），没有为「选题」另造一套字段词汇 |
| P2-01-03 从素材创建选题 | 选题页「从热点导入」复用既有 `GET /api/hot-topics` | 研究素材模块（CI-P3-01）尚未建立，因此只用今天真实存在、向导第一步也在读的热点源；没有虚构「研究素材」入口 |
| P2-01-04 从选题进入创作 | `topicWritingHref()` → `/creation/ai-writing?topicId=<id>`（`src/lib/topics.ts`） | 向导把选题读成**可见、可编辑**的素材文本（自由素材），而不是从隐藏通道注入 prompt：用户看到的就是被带过去的内容 |
| P2-01-05 选题与内容的关联 | 生成入口写两处：文章 `metadata.topicId`（`src/app/api/ai-writing/generate/route.ts`）与 `topics.content_item_id`（`linkTopicContentItem`） | 双向可见：选题行「打开文章」→ 既有文章编辑器；文章列表来源显示「选题」（`arSourceTopic`） |

### 2. 调用链路

1. **新增**：选题页表单 → `POST /api/topics` → `topicInputSchema` → `createTopic` → `topics` 表（`content_item_id` 为空）。
2. **编辑 / 归档**：行内归档按钮或表单 → `PATCH /api/topics/{id}` → `topicPatchSchema`（**不含** `contentItemId`）→ `updateTopic`。
3. **从选题创作**：选题行「开始创作」→ `/creation/ai-writing?topicId={id}` → 向导 `GET /api/topics/{id}` → 填 `freeText`、切到自由素材 → `POST /api/ai-writing/generate`（带 `topicId`）→ `generateArticle()` 存文章（`metadata.topicId`）→ `linkTopicContentItem(topicId, item.id)` 回写 `topics.content_item_id` → 向导返回文章 id，可进编辑器。
4. **打开文章**：选题行 → `articleEditorHref(locale, contentItemId)` → `/creation/articles?edit={id}`（复用 P5-C1 的既有交接，不新增第二个编辑器入口）。



### 3. 本轮真实执行的验证

| 命令（真实执行） | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | exit 0 |
| `node_modules\.bin\vitest.cmd run src/lib/topics.test.ts src/db/repositories/topics.test.ts src/app/api/topics/route.test.ts "src/app/api/topics/[id]/route.test.ts" src/lib/i18n-coverage.test.ts` | **5 文件 / 29 用例全绿**（`lib/topics` 8、仓层 7、`/api/topics` 4、`/api/topics/[id]` 7、i18n 覆盖 3） |
| `node_modules\.bin\vitest.cmd run src/app/api/ai-writing/generate/route.test.ts` | **7 用例全绿**（新增 2 例：`topicId` 双向关联；选题已删除时仍 201 且不建立关联） |
| `node_modules\.bin\eslint.cmd src/db src/lib src/components src/app` | exit 0（唯一 1 条 warning 在未改动的 `src/components/agent-chat/chat-conversation.tsx:146`） |
| `node_modules\.bin\eslint.cmd .` | exit 1，仅 3 个 `tmp-probe-*.cjs` 工作区脚本的 `no-require-imports` 报错（既有文件，与本卡无关） |
| `GET http://127.0.0.1:3000/api/topics`（工作区里已在运行的 `next dev`，**真实工作区数据库**） | **200 `{"ok":true,"data":[]}`**：新路由在开发态真实可调用，且真实工作区当前 0 条选题（诚实空列表，不是伪造数据） |
| `GET /zh-cn/creation/topics`（同上） | **200**，HTML 里带着 `选题管理` 导航项：新页面在开发态真实编译并渲染 |
| `GET /zh-cn/creation/ai-writing?topicId=nonexistent`（同上） | **200**：向导带 `?topicId=` 时仍能编译渲染（`Suspense` 边界就位），选题不存在由客户端提示 |
| `GET /api/workspace/manifest`（同上） | `tableCount=30`（28 张 schema 声明 + 既有 `ai_providers`、`sites`），`unknownTables` 仍为 `ai_providers,sites`——新表 `topics` 是**已声明**的，不是被报为「本版本读不懂」的表 |

测试要点（不是重复断言，而是各钉一条契约）：归档只改 `status`（其余字段不动、可恢复）；`PATCH` 不能伪造 `contentItemId`；选题不存在时生成仍 201 且不建立关联；`topicMaterialText` 的兜底顺序（链接 → 来源名 → 不输出）。

### 4. 已知限制与未完成项（不标记为「完整通过」）

- **一题一文的关联只记「最近一次产出」**：同一选题再次生成会覆盖 `content_item_id`（与「选题行应能打开刚产出的那篇」一致）。要保留多篇关联需要新表，本卡不新增。
- **`metadata.topicId` 是「这次请求从哪来」的事实**：选题在生成过程中被删除时，文章仍记该 id（确实发生过），但不会建立关联（`linkTopicContentItem` 对不存在的选题返回 `null`，不复活选题）。
- **P2-01-03 的另一半（从研究素材创建选题）** 等 CI-P3-01 落地后再接；本卡只用热点源。
- **界面与真实模型调用未做手工核对**：本卡验证止于契约、单元 / 路由测试，加上上面的开发态 HTTP 读检查（200 与空列表）。**没有**在界面上真的点过「新建选题 / 归档 / 开始创作」，也**没有**用真实模型跑过一次「从选题生成文章」；这些留给真实运行中的应用做集中回归（与后续 CI-P2 卡一起）。
- **行号类文档**：`docs/menu-inventory.md` 已按新行号更新（新增 1 行 import + 1 行导航叶子）；`docs/data-model-inventory.md` 仍是 27 张表时期的快照，本卡新增第 28 张表 `topics`，未回填。
- **真实工作区数据库的变化只有 schema**：工作区里在跑的 `next dev` 已按新代码建出空表 `topics`（`/api/workspace/manifest` → `tableCount=30`）。`web-data/social-auto-post.db` 的大小仍是 929792、mtime 停在 9:56:25 PM（早于本轮所有命令），`GET /api/topics` 返回 0 条——没有写入任何数据、没有改动任何既有表；本轮**未**执行 `git add` / `git commit`，也未触发任何真实平台发布。
- **工作区里的本轮残留物**：`tmp-vitest-full.log`（全量回归输出）留在工作区，与既有 `tmp-probe-*`、`tmp-tools-live-probe.ps1` 同类，未删除、未提交。

## 附录 B-6：CI-P2-02 品牌资料管理交付记录（done，2026-10-09）

> 卡片完成标准（原文）：写作流程能够选择品牌资料，并将其作为明确的生成输入。以下每条都是本轮真实执行的结果；没有运行的项目在 §4 明确标注。

**事实边界（先说清楚本卡不是什么）**：本卡新增的 `brands` 表**不是**控制台的 `app_settings["brand"]`（`src/app/api/settings/brand/route.ts`：logo、配色、Agent 系统提示词，全应用一条记录）。那一条回答「这台机器是什么品牌」，本卡的品牌资料是**可多选的内容品牌库**，两者字段、用途、读写方都不同，互不写入。旧接口、旧页面、旧数据一律未改。

### 1. 交付内容（P2-02-01 … 05）

| 子项 | 落点 | 说明 |
| --- | --- | --- |
| P2-02-01 定义品牌资料 | `src/db/schema.ts`（`brands`）、`src/db/client.ts`（DDL）、`src/lib/types.ts`（`BrandRecord`）、`src/lib/validation.ts`（`brandInputSchema` / `brandPatchSchema`） | 六个字段：`name` / `description` / `targetAudience` / `tone` / `keywords` / `bannedWords`；两个列表存 JSON（`keywords_json` / `banned_words_json`），与 `products.keywords_json` 同一形状，没有为「品牌」另造一套字段词汇。`brands` 是第 29 张 schema 表 |
| P2-02-02 新增 / 编辑 / 查询 | `src/db/repositories/brands.ts`（`listBrands` / `getBrand` / `createBrand` / `updateBrand` / `deleteBrand`）+ `src/app/api/brands/route.ts`（`GET` / `POST`）+ `src/app/api/brands/[id]/route.ts`（`GET` / `PATCH` / `DELETE`）+ `src/components/creation/brands-workspace.tsx` + `src/components/creation/brand-form-dialog.tsx` + `src/app/[locale]/(console)/creation/brands/page.tsx` | 查询＝`GET /api/brands`（`updatedAt` 倒序，一次表读取）＋客户端搜索（`brandMatchesQuery`，`src/lib/brands.ts`）；新增/编辑/删除走同名三个动词。**「选择」不在这一页**，理由见下一行 |
| P2-02-03 注入写作上下文 | `src/lib/ai-writing.ts`（`AiWritingBrand` + 两个 prompt 构建器接受 `brand`）、`src/app/api/ai-writing/generate/route.ts`（透传 `config.brandId`）、`src/lib/article-generation.ts`（`getBrand(request.brandId)` → **同一条记录**同时喂给 system 与 user prompt） | 品牌名称 / 简介 / 目标受众 / 语气与**合并后的禁用词**进 system prompt，受众与关键词进 user prompt；禁用词是「定位 ∪ 品牌」去重后的一个列表（`uniqueWords`），不是两份。选择发生在向导的「写作配置」步（`ai-writing-step-config.tsx`，选中后 `brandContextSummary` 显示将被注入的内容，`ai-writing-step-output.tsx` 在生成摘要里回显品牌名） |
| P2-02-04 保留引用或版本 | `src/lib/article-generation.ts` 写 `metadata.brandId` + `metadata.brandVersion` | `brandVersion` ＝品牌行的 `updatedAt`，**不复制字段副本**：文章只存一个数字，「生成后品牌被编辑过」＝两个数字的比较 |
| P2-02-05 不串用其他品牌 | `src/lib/ai-writing.test.ts`、`src/lib/article-generation.test.ts`、`src/app/api/ai-writing/generate/route.test.ts`、`src/db/repositories/brands.test.ts`、`src/app/api/brands/*/route.test.ts` | 每个涉及品牌的测试都建**两个**品牌（Clipversity / 绿源海鲜），断言只出现被选中的那一个：未知 id＝无品牌（不回退）、编辑只改给到的列、删除只删品牌行 |

界面与文案：导航「创作 → 品牌资料」（`src/components/console-layout-shell.tsx:125`，key `navBrands`）；三份语系各新增 **29** 个 key（`navBrands` 1 + `bd*` 23 + `awBrand*` 5），三文件计数一致。

### 2. 调用链路

1. **新增 / 编辑 / 删除**：品牌页表单（或行内删除按钮）→ `POST /api/brands` / `PATCH` · `DELETE /api/brands/{id}` → `brandInputSchema` / `brandPatchSchema` → `createBrand` / `updateBrand` / `deleteBrand` → `brands` 表 → `mutate()` 刷新列表。`PATCH` 用**没有默认值**的 schema，所以「只改语气」不会把关键词清空。
2. **选择**：AI 写作向导「写作配置」→ `GET /api/brands`（`useSWR`）→ 下拉写入 `config.brandId`（空字符串＝「不使用品牌资料」，也是所有旧客户端的默认值）。
3. **注入与落库**：`POST /api/ai-writing/generate`（带 `config.brandId`）→ `generateArticle()` → `getBrand(id)` → 同一记录构建 system prompt（品牌身份 + 合并禁用词）与 user prompt（受众 + 关键词）→ 文章 `metadata.brandId` / `metadata.brandVersion`。
4. **追溯**：品牌被改名或删除后，文章仍带着当时的 id 与版本号（`DELETE` 只删品牌行，不动文章）；本卡界面只做到「摘要回显当前品牌名」，见 §4 第 3 条。
5. **未接的一条**：`POST /api/content/generate`（旧文章生成入口）在请求里固定 `brandId: ""`，即按原样写「无品牌」；接线属于 CI-P2-03。

### 3. 本轮真实执行的验证

| 命令（真实执行） | 结果 |
| --- | --- |
| `node_modules\\.bin\\tsc.cmd --noEmit` | `TSC_EXIT=0` |
| `vitest.cmd run src/lib/brands.test.ts src/db/repositories/brands.test.ts src/app/api/brands src/lib/ai-writing.test.ts src/lib/article-generation.test.ts src/app/api/ai-writing/generate/route.test.ts src/app/api/content/generate` | **8 文件 / 55 用例全绿**（brands 纯函数 5、仓层 6、`/api/brands` 5、`/api/brands/[id]` 6、`ai-writing` 9、`article-generation` 9、向导生成路由 9、旧生成路由 6） |
| `vitest.cmd run`（全量） | **114 文件 / 808 用例全部通过，0 failed**（26.15s；最近一次全量记录见附录 B-4 的 103 文件 / 726 用例，本卡 +11 文件 / +82 用例） |
| `eslint`（26 个改动 / 新增文件，路径逐条列出） | `ESLINT_EXIT=0`。注：`.cmd` shim 在含 `[locale]`、`(console)` 的路径上会被 cmd.exe 误解析，故经 `node node_modules/eslint/bin/eslint.js` 调用 |
| `GET http://127.0.0.1:3000/api/brands`（工作区里已在跑的 `next dev`，**真实工作区数据库**） | **200 `{"ok":true,"data":[]}`**：新路由在开发态真实可调用，且真实工作区当前 0 条品牌（诚实空列表，不是伪造数据） |
| `GET /zh-cn/creation/brands`（同上） | **200**，HTML 带 `品牌资料`（导航 + 页名）、`新增品牌`、`搜索品牌资料…`、空态文案 |
| `GET /creation/brands`（同上） | **307** → `/zh-cn/creation/brands`（既有语系重定向，与新页面不冲突） |
| `GET /zh-cn/creation/ai-writing`（同上） | **200**，HTML 带 `不使用品牌资料`、`awBrandHint`、`管理品牌资料`：品牌下拉在服务端渲染阶段就存在（不是只在客户端出现） |
| `GET /api/workspace/manifest`（同上） | `tableCount=31`（**29 张 schema 声明表** + 既有的 `ai_providers`、`sites`），`unknownTables` 仍只有那两张——新表 `brands` 是**已声明**的，不是被报为「本版本读不懂」的表 |
| 直连只读查询 `sqlite_master`（`@libsql/client`，只发 `select`） | `brands` 表存在；DDL 与 `schema.ts` 一致（`keywords_json` / `banned_words_json` 默认 `'[]'`）；`select count(1) from brands` = **0** |

测试要点（各钉一条契约，不是重复断言）：`brandPatchSchema` 不含默认值（局部编辑不清空未提供的列）；`brandInputSchema` 拒绝空名称；`GET /api/brands/{id}` 对不存在的 id 给 404（不是空对象）；未知 `brandId` ＝无品牌（不回退到默认品牌）；`brandVersion` 随品牌编辑而变化、删除品牌后文章仍保留原 id / version；`content/generate` 仍写 `brandId: ""`（旧入口行为未变）。

### 4. 已知限制与未完成项（不标记为「完整通过」）

1. **两条生成入口只接上了一条**：写作向导（`/api/ai-writing/generate`）可以选择品牌；`/api/content/generate` 固定 `brandId: ""`。把它接上是 **CI-P2-03**（卡片 3 的「串联选题、品牌资料、文章生成和编辑」）。
2. **没有默认品牌**：`brandId` 缺失或指向已删除的品牌＝「不使用品牌资料」，不回退到列表第一条。这是 P2-02-05 的刻意选择（写入别人品牌的文章是唯一的禁区），测试已钉住；代价是旧客户端（不带 `brandId`）不会有品牌上下文。
3. **没有「品牌被改过 / 已被删除」的界面提示**：文章确实记了 `brandId` + `brandVersion`，但文章列表与编辑器还没把它渲染成「此文章的品牌已更新」之类的提示。卡片只要求保留信息以便追溯，可延后。
4. **界面与真实模型调用未做手工核对**：本卡验证止于契约 / 单元 / 路由测试，加上上面的开发态 HTTP 读检查（200、空列表、HTML 关键字）。**没有**在界面上真的点过「新增品牌 / 编辑 / 删除」，也**没有**用真实模型跑过一次带品牌的生成；这些留给 CI-P2-03 联调与集中回归（CI-P2-05/CI-P6）。
5. **`docs/data-model-inventory.md` 仍是 27 张表时期的快照**：P2-01 的 `topics`（第 28 张）与本卡的 `brands`（第 29 张）都未回填；本文档 §附录 A-1 的「29 张」也已加注说明。`docs/menu-inventory.md` 已更新：新增「创作 → 品牌资料」叶子、叶子数 28 → 29，并按当前文件复核了全部 `file:line`（含 CI-P2-02 的 +1 import / +1 叶子两次偏移）。
6. **真实工作区数据库的变化只有 schema**：工作区里在跑的 `next dev` 已按新代码建出空表 `brands`（`/api/workspace/manifest` → `tableCount=31`；`select count(1) from brands` = 0），`GET /api/brands` 返回空列表——没有写入任何数据、没有改动任何既有表；本轮对真实库执行的全部是 `select`。**未**执行 `git add` / `git commit`，也未触发任何真实平台发布。
7. **工作区残留物**：本轮无新增探测脚本。验证用的临时文件（`tmp-brands-db-check.mjs` 与两个 HTML 导出）在验证后已删除，未留在工作区。


## 附录 B-7：CI-P2-03 整合文章创作流程交付记录（done，2026-10-09）

> 卡片完成标准（原文）：从选题到文章、图片、保存和重新编辑，形成可重复操作的闭环。以下每条都是本轮真实执行的结果；没有运行的项目在 §4 明确标注。

**事实边界（先说清楚本卡不是什么）**：本卡**没有**新建第二个文章编辑器、第二套图片存储、第二个生成框架或新页面。它做的是把已有零件接上：`POST /api/content/generate`（旧文章/动态/视频生成入口）此前在请求里写死 `brandId: ""`（B-6 §4 第 1 条），现在真正读取调用方选择的品牌与选题；两个生成入口的「选题 / 品牌」选择收敛到一个共用组件；生成结果沿用既有的 `?edit=<id>` 交接进入既有编辑器。**没有 Schema 迁移、没有动 `content_items` 表结构、没有改发布契约、没有动 `api/ai-writing/generate` 的既有行为。**

### 1. 交付内容（对照 §5 卡片子项 P2-03-01 … 06）

| 子项 | 落点 | 说明 |
| --- | --- | --- |
| P2-03-01 串联选题、品牌资料、文章生成和编辑 | `src/lib/validation.ts`（`contentGenerateSchema` 新增 `brandId` `:98` / `topicId` `:105`，两字段的注释写明「空串＝未选择」「未知 id＝无品牌、无选题，绝不回退」）；`src/app/api/content/generate/route.ts`（读选题 `:80`、`materialTextOf()` `:31-40`、`config.brandId` `:99`、`material.freeText` `:106`、`request.brandId` `:116`、`provenance.topicId` `:130`、回写选题关联 `:140`）；`src/components/creation/generation-source-selects.tsx`（**新增**，116 行，选题库 + 品牌资料两个下拉）；`src/components/creation/article-ai-dialog.tsx`（`:81-82` 状态、`:114-115` 随请求发出、`:143` 选择器）；`src/components/generate-content-panel.tsx`（`:32-33`、`:104`、`:59-62`） | 品牌**不是只传 ID**：`generateArticle()` 一直是按 id 读 `brands` 行、用**同一条记录**构建 system prompt（名称/简介/受众/语气/合并禁用词）与 user prompt（受众/关键词）（B-6 §1）。本卡补的是「谁把 id 传下去」＋「选题也照样读」。选题在旧入口里不再是纯 provenance：`getTopic()` 读出的行，其描述/关键词/来源会成为素材（措辞与向导第 1 步的 `topicMaterialText` 完全一致，P2-01-04），其来源页成为唯一可用的配图来源页；未知/已删的选题 id **不写入** provenance，文章因此不会认领一个它没读到的选题。**界面归属**：`ArticleAiDialog` 挂在有页面的 `/creation/articles`（文章创作）上；`GenerateContentPanel` 属 F-C0-7 记录的**孤立创作面**（`content-type-workspace.tsx` 引用它，而该文件自身没有任何页面引用），改动随组件保留，但今天没有页面能点到它 |
| P2-03-02 串联图片生成、图片选择、封面选择与文章关联 | 既有链路复用：`src/lib/article-images.ts`（生成期配图）、`src/components/creation/article-editor/article-editor.tsx`（图片库选图 / 设封面 `pickCover` / 正文插图 `insertImage`）、`src/lib/content-images.ts`（`metadata.images` 为事实来源，`imagePath` 为封面镜像） | 本卡**未新增**图片实现，只把「选题的来源页」接进了既有的 `imageSources.sourceUrls`（`:111`），使生成期图片解析与文章 `sourceUrls` 多一个真实来源（旧入口以前传空数组）。封面与正文图片的引用格式（`metadata.images` 有序列表 + `imagePath`）零改动，编辑器保存路径零改动——配图这一环是「验证仍通」，不是「重做」 |
| P2-03-03 保持现有文章编辑器的保存格式和历史正文兼容性 | 无代码改动即为交付：`src/app/api/content/[id]/route.ts` 的 `PATCH` 把 `themeId` 与 `images` 交给 `mergeContentMetadata()`（`src/lib/content-images.ts`）**合并**写入，而不是整块覆盖 `metadata` | 这条是本卡最容易被改坏的一条：编辑器保存只写它自己拥有的字段（标题/正文/可发布文本/图片/主题/状态），而「这篇文章由哪个选题、哪个品牌生成」存在 `metadata` 里。既有实现是合并语义，本卡的测试把它钉住（§3 第 3 行），所以「编辑一下就把来源擦掉」不会发生 |
| P2-03-04 统一展示生成状态、失败原因和可重试入口 | 既有实现，本卡未新增界面：失败经 `failFromError()` 原样带运行时的 code + status（`MODEL_CREDENTIAL_MISSING` 400 / `MODEL_UPSTREAM_FAILED` 502），对话框/面板沿用既有失败文案（`awGenerateFailed`），重试＝同一个按钮再点一次 | **部分完成**，见 §4 第 1 条：没有做「统一的生成状态中心 / 一键重试入口」 |
| P2-03-05 支持保存草稿、重新打开和继续编辑 | 既有 `ArticleEditor` + `?edit=<id>`（`src/lib/editor-link.ts`）+ `GET/PATCH /api/content/[id]`，本轮为其补了 PATCH 的来回测试（`src/app/api/content/[id]/route.test.ts:94` 起两个用例） | 「重新打开」＝列表行或生成结果 → `?edit=<id>` → 编辑器就地打开（`articles-workspace.tsx` 读参数后 `GET /api/content/{id}`），保存走 `PATCH`。本卡把这条从「代码上存在」提升为「有测试钉住的往返」 |
| P2-03-06 避免重复点击造成重复创建文章或重复提交同一个任务 | 既有实现：`Button` 的 `loading` 直接 `disabled`（`src/components/ui/button.tsx:46`），两个入口的生成按钮都带 `loading` 态 | **部分完成**，见 §4 第 2 条：挡的是同一页面内的连点，**没有**服务端幂等键（同一请求重发仍会生成第二篇） |

**界面与文案**：三份语系各新增 **2** 个 key（`genTopicLibrary` / `genTopicLibraryNone`，用于共用的「从选题库选择」下拉），三文件计数一致（`src/lib/i18n-coverage.test.ts` 校验）。品牌侧文案复用既有 `awBrand*` 五个 key，未新增。**没有新增导航叶子、没有新增页面**。

### 2. 调用链路（真实实现的形状）

1. **选择**：文章创作页（`/creation/articles`）的 AI 生成对话框（`ArticleAiDialog`）→ 共用的 `GenerationSourceSelects` → `GET /api/topics` + `GET /api/brands`（各一次列表读取）→ 选中后 `topicId` / `brandId` 进入请求；选题还会把**它的标题**预填进用户可见的主题输入框，其余字段由服务端读取。同样的选择器也挂在 `GenerateContentPanel` 上（该组件见 §1 的孤立面说明）。
2. **生成**：`POST /api/content/generate`（body 新增 `topicId` / `brandId`，缺省为空串，旧客户端行为不变）→ `contentGenerateSchema` 校验 → `getTopic(topicId)`（为空则不查库）→ 素材 = 选题行字段（`topicMaterialText` 措辞）+ 用户改过的主题（没改则不重复）+ 补充说明 → `config.brandId` 带进 `aiWriting` 摘要。
3. **落库**：`generateArticle({ positioningId, brandId, config, material, imageSources, provenance })` → `getBrand(brandId)`（未知 id＝无品牌，不回退）→ 同一条品牌记录构建两个 prompt → `aiRuntime.chatStructured` → 图片解析（选题来源页此时在 `sourceUrls` 里）→ `content_items` 行（`metadata` 里 `topicId` / `brandId` / `brandVersion` / `aiWriting` / `images`）→ `usage_records` 行。
4. **回写关联**：文章已提交之后，`linkTopicContentItem(topicId, item.id)` 把选题指向这篇文章（失败只 `console.warn`，不让已落库的文章变成错误）——与 `api/ai-writing/generate` 同一顺序、同一取舍。
5. **编辑与配图**：生成结果 → `articleEditorHref(locale, id)`（`?edit=<id>`）/ 对话框直接把 item 交给工作区 → `articles-workspace` 读参数 → `GET /api/content/{id}` 回读 → `ArticleEditor` 改稿、选图/设封面（`ArticleImageDialog` + `metadata.images`）→ `PATCH /api/content/{id}` 合并保存 → 重新打开仍是同一份带来源的文章 → 「发布」走既有 `ContentPublishDialog`（本卡未改发布契约）。
6. **沿用而非新建**：图片事实来源仍是 `content_items.metadata.images`；任务/用量仍写既有表；品牌与选题的读接口仍是 P2-01 / P2-02 的 `GET /api/topics` `GET /api/brands`，没有为生成流程新开读接口。

### 3. 本轮真实执行的验证

| 命令 / 动作（真实执行） | 结果 |
| --- | --- |
| `node_modules\\.bin\\tsc.cmd --noEmit` | `TSC_EXIT=0` |
| `vitest.cmd run src/app/api/content src/app/api/ai-writing src/lib/topics.test.ts src/lib/ai-writing.test.ts src/lib/article-generation.test.ts src/lib/i18n-coverage.test.ts` | `VITEST_EXIT=0`，**11 文件 / 87 用例全绿** |
| `vitest.cmd run src/app/api/content/generate/route.test.ts` | **9 用例**（原有 6 + 本卡 3：读品牌与选题并落库、品牌间不串用、无品牌/无选题与已删行的显式语义） |
| `vitest.cmd run "src/app/api/content/[id]/route.test.ts"` | **5 用例**（原有 3 + 本卡 2：保存改动且不丢来源、无此 id 给 404） |
| `vitest.cmd run`（全量） | **114 文件 / 813 用例全部通过，0 failed**，Duration 42.17s（基线见 B-6：114 文件 / 808 用例；本卡 +5 用例、无新增测试文件） |
| `node node_modules/eslint/bin/eslint.js src/lib/validation.ts src/app/api/content/generate/route.ts src/app/api/content/generate/route.test.ts src/app/api/content/[id]/route.test.ts src/components/creation/generation-source-selects.tsx src/components/creation/article-ai-dialog.tsx src/components/generate-content-panel.tsx` | `ESLINT_EXIT=0`（注：含 `[id]` 的路径经 `.cmd` shim 会被 cmd.exe 误解析，故用 node 直接调用） |
| 真实调用（工作区里已在跑的 `next dev`，`127.0.0.1:3000`，**真实数据库**）：`POST /api/brands` → `POST /api/topics` → `POST /api/content/generate`（带 `brandId` + `topicId`）→ `GET /api/topics/{id}` → 三条 `DELETE` | `201 / 201 / **201**`；文章 `metadata` 实测 `brandId` ＝刚建的品牌、`brandVersion` ＝其 `updatedAt`、`topicId` ＝刚建的选题、`aiWriting.brandId` ＝同一个 id、`sourceUrls` ＝ `["https://example.com/ci-p2-03-verify"]`（选题来源页）、`generationType` ＝ `"topic"`；选题行 `contentItemId` ＝ 该文章 id（**关联真实落库**）；清理后 `GET /api/content` 总数回到 **18**、`/api/topics` 与 `/api/brands` 均回空数组 |
| 直连查询（`@libsql/client`，`web-data/social-auto-post.db`，只发 `select` + 按 id 定点 `delete`） | 开工前后一致：`content_items` = **18**、`usage_records` = **16**；三条由本轮真实调用产生的 `usage_records`（`content_item_id` 恰为那三篇验证后已删的文章）已按 id 精确删除 |

**测试要点（各钉一条契约）**：无品牌时 Prompt 不含任何品牌行；选中品牌 A 时 system prompt 等于「同一 agent 前缀 + 由该品牌构建的文章规则」（整串比对，不是包含关系），且 `metadata.brandId` / `brandVersion` 落到该品牌；切到品牌 B 时 A 的名称/语气/禁用词/关键词在本轮**完全不出现**；`topicId` 命中时描述/关键词/来源进入素材、`metadata.topicId` 与选题行 `contentItemId` 双向可查；`brandId`/`topicId` 指向不存在的行时文章照样生成、`metadata.brandId` 为空且**不写** `topicId`（而 `aiWriting.brandId` 如实保留调用方的选择，两者可区分）；编辑器 `PATCH` 只改自己的字段、`metadata` 里的来源与 `sourceUrls` 原样保留且封面跟随图片列表首项。

### 4. 已知限制与未完成项（不标记为「完整通过」）

1. **P2-03-04 只做到一半**：失败原因沿用运行时的 code / status 与既有文案（`awGenerateFailed`），**没有**卡片所说的「统一展示生成状态、失败原因和可重试入口」。留待 CI-P5-01 创作闭环或 CI-P6。
2. **P2-03-06 只做到客户端一半**：`Button` 的 `loading` 会 `disabled`（`src/components/ui/button.tsx:46`），同页面连点不会重复提交；但**没有服务端幂等键**，同一份请求被重发仍会生成第二篇。需要幂等键时应与 CI-P4 / 任务幂等一起做。
3. **两条入口的「选题」语义不同，且是有意的**：向导的 `topicId` 是纯 provenance（文本已随 `freeText` 走，见 B-5），旧入口的 `topicId` 会被服务端**读行**（描述 / 关键词 / 来源进 Prompt）。两者各自都满足「用户看到什么＝模型收到什么」，统一它们属于后续重构，本卡不做。
4. **未知 / 已删除的 `topicId` 不写 provenance**：好处是文章不认领它没读到的选题，代价是「从某选题进来、但该选题在生成前被删」的痕迹只剩素材文本。已由测试钉住（`src/app/api/content/generate/route.test.ts:686`）。
5. **两个生成界面的下拉无法用抓 HTML 证明**：`Dialog` 在 `open=false` 时直接返回 `null`（`src/components/ui/dialog.tsx:52`），所以新下拉不在服务端 HTML 里；页面级检查止于「200 / 客户端产物可编译」，真正的点击级验证留给 CI-P6-02 浏览器回归。仓库没有 `*.test.tsx`，本轮未引入组件测试设施。
6. **图片环节是「验证仍通」而非新增**：生成期配图依赖可用的图片模型，本机在 B-3 已记录「无可用图片模型」→ 结构化失败。本卡既没有伪造图片生成成功，也没有因图片受阻而停下文章闭环。
7. **`docs/data-model-inventory.md` 只做了有界回填**：更新了规模数字（29 表 / `schema.ts` 423 行 / `client.ts` 586 行 / 20 个仓储文件）并补上 `topics`、`brands` 两行（行号按现文实测），同时写明「其余 `file:line` 未逐条复核」的漂移警示。全文行号复核仍是欠账。
8. **一次被测试抓到的假性通过（已修）**：新用例第一版拿「品牌 A 的禁用词」做隔离断言，而那个词（`最强`）恰好也在**定位 fixture** 的禁用词里，于是「品牌 A 的词不该出现在品牌 B 的请求里」假性失败——负向断言必须钉该对象**独有**的标记，而不是任何地方都可能出现的字符串。已改用品牌独有的 `硬广腔`。
9. **两个生成面里只有一个有页面**：`ArticleAiDialog` 挂在 `/creation/articles`，可点到；`GenerateContentPanel`（以及引用它的 `content-type-workspace.tsx`）是审计 F-C0-7 记录的孤立创作面，`src` 内没有任何页面引用它们。本卡给两者都接上了选择器（共用组件，成本相同），但**只有文章对话框是今天真实可达的入口**；要不要复活或删除这两个孤立面不属于本卡范围。

### 5. 工作区与数据库留痕（透明记录）

- **未**执行 `git add` / `git commit`；**未**覆盖或丢弃任何既有未提交改动。
- **未**执行真实平台发布，**未**启动 worker，**未**处理任何既有队列。
- **真实数据库本次确有写入**（与 B-6 的「全程只读」不同，必须说明白）：为验证真实链路，本轮通过应用自身 API 建过 1 个品牌 + 1 个选题，并生成过 3 篇文章（1 次无品牌/无选题冒烟、1 次带品牌与选题的完整验证、1 次编码探测）。这些随后**全部**删除：3 篇文章经 `DELETE /api/content/{id}`、选题与品牌各自经 `DELETE /api/topics/{id}` / `DELETE /api/brands/{id}`；3 条 `usage_records` 因为没有删除接口，用 `@libsql/client` 按 `content_item_id` 精确删除。收尾核对：`content_items` = **18**、`usage_records` = **16**（均回到开工前数值），`topics` / `brands` 回到空列表。除此之外对真实库没有别的写操作。
- 临时物：`tmp-p2-03-live-check.mjs`、`tmp-p2-03-usage-check.mjs`、`tmp-p2-03-usage-tail.mjs`、`tmp-vitest-p2-03.log` 验证后已删除；工作区里原有的 `tmp-*` 探测脚本与日志（属早前批次）未动、未清理。

### 6. 下一步

CI-P2-04（内容生命周期与日历）与本卡的接口已就绪：文章与选题/品牌的关联写在 `content_items.metadata` 与 `topics.content_item_id` 上，排期/生命周期只需读这两处，不必新增关系表；发布成功契约（C2）不在本卡范围，也未被改动。

---

## 附录 B-8：CI-P3-01 研究素材管理与创作流程集成交付记录（done，2026-10-09）

### 1. 交付内容（对照 §6 卡片子项 P3-01-01 … P3-01-06）

| 子项 | 交付物 | 落点 |
| --- | --- | --- |
| P3-01-01 存储与引用 | 新表 **`research_materials`**（14 列）：`kind` / `content` / `source_url` / `status` / `status_message` / `image_url` / `file_name` / `tags_json` / `fetched_at` | `src/db/schema.ts:424-450`；建表语句 `src/db/client.ts:227-243`（沿用既有「`ensureDatabase` + `CREATE TABLE IF NOT EXISTS`」的无迁移风格，`src/db/migrations/` 仍不存在） |
| P3-01-02 CRUD API | `GET/POST /api/research`、`GET/PATCH/DELETE /api/research/{id}`、`POST /api/research/{id}/fetch`（读取来源）、`POST /api/research/upload`（导入本地文件） | `src/app/api/research/**`（4 个 handler + 4 个测试文件；`route.test.ts`、`[id]/route.test.ts`、`[id]/fetch/route.test.ts`、`upload/route.test.ts`） |
| P3-01-03 管理页面 | `/creation/research`「研究素材」：列表（搜索 + 处理状态筛选 + 计数）、新建/编辑对话框、导入文件、读取来源、删除；列＝素材（标题 + 正文预览 + 标签 + 来源页缩略图）/ 类型 / 来源 / 处理状态 / 更新时间 / 操作 | `src/components/creation/research-workspace.tsx`、`research-form-dialog.tsx`、`src/app/[locale]/(console)/creation/research/page.tsx` |
| P3-01-04 接入创作 | `POST /api/content/generate` 新增 `researchMaterialId`：**服务端读取该行**，把素材**正文**并入生成素材（与 `topicId`、`brandId` 同一套「只传 id、由服务端读行」的契约）；`metadata.researchMaterialId` + `researchMaterialVersion` 记录读的是哪一行、哪一版 | `src/app/api/content/generate/route.ts`、`src/lib/validation.ts:107-113`、`src/lib/research.ts` 的 `researchMaterialPromptText()` |
| P3-01-05 来源与配图 | 素材的 `sourceUrl` 进入 `imageSources.sourceUrls` → 同一次运行内送给图片解析器（`web`/`mixed` 策略会读同一页的 `og:image`），并落到 `content_items.source_urls_json`；**只在素材确实贡献了正文时才带上** | `src/lib/research.ts` 的 `researchMaterialSourceUrls()`（内联测试 `src/lib/research.test.ts`） |
| P3-01-06 定向测试与回归 | 新增 6 个测试文件（43 用例）+ 扩展现有生成入口用例（+5）；全量 **120 文件 / 861 用例通过**；`tsc --noEmit` 退出码 0 | 见 §4 |

**新增 15 个文件**（含 6 个测试文件）+ **改动 18 个既有文件**（生成入口与其测试、共享选择器、两个创作面、导航壳、三份语系、四份文档）。

### 2. 存储决策：先复用检查，再新增一张表（P3-01-01）

卡片要求「优先复用现有表，只有现有结构确实无法表达必要信息时才新增 Schema」。逐项检查后新增 `research_materials`，理由与落点如下：

| 候选结构 | 结论 | 依据 |
| --- | --- | --- |
| `knowledge_base` | **最近，但无法表达处理状态** | 它有正文 / 分类 / 权重 / `origin` / `tags_json` / `source_url` / `file_name`，是「素材库」的现成形状，本卡的仓储 / API / UI 都照它写；但它**没有**「来源读取到哪一步」的列——`origin` 说的是*怎么进来的*（manual / ai / file / product），不是*读没读到*。把 `failed` / `empty` 塞进 `tags_json` 会是「用一个自由字段撒谎」，故不采用 |
| `content_items` | 拒绝 | 它是「可发布的内容」，混入研究素材会污染文章列表、指标与发布链路（`schedules` / `publish_records` 都指向它） |
| `topics` | 拒绝 | 选题是**主题**（想法），没有正文语料；把资料正文塞进 `description` 会同时破坏选题列表的语义与 `topicMaterialText` 的口径 |
| `products` / `brands` | 拒绝 | 用途专用的资料库，字段集与「任意外部资料」不匹配 |
| artifacts / media 文件 | 拒绝 | 素材是磁盘文件与目录约定（§3.4 / §5），没有可挂状态的元数据行 |

→ 结论：**只新增一张表，且只为状态**。`status` / `status_message` / `fetched_at` 三列是本表存在的理由；其余列都对齐 `knowledge_base` 既有形状（`title` / `content` / `source_url` / `file_name` / `tags_json` / 时间戳）。**无字段迁移**：老库只需多一条 `CREATE TABLE IF NOT EXISTS`。

**状态语义（本卡的核心口径，写在 `src/lib/types.ts` 与 `src/lib/research.ts`）**

| `status` | 含义 | 谁能写 |
| --- | --- | --- |
| `draft` | 待读取：有来源连结但从未读取过，且当前没有可写正文 | 创建/编辑（由「有没有正文」推导，见 `derivedResearchStatus`） |
| `ready` | 正文就绪：记录里有可用正文。**是否来自来源读取由 `fetchedAt` 回答**（有＝读到；无＝用户自己填的） | 创建/编辑或一次成功读取 |
| `empty` | 读取成功，但页面没有可用正文（原正文保留） | **只有** `POST /api/research/{id}/fetch` |
| `failed` | 读取失败；原因存 `status_message`；`content` 与 `fetchedAt` 都不动 | **只有** `POST /api/research/{id}/fetch` |

`PATCH` 的 schema 里**根本没有** `status` / `statusMessage` / `fetchedAt` / `imageUrl`，所以任何浏览器负载都无法声明「抓取成功」；唯一会移动读取状态的是「更换来源连结」——此时读取事实被清空（`fetchedAt: null`、原因清空），状态回到「有正文就 `ready`、没有就 `draft`」，**但已存的正文永不因此被丢掉**（读取新来源才是覆盖它的动作）。

### 3. 调用链路（真实实现的形状）

```
写入（用户）
  /creation/research 新建/编辑对话框 ─ POST /api/research ─┐
  工具栏「导入文件」 ───────────────── POST /api/research/upload ─┤
                                                              ├─► db/repositories/research.ts ──► research_materials
  行内「读取来源」 ───── POST /api/research/{id}/fetch ────────┘        （四个动词 + recordResearchFetch）
        └─► lib/scraper.ts 的 fetchArticleText()   ← 与 /api/content/import-url 同一个读取器
              ├─ 有正文 → status=ready, content=页面正文, fetchedAt=now
              ├─ 无正文 → status=empty（原正文保留、fetchedAt 仍记这次成功读取）
              └─ 抛错   → status=failed, status_message=原因（content / fetchedAt 不动）

读取（生成）
  /creation/research 行内「用此素材创作」 → /creation/articles?researchMaterialId={id}
        └─► articles-workspace 读取该参数 → 带素材打开 ArticleAiDialog（参数消费一次即从 URL 移除）
              └─► POST /api/content/generate { researchMaterialId, topicId, brandId, ... }
                    ├─ getResearchMaterial(id)            ← 读行，不信任 id
                    │    └─ id 不解析 → 404 NOT_FOUND（不生成、不降级、也不换成别的素材）
                    ├─ researchMaterialPromptText(row) → material.freeText
                    │    └─ generateArticle() → buildArticlePrompt() → aiRuntime.chatStructured()
                    │          （systemPrompt 里是定位 + 品牌；素材在 user prompt 的「可用素材」段）
                    ├─ researchMaterialSourceUrls(row) → imageSources.sourceUrls
                    │    └─ resolveArticleImages()（web/mixed 策略读同一页 og:image）
                    │    └─ content_items.source_urls_json（文章的来源列表）
                    └─ createContentItem({ metadata: { researchMaterialId, researchMaterialVersion, ... } })

读取（编辑器）
  GET /api/content/{id} → 标题/正文/来源 + metadata（含 researchMaterialId）
  PATCH /api/content/{id} → 改标题/正文/图片；metadata 走既有 merge 语义，素材来源不会被保存动作抹掉
```

三个「面」共用一份契约：库页面（写）、文章创作 AI 对话框（读）、孤立面 `GenerateContentPanel`（读，同样是 `GenerationSourceSelects` 的调用方）——所以「一次生成到底读了哪些已存对象」在两侧不可能各说一套。

### 4. 本轮真实执行的验证

**定向测试**（`node_modules\.bin\vitest.cmd run …`，串行执行，未并行）

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| `src/lib/research.test.ts` | 10 | `研究素材：/来源：/正文：` 三段口径；无正文时**不写 `正文：`**；6000 字上限；`researchMaterialSourceUrls` 的「贡献了正文才算来源」；`derivedResearchStatus` 只推导 ready/draft；搜索字段；创作深链与参数回读 |
| `src/db/repositories/research.test.ts` | 8 | 手写正文=ready / 未读取=draft；列表新→旧；编辑不动读取事实；`recordResearchFetch` 的 ready / empty / failed 三种写入（含「失败不清正文、不挪 `fetchedAt`」）与「行已删→null」 |
| `src/app/api/research/route.test.ts` | 8 | 列表；创建（文本 = ready、网页无正文 = draft）；省略 `kind` 的推导；`kind:url` 无连结 / 空标题 / 未知 kind → 400 且不写；**负载自称 `status/statusMessage/fetchedAt` 一律被忽略**；非 JSON → 400 |
| `src/app/api/research/[id]/route.test.ts` | 8 | GET/404；编辑只改给到的字段；**负载不能写任何读取事实**；换来源连结 → 读取事实清空但正文保留；无正文时换连结 → 仍 draft；空标题 400；删除 + 二次删除 404 |
| `src/app/api/research/[id]/fetch/route.test.ts` | 6 | 页面有正文 → ready + `og:image` + `fetchedAt`；页面无正文 → empty 且原正文保留；HTTP 404 → failed + `HTTP 404`；传输层抛错 → failed + 原因（不逃逸成 500）；无连结素材 → 400 **且不发起任何请求**；行不存在 → 404 |
| `src/app/api/research/upload/route.test.ts` | 3 | txt → file 素材（标题去扩展名、`fileName` 保留、正文即文件正文）；空白文件 → `empty` 素材（不是静默失败）；mp4 / 无文件 / 空文件 → 400 且不写 |
| `src/app/api/content/generate/route.test.ts` | +5（共 14） | 素材正文进 prompt（并记 `researchMaterialId` + 版本 + 来源页）；未读取素材 → 有标题与来源、**无 `正文：`**、无图源；选题+品牌+素材三者同时生效（两个来源页都在 `sourceUrls`）；id 不存在 → 404 且**不写文章、不记账、不调模型**；老客户端不传字段 → 行为与之前逐字一致 |

**全量回归**：`vitest run` → **120 文件 / 861 用例全部通过**（本卡开工前基线 114 / 813，即 +6 文件 / +48 用例；无既有用例被改动语义，只有生成入口用例按新契约扩展）。

**类型与静态检查**：`tsc --noEmit` 退出码 **0**；`eslint src electron scripts` 退出码 **0**（`src/**` 0 error；唯一一条 warning 在 `src/components/agent-chat/chat-conversation.tsx:146` 的 `react-hooks/exhaustive-deps`，该文件本卡未改动，属既有欠账）。整仓 `eslint .` 退出码 **1**：**3 errors + 同一条 warning**——3 条 error 是仓库根目录两个历史探测脚本 `tmp-probe-db.cjs`（1）与 `tmp-probe-zod-json-schema.cjs`（2）的 `@typescript-eslint/no-require-imports`，两文件都早于本卡存在、本卡未改动；本卡自己用过的两个临时脚本已在收尾时删除（见 §6）。

**真实 HTTP / 真实库冒烟**（dev server `127.0.0.1:3000` + `web-data/social-auto-post.db`，脚本 `tmp-p3-01-live-check.mjs`，日志 `tmp-p3-01-live.log`）

| 步骤 | 结果 |
| --- | --- |
| 开工前计数 | `content_items`=18 / `usage_records`=16 / `research_materials`=0 |
| `POST /api/research`（网页素材 + 手写正文 + 标签） | **201**，`kind=url`、`status=ready`、`fetchedAt=null`（没读却也不假装读了） |
| `PATCH /api/research/{id}`（改标题） | **200**，标题变、其余列与 `status`/`fetchedAt` 原样 |
| `POST /api/research/{id}/fetch`（真读 `https://example.com/`） | **200**，`status=ready`、`fetchedAt=1791561125090`、`content` 被替换成页面真实正文（「This domain is for use in documentation examples…」） |
| `POST /api/content/generate`（带 `researchMaterialId`，**真实模型调用**） | **201**；`sourceUrls=["https://example.com/"]`；`metadata.researchMaterialId`、`researchMaterialVersion=1791561125091` 与 row 一致；metadata 键序完整 |
| `GET` 后 `PATCH /api/content/{id}`（编辑器回读 + 保存） | 回读标题与 `researchMaterialId` 都在；保存新标题后 `researchMaterialId` 仍在（既有 merge 语义未被破坏） |
| `POST /api/content/generate` 带不存在的素材 id | **404** `NOT_FOUND`（`details` 说明「the selected research material no longer exists」）；三张表计数**未变** |
| 页面冒烟 `GET /zh-cn/creation/research` | **200**，HTML 内含导航标签「研究素材」 |
| 收尾清理 | `DELETE /api/content/{id}` 200（并按 `content_item_id` 删掉 1 条 usage）、`DELETE /api/research/{id}` 200 → 计数回到 **18 / 16 / 0**，`GET /api/research` = `[]` |

### 5. 已知限制与未完成项（不标记为「完整通过」的部分）

1. **只有一个创作入口有素材选择器。** 「研究素材」下拉挂在 `GenerationSourceSelects` 上，因此 `ArticleAiDialog`（`/creation/articles`，真实可达）与孤立面 `GenerateContentPanel`（审计 F-C0-7）都有；**三步式 AI 写作向导（`/creation/ai-writing`）没有加入该选择器**——它的素材输入仍是自由文本 / 产品 / 热点（`?topicId=` 照旧）。素材仍能进向导：库里「用此素材创作」把素材带进文章创作对话框。把选择器加进向导属下一步扩展，不影响本卡验收（卡片要求的「选择素材并把内容送入生成上下文」已在可达入口成立并有真实调用证据）。
2. **`status` 与 `fetchedAt` 必须一起读。** `ready` 只表示「有可用正文」：`ready + fetchedAt` 非空＝读到的正文，`ready + fetchedAt` 空＝用户自己填的正文（UI 显示「正文由你提供」）。这是一个文档级 + UI 提示级约定，表里没有单独的「来源是否读取过」布尔列。
3. **`empty` 的原因不落库。** 读取成功但页面没正文时 `status_message` 留空，由前端按状态标签（`rsStatusEmpty`）本地化表达；`failed` 才把读取器原话（如 `HTTP 404`、`socket hang up`）写进 `status_message`——那是技术事实，不适合翻译。
4. **读取器能力即 `fetchArticleText()` 的能力**：静态 HTML，去 `script/style/nav/header/footer/aside/form/iframe`，取 `<article>` → `<main>` → `<body>` 文本，正文截断 **12 000** 字符，只额外取 `og:image`。**不做 JS 渲染、不登录、不跟随需要交互的页面**；这类页面的结果是 `failed` / `empty`，不会被写成「已获取正文」。
5. **注入 prompt 的正文有 6 000 字符上限**（`researchMaterialPromptLimit`）。这是对 prompt 的有意约束，不是对记录的限制：库页面与 API 始终给全文；超限部分不进 prompt。文档化在 `src/lib/research.ts`。
6. **一次生成只读一个素材**（与「一个选题、一个品牌」一致）。多素材同时注入、素材合集、按相关性挑选都未实现。
7. **没有素材→文章的反向查询列。** 文章侧记得住（`metadata.researchMaterialId` / `researchMaterialVersion`），但「这条素材产出过哪些文章」需要扫 `content_items.metadata`；本卡**故意**没有加 `content_item_id`（`topics` 有，是因为选题列表要用它提供「打开文章」）。若 P3-03 需要该列表，再加列并回填。
8. **没有 RAG / 向量库 / Agent**：按卡片明确排除，本卡只做「把资料可靠送进现有链路」。
9. **服务端幂等键与统一生成状态/重试界面仍然没有**（沿用 §附录 B-7 §4 的欠账，本卡未扩大范围）。「读取来源」的按钮在读取中会禁用，这是**加载态**，不是幂等保障的声明。
10. **孤立面未处理**：`src/components/content-type-workspace.tsx` / `src/components/generate-content-panel.tsx` 仍无页面引用（F-C0-7）。本卡给它们接上了同一份选择器（成本相同、避免契约分叉），但**没有复活也没有删除**它们。
11. **未做真实浏览器点击验证**：页面级冒烟只到「`GET /zh-cn/creation/research` 返回 200 且含导航标签」，以及真实 HTTP 走通 API 全链路。前端交互（对话框、按钮、禁用态）由类型检查 + 组件复用既有约定覆盖，**没有** Playwright 点击证据。

### 6. 工作区与数据库留痕（透明记录）

- **未**执行 `git add` / `git commit`；**未**覆盖、丢弃或重置任何既有未提交改动。
- **未**真实发布内容，**未**启动 worker，**未**处理任何既有队列。
- **真实数据库本轮有写入，且已全部回滚**：冒烟建过 1 条研究素材、1 篇文章与它对应的 1 条 `usage_records`，随后经应用自身 API 删除内容与素材、按 `content_item_id` 删除 usage 记录；收尾计数 `content_items`=18、`usage_records`=16、`research_materials`=0（均与开工前一致）。**迁移是「建表」而非改列**：`CREATE TABLE IF NOT EXISTS`，老库无需重建。
- 临时物：`tmp-p3-01-live-check.mjs`、`tmp-p3-01-live.log`（验证后删除）、本卡用过的读取助手 `tmp-show.cjs` / `tmp-locale-lines.cjs`（删除）；工作区里原有的历史 `tmp-*` 脚本与日志未动、未清理。

### 7. 下一步

CI-P3-02（音视频转录）与 CI-P3-03（研究摘要与结构化提炼）可直接接在本卡上：转录/摘要产出的文本就是 `research_materials.content` 的另一种来源（`kind` 可扩 `audio` / `video`，或复用现有媒体任务把结果写成一条素材），生成侧不需要任何改动——`researchMaterialPromptText()` 只认「标题 + 来源 + 正文」。若要「摘要后再入 prompt」，只需写入 `content` 的新值并让 `researchMaterialVersion` 继续记版本即可。

若要补本卡的限制：把选择器加进 AI 写作向导（同 `GenerationSourceSelects`）、给素材加「产出文章」反向列（P3-03 若有列表需求）。

## 附录 B-9：CI-P3-02 音视频转录交付记录（partial，2026-10-10）

### 1. 交付内容（对照 §6 卡片子项 P3-02-01 … P3-02-07）

| 子项 | 交付物 | 落点 |
| --- | --- | --- |
| P3-02-01 建立转写任务 | 媒体输入链路（**新**）：`POST /api/media/upload` 导入（扩展名/大小/空文件三关都在落盘前过）、`GET /api/media` 列出、`GET /api/media?file=` 取回（含 `Range` → 206）；**新** `POST /api/transcription`（建任务并立刻起跑）、`GET /api/transcription`（任务列表）、`GET /api/transcription/providers`（本机可用引擎 + 不可用原因 + 回退顺序） | `src/lib/media-library.ts`、`src/lib/paths.ts` 的 `mediaRoot()`/`ensureMediaRoot()`、`src/app/api/media/**`、`src/app/api/transcription/**` |
| P3-02-02 接入长任务 | 一条转写 = 一行 `runs`（`playbook_id = media_transcription`），**不新建状态词汇表**：状态/进度/日志/取消全部读 CI-P1-02 的 `GET /api/tasks/{id}`；worker 分支 `case "media_transcription"` 复用同一个执行器 | `src/lib/transcription/transcription-task.ts`、`src/worker/runner.ts`、`src/lib/schedules/schedule-labels.ts`（`media_transcription` 标签） |
| P3-02-03 保存文本与来源关联 | 转写结果写成一条 **`research_materials`**：`content` = 引擎给的正文、`kind` = `audio`/`video`、`fileName` = 来源文件名、`status = ready`、`fetchedAt` = 读取时间；来源写进 `transcript_json`（`sourceRoot` / `sourceFileName` / `sourceSizeBytes`）与 `transcript_json.taskId` ← `runs.id` | `src/db/schema.ts`（`transcript_json` 列）、`src/db/client.ts`（就地 `ALTER TABLE`，**不新增表**）、`src/db/repositories/research.ts` |
| P3-02-04 时间戳 | `transcript_json.segments[]`（`index` / `startMs` / `endMs` / `text`）。云端引擎给绝对时间就原样存；Windows 引擎只报告「说了什么」→ 存 `null`，**不估算**；前端只在有值时渲染 `mm:ss`，一个时间都没有时直说「该引擎未报告时间位置」 | `src/lib/transcription/transcription.ts`（`transcriptLines()` / `formatTranscriptTimestamp()`）、`src/lib/transcription/local-speech.ts`、`src/components/creation/research-transcript-dialog.tsx` |
| P3-02-05 摘要 | **未交付**（见 §5） | — |
| P3-02-06 原文与摘要分开存 | **部分交付**：引擎原始分段（`transcript_json.segments`）与用户可编辑正文（`content`）是两个槽位，互不覆盖——编辑只 `PATCH content`，转写记录不动（已 live 验证）；**摘要槽位不存在**，故「原文 vs 摘要」这一层未成立 | 同上 + `src/app/api/research/[id]/route.ts` |
| P3-02-07 引用信息 | **未交付**（无摘要即无摘要内引用）；已具备的是**素材级**可追溯：`transcript_json` 里有来源文件、引擎 id、模型、语言、时长、返回格式与任务 id，对话框逐项显示 | `src/components/creation/research-transcript-dialog.tsx` |
| 界面入口 | `/creation/research` 新增「音视频转录」面板（选文件/引擎/语言/标题/写入素材 → 提交 → 跟随进度、状态原文与日志 → 「查看转写」+ 最近任务列表）；带转写的行多一个转写按钮，打开「转写内容」对话框（原始分段 + 可编辑正文 + 来源记录 + 继续创作） | `src/components/creation/research-transcription-panel.tsx`、`research-transcript-dialog.tsx`、`research-workspace.tsx` |

**本卡新增**：`src/lib/media-library.ts`；`src/lib/transcription/transcription.ts`、`providers.ts`、`ffmpeg.ts`、`local-speech.ts`、`transcription-task.ts`；`src/app/api/media/route.ts`、`src/app/api/media/upload/route.ts`；`src/app/api/transcription/route.ts`、`src/app/api/transcription/providers/route.ts`；`src/components/creation/research-transcription-panel.tsx`、`research-transcript-dialog.tsx`。**本卡新增测试**：`src/lib/transcription/local-speech.test.ts`、`transcription-task.test.ts`、`src/app/api/transcription/route.test.ts`。**改动**：`src/worker/runner.ts`、`src/components/creation/research-workspace.tsx`、`src/db/repositories/research.ts`、`src/db/schema.ts`、`src/db/client.ts`、`src/lib/types.ts`、`src/lib/research.ts`、`src/lib/schedules/schedule-labels.ts`、三份语系、四份文档（其余 `git status` 里的改动来自更早的卡片）。

### 2. 关键决策（每条都有「不这样做的代价」）

| 决策 | 内容 | 代价 / 反例 |
| --- | --- | --- |
| **转写就是一行 `runs`** | `playbook_id = media_transcription`，没有转写表、没有第二套状态词表；进度来自它自己的 `run_events`（`{current,total}` → `deriveProgress`） | 若另建表，取消/重启恢复/任务台/日历都要重写一遍 |
| **引擎名与模型名都落库** | `transcription_json.providerId` / `model`；回退发生时日志里写明「没跑在谁身上、为什么」 | 只记模型名会让「本地识别器」和「云端模型」看起来是同一件事 |
| **回退永不朝云端** | `transcriptionFallbackOrder`：`local-windows-speech → [local]`；`ai-runtime → [ai-runtime, local]` | 离线请求却把文件上传，是本地优先应用最不能犯的错 |
| **空 ≠ 成功** | 引擎跑完没文本 = `TRANSCRIPTION_EMPTY` 失败，**绝不写空素材** | 空素材会让生成侧以为「有正文」 |
| **素材先写、任务后成功** | `updateRunStatus(success)` 之前写 material | 顺序反过来会出现「成功但没有素材」的任务 |
| **时间戳只存引擎给的** | 云端给绝对时间就存；Windows 识别器只给断句 → `startMs/endMs = null`，界面不显示时间 | 估算位置会让「00:12 说的话」变成一句假证词 |
| **并发三重防线** | ①进程内 `runningTranscriptions` 防重复起跑；②无 key 时只折叠 in-flight、有 `idempotencyKey` 才跨终态复用；③material 写入按 `taskId` 幂等（`findMaterialByTaskId`），跨进程重复执行只产生一条素材 | 仓库层没有 CAS claim，跨进程去重做不到「预防」，只能做到「无害」 |
| **编辑只动 `content`** | `transcript_json.segments` 是引擎的原始记录，`PATCH /api/research/{id}` 不碰它 | 编辑覆盖原始转写＝把「引擎说了什么」变成「用户改成了什么」 |

### 3. 调用链路（真实实现的形状）

```
写入（用户）
  /creation/research 行动画布「音视频转录」面板
    ├─ GET /api/media                       ← 已导入的音/视频清单（media/ 段）
    ├─ GET /api/transcription/providers     ← 本机可用引擎 + 不可用原因 + 回退顺序（先问再跑）
    └─ POST /api/transcription {sourceRoot, sourceFileName, providerId, language, title?, materialId?}
         ├─ resolveTranscriptionSource()    ← 文件不存在/超限/越界 → 400，且**不建任务**
         ├─ createTranscriptionTask()       ← 幂等复用（idempotencyKey / in-flight 同源）
         ├─ startTranscriptionTask()        ← 后台起跑（不占着请求），返回 { taskId, lookup, reused, started }
         └─ 立刻返回 201；前端改用 GET /api/tasks/{id} 轮询（2 s，仅在 queued/running 时）

执行（进程内或 worker，同一个执行器）
  executeTranscriptionTask(runId)
    ├─ updateRunStatus(running)            ← 任务台因此有真实 startedAt
    ├─ prepare   ：resolveTranscriptionSource → run_events
    ├─ provider  ：chooseTranscriptionProvider()；不可用的一次次写 warn，写明原因
    ├─ decode    ：ffprobe 问时长/容器/是否有音轨 → ffmpeg 解成 16 kHz 单声道 PCM wav
    ├─ recognize ：云端 = aiRuntime.transcribe()（适配器按 verbose_json/json）；本地 = PowerShell + System.Speech
    ├─ store     ：transcriptBody() → 空则 TRANSCRIPTION_EMPTY；否则写 research_materials（内容 + transcript_json）
    ├─ success   ：updateRunStatus(success) + done 事件（带 materialId / segments / 字符数 / 来源）
    └─ 任一步抛错：updateRunStatus(failed) + error 事件（带稳定错误码）

读取（用户与生成）
  /creation/research 行内转写按钮 → GET /api/research/{id} → 「转写内容」对话框
    ├─ 原始分段：transcript_json.segments（引擎的断句，有时间才显示时间）
    ├─ 正文：content（可编辑，保存只 PATCH content）
    └─ 继续创作 → /creation/articles?researchMaterialId={id}（P3-01 既有路径，无需改动）
```





### 4. 本轮真实执行的验证

**定向测试**（`node_modules\.bin\vitest.cmd run …`，串行执行，未并行）

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| `src/lib/transcription/transcription-task.test.ts` | 8 | 真库、假引擎：转写写成 `research_materials`（`kind`/`fileName`/正文/`segments`/`taskId`）；指定素材时**只更新那一条**（不新增行）；引擎没识别出文字 → `TRANSCRIPTION_EMPTY` 且**不写素材**；引擎拒绝 → 错误码留在任务与日志上；文件不在工作区 → 在调引擎**之前**就失败；已终态的任务不再跑（引擎只被调一次）；无 key 折叠 in-flight、有 key 复用、终态后同源再提交是新任务；`startTranscriptionTask` 同进程只起一次 + 列表可见 |
| `src/app/api/transcription/route.test.ts` | 5 | 未提交时列表为空且**不建 media 段**；缺文件名 → 400 且不建任务；文件不在库 → 400 且 `details.code = SOURCE_MISSING`；文件在库 → 201 + `{taskId, lookup, reused:false, started:true, task}`，`runs` 行与 `params` 逐字段核对；同文件再提交 → 200 + `reused:true` + 只有一行 `runs` |
| `src/lib/transcription/local-speech.test.ts` | 5 | 固定两个「跑起来才看得见」的坑：脚本不得声明 `Input` 参数（PowerShell 自动变量冲突）、不得有 `Mandatory`（会把立即报错变成等满预算）且必须有空值守卫；`SetInputToWaveFile($WavePath)`；识别器 id/culture 如实回报、位置一律 `null`；`stripBom` 只吃开头那一个 BOM |
| `src/app/api/research/route.test.ts` | +1（共 9） | 表格 kind 词汇表扩容后，「未知 kind」改用 `podcast` 仍被拒；`video` 作为转写写入的 kind 现在可以被创建 |

**全量回归**：`vitest run` → **123 文件 / 880 用例全部通过**（本卡开工前基线 120 / 861，即 +3 文件 / +19 用例）。回归里 4 条既有 pin 被本卡的真实改动打红，全部按新事实改正而非放宽：`media-artifact-ref.test.ts`（根词汇表多了 `media`）、`src/lib/workspace/manifest.test.ts`（报告多了 `media` 段）、`src/app/api/tools/route.test.ts`（工具入参 enum 多了 `media`）、`src/app/api/research/route.test.ts`（kind 词汇表扩容）。同时把 `media_list_assets` 的工具描述与注释从「四个根」改成五个根——工具对 Agent 说的话也要跟事实一致。

**类型与静态检查**：`tsc --noEmit` 退出码 **0**；`eslint src electron scripts` 退出码 **0**（`src/**` 0 error；唯一一条 warning 在 `src/components/agent-chat/chat-conversation.tsx:146` 的 `react-hooks/exhaustive-deps`，该文件本卡未改动，属既有欠账）。




**真实引擎端到端**（本机：Windows + Windows PowerShell 5.1；已装识别器 `MS-1033-80-DESK`(en-US) 与 `MS-2052-80-DESK`(zh-CN)；`ffmpeg` / `ffprobe` 8.1.2 在 PATH；模型网关**没有** `speech_to_text` 能力）

| 验证 | 方式 | 结果 |
| --- | --- | --- |
| 只认引擎 | 直接用 `System.Speech` 脚本识别 SAPI 合成 wav（7.99 s） | **606 ms**，3 段：`Hello` / `is is a transcription test for cool pilot` / `quick brown fox jumps over the lazy dog` |
| 真任务 | 临时工作区 + 临时库，`createTranscriptionTask()` + `executeTranscriptionTask()`（无任何桩） | **1281 ms**：`status = success`、`progress = 100`、素材 3 段且 `startMs/endMs = null`、`content` 与识别文本一致、来源文件名 / 引擎 / 模型 / 时长 7988 ms 全部落库 |
| HTTP 冒烟 | 仓库既有 dev server `127.0.0.1:3000`（真实 `web-data`） | `POST /api/media/upload` → `POST /api/transcription`（201，`status:queued`、`progress:null`）→ `GET /api/tasks/{id}`（`succeeded`、`progress:100`、7 条真实阶段日志）→ `GET /api/research/{id}`（正文 = 3 段）→ `PATCH /api/research/{id}`（正文被改，**3 段仍在、来源文件名仍在**）→ `GET /api/transcription`（`succeeded:100`）。整段 **2369 ms** |

**这一轮跑起来才发现、并已修掉的两个真 bug**（都是「读代码看不出来、跑一次立刻现形」）：

1. **`-Input` 参数名与 PowerShell 自动变量 `$input` 冲突**：脚本声明的 `$Input` 拿到空串，`SetInputToWaveFile('')` 抛异常；更糟的是 `[Parameter(Mandatory=$true)]` 在参数未绑定时会让 PowerShell *询问*参数，而 `execFile` 的 stdin 是一个一直开着的管道——于是「立刻报错」变成「子进程静静等到 120 s 预算耗尽才被杀」，任务记成 `TRANSCRIPTION_TIMEOUT`（第一次真任务跑出来的就是这个结果）。修法：参数改名 `-WavePath`、去掉 `Mandatory`、换成显式的空值守卫（stderr + `exit 2`）。
2. **Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写 BOM**，`JSON.parse` 见到 `\uFEFF` 直接报 `Unexpected token`。修法：读取答案文件时 `stripBom()` 剥离开头那一个 BOM，并注明「不能让三个字节把一次成功的识别变成解析错误」。


### 5. 未完成与边界（诚实记录）

- **P3-02-05 摘要、P3-02-07 引用信息在本卡内未交付**（**已于下一卡补齐**，见 §附录 B-10）：本卡只做到「`content`（用户可编辑正文）与 `transcript_json.segments`（引擎原始记录）互不覆盖」这一层（已 live 验证：`PATCH` 后 3 段仍在）。收尾**没有**按本卡当时的设想加 `summary_json` 列或 `research_summaries` 表，而是把摘要做成 `research_materials` 上的**研究提炼**（`extraction_json` + `extraction_history_json`，仍然不新增表）：一次 `research_extraction` 任务写一版结果，原文、转录与提炼是三个各自独立的槽位，编辑或重新生成提炼都不触碰前两者。表总数因此仍是 **30**。
- **云端引擎没有 E2E 证据**：本机模型网关报 `capability-missing (no model provides: speech_to_text)`，`ai-runtime` 引擎只有契约层（`contracts.ts` 的 `transcription` intent、`adapters.ts` 的 `verbose_json` / `json` 两种请求体、`runtime.transcribe()`）与错误码的单测，**没有**真实上传过一次音频；`verbose_json` 的时间戳解析因此只在单测里成立。
- **未验证的运行语义**：跨进程并发（worker 与 API 抢同一行）、对转写行执行 `POST /api/runs/{id}/cancel`、重启收敛（`reconcileInterruptedTasks` 处理 `media_transcription` 行）——都建立在 CI-P1-02 的既有保证上，本卡没有为它们单独跑过用例。
- **界面没有组件级测试**：仓库没有组件测试基础设施，面板与对话框只有 `tsc` 通过 + 上面那一次 HTTP 冒烟（冒烟走 API，不走 DOM）。「点一次按钮会发出什么请求」这层没有自动化测试。
- **进度条只在真的出现进度信号时渲染**：执行器每个阶段都写 `{current,total}`，所以正常能看到；一个只写 message 的任务不会显示百分比——这是有意的（不猜）。

### 6. 临时物与工作区状态

- 本卡用过的临时物全部删除：`tmp-p3-02-http-check.cjs`、`tmp-cp-recognize.ps1`、`tmp-cp-input-name.ps1`、`src/lib/transcription/live-e2e.tmp.test.ts`；`%TEMP%` 下的合成 wav 与 dev-server 日志随系统回收。仓库根目录里历史卡片留下的 `tmp-*`（`tmp-e2e-baseline*.json`、`tmp-p1-04-*.log`、`tmp-probe-*.cjs` 等）**未动、未清理**。
- **真实工作区已恢复**：冒烟在 `web-data` 建的 1 条素材经应用自身 API 删除（`GET /api/research` 回到 `data: []`），导入的 `media-1791567122388-JU_zCC0U.wav` 已删除、随之出现的空 `web-data/media/` 目录也一并移除（开工前它不存在，`GET /api/media` 原本就是 `{ media: [] }`）。
- **真实库里留下一行运行记录**：冒烟那次 `runs.id = 4ALLmjFf1MVuDynnKc2gx`（`media_transcription`，`success`）与它自己的 `run_events`。`runs` 没有删除 API，未手工改库；这条记录本身就是本次验证的证据（`/runs/queue` 里能看到真实的 7 条阶段日志）。
- **既有 dev server 未重启、未停止**：`127.0.0.1:3000` 上原本就有一个 dev server（PID 30240，非本卡启动），冒烟复用它；本卡另外尝试起的第二个 dev server 被 Next 16 的锁拒绝（`Another next dev server is already running`），故没有重启任何一个。因此**本轮没有验证打包后的 Electron 界面**，界面证据只到 dev server + HTTP 层。

### 7. 下一步

- ~~补 P3-02-05/06/07~~ **已补齐**（§附录 B-10）：摘要/提炼走 `research_extraction` 任务 + `extraction_json` 槽位，原文与提炼互不覆盖；引用按 `facts[].evidence` 与素材正文的比对得出「原文可查 / 原文中未找到」，不从模型话里采信。
- ~~CI-P3-03（研究结果进入创作）可直接开始~~ **已完成**（§附录 B-10）：转写素材与网页素材在生成侧确实完全同形，`researchMaterialPromptText()` 无需改动；提炼由 `includeResearchExtraction` 这个显式开关**追加**，不开则 prompt 与旧客户端逐字节一致。
- 若要云端引擎的真证据：先让模型网关同步一个提供 `speech_to_text` 的模型（`/system/models`），再把同一条 HTTP 冒烟的 `providerId` 换成 `ai-runtime` 跑一遍。**至今未验证**（见 §附录 B-10 §4）。

两条都写进 `src/lib/transcription/local-speech.test.ts` 固定下来——它们的失败形态是「安静地错」和「安静地等」，不钉住就会再犯。

## 附录 B-10：CI-P3-02-05/06/07 摘要与引用收尾 + CI-P3-03 研究结果进入创作交付记录（done，2026-10-10）

> **定位**：CI-P3-02 的转写主卡（§附录 B-9）把音视频变成了素材，但素材那时还只是「存下来的文本」。本卡把它变成**可被创作使用的提炼**，再把提炼接进文章生成。P3-02-05/06/07 与 CI-P3-03-01…04 因此是同一件事的两端，一张卡交付。

### 1. 交付内容（对照 §6 卡片子项）

| 子项 | 交付物 | 落点 |
| --- | --- | --- |
| P3-02-05 摘要 | 基于素材正文的一次结构化写作：`summary` / `keyPoints` / `facts` / `quotes` / `topicSuggestions`。**空结果不是成功**（`EXTRACTION_EMPTY`），模型失败不留任何结果 | `src/lib/research-extraction/extraction.ts`（契约 + prompt）、`extraction-task.ts`（执行器）、`src/app/api/research/[id]/extraction/route.ts` 的 `POST` |
| P3-02-06 原文与摘要分开存 | 三个互不覆盖的槽位：`content`（正文）／`transcript_json`（引擎原始记录）／`extraction_json`（提炼）。`saveResearchExtraction()` 的 update 语句里**没有** `content` / `status` / `transcript_json`，所以「编辑提炼不会覆盖原文/转录」是代码性质而非注释承诺；重新生成把当前版推进 `extraction_history_json`，不抹掉 | `src/db/repositories/research.ts`、`src/db/schema.ts` |
| P3-02-07 引用信息 | 每条事实带 `evidence`（素材原文片段），并记录 `materialId` / `sourceUrl` / 版本 / 任务。**核实是比对而不是采信**：`researchExtractionEvidenceLocator()` 拿 `evidence` 在素材正文里找，找不到就标「原文中未找到」，并且**不进入写作 prompt**（同时说明省略了几条） | `extraction.ts`、`src/components/creation/research-extraction-dialog.tsx` |
| P3-03-01 素材/摘要加入选题 | `POST /api/research/{id}/extraction/topics { index }`：把一条 `topicSuggestions` 建成真实选题（`source: research_extraction`，记下 `researchMaterialId`），index 越界**拒绝而不是取最近一条** | `src/app/api/research/[id]/extraction/topics/route.ts` |
| P3-03-02 研究内容作为文章生成上下文 | `POST /api/content/generate` 新增 `includeResearchExtraction`（默认 `false`）：为 `true` 且素材确有提炼时，把提炼块**追加**进 prompt；素材正文仍按原样进入（`researchMaterialPromptText()` 一行未改） | `src/app/api/content/generate/route.ts`、`src/lib/validation.ts` |
| P3-03-03 区分用户输入/原始素材/AI 生成 | 提炼块自带身份标签（「AI 提炼自同一份素材，非素材原文；第 N 版」）；**选题建议永不进入写作 prompt**（那是给用户的创作建议，不是素材事实）；原文中找不到片段的事实也不进入 | `extraction.ts` 的 `researchExtractionPromptText()` |
| P3-03-04 使用前可查看来源 | 「研究提炼」对话框先给素材正文/来源/引擎记录，再给提炼；每条事实旁边是「原文可查 / 原文中未找到」；`stale` 由**指纹比对**得出（素材改过就说这份提炼是旧的） | `src/components/creation/research-extraction-dialog.tsx`、`research-workspace.tsx`（行徽标 + 提炼按钮） |
| 文章 → 素材 追溯（P3-03） | 文章 `metadata` 记 `researchMaterialId` / `researchMaterialVersion` / `researchExtractionRevision` / `researchExtractionTaskId`；内容库「内容详情」新增**「研究来源」**一栏把它显示回来（本卡补的 UI） | `src/app/api/content/generate/route.ts`、`src/app/[locale]/(console)/content/library/page.tsx` |
| 单素材边界（明说而非暗示） | 生成选择器是单选的，并直接写出「一次生成只读取一份素材；要综合多份素材，请分别生成。」（本卡补的文案） | `src/components/creation/generation-source-selects.tsx`、`src/locales/{en,zh-cn,zh-hk}.json` |

### 2. 验证（本卡实测）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 定向用例 | **本卡 4 份用例 42 例全绿**（纯契约 15 + 任务执行器 15 + 提炼路由 8 + 选题落点路由 4）；连同既有的 4 个研究路由文件，`vitest run src/lib/research-extraction "src/app/api/research"` = **8 文件 / 68 例通过** | `src/lib/research-extraction/extraction.test.ts`、`extraction-task.test.ts`、`src/app/api/research/[id]/extraction/route.test.ts`、`.../topics/route.test.ts` |
| 全量单测 | **152 文件 / 1247 用例：1245 通过、2 失败**（47.38s）。2 条失败都在 `src/worker/runner.test.ts`（工作区**在途的 CI-P7-03 运行预算暂停改动**：期望 `failed`、实测 `paused`），**单独跑该文件同样复现**（3 例 / 2 失败），与本卡无关（本卡初稿记录的 127 文件 / 918 例是当次运行；差额全部来自工作区其他未提交改动，本卡未触碰） | `node_modules\.bin\vitest.cmd run` |
| 类型 | `tsc --noEmit` 无任何输出（全项目 0 error） | `node_modules\.bin\tsc.cmd --noEmit` |
| Lint | **本卡落点全部干净**：`eslint` 对本卡的 lib 目录、路由目录、`src/components/creation`、`validation.ts`、`schema.ts`、`client.ts`、`repositories/research.ts`、`content/generate/route.ts`、`generation-source-selects.tsx` **无任何输出**。**全仓 `eslint .` 有 4 个问题（3 error / 1 warning），全部在本卡之外**：`src/components/agent-chat/chat-conversation.tsx` 一条 `react-hooks/exhaustive-deps`（该文件在 `2d8e5f8` 里已提交、本次未被本卡触碰），以及两个**未跟踪的历史临时脚本** `tmp-probe-db.cjs` / `tmp-probe-zod-json-schema.cjs` 的 `@typescript-eslint/no-require-imports`（不是本卡产物，按纪律未删除） | `node_modules\.bin\eslint.cmd <本卡路径…>`；`node_modules\.bin\eslint.cmd .` |
| 语系对齐 | 三份资源各 **2250 键**，展开到完整键路径后**键集完全一致**，三份都**无 BOM** | 本卡复核命令见下；`src/lib/i18n-coverage.test.ts`（3 用例）同过 |
| 界面（只读浏览器） | 内容库与文章创作两页真实渲染：**0 个 console/page 错误**；无来源的文章**不渲染**「研究来源」一栏；把一条带来源的文章交给浏览器后，「研究来源」正确显示素材 id / 版本 / 提炼版本 / 任务 id，链接指向 `/zh-cn/creation/research`；文章创作 AI 对话框出现「一次生成只读取一份素材」 | Playwright（只读；无数据库写入），见 §2.2 |
| 隔离环境端到端 | 一次临时用例把整条链跑通（临时库、真实 handler、真实 runtime、只桩掉 transport），跑完即删 | 见 §2.1 |

> **2026-10-10 收尾复核命令**（全部直连二进制执行，结果如上表）：
>
> - `node_modules\.bin\tsc.cmd --noEmit` → **exit 0，无输出**（本机终端有时不显示子进程输出，所以把退出码写进文件再读回）。
> - `node_modules\.bin\eslint.cmd .` → **4 个问题（3 error / 1 warning），全部在本卡之外**（见上表 Lint 行：一条**已提交**文件里的 hook 依赖告警 + 两个**历史临时** `.cjs` 的 `require` 报错）；**只对本卡落点跑时无输出**。
> - `node_modules\.bin\vitest.cmd run`（全量）与两次定向（本卡 8 文件 68 例；`src/worker/runner.test.ts` 单独 3 例 / 2 失败）如上表。
> - 语系核对：`node -e` 读三份 JSON → 逐份 `JSON.parse`（先剥 BOM 再解析，实测**无 BOM**）→ 递归展开叶键 → 三份键集互相对齐，输出 `missing = none` / `en-only = none`。

#### 2.1 那次隔离 E2E 实际断言了什么

用例（跑完即删，不留在仓库里）在一个临时数据库里依次验证：

1. **P3-02-05**：`createResearchExtractionTask` → `executeResearchExtractionTask` 走完任务系统，终态 `succeeded`。
2. **P3-02-06**：跑完后 `material.content` **逐字节仍是原文**，而 `extraction.summary` / `keyPoints` / `quotes` 落在 `extraction_json`。
3. **P3-02-07**：`evidence` 在素材正文里能找到 → `verified: true`；素材里没有的那条 → `verified: false`。
4. `GET /api/research/{id}/extraction` 答 `revision: 1` 且 `stale: false`。
5. **P3-03 兼容性**：不带 `includeResearchExtraction` 生成 → prompt **含原文、不含摘要**（旧客户端逐字节不变）。
6. **P3-03-02/03**：带开关生成 → prompt 同时含**原文**与**带标签的提炼块**，且打印出「1 条事实在素材原文中找不到对应片段」。
7. **追溯**：两次生成落库的文章 `metadata` 分别是「记了 `researchExtractionRevision` / `researchExtractionTaskId`」与「完全没记这两个键」。

#### 2.2 界面证据的来源与边界

只读浏览器检查跑在既有 dev server 上（未重启、未打包）：内容库 `/zh-cn/content/library` 与文章创作 `/zh-cn/creation/articles` 两页都 0 错误；**真实工作区的 19 条内容里没有任何一条带 `researchMaterialId`**，所以「研究来源」一栏的**出现分支**是用 Playwright 拦截 `/api/content` 的应答、交给浏览器一条带来源的条目来验证的（不发真实请求、不写任何库）；**消失分支**则用真实条目验证（不渲染空栏）。

### 3. 数据模型

**没有新增任何表**（仍是 30 张）。`research_materials` 上新增两列，都是「就地 `ALTER TABLE` + 默认值」，见 `docs/data-model-inventory.md` §3.2：

- `extraction_json`：当前提炼，`''` ＝「没提炼过」（与「提炼结果是空的」是两回事，后者被 `EXTRACTION_EMPTY` 拒绝，不落库）。
- `extraction_history_json`：被替换掉的版本（上限 `researchExtractionHistoryLimit`），用户**手工编辑**不算新版本、不进入该列。

### 4. 未完成与边界（诚实记录）

- **P3-03-05 的 RAG 预留没有做**，这是**有意**的：卡片原文写的「本轮不以建设完整 RAG 系统为前置条件」，而提炼已经是可被下游读取的结构化对象，真要做检索时再在其上建索引即可。**没有**向量库、没有 embedding、没有检索接口。
- **一次生成只读一份素材**：多素材综合未实现（已按卡片要求在界面上明说）。素材之间也没有相关性排序。
- **摘要即提炼，没有单独的「短摘要」字段**：`summary` 是一个字段，卡片说的「摘要」由它承担；`summary_json` 列**不存在**（见 §附录 B-9 §5 的勘误）。
- **不能「只要摘要、不要原文」**：带素材生成时正文**始终**进入 prompt，提炼是**额外追加**（`includeResearchExtraction` 只控制追加与否）。这是有意的——摘要是 AI 的二次概括，只给摘要等于把二手材料当一手来源；但对「用摘要做创作输入、不进原文」这一诉求，目前**没有**开关，属已知的范围选择。
- **UI 无组件级测试**：仓库没有组件测试基础设施，界面改动靠 `tsc` + `eslint` + §2.2 的只读浏览器检查（两页 0 错误、两个分支都看过）。**打包后的 Electron 界面未验证**（本轮未重启、未打包）。
- **真实工作区里还没有「带来源的文章」**：追溯那一栏的出现分支只能靠拦截应答验证；要让它出现在真实页面上，需要真的用一份素材生成一篇文章（会调真实模型并写真实库），本轮按纪律没有做。
- **云端转写引擎仍无真证据**（沿用 §附录 B-9 §5）：本机模型网关仍不提供 `speech_to_text`，所以「转写 → 提炼」这条链只用**本机引擎**或**桩**跑过。
- **既有 dev server 未重启、未停止**：`127.0.0.1:3000` 上原本就有一个（非本卡启动），界面证据复用它。

### 5. 工作区状态

- 未执行 `git add` / `git commit`；未清理、未覆盖任何既有未提交改动；未执行真实平台发布；未启动会消费现有队列的 worker。
- 临时用例与临时脚本全部删除（`src/app/api/research/[id]/extraction/tmp-p3-e2e.test.ts` 及其一次性运行产物）。仓库根目录里历史卡片留下的 `tmp-*` **未动**。
- **收尾时补的两个用例文件**：`src/app/api/research/[id]/extraction/route.test.ts`（GET/POST/PATCH 8 例）与 `.../topics/route.test.ts`（转为选题 4 例）本轮写入仓库，是本卡的一部分（不是临时文件）。它们把此前只在隔离 E2E 里跑过一次的调用路径固化成常驻用例。
- **收尾复核用的临时日志**：`tmp-tsc-out.txt` / `tmp-locale-out.txt` / `tmp-eslint-out.txt` / `tmp-eslint-card-out.txt` / `tmp-runner-out.txt` / `tmp-card-out.txt` 已删除；`tmp-vitest-out.txt` 是本卡此前一次运行留下的日志，被本轮全量运行覆盖为最新一次的输出（内容仍是本卡的量测记录，故未删）。10:02 前后的其他 `tmp-*` 同样未动。
- **本轮全量单测里那 2 条失败不属本卡**（`src/worker/runner.test.ts`，CI-P7-03 在途改动），**本卡未修、未触碰**：按第 3 条纪律，改动别人的在途工作不在本卡范围内，这里只报告差异。
- **真实库未被本卡写入**：隔离 E2E 用的是 harness 钉住的临时数据库；`web-data` 里的 DB 与文件没有新增、没有改动。

### 6. 下一步

按既定路线，接下来是 **CI-P2-04 内容生命周期与日历**，然后 **CI-P2-05 多平台内容模型**。P4 的 Agent 能力扩展**不提前**；发布结果契约（F2-1）与真实平台发布成功分支、真实视频编码仍各自等待真实凭据/授权，属已登记的阻塞项。

## 附录 B-11：CI-P7-01 统一使用账本与真实成本核算交付记录（in_progress，2026-10-10）

> 本卡落地的是**账本、调用点接入与价格目录录入**，不是成本中心界面。菜单**没有**改名，理由见 §13 开头。
> P7-01-04 把 14 个生产调用点全部接上并补齐「彻底失败」与「自纠重试」两处记账缺口；P7-01-05 交付价格目录的录入入口，并把价格表的键从「供应商+模型+时刻」扩成「供应商+模型+**计量维度**+时刻」。**目录里有没有价格由用户决定**，所以账本行是否 `unpriced` 不再取决于产品缺功能。

### 1. 交付内容（对照 §13 卡片子项）

| 子项 | 交付物 | 落点 |
| --- | --- | --- |
| P7-01-01 | 账本表 + 价格目录表 | `src/db/schema.ts`（`aiUsageLedger` / `aiModelPrices`）、`src/db/client.ts`（DDL + 3 个账本索引；价格表的唯一键改由 `migrateAiModelPriceCatalog()` 建，见 §3） |
| P7-01-02 | 纯函数层 | `src/lib/ai-usage-ledger.ts`（单测 `src/lib/ai-usage-ledger.test.ts`，**35 例**：P7-01-04 的 23 例 + P7-01-05 的 12 例「维度门槛 / 单位计价 / 快照带维度 / 在生效标记」） |
| P7-01-03 | 写入器 | `src/lib/ai-usage-ledger-recorder.ts` |
| P7-01-04 | 调用点接入 | **14/14 全部接入**（逐条清单见 §4）。三处结构性改动：`ModelAttempt` 升级为「一次请求一项」的完整轨迹（`src/features/ai-runtime/contracts.ts`）、抛错时轨迹随错误对象带出（新增 `src/features/ai-runtime/trail.ts`）、记录器改为「一次请求一行」并返回写入结果（`src/lib/ai-usage-ledger-recorder.ts`） |
| P7-01-05 | 价格目录录入入口 | **已交付**：页签 `系统 → 模型管理 → 价格目录`（`src/components/system/model-price-panel.tsx`），`GET/POST /api/models/prices`，边界校验 `aiModelPriceInputSchema`（`src/lib/validation.ts`）。同时改了价格表的唯一键与取价/计价/形状三条规则（见 §3） |
| P7-01-06 | 计量声明规范 | 写入 §13「产品原则」第 8 条 |

仓储层：`src/db/repository.ts` 新增 7 个函数（`createAiUsageLedgerEntry` / `getAiUsageLedgerEntry` / `listAiUsageLedgerEntries` / `summarizeAiUsageLedgerRange` / `createAiModelPrice` / `listAiModelPrices` / `resolveModelPrice`）；`src/db/repositories/ai-usage-ledger.ts` 为 barrel，已挂到 `src/db/repositories/index.ts`。

### 2. 关键决策（每条都有「不这样做的代价」）

| 决策 | 理由 | 不这样做的代价 |
| --- | --- | --- |
| 新建 `ai_usage_ledger`，不扩 `usage_records` | 现有表是「一次成功的生成一行」，账本要「一次尝试一行」 | 给 `usage_records` 加十几个可空列，会让 6 个既有写入点与 用量统计 页的语义同时变得二义 |
| 金额可为 NULL，且用 `cost_source` 四态区分 | 「算得出来的钱」「厂商报的钱」「没有价格」「根本没测到」是四件不同的事 | 用 0 冒充未知，汇总页会把「没记账」读成「没花钱」 |
| 价格快照冻结在账本行上，价格目录只增不改 | 明天改价不能改写昨天的成本 | 成本随目录编辑而变化，历史账不可复核 |
| 账本写入失败被吞掉，但**结果里报告** | 记账是观测，不是事务；不能因记账异常让用户已付费的生成失败 | 反过来做，一个记账异常就变成用户可见的失败 |
| 返回 `{ rows, reported, failed }` 而不是「行数组」 | 「请求发生了但账本没记下」（`failed: true`）与「根本没有发出请求」（`reported: 0`）是两件不同的事 | 只返回空的数组，两种失败就合成了一种，谁也说不清是哪一种 |
| 抛错时把请求轨迹挂在**错误对象**上，而不是写库 | 让「彻底失败」可记账，同时保持 runtime 不 import 任何存储模块 | 在 runtime 里写库 = 把存储依赖塞进模型层；或干脆不记 = 失败的调用永远查无此账 |
| 轨迹不放进 `AppError.details` | 那个字段会成为 HTTP 响应体（`toApiErrorShape`），轨迹是记账信息不是接口契约 | 把内部账务细节泄露给客户端，并让响应体随内部改动而变 |
| 自纠重试按请求拆行（`kind: self-correction`） | 两次请求就是两次计费，合并后的 usage 会让账单少一半 | 把「一次纠正」记成一次调用，成本被系统性低估 |
| 请求轨迹包含**赢家**，不再只含失败 | 只看失败就知道「哪把 key 被拒」，看不出「到底跑了什么」 | 账本无法为真正被计费的那次请求写行 |
| `attempt_index` 从 0 起，失败尝试排在前 | 让「这次换了几次 Key / 换过几个模型」是一列可查的事实 | 只看最终行，重试成本永远不可见 |
| 提供商记「实际执行方」而非「用户所选」 | 失败切换后用户选的供应商并未计费 | 费用归错供应商，按供应商维度的分析整体失真 |

### 3. 数据模型

DB 表数 **30 → 32**（`ai_usage_ledger`、`ai_model_prices`）。两表都由 `schema.ts` 声明，因此自动被既有基础设施纳入：

- `src/db/repositories/backup.ts` 的 `collectTables()` 从 schema 模块发现表 → 备份/恢复**无需登记**新表；
- `src/lib/workspace/manifest.ts` 的 `schemaTableNames()` 同理，`unknownTables` 仍为空。

`ai_usage_ledger` 列：`purpose` / `outcome`(success|failed|interrupted) / `provider_id`（**实际执行方**）/ `model_id` / `endpoint_id` / `credential_label`（掩码）/ `attempt_index` / `task_id` `run_id` `node_id` `parent_usage_id` `output_asset_id` `content_item_id` / `metered_kind` / `input|output|total|cached_input|reasoning_tokens` / `completeness` / `quantity_json` / `cost_amount`（**可 NULL**）/ `cost_currency` / `cost_source` / `pricing_json` / `duration_ms` / `error_summary` / `created_at`。

`ai_model_prices` 列：`provider_id` / `model_id`（`*` = 该供应商兜底价）/ **`metered_kind`（这一行计价哪个计量维度；P7-01-05 之前的行一律是 `text`）** / `currency` / `input_per_million` / `output_per_million` / `cached_input_per_million`（**NULL = 不单独计价**；填 0 会谎称缓存免费）/ **`unit_price` + `unit_label`（非 token 维度的单位价，token 行两者皆空）** / **`declared_free`（这一行的 0 是「真的免费」还是「没人填」）** / `price_version` / `source` / `effective_from` / `notes` / `created_at`。

唯一键：`(provider_id, model_id, metered_kind, effective_from)`（`idx_ai_model_prices_scope_kind_effective`）。P7-01 的旧键 `(provider_id, model_id, effective_from)` 无法让同一模型的「文本价」与「图片价」在同一时刻共存，因此由 `migrateAiModelPriceCatalog()` 重建；迁移策略见 §6。

**P7-01-05 定下的三条规则（写在 `createAiModelPrice` / `resolveModelPrice` / `computeUsageCost` 里，任何写入者或调用者都绕不过）**：

1. **token 行必须同时给出输入与输出单价**。`undefined` 不再被默认成 0：一整行都是 0 且没有 `declaredFree` 时**拒绝写入**（真正免费的模型必须显式声明），因为旧默认会让「漏填」变成账本上一笔精确的 0 元。
2. **单位价行必须给出 `unitLabel`**（`image` / `second` / `character` / `call`，按维度限定），并**不得携带 token 单价**——一行只计价一个维度。反之 token 行不得携带 `unit_price`。
3. **取价与计价都按维度匹配**。`resolveModelPrice(providerId, modelId, at, meteredKind)` 的第四个参数是**必填**（不给默认值：一个更短的参数列表就能把「文本价给图片计价」重新引进来）；`computeUsageCost(..., metering)` 再核一次维度是否一致，不一致即 `unpriced` + NULL。**非 token 维度用 `quantity × unit_price`**，用量缺失时是 `unknown` + NULL，**不会**退化成一个 `computed` 的假金额。

### 4. 未完成与边界（诚实记录）

**P7-01-04 已完成：生产代码里 14 个 `aiRuntime.*` 调用点全部接入账本。** 逐条清单（行号为本卡实测；每个调用点都带 `purpose` 与能拿到的最强业务身份）：

| # | 调用点 | `purpose` | 业务身份 | 写入位置（成功 / 失败） |
| --- | --- | --- | --- | --- |
| 1 | `lib/article-generation.ts`（`api/content/generate` 与 `api/ai-writing/generate` 共用） | `article` | `contentItemId` | `:229` / `:175` |
| 2 | `app/api/content/[id]/rewrite/route.ts` | `content-rewrite` | `contentItemId` | `:85` / `:112` |
| 3 | `app/api/content/[id]/translate/route.ts` | `content-translate` | `contentItemId` | `:66` / `:92` |
| 4 | `app/api/knowledge-base/ai-parse/route.ts` | `knowledge` | 无（粘贴内容没有 id） | `:69` / `:97` |
| 5 | `app/api/positions/generate/route.ts` | `position` | 无（草稿尚未保存） | `:64` / `:81` |
| 6 | `app/api/content/mindmap/route.ts` | `mindmap` | 无（只有主题字符串） | `:91` / `:97` |
| 7 | `app/api/metrics/insights/route.ts` | `insight` | `contentItemId`（取自发布记录） | `:60` / `:71` |
| 8a | `lib/scraper.ts` `rewriteArticle()` | `rewrite` | `runId`（自动化运行） | `:91` / `:101` |
| 8b | `lib/scraper.ts` `generateTopicPost()` | `topic-post` | `runId` | `:143` / `:140` |
| 9 | `lib/research-extraction/extraction-task.ts` `askModel()` | `extraction` | `runId` | `:187` / `:190` |
| 10 | `lib/agent/langgraph-engine.ts` `planToolCalls()` | `agent-plan` | `runId` + `nodeId: planner` | `:177` / `:182` |
| 11 | `lib/agent/local-tools.ts` 的 `generate_image_prompt` 工具 | `agent-tool` | `runId` + `nodeId: generate_image_prompt` | `:224` / `:221` |
| 12 | `lib/agent/chat-thread-title.ts` | `chat-title` | `runId` | `:90` / `:98` |
| 13 | `lib/agent/image-generation.ts`（`generateImage` 的**唯一**调用点） | `image` | `outputAssetId`（落盘文件）+ `meteredKind: image` + `quantity` | `:88`（空图另记 `:79`）/ `:71` |
| 14 | `lib/article-images.ts:65` | —（**间接**） | 经 `generateImageFile()` 落在第 13 条；文章级归属不可得，见下 | — |

为了让第 8、9、10、11、12 条有真实身份，本卡给 5 个函数加了**可选**的 `runId` 参数（`generateTopicPost` / `rewriteArticle` / `planToolCalls` / `updateChatThreadTitleIfNeeded` → `generateChatThreadTitle` / `askModel`（模块内部）），由调用方传入它本来就有的运行 id（`AutomationContext.runId`、`agentRunId`、`local.run.id`）；不传则退化为「只按 `purpose` 归属」，与第 4、5、6 条相同。

**两处缺口已补齐：**

- **彻底失败的调用现在有记录。** 原因是结构性的：`chat()` 一直知道它发过哪些请求，只是没有地方放，于是抛错时把整条轨迹一起丢掉了。本卡新增 `src/features/ai-runtime/trail.ts`，把轨迹作为**错误对象上的一个自有属性**带出（`attachModelAttempts()` / `modelAttemptsFrom()`）——这是「挂一个值」，**不是**数据库写入，因此「runtime 不 import 任何存储模块」这条边界原样保住（`runtime.ts` 仍然只 import `contracts` / `adapters` / `key-pool` / `registry` / `trail`）。轨迹刻意**不**放进 `AppError.details`：那个字段会成为 HTTP 响应体（`toApiErrorShape`），而轨迹是记账信息、不是对客户端的契约（`trail.test.ts` 直接断言它不出现在 API 形状里）。空轨迹不附着，所以「什么都没发出」与「全都失败」仍然可分辨。
- **自纠重试现在单独成行。** `ModelAttempt` 从「赢家之前的失败」升级为「本次调用实际发出的每一个请求」，带 `kind`（`answer` / `self-correction`）、`outcome`（`success` / `failed`）、`endpointId`，以及**该请求自己的** `usage`。于是 `chatStructured` 的第二轮请求以 `self-correction` 进入同一条轨迹，账本按 `attempt_index` 顺序倒出两行；`usage` 仍是两次之和（给只想看总数的调用方），账本用的是拆分后的两份。连带的两个消费方也一并修正：`extraction-task.ts` 的 run event 与 `transcription/providers.ts` 的提示语现在**只数失败项**——因为它们原文写的就是「之前失败了几次」。
- **赢家本身也进了轨迹。** 旧语义下 `attempts` 只有失败，调用方知道「哪把 key 被拒」却不知道「到底跑了什么」，账本因此无法为真正被计费的那次请求写行。

其余边界（诚实记录，不声称绝对完整）：

- **进程崩溃与写库失败无法保证有行。** 记账写入仍然被吞掉（记账是观测，不是事务），但结果里明确返回 `{ rows, reported, failed }`：`failed: true` 表示「请求发生了而账本没记下」，`reported: 0` 表示「根本没有发出请求」（例如一个都没配置）。这两件事在过去都被压缩成「返回空数组」，本轮把它们分开建模。删除行、磁盘损坏这类进程级灾难不在承诺范围内。
- **`article-images.ts` 的图片调用没有文章级归属。** 它经 `generateImageFile({ prompt })` 走第 13 条，而调用点只拿得到 prompt（没有 `contentItemId`），所以这些行只有 `purpose: image` + 落盘路径。要接上文章归属需要给 `generateImageFile` 传身份参数，留给后续卡。
- **`transcribe()` 没有任何生产调用点。** 因此 14 条清单里没有转写；`aiRuntime.transcribe` 目前只被 `lib/transcription/providers.ts` 这一层消费（其上层调用方尚未接上）。runtime 侧已按同一规则改造（赢家入轨迹、抛错带轨迹），但**不会有真实调用写它**。
- **`interrupted` 仍无真实来源。** 类型支持该取值，但当前没有任何调用点能判定流式中断，因此生产数据里不会出现该值。
- **自纠重试的拆分来自运行时的轨迹，不是账本新增的列。** 账本没有 `kind` 列：一行若 `attempt_index > 0` 且其前一行 `outcome = success`，它就是一次自纠重试（自纠的前置请求是成功的，key 轮换/模型降级的前置请求是失败的）。这条推导规则写在 `ai-usage-ledger-recorder.test.ts` 的注释里。
- **`duration_ms` 恒为 0 = 「未测量」。** 本轮没有给每个请求加计时；记录器写 0，并在此声明它不代表「瞬间完成」，避免读者把它读成一个事实。
- **失败的尝试不猜 token、不猜钱。** 一律 `completeness: unknown` + `cost_amount` NULL，`error_summary` 存运行时给出的原因。
- **价格目录现在有入口，但内容仍然由用户决定**：P7-01-05 之前 `createAiModelPrice()` 没有任何生产调用者，所以成功行必然是 `unpriced` + NULL；现在它由 `/api/models/prices`（POST）写入，界面在 系统 → 模型管理 → 价格目录。**目录为空时行为不变**：报「说不出来」，而不是报 0 元。**这不是缺陷，而正是本卡要证明的事**——而且现在多了一层：即使有价格，**维度不匹配也仍然是 `unpriced`**（文本价不会给图片计价）。
- **P7-01-05 的边界（本轮明确不做，均已声明）**：
  - **界面只录文本 token 价**。其他维度的单位价（图片/视频/语音/Agent）**表、唯一键与 `computeUsageCost` 的分支都已就绪**，缺的只是一个表单；在它之前这些维度在界面上显示为「尚未定价」，账本里是 `unpriced`。
  - **`provider-reported` 仍然没有写入者**——所以系统里目前**不存在「实际费用」**，只有 `computed`（依目录估算）与 `unpriced`（说不出来）两种状态。供应商账单对账是独立的一步，本轮不声称已经做到。
  - **单位价没有限定条件**：`unit_label` 参与匹配，但「同一单位内按分辨率/质量分价」目前表达不了（一行只有一个 `unit_price`）。需要时加限定列，而不是现在先塞一个 JSON 占位。
  - 价格表的 `metered_kind` 在 `listAiModelPrices` 里只是**可选筛选**，没有「默认只看 text」的隐藏语义。
  - **新面板没有渲染测试**：`src/components/system/model-price-panel.tsx` 与仓库里既有的三个模型面板一样，只有 `tsc` 与 `eslint` 兜底（仓库里唯一的组件测试是 `src/components/accounts/shared.test.ts`，测的是纯函数）。面板读的字段、POST 的载荷、错误码到文案的映射都在 `route.test.ts` / `validation.test.ts` / `ai-usage-ledger.test.ts` 里覆盖到了，但「按钮点下去会怎样」**没有**自动化验证——这一条与「未打开浏览器」一起，是本轮不声称已端到端验证的部分。
  - 「哪条价在生效」的判定被放在**服务器**（`markInForceModelPrices`）而不是页面：不是为了省事，而是因为页面在读时钟时调 `Date.now()` 已被 eslint 的 `react-hooks/purity` 拦下——那条规则指出的正是真问题：渲染期取时间会让结果随重渲染漂移，而真正决定用哪条价的本来就是服务器。

- **不记录任何密钥内容**：账本只存掩码标签（`****1234`）。本轮同时修正了一处**措辞错误**——`credential_label` 为空**不等于**「没有发出请求」：非密钥类失败（如 400）的路径上，密钥池在抛出前没有报告用的是哪把 key，所以空标签表示「无法归属」，而不是「未计费」（`contracts.ts` 与 `runtime.ts` 的注释已按此改正，`runtime.test.ts` 有一条用例把它钉住）。
- **`mindmap` 路由的口径变化**：它过去明确「不写 `usage_records`」，本轮开始写账本。这不是行为回归——它记的是「用户自己的 key 被用掉了一次」，而「用量统计」的计数口径未动，路由注释里写明了这一区别。

### 5. 本轮真实执行的验证

全部在本机以直接二进制执行（与仓库既有做法一致）：

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**（全项目无类型错误） |
| `node_modules\.bin\eslint.cmd <22 个改动文件 / 目录>` | **exit 0**（0 error / 0 warning） |
| `node_modules\.bin\vitest.cmd run`（全量） | **132 个测试文件 / 996 个用例全部通过，exit 0**（P7-01-04 记录为 131 / 962；本轮本卡贡献 **1 个新文件 / 33 例**，其余差额来自工作区既有未提交改动，本卡未触碰） |
| `node_modules\.bin\vitest.cmd run`（定向 A：账本 + 运行时） | 9 个文件 / **84 例通过** |
| `node_modules\.bin\vitest.cmd run`（定向 B：被接入的 lib 层） | 16 个文件 / **107 例通过**（scraper / agent / research-extraction / article-generation / article-images / transcription / worker） |
| `node_modules\.bin\vitest.cmd run`（定向 C：8 个被接入的路由） | 8 个文件 / **76 例通过** |

**本轮新增的 21 个用例直接钉住验收要求里的四条规则：**

- **顺序与业务关联**（`src/lib/ai-usage-ledger-recorder.test.ts`，8 例）：一次调用发出两个请求 → `attemptIndex` 为 `[0, 1]`、第二行 `parentUsageId` 等于第一行的 id、第一行为空串，两行都带同一个 `contentItemId` / `runId` / `nodeId`；失败调用的两行分别带各自的 `errorSummary`。
- **自纠重试单独计费**：账本侧两行 `totalTokens` 为 `[120, 170]`（不是把 290 合并进一行）；runtime 侧 `runtime.test.ts` 断言轨迹的 `kind` 为 `["answer", "self-correction"]`、两条 `usage` 各自是 `{ inputTokens: 2, outputTokens: 3, totalTokens: 5 }`，而响应上的 `usage` 是两者之和 `{ 4, 6, 10 }`——显示口径与记账口径被明确分开。
- **彻底失败也有记录**：`runtime.test.ts` 断言抛出的错误带着轨迹（`modelAttemptsFrom()` 读得出 `outcome: "failed"`），`ai-usage-ledger-recorder.test.ts` 断言两行都写进去了且 `costAmount` 为 `[null, null]`、`costSource` 为 `unknown`；`trail.test.ts`（6 例）断言空轨迹不附着、非对象抛出无害、轨迹**不**出现在 `toApiErrorShape()` 的 HTTP 形状里。
- **未知不得写成 0**：未定价的成功行是 `unpriced` + NULL（token 照记）；图像调用（无 usage）是 `unknown` + NULL，同时记下 `meteredKind: image` 与 `quantity`；`src/db/repositories/ai-usage-ledger.test.ts`（7 例）另测「目录为空返回 null」「精确价胜过 `*` 兜底」「未到生效时间不参与计价」「`*` 不跨供应商」「窗口汇总只累加说得出钱的行并置 `costIsComplete = false`」。
- **写不进去必须说出来**：一次故意让 SQLite 无法绑定的写入返回 `failed: true` / `rows: []` / `reported: 1`，而一个不带轨迹的错误返回 `{ rows: [], reported: 0, failed: false }`——「账本没记下」与「本来就没发出」不再混为一谈。

`src/lib/ai-usage-ledger.test.ts` 的 23 例逐条锁住了本卡的诚实规则，其中直接断言「不撒谎」的有：

- 「没有价格」返回 `unpriced` 且 `costAmount === null`（**不是 0**）；
- 「没有测到」返回 `unknown` 且 `costAmount === null`；
- 供应商报了一个全 0 的 usage 与**什么都没报**是两种状态（`computed` 的 0 vs `unknown` 的 null）；
- 缓存 token 只在快照给出缓存单价时按缓存价计费，且 `cachedInputTokens` 不得超过 `inputTokens`；
- 汇总只累加「说得出」的行，`unpriced` / `unmeasured` 分别计数并把 `costIsComplete` 置 false；**空窗口的 `costIsComplete` 也是 false**（0 元账单 ≠ 没有账单）。

**P7-01-05 本轮新增 33 例（1 个新文件 + 5 个文件扩展），逐条对应验收要求：**

| 验收要求 | 用例 |
| --- | --- |
| 文本价不得给图片等其他维度计价 | `ai-usage-ledger.test.ts`「never costs an image with a text price, whatever usage the provider reported」（**刻意用「图片端也报了 token 用量」这个前提**，因为那正是会产生假金额的场景）；`repositories/ai-usage-ledger.test.ts`「does not price a call whose dimension has no row of its own」（`resolveModelPrice(..., "image")` 返回 null） |
| 维度/单位/用量不匹配不得产生 `computed` | 「says unknown - not 0 - when the price is known but the units it multiplies are not」「refuses a per-unit price whose quantity was metered in another unit」「treats a per-unit price that states no rate as unpriced rather than as free」 |
| 单位价按自己的维度与单位计价 | 「costs an image with its own per-unit price and the units the call used」「prices speech per character and video per second, each with its own unit」「still prices an embedding call by its input tokens」 |
| 旧库迁移后数据可读、唯一键含维度 | `client.test.ts`（+4 例）：旧结构的库 → 每行读成 `text`、四个新列补齐、`pragma_index_info` 确认键为 `(provider_id, model_id, metered_kind, effective_from)`、旧索引名消失；同一时刻的文本价与图片价可以共存；重复键仍返回 `AI_PRICE_CONFLICT`；迁移再跑一次什么都不做 |
| 迁移失败必须可诊断、且不能悄悄丢数据 | 「refuses to rebuild over rows it cannot tell apart, names them, and drops nothing」：`duplicateKeys` 报出冲突键与行数、`indexRebuilt: false`、`error: null`、**两行都还在**，并且**不建一个假装唯一的索引** |
| 追加不改历史快照 | `ai-usage-ledger-recorder.test.ts` 原有的「freezes it onto the row, and never restates it later」继续通过（新版本写在更晚的时刻）；`pricingBasisFromRow` 新增「freezes the dimension and the unit onto a per-unit row」 |
| 非法币种 / 价格 / 生效时间 / 版本返回明确错误 | `validation.test.ts`（+6 例，管**格式**）与 `repositories/ai-usage-ledger.test.ts`（+5 例，管**含义**）：漏填单价被拒、全 0 未声明被拒而声明后通过、token 行带单位价被拒、单位行缺 `unitLabel` 被拒、非法币种与越界价格与非整数/过远时间被拒 |
| 唯一冲突是业务错误而非 SQLite 原文 | 仓储层断言 `AI_PRICE_CONFLICT` / 409 且 message 不含 `UNIQUE constraint`；路由层「answers a duplicate instant with a conflict a page can explain, not a driver message」 |
| 备份恢复保留新字段 | `backup.test.ts`（+1 例）：`backupTableDescriptors()` 含四个新列、快照里字段原样、`replace` 恢复后仍读成「image / per image / 0.04 USD」 |
| 凭证不进入价格目录 / 账本 / 日志 | 路由层「stores nothing a caller was not meant to put in the catalog」：请求体里塞 `apiKey` / `geminiKey` 后，写入与回读的 JSON 都不含该串，行上也没有这两个属性 |
| 「哪条价在生效」由服务器判定，不由页面时钟判定 | `markInForceModelPrices`（`ai-usage-ledger.test.ts`，+4 例）：最新且已生效者被标记、被它取代者不标记、未到生效时间者标为 `false` 而**不是**被隐藏（排定的改价值得看见）、两个维度各自独立；路由层断言列表里的行带 `inForce: true` |

**P7-01-05 刻意不做的两件事**（都属于「不撒谎」）：界面**不**把 `computed` 显示成实际费用（只标「依目录估算」，见 §13 产品原则第 9 条）；未定价的维度显示为「尚未定价」，**不**给占位价——占位价会被真实用量乘出一个看起来精确的数字。

### 6. 工作区状态

- 未执行 `git add` / `git commit`。**本轮改动全部留在工作区**；同时明确记录：该仓库当前还有大量**与本卡无关**的既有未提交改动（`README.md` / `docs/creator-workflow-audit.md` / `next.config.ts` / 若干组件与路由），本轮**没有**触碰、覆盖或清理其中任何一个，也没有把它们一并提交——这正是本轮不执行 `git add` 的原因：无法从工作区状态可靠地区分哪些改动属于同一张卡。
- **未启动应用、未重启 dev server、未打开浏览器、未发出任何真实模型请求**：本轮验证只有类型检查、Lint 与单测，单测里的 provider 全部由 `fetch` stub 替代。
- **未连接本机真实数据库**：所有可能走到账本写入器的测试都经 `@/test/route-harness` 或各自的三行 pin 把 `SOCIAL_AUTO_POST_DB_URL` 指向临时目录（本轮逐一核对：`scraper.test.ts`、`runtime.test.ts`、`extraction-task.test.ts`、`article-generation.test.ts`、`article-images.test.ts`、8 个路由测试、2 个新测试文件）；其余把 runtime mock 掉的测试其响应里根本没有 `attempts`，记录器拿到空轨迹后**连数据库都不会打开**（逐一核对：`chat-thread-title` / `langgraph-engine` / `local-tools` 等）。
- 未新增临时文件；验证输出写在 `$env:TEMP`，不在仓库内。
- 真实库的表结构**尚未**含这两张新表（`ensureDatabase()` 尚未在本机真实库上跑过）；首次运行时会 `CREATE TABLE IF NOT EXISTS` 补上。**本轮新增了列与一次索引重建**（`ai_model_prices` 加 `metered_kind` / `unit_price` / `unit_label` / `declared_free`），因此有一个真实迁移步骤：`migrateAiModelPriceCatalog()` 在 `initializeDatabase()` 里先查 `pragma_table_info` 补列、再查 `pragma_index_list`/`pragma_index_info` 与重复键、然后**先建新键再删旧键**；失败会带 SQLite 原文落进 `console.error` 并出现在返回值里，**没有**用 `.catch(() => undefined)` 吞掉（迁移逻辑本身有 4 例单测，含旧库兼容、同刻两维度共存、重复数据拒绝与幂等）。

### 7. 下一步

1. **P7-01-05 价格目录录入入口**：**已交付**（系统 → 模型管理 → 价格目录，`GET/POST /api/models/prices`）。它同时改了价格表的键与三条形状规则，逐条见 §3。剩下的事只有一件：**用户录入自己的价格**。
2. **CI-P7-02** 把「用量统计」升级为一级菜单「AI 成本与质量优化中心」：菜单改名与第一个真实费用界面**同卡交付**（成本总览 / 调用明细 / 按业务追溯）。**读账本时要注意两件事**（本轮已写进代码注释与单测）：金额来源必须照原样呈现（`computed` 是「依目录估算」，不得标成实际费用）；「自纠重试」不能只看 `attempt_index > 0`——密钥轮换、模型降级与自纠三种成因在同一列上都 > 0，要沿 `parentUsageId` 读前一行的 `outcome` 与身份才能分开。`AiUsageLedgerTotals.retries` 目前的口径是**「不是该次调用的第一个请求」**，界面上不要直接写成「自纠次数」。
3. 之后进 CI-P7-03（预估与预算控制）与 CI-P7-04（质量与成本优化）；逐请求的 `duration_ms` 计时到那时才需要补上（本轮按「未测量」写入并已声明）。**非文本维度的录价界面**（图片/视频/语音/Agent 的单位价）也留到那时：表、键与计价函数本轮已经支持它们，缺的只是一个表单。
4. 与 P7 并行的既有主线下一项仍是 **CI-P2-04 内容生命周期与日历**（§10 顺序表第 8 项），两条线互不阻塞。

## 附录 C：参考项目设计借鉴条目映射（A1–A7 · Anki 扩展参考，2026-10-10 追加，**非任务卡**）

本附录由作者指令追加，用于把 Anki 的设计借鉴条目挂到既有卡片上。**只新增参考条目与映射**：

- **不新增任务卡**，不改动任何既有卡片的编号 / 顺序 / 状态 / 历史交付记录；`A1`–`A7` **不进入 §1 状态表**、不占 `CI-` 卡号。
- **不修改业务代码、不新增数据库表、不执行数据迁移**；`CI-P2-04` 的状态不变，**未**因此启动 P1-05 或 P8-05。
- `A1`–`A7` 的**权威正文**（借鉴内容、适用边界、处理方式）在 `docs/development/CoolPilot-开发清单-10个开源项目整合版.md` **附录 Z**；本附录只做映射，**不重复条目内容**。
- Anki 参考来源与逐项核查状态（仓库 / 架构文档 / `pylib/anki/collection.py` / `docs-site/addons/` / `LICENSE`）见附录 Z 的 **Z.1**：只写本轮真实读到的事实，未核实的一律标注，**不**把未核查的实现细节写成已验证事实。

| 参考项 | 关联开发方向（编号以最新清单为准） | 主线对应 | 当前处理方式 |
| --- | --- | --- | --- |
| **A1** 内容主体与生成产物分离 | 新清单 **P2-04**（§四 第 248 行起）；后续 **P2-05**（第 263 行）、**P2-06**（第 275 行） | `CI-P2-04`（done）、`CI-P2-05`（done，限模型与 API 契约，见 §5 第 210 行起） | 作为 P2-04 的**内容模型核查参考** |
| **A2** 生命周期、计划时间与历史记录分离 | 新清单 **P2-04**（第 248 行起）；后续 **P1-02**（§三）、**P1-05**（第 193 行） | `CI-P2-04`（done） | 作为当前状态与日历设计的参考；**不套用**复习调度算法 |
| **A3** 稳定业务 API 与数据访问边界 | 全局架构约束（无独立卡）；相关 **P6-04**（第 570 行）、**P4-01-06**（第 345 行） | 本文 §0 冻结边界 + §附录 A-1 落点 | **持续遵守**：页面 / 服务 / AI Runtime / 持久化分层，不在组件或 Runtime 里散落直连数据库 |
| **A4** 扩展机制与 Marketplace 契约 | 新清单 **P1-05**（第 193 行）、**P5-06**（第 519 行）、**P7-01 / P7-02**（第 583 / 597 行） | 主线 `CI-P4-*`（todo）、`CI-P7-05-03` | **先研究契约，不提前实现** Marketplace |
| **A5** 导入、导出、备份与迁移 | 新清单 **P5-06**（第 519 行）、**P6-03-05**（第 557 行）、**P6-04-04**（第 570 行）、**P8-07-04**（第 721 行） | 主线 `CI-P7-05-04`（导出不得含凭据） | 纳入规划储备；凭据独立处理，**不得**因导出而明文导出秘密 |
| **A6** 统一检索、标签与跨模块过滤 | 新清单 **P2-06-03**（第 281 行）、**P7-02-01**（第 599 行）、**P3-01-03**（第 301 行） | 储备（`CI-P2-05` 之后的规划） | 纳入规划储备；**不要求任何当前卡实现**全局搜索 |
| **A7** 基于真实历史反馈的质量优化 | 新清单 **P8-05** 质量指标与成本优化建议（第 677 行） | 主线 `CI-P7-04`（§13 第 440 行，todo） | 纳入规划储备；不得把「模型返回成功」等同「内容质量合格」，也不得在无数据时虚构效果 |

> 上表只是**计划映射**：不代表对应开发卡的全部验收要求，也**不自动创建新卡**；是否采纳由具体卡片的作者指令决定。

**下一步（2026-10-10 更新）**：仍按「一次只做一张卡」推进（§1）——**`CI-P2-05` 已按契约交付**（多平台内容模型，限模型与 API 契约，§5 第 210 行起；**UI 消费者与真实 HTTP 冒烟未做**，其 UI 已立项为 **`CI-P2-07`**（见 §14））；本附录不改变待指定状态——**下一张候选卡为 `CI-P7-03`**（生成前预估与预算控制，§13 第 **442** 行起；旧记录写的 433 为插入交付记录前的行号，已核对为 442）。

## 14. P2 补充：多平台内容版本管理 UI（`CI-P2-07`，2026-10-10 作者授权立项）

> **为什么追加在文末**：本卡是对 §5 `CI-P2-05`（多平台内容模型，done，**限模型与 API 契约**）的**界面消费者**补充。为主线 §1–§13 与附录 A–C 的**既有行号引用保持有效**，本节**追加于文末**，不改动 §5 及之后任何既有行号。
> **编号依据**：`CI-P2-06` **已被占用**——`docs/development/CoolPilot-开发清单-10个开源项目整合版.md` §四 第 **279** 行「`P2-06：创作者资料与内容分群（erxes Contacts / Segments）`」；全仓 docs + src 无 `CI-P2-06` / `CI-P2-07` 字样，故取下一个空位 **`P2-07`**。**不改**该清单文件（`P2-07` 是我方实现层补充卡，需求原文 `P2-05` 不动）。
> **状态**：`todo`。开工前**先核查并报告唯一宿主**，作者确认后再写代码；逐条登记见 `docs/development/capability-integration-numbering-map.md` §4.5。

### 子项与范围

| 子项 | 范围 | 备注 |
| --- | --- | --- |
| `P2-07-01` 版本列表与基础内容展示 | 展示基础内容、平台版本及版本状态；妥善展示**不可读条目**（沿用 `unreadable` 计数，不静默丢弃） | 只读 |
| `P2-07-02` 平台版本派生 | 从基础内容选择目标平台并创建派生版本（走既有 `POST /api/content/[id]/platform-versions`） | 不新增路由 |
| `P2-07-03` 版本编辑与保存 | 支持编辑、保存，并保留**来源关系**（`derived` / `edited`、`baseFingerprint`）与编辑状态 | `PATCH` **不重算**指纹 |
| `P2-07-04` 平台适配信息展示 | 展示标题支持情况、文本限制、媒体信息等**已有契约信息**（`PlatformContentProfile`）；**不得虚构平台能力**（`titleLimit` 全为 `null` 时如实显示「本层不限额」） | 事实只从既有代码推导 |
| `P2-07-05` 版本删除与发布隔离 | 删除指定平台版本，并**验证**不创建发布记录、不修改内容发布状态、不创建排程 | 与 C2 发布契约隔离 |
| `P2-07-06` 完整链路验证 | 覆盖组件交互、API 调用、错误处理与**真实服务链路** | 见下方「验证要求」 |

### 完成标准（作者裁定）

用户可以在界面中完成平台版本的**查看、派生、编辑、保存和删除**，且**来源关系正确**、**发布行为隔离**、**真实 API 链路通过验证**。

### 宿主选择原则

优先评估内容中心 `src/app/[locale]/(console)/content/library/page.tsx`（已有内容详情入口、`ContentLifecyclePanel` 与对话框模式）；若数据获取方式或交互模式更适合，可选**其他现有页面**；**不得**同时改内容中心与发布向编辑器，除非有证据证明单一宿主无法满足需求（证据须进交付记录）。**宿主在开工前先核查并报告，再由作者确认。**

### 验证要求（不得以「组件渲染成功」代替）

① 组件交互测试（含不可读条目、`stale` 状态与错误分支）；② 路由级测试沿用既有 `platform-versions` 测试；③ **真实链路验证**：dev server 上对该端点做真实 HTTP 请求并记录状态码与 payload；若本机限制导致无法进行，必须在交付记录中**明写未做**，不得只写「测试通过」；④ 打包版 Electron 行为按项目规则另行标注是否验证。

### 范围与非范围

本卡**只做界面消费**：**不新增**数据表 / 列 / 迁移，**不新增**发布路径，**不改** C2 发布契约与 `src/features/ai-runtime`。模型层缺口（手写 `save` 版本不带媒体、版本 → 版本派生不支持）**不在本卡修复**，如需修复另立卡。

### 文档一致性说明（2026-10-10，本轮）

- **本轮改动**：§1 增加 `CI-P2-07` 一行（插在 `CI-P2-05` 行之后，保持 P2 分组顺序）；本节为新增；§5 `CI-P2-05` 交付记录末句与 §附录 C 的「下一步」同步更新（指向 `CI-P2-07`，并把 `CI-P7-03` 起始行改为实测 **442**，旧值 437 / 433 保留说明）。
- **位移抵消**：插入 §1 一行会让其后所有行号 +1，为**保住 §13（第 442 行）及附录的既有引用不变**，本轮把 §10/§11 交界处一处**冗余连续空行**合并为一（纯空白，无渲染差异）。
- **因位移同步更新**：§5 内 `CI-P2-05` 交付记录行号由 209 变 **210**，§1 第 49 行、§附录 C A1 行与本句的引用已同步；`CI-P2-04` 交付记录由 196 变 **197**。
- **仍未修正的既有过期引用（仅报告，等作者裁定）**：§1 第 48 行记「§5 第 192 行本卡交付记录」，实测该记录在 **§5 第 197 行**；§1 第 59 行记「§13 第 418–425 行」，实测 `CI-P7-02` 块为 **431–440**；§附录 C A7 行记「§13 第 440 行」，实测 `CI-P7-04` 为 **449**。另有 `docs/development/capability-integration-numbering-map.md` §3 / §4.1 / §4.6 的多条同源过期引用，已在该文档 §4.4 登记句中列明。




## 15. CI-P2-07 交付记录（内容中心多平台版本管理 UI，2026-10-10）

> **位置说明**：与 §14 同因追加于文末——§1 第 50 行（`CI-P2-07`）为**原地等行数替换**（todo → done），本节为**新增**，故 §1–§13 与附录 A–C 的既有行号引用**均未位移**（`CI-P2-04` 交付记录仍为第 197 行、`CI-P2-05` 仍为第 210 行、§13 起始仍为第 442 行）。
> **编号依据**：`CI-P2-06` 已被开发清单 §四 第 279 行占用，故取下一空位 `P2-07`（详见 §14、`docs/development/capability-integration-numbering-map.md` §4.5）；本轮**未改**该清单文件。

**改动内容（唯一宿主：内容中心；未改发布向编辑器）**

| 文件 | 规模 | 作用 |
| --- | --- | --- |
| `src/lib/platform-version-view.ts`（新增） | 178 行 | 纯逻辑：可选派生目标、草稿与「不能保存」判定、限额文案、`stale` 判定、来源标签、错误码 → 文案键映射 |
| `src/components/creation/platform-versions-view.tsx`（新增） | 347 行 | 纯展示：无取数、无状态、无 API 调用（每个分支都可从夹具静态渲染） |
| `src/components/creation/platform-versions-panel.tsx`（新增） | 178 行 | 容器：SWR + `apiPost` / `apiPatch` / `apiDelete`，只打 `/api/content/[id]/platform-versions`，写成功即用响应体替换缓存 |
| `src/app/[locale]/(console)/content/library/page.tsx`（改） | 第 20 行导入、第 396 行挂载 | 内容详情对话框内挂载（与 `ContentLifecyclePanel` 并列），未新增第二个宿主 |
| `src/lib/platform-version-view.test.ts`（新增） | 252 行 / 18 例 | 纯逻辑单测（交互分支在此覆盖） |
| `src/lib/platform-versions-render.test.ts`（新增） | 281 行 / 21 例 | `react-dom/server` 静态渲染冒烟（`environment: node`；**不是** DOM 交互测试） |
| `scripts/platform-versions-ui-smoke.ts`（新增） | 217 行 | 真实浏览器交互冒烟（沿用 `scripts/workspace-overview-smoke.ts` 范式） |
| `src/locales/{en,zh-cn,zh-hk}.json`（改） | 各 **+65** 个 `pv*` 键（三文件均 2159 行、键数一致） | 三语 i18n |

**调用链路**：内容库 → 内容卡片 → 详情对话框 → `PlatformVersionsPanel` → `GET /api/content/[id]/platform-versions`；派生 `POST {platform, mode:"derive"}`；编辑保存 `PATCH {platform, title?, body?}`；删除 `DELETE ?platform=`。四项全部打在 `CI-P2-05` 既有端点上，**未新增路由**；数据只落在内容项自己的 `metadata.platformVersions`。

**边界（诚实性要求，已实现且已断言）**：`titleLimit` / `textLimit` 为 `null` 时文案是「本层不设额度」而不是平台限额；未记录数字的截断不显示 `{limit}`；「生成版本 ≠ 发布」在面板内明写；不可读条目计数显示而非静默丢弃；无标题字段的平台 `PATCH` **不发送 `title`**。

**验证结果（实际命令与结果）**

- `node_modules\.bin\tsc.cmd --noEmit` → **exit 0**
- `node_modules\.bin\eslint.cmd .` → 本卡新增/修改文件 **0 问题**；全仓余 3 error + 1 warning，**全部非本卡**：`tmp-probe-db.cjs`（1）与 `tmp-probe-zod-json-schema.cjs`（2）是 **2026-10-09** 遗留的未跟踪探针脚本（本卡未创建 / 未删除 / 未修改），warning 在 `src/components/agent-chat/chat-conversation.tsx:146`
- `node_modules\.bin\vitest.cmd run` → **142 文件 / 1122 用例全部通过，exit 0**（含本卡新 2 个测试文件的 39 例）
- **真实 HTTP 冒烟**（`next dev` on `127.0.0.1:3210`，`SOCIAL_AUTO_POST_DB_URL=file:<temp>/smoke.db`）→ 状态码与 payload 逐项见下表，全部符合预期
- **真实浏览器交互冒烟**（Chromium，真实仓库 + 同一隔离库）：`node_modules\.bin\tsx.cmd scripts/platform-versions-ui-smoke.ts http://127.0.0.1:3210 <locale>` → **zh-cn 28/28、en 28/28、zh-hk 28/28，三次 exit 0**（断言：面板确实挂在详情对话框内、适配事实与额度文案、派生、编辑保存、删除先确认、无标题平台不臆造标题、计数随服务端、无发布记录、内容状态未改、页面无错误）
- **隔离取证**：冒烟前后真实库 `web-data/social-auto-post.db` 的 `Length` 与 `LastWriteTime` **完全一致**（995328 B / `2026-10-10T04:58:25.6920388+08:00`），隔离库自身增到 421888 B；浏览器冒烟每次自建的内容项在结束时已 `DELETE`。

**HTTP 冒烟逐项（隔离库）**

| # | 请求 | 结果 |
| --- | --- | --- |
| 1 | `POST /api/content`（title / body / type） | **201**，返回内容 id |
| 2 | `GET /api/content/{id}/platform-versions` | **200**，`profiles=28`、`versions=0`、`unreadable=0`、`base.fingerprint=v1:55:846122e5`；profile 含 `titleField` / `composerEntry` / `videoRoute` / `titleLimit=null` / `textLimit=null` |
| 3 | `POST … {platform:"CSDN", mode:"derive"}` | **200**，`versions=1`、`source=derived`、版本 `baseFingerprint` == `base.fingerprint` |
| 4 | `POST … {platform:"no-such-platform", mode:"derive"}` | **400** `INVALID_PAYLOAD` |
| 5 | `POST … {platform:<已知>, mode:"save"}`（无 title / body） | **400** `INVALID_PAYLOAD` |
| 6 | `POST … {mode:"derive"}`（缺 platform） | **400** `INVALID_PAYLOAD` |
| 7 | `PATCH … {platform:"CSDN", body:"hand edited…"}` | **200**，`source=edited`、**`baseFingerprint` 未变**（不重算指纹）、`updatedAt` 前进 |
| 8 | `PATCH … {platform:"no-such-platform", body:"x"}` | **404** `NOT_FOUND` |
| 9 | `GET /api/content/{id}` | **200**，`status=ready`（未被改写）、`metadata` 键 = `type,images,platformVersions` |
| 10 | `GET /api/publish-records` | **200**，**0 行**（未写发布记录） |
| 11 | `POST … {platform:"Threads", mode:"derive"}`（该平台无标题字段） | **200**，`versions=2`，`adaptations` 含 `title-not-offered`，该版本 `title` 为空串（不臆造标题） |
| 12 | `DELETE …?platform=CSDN` | **200**，`versions=1`（余 Threads） |
| 13 | `DELETE …?platform=CSDN`（再删一次） | **200**，`versions=1`（既有语义：删不存在的版本是 no-op） |
| 14 | `DELETE …?platform=WordPress`（从未派生） | **200**，`versions=1`（同上） |
| 15 | `DELETE …`（缺 `platform`） | **400** `INVALID_PAYLOAD` |
| 16–19 | 不存在内容 id 的 `GET` / `POST` / `PATCH` / `DELETE` | 全部 **404** `NOT_FOUND`（`POST` 先查内容项再解析载荷） |
| 20 | `GET /api/content/{不存在 id}` | **404** `NOT_FOUND` |
| 21–22 | 收尾 `GET …/platform-versions`、`GET /api/content/{id}` | **200**，`versions=1`、`base.fingerprint` 与初始相同、`status` 仍 `ready` |

**未验证 / 受限（不写成「通过」）**

1. **没有 DOM 单元测试**：`vitest` 为 `environment: "node"`，仓库无 jsdom / happy-dom / @testing-library。本卡按作者批准的方向（**不新增依赖、不改 `vitest.config.ts`**）把交互分支交给纯逻辑单测 + 静态渲染冒烟，真实交互交给上面的 Chromium 冒烟；**组件层不被称为「DOM 交互测试」**。
2. **打包版 Electron 行为未验证**：本卡未改 Electron 主进程与打包脚本，未做打包产物验证。
3. **浏览器冒烟未覆盖的三个分支**（不可读条目、`stale`、错误分支）只在纯逻辑 / 静态渲染测试中覆盖，未在真实浏览器里构造（构造需直接改写 `metadata_json`）。
4. **模型层缺口不在本卡**：手写 `save` 版本不带媒体；版本 → 版本再派生不支持（`CI-P2-05` 已登记边界）。
5. 本卡**未改** C2 发布语义、**未改** AI Runtime、**未新增**表 / 列 / 迁移；未执行 `git add` / `commit` / `stash` / `clean`。

**环境取证：为何不直接在既有 dev server 上冒烟**：作者 3000 实例持有 Next dev 锁，第二个 dev server 直接退出（连接被拒）；把仓库复制到别处并用**目录联接**复用 `node_modules` 时 Turbopack 报 `Symlink [project]/node_modules is invalid, it points out of the filesystem root`；改用 `--webpack` 后服务端可用但**客户端水合失败**（`Error: invariant expected layout router to be mounted`，页面显示 "This page couldn't load"）。最终方案：**经作者授权**短暂停用 3000 → 用**真实仓库 + 隔离临时库**在 3210 跑完全部冒烟 → 按**原命令**（`cmd /c node_modules\.bin\next.cmd dev --hostname 127.0.0.1 --port 3000 > dev-server.log 2>&1`）原样重启 3000。全程未改 `.env.local`、未写真实库、未动其它未提交改动；临时的仓库副本、目录联接与隔离库**均已删除**（`dev-server.log` 旧内容在重启前已备份到 `%TEMP%\cp-dev-server-before-ci-p2-07.log`）。

**一次环境纠错（必须记录，已修复）**：首次重启 3000 时，本会话**残留的作用域变量** `SOCIAL_AUTO_POST_DB_URL=file:d:/tmp/…/smoke.db` 被 `Start-Process` 继承，该实例因此**指向临时库**（库内 0 条内容，界面看起来是空的）；发现后立即停掉该实例、**清空该变量**后再按其原样重启（日志 `Environments: .env.local`），复核实测 `GET /api/content?page=1&pageSize=3` → `total=19`（作者真实内容），真实库 `web-data/social-auto-post.db` 全程为 `995328 B / 2026-10-10T04:58:25.6920388+08:00`（**从未被写入**，无 `-wal` 残留）。教训：**用 `Start-Process` 代他人拉起进程前，必须先清空本会话的作用域环境变量**（`Remove-Item Env:…`），再启动。

**下一步编号**：主线下一张候选卡仍为 **`CI-P7-03`**（生成前预估与预算控制，§13 第 442 行起）。本卡非阻塞后续（等作者裁定）：① `scripts/platform-versions-ui-smoke.ts` 是否保留为常驻冒烟（现已在 `scripts/` 内、与既有 `*-smoke.ts` 命名一族一致；若不保留，删除该单文件即可）；② 是否为 vitest 增加 DOM 环境（属基建决定，需新增依赖）；③ 是否把「不可读条目 / `stale` / 错误分支」也做成浏览器级夹具冒烟。

> **更新（2026-10-10，本卡交付后）**：`CI-P7-03` 已按作者裁定稿交付并实测，逐条记录见 **§附录 D**；本句的「下一张候选卡」由此推进为 **`CI-P7-04`**（质量与成本优化，§13 第 449 行起）。

---

## 附录 D：CI-P7-03 生成前预估与预算控制交付记录（done，2026-10-10）

> **为什么记在文件末尾**：`CI-P7-02` 的交付记录是**插在 §13 卡体之后**的一行（第 441 行），那次插入把其后所有 §13 行号整体 +1（`CI-P7-03` 442–447、`CI-P7-04` 449、`CI-P7-05` 455 都是插入后实测的值）。本卡的记录改为**追加到文件末尾**，使上述行号**保持有效、不再变动**；§1 状态表第 60 行与编号对照 §3 表第 102 行都指向本附录。
> **交付范围**：作者 2026-10-10 裁定稿的 8 条完成标准（**原卡没有「完成标准」行**，来源与依据见 `docs/development/ci-p7-03-design-draft.md` §2）。**范围 = 生成前预估 → 自然月预算 → 请求发出前拦截 → 执行中预留与回收**这条闭环；`P7-03-04` 三种执行策略**不在本次交付**（设计稿 §2.2 缺口 B 已明列「是否纳入本卡须作者裁定」）。
> **新增代码**：① 纯算术层 `src/lib/ai-budget.ts`（**无数据库、无 runtime 依赖**）——`estimateTokensFromText`（声明式启发，见 `textTokenEstimateMethod`，本仓无 tokenizer）、`estimateAiCallCost`（输出**区间**；未声明输出上限时 `amountMax` 为 `null`，不拿下界充数）、`budgetPeriodOf`（自然月 `[start, end)`，本地时区）、`evaluateAiBudget`（区分 `definite` / `possible`，含 `remaining` / `projectedMin` / `projectedMax`）、`roundAmount`、`aiBudgetPolicies = off|warn|block`、`aiBudgetUnknownCostPolicies = allow|block`（默认 `allow`：缺价不阻断使用，但**不得**当免费）、`aiBudgetEnforcement = "in-process-soft"`、`aiBudgetReservationTtlMs = 30 min`、`defaultAiBudgetSettings`（`off` / 无上限 / CNY / `allow`）。② 闸门层 `src/lib/ai-budget-guard.ts` —— `previewAiBudgetCall`（只读，不占预留）、`beginAiBudgetCall`（**「读本月花费」与「写入预留」是同一个同步步，中间无 `await`**）、`getAiBudgetStatus`（面板数据）、`inFlightAiBudgetReservations` / `reservedAiBudgetAmount` / `releaseAiBudgetReservation`、`aiBudgetBlockedError`（402）、`isAiBudgetRefusal`、`aiBudgetDecisionDetails`（只有计数、金额与原因码：无提示词、无凭据）。③ 错误码 `AI_BUDGET_EXCEEDED`（`src/lib/app-errors.ts`）。④ 校验 `aiBudgetSettingsSchema`（`src/lib/validation.ts` 第 863 行起）。
> **存储与既有契约**：预算设置是 `app_settings` 里的一行（`src/db/repositories/settings.ts:244` `AI_BUDGET_SETTINGS_KEY = "ai-budget"`，`getAiBudgetSettings` / `updateAiBudgetSettings`）——**未新增表、未加列、未改迁移**；坏值**逐字段**回落默认值，默认 `policy: "off"`（一行坏数据不会悄悄开启拦截）。预估与预留**不写入** `ai_usage_ledger.cost_amount`：`cost_source` 仍是原有四值枚举、**没有第五个值**；无价格的调用**预留 0 金额**（不是把费用记成 0，而是「没有可据以占用的诚实数字」），账本行保持 `costSource: "unpriced"` + `costAmount: null`。`src/features/ai-runtime`（冻结面）**未被修改**，本卡只调用它公开的 `resolveRoute`；C2 发布语义（`recordPublishSuccess`）**未被触碰**。
> **界面与路由**：`GET/PUT /api/ai-cost-center/budget`（`route.test.ts` 6 例）、`POST /api/ai-cost-center/estimate`（`route.test.ts` 6 例；只测量 `inputText` 后丢弃，**不写账本、不占预留**）、`src/components/cost-center/budget-panel.tsx` 挂在成本中心页。面板**原样打印** `in-process-soft`，不转述为「硬上限」。三语核对（脚本实测）：面板使用 **51** 个 `t("…")` 键，`src/locales/en.json` / `zh-cn.json` / `zh-hk.json` 各 **2237** 键、互相**零缺键**、51 个面板键在三份里**全部存在**。
> **闸门落点（5 处 / 4 文件，都在 `try` 之外）**：`src/lib/scraper.ts:90` 与 `:145`（摘要 / 改写）、`src/app/api/content/[id]/rewrite/route.ts:87`、`src/lib/agent/langgraph-engine.ts:177`（planner；拒绝后**不**回落到那个会再发一次模型调用的 fallback）、`src/lib/research-extraction/extraction-task.ts:192`。被拒时**没有请求发出**，因此**不写账本行**，也不会被压成「供应商失败」的措辞。
> **实测（2026-10-10）**：`tsc --noEmit` → **exit 0**；全量 `vitest run` → **146 文件 / 1188 用例全通过（exit 0）**。本卡新增 4 个测试文件共 **62 例**：`src/lib/ai-budget.test.ts` 42、`src/lib/ai-budget-guard.test.ts` 8、`src/app/api/ai-cost-center/budget/route.test.ts` 6、`src/app/api/ai-cost-center/estimate/route.test.ts` 6；并在既有 `src/lib/research-extraction/extraction-task.test.ts` 里新增 **4 例端到端闸门用例**（真实数据库 + 真实账本 + 真实价格目录，只 stub 传输）：额度内放行并**回收预留**、账本只留 1 条 `computed` 行；超额度时**发送前拒绝**（零次 chat 调用、账本只剩种子行、素材 `extraction` 仍为 `null`、运行与日志带 `BUDGET_EXCEEDED`）；无价格模型在 `unknownCostPolicy: block` 下拒绝、在 `allow` 下放行并记为 `unpriced` + `costAmount: null`；运行时自己的自纠重试仍算在**一次**受闸调用内且预留照样回收。
> **同一文件里的一个既有计时问题一并修掉（不改产品代码）**：`starts a task once per process and lists it for the console` 用**默认 1 秒**的 `vi.waitFor` 等后台任务，而该任务实测单跑 **670 ms**、与另两个文件并行 **947 ms**——边界恰在 1 秒上。超时后该用例结束时运行仍是 `running`，这个**遗留后台任务**会在下个用例 `beforeEach` 取消 stub 之后触网，401 把共享凭据键标成 `invalid`（`src/features/ai-runtime/key-pool.ts` 的 `diagnoseCredentialFailure` → `markCredentialKeyFailure`），于是本文件后续所有 `prepareChatModel` 都以 `MODEL_CREDENTIAL_UNAVAILABLE (invalid)` 失败——本次全量运行**确实这样红过一次**（5 failed）。修法：等待放宽到 **15 s / 100 ms 轮询**、该用例上限 **20 s**，使运行必然在用例结束前进入终态；修后全量 **146 / 1188 全通过**。
> **未交付 / 诚实边界（不得据此宣称已满足）**：① **`P7-03-04` 三种执行策略（省成本 / 均衡 / 质量优先）一行未写**（`src/**` 内零命中）——设计稿 §2.2 缺口 B 已明列需作者裁定，需另立卡或由作者指定归属；② **完成标准 5「暂停与恢复」不是可持久化的可恢复暂停**：预算拒绝是**终止性失败**（自有错误码 + 402），「继续」= 用户调整预算后**重新发起**（会重新检查），**不存在**「因预算而暂停的运行」这种状态；Agent 路径同样是拒绝 planner 调用并让运行失败，**没有**复用 `paused` / `pendingApproval`；③ **完成标准 3 的并发只到 `in-process-soft`**：同进程内「检查 + 预留」无缝隙，但**跨进程**（dev server 旁的 worker、重启后的进程）各持各的内存预留，**合计仍可能超支**——未新增预算 / 预留表（正是设计稿 §3.4 要求「不加表就必须写明」的那句话）；④ **预留只带周期与币种**（`Reservation = { id, periodKey, currency, amount, at }`，`src/lib/ai-budget-guard.ts:93`），**不带 `runId` / `nodeId`**，所以对账粒度是「周期 + 币种 + 用途」，**逐运行 / 逐节点对账未交付**；⑤ **没有持久化的预算决策记录**：拒绝只活在该次调用的 402 响应与 details 里，面板给的是**当前**投影（已发生 / 未计价行数 / 在途预留），不是决策日志；⑥ **预估是区间 + 声明的方法**（本仓无 tokenizer；未声明输出上限则上界为 `null`），界面写明「预估不是保证价格」；⑦ 验证止于 `tsc` / `vitest`（含 route handler 级）：**未**做预算面板的浏览器级渲染验证（`scripts/` 下无预算冒烟脚本，本卡未新增）、**未**在 dev server 上做真实 HTTP 冒烟、**未**验证打包版 Electron。
> **未触碰**：`src/features/ai-runtime`（冻结面）、C2 `recordPublishSuccess` 的写入顺序与 verify 语义、`cost_source` 枚举、数据库 schema / 迁移；未执行 `git add` / `commit` / `push` / `stash`。
> **下一步编号**：**`CI-P7-04`**（质量与成本优化，§13 第 449 行起）。编号对照见 `docs/development/capability-integration-numbering-map.md` **§3 表第 102 行**（已同步为 `done`）；§1 状态表第 60 行已同步。**交付后的补完记录**（其余调用点接线 + 逐调用点拒绝用例 + 一处测试隔离修复）见文末 **§附录 G**。

---

### 工作区操作事故与恢复（2026-10-10，本卡期间；如实记录，不美化）

> **发生了什么**：本卡收尾的「清理临时文件」一步用了 `Get-ChildItem -File -Filter 'tmp-*' | Remove-Item -Force`，把仓库根目录 **60** 个 `tmp-*` **整批删除**。其中 **38 个是此前各卡留下的取证文件**（`tmp-e2e-baseline*` ×13 = 12 个 `*.json` + `tmp-e2e-baseline.cjs`、`tmp-p1-04-*.log` ×8、`tmp-p1-05-*` ×10、`tmp-probe-{db.cjs,registry.ts,zod-json-schema.cjs}`、`tmp-tools-live-probe.ps1`、`tmp-video-live-probe.ps1`、`tmp-vitest-full.log`、`tmp-vitest-out.txt`；13+8+10+3+1+1+1+1 = 38），而 `docs/e2e-baseline-inventory.md` 第 39/46/64 行与主线 §附录 B 第 802/928/976 行**明确记着这些文件留在工作区**（第 1684 行还把 `tmp-probe-db.cjs` 记为全仓既有 eslint error 的来源）。规则第 3 条要求不得清理用户未提交的工作——**本次清理越界，属本卡的操作事故，不由「它们本来是临时文件」豁免**。
>
> **恢复结果（已逐字节验证）**：38 个取证文件**全部还原**。来源 = Cline 检查点快照 `refs/cline/checkpoints/1791572892968_eslph/20`（2026-10-10 08:39:39）的祖先根提交 `981594f`（提交信息 `untracked files on cline checkpoint`），其树内即含这 38 个未跟踪文件（`git ls-tree -r --name-only 981594f` 命中 38 行）。还原命令 `git restore --source=981594f --worktree -- <path>`（**不带 `--staged`**）：运行前后 `git diff --cached` **均为空**，即**未动 index、未 stage、未 commit**。校验：**38/38** 的 `git hash-object <path>` 与 `git rev-parse 981594f:<path>` **完全相等**（逐字节一致）；抽检 `tmp-e2e-baseline-stage1{,-final}.json`、`tmp-e2e-baseline-check.json` 可 `JSON.parse`；`tmp-tools-live-probe.ps1`（首行 `# CI-P1-03 real-call probe …`）、`tmp-e2e-baseline.cjs`、`tmp-vitest-full.log`（首行 `RUN v4.1.11 D:/…CoolPilot`）内容正常。还原后 `git status --porcelain` 里 `?? tmp-*` 恰为 **38** 条。
>
> **未能恢复的 22 个**：`tmp-budget-all.log`、`tmp-budget-tests.log`、`tmp-eol.mjs`、`tmp-extraction-alone.log`、`tmp-full-suite{,2,3}.log`、`tmp-gate-e2e{,2}.log`、`tmp-i18n-check.mjs`、`tmp-i18n-keys.mjs`、`tmp-install.mjs`、`tmp-p7-03-vitest.log`、`tmp-recover{,2,3,4}.mjs`、`tmp-repair.mjs`、`tmp-repro.log`、`tmp-route-tests.log`、`tmp-targeted-1.log`、`tmp-verify-roundtrip.ps1` —— 均为**本任务自身**在 08:39 快照之后产生的临时脚本 / 日志（**没有**更晚的检查点含它们；本任务此后未再生成检查点）。**已核对：`docs/**` 内对这 22 个文件名做逐名 `Select-String` 实测零命中**，故无任何文档叙述因此失效；本卡结论以正文数字记录，不依赖这些日志文件存在（全量结果可复跑复现，见下方「最终验证」）。
>
> **未提交条目净变化**：恢复后实测 **251 = 92 M + 159 ??**、**删除条目 0**（`git status --porcelain`）。事故前数值未直接实测，按「251 + 22 个未恢复的未跟踪条目」**推断**为 **273 = 92 M + 181 ??**（标注为推断，不作实测断言）。
>
> **纪律修正（本卡起生效）**：① 不再用 `tmp-*` 通配做清理；删除仓库根任何文件前先逐名确认归属与文档引用；② 本卡后续临时产物（含最终验证日志）一律写到 `%TEMP%`，**不在仓库根新增 `tmp-*`**；③ 事故与恢复按上文字面记录，不隐藏、不美化。

#### 顺带发现（**未修改**，待作者裁定）

> `docs/development/capability-integration-numbering-map.md` §3 表内**另有**两处行号与实测不符（本次**未改**，按规则「先报告差异、不顺手修正」）：① 第 **100** 行把 `CI-P7-02` 记为「主线 §13 第 **418–425** 行」，实测 `### CI-P7-02` 标题行 = **431**，其卡体延伸到第 **441** 行（含 CI-P7-02 自己的交付记录行 440）；② 第 **103** 行把 `CI-P7-04` 记为「主线 §13 第 **434–438** 行」，实测 `### CI-P7-04` 标题行 = **449**。两组数字都早于当前 §13 布局（本卡只更正了第 102 行自己那一格，并在同格注明来源与实测值）。同表第 104 行对 `CI-P7-05` 引用的是 `B-11 §7 第 3 条`（非行号），无此问题。

### 最终验证（2026-10-10，恢复动作完成后重跑；其后**仅追加本附录文字**，未再动任何代码 / 配置；三条命令在同一 shell 内串行）

| 命令（规则第 7 条指定的直连二进制） | 退出码 | 实测结果 |
| --- | --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **0** | 无输出 |
| `node_modules\.bin\eslint.cmd .` | **1** | **3 error + 1 warning，逐条均为既有、非本卡**：`tmp-probe-db.cjs:1:26`、`tmp-probe-zod-json-schema.cjs:7:15` 与 `:42:29`（`@typescript-eslint/no-require-imports`）、`src/components/agent-chat/chat-conversation.tsx:146` warning（`react-hooks/exhaustive-deps`）。与主线 §附录 B 第 960 行、第 1684 行记录的历史基线**逐条一致**——这同时反证 38 个取证文件已**按原样**还原（`tmp-probe-*.cjs` 若缺失，全仓会变成 0 error） |
| `node_modules\.bin\vitest.cmd run` | **0** | `Test Files  146 passed (146)`、`Tests  1188 passed (1188)`、`Duration 32.17s`（Start at 10:05:11） |

> 本轮日志写在 **`%TEMP%\cp-ci-p7-03-final\{tsc,eslint,vitest}.log`**，**故意不落到仓库根**（事故纪律修正②）；仓库根本卡**未新增任何** `tmp-*`（`?? tmp-*` 仍为还原后的 **38** 条，全部是既有取证文件）。
> 串行执行的原因：本卡修掉的正是 `extraction-task.test.ts` 里那个 1 秒边界上的计时敏感用例，与其它命令并发会给它加负载——第 1740 行已记录它 670 ms（空闲）/ 947 ms（并行）的实测值。


## 附录 E：CI-IA-01 控制台菜单信息架构重整交付记录（done，2026-10-10）

> **范围**：作者 2026-10-10 的菜单重整要求——把左侧导航从「按开发模块」改为「按用户业务目标」的 **8 个分组**，统一命名并三语同步；**明确不新增任何没有真实页面的占位菜单**。
> **不做**：不改任何路由（30/30 逐条不变）、不改权限（侧边栏本无权限判断，也未新增）、不改 API、不改数据库、不改业务逻辑与组件行为、不移动/新增/删除任何 `page.tsx`、不动左下角帐号菜单。

### 交付内容

| 项 | 内容 |
| --- | --- |
| 单一菜单模型 | **新增** `src/lib/console-nav.ts`：`consoleNavItems`（8 组 / 30 叶子，唯一事实来源）、`consoleMobileNavIds`（5 个移动页签）、`consoleNavOffMenuRoutes`（3 条刻意免菜单路由）、`labelConsoleNav` / `flattenConsoleNav` / `collectConsoleNavGroups` / `consoleNavLeafHref` / `matchesConsoleNavSegment` / `findActiveConsoleNavEntry`。纯数据 + 纯函数，无 DOM 依赖 |
| 布局接入 | `src/components/console-layout-shell.tsx`：内联导航数组改为 `labelConsoleNav(consoleNavItems, t)`；本地 `href` / `isActive` / `leafHref` 助手改为共享函数；移动端页签 id 取自 `consoleMobileNavIds`；顶部标题改用 `activeItem?.name`（未加新状态） |
| 归属与命名（旧→新 30 条逐项映射 + 理由） | `docs/development/menu-information-architecture.md` §4 |
| i18n | 新增 4 个分组 key（`navWorkbench` / `navDataAssets` / `navAppMarket` / `navOperations`）、改名 9 个标签；`zh-cn` / `zh-hk` / `en` 三语同步，**既有 key 名一律不改** |

### 最终结构（8 组 / 30 叶子）

工作台（仪表板·聊天）· 数据与资产（内容中心·研究素材·品牌资料·帐号定位·知识库·产品管理）· 内容创作（AI写作·选题管理·文章创作·配图创作·智能画布[白板/思维导图]）· 发布与渠道（帐号管理·动态发布·影片发布·发布记录·发布排程·内容日历）· 自动化（运行队列·执行历史·执行节点）· 应用与市场（应用商店）· 运营管理（数据中心·产生记录·AI 成本中心）· 系统设置（模型管理·通用设置·工作区）。

### 与建议稿的差异（不机械照搬，逐条给依据）

1. 「动态发布 / 影片发布」放**发布与渠道**（两者终点都是 `publish_records`，且不存在独立的视频创作页）；2. 「配图管理」留**内容创作**并改名「配图创作」（页面就是 AI 生图工作台）；3. 「帐号定位 / 知识库」移入**数据与资产**，删除无页面的「智能配置」空容器；4. 「排程 / 内容日历」移入**发布与渠道**（排程带帐号与内容项，是发布计划）并改名「发布排程」；5. 「营运日志」留**自动化**并改名「执行历史」（读 `/api/runs` 与执行事件）；6. 「数据中心 / 产生记录」与成本中心同入**运营管理**；7. `/settings` 改名「通用设置」以区别于组名；8. 「AI写作 / 文章创作」两条工作流都**保留**（重叠问题登记为遗留，不擅自删页面）。完整表见 `docs/development/menu-information-architecture.md` §5。

### 实测（2026-10-10）

| 命令 / 方式 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**，无输出 |
| `node_modules\.bin\vitest.cmd run`（全量） | **exit 0**：`Test Files 147 passed (147)`、`Tests 1198 passed (1198)`。基线（`CI-P7-03` 附录 D）为 146 / 1188 → 净增 1 文件 / 10 用例**全部来自本卡新增测试**，既有用例零改动 |
| `node_modules\.bin\eslint.cmd .` | exit 1，**问题与基线逐条相同**：3 个 error（`tmp-probe-db.cjs:1:26`、`tmp-probe-zod-json-schema.cjs:7:15` / `:42:29`）+ 1 个 warning（`chat-conversation.tsx:146`）。本卡触碰的文件**零问题** |
| 真实浏览器冒烟（Playwright / Chromium，dev server `:3000`，`zh-cn` / `zh-hk` / `en` 各 37 项） | **111/111 通过**：8 组名称与顺序、每组件数（2/6/6/6/3/1/3/3）、30 叶子且 href 无重复、href 集合与改动前逐条相同、分组收起/展开、深链 `/system/cost-center` 的自动展开与分组+叶子高亮、跨 4 组点击的 URL/标题/高亮、5 个改名标签的真实渲染、控制台无 error、移动端 390px 5 页签与「数据与资产」→ `/content/library`。详见 `docs/development/menu-information-architecture.md` §8.1 |
| 不变式单测 | `src/lib/console-nav.test.ts`（10 例）：结构固定（8 组顺序）、逐条路由（与手写旧清单一字不差）、磁盘 `(console)` 页面 = 菜单路由 + 3 条登记免菜单路由、归属唯一、id/segment 无重复、三语 key 存在、匹配与前缀高亮 5 个边界、5 个移动页签 |

> 日志与冒烟脚本写在 **`%TEMP%\cp-ia-01\`**（`tsc.log` / `vitest-full.log` / `eslint-changed.log` / `menu-smoke.log` / `menu-smoke.mjs`），仓库根**未新增**任何 `tmp-*`。

### 文档一致性说明与本卡副作用

- **本轮改动**：本附录为新增（追加于文末，既有 §1–§15 与附录 A–D 的正文行号**未位移**）；`docs/development/menu-information-architecture.md` 为新增文件；`docs/menu-inventory.md` 新增 §2.1（原 §2 盘点表原样保留为历史证据）；`docs/development/capability-integration-numbering-map.md` 新增 §8 与 §7 第 15 条。
- **一处行号位移（如实登记，待作者处置）**：§1 新增 `CI-IA-01` 一行（插在 `CI-P7` 行之后），因此**第 61 行之后的所有行号整体 +1**；本文件与编号映射中既有的行号引用（如 §13 起 442、§5 的 192/210、§附录 B 的 96 等）随之**全部偏 1**。按规则「先报告差异、不顺手修正」，本卡**未**自行批量改这些引用，交由作者裁定；这与编号映射 §7 第 15 条已登记的同类过期引用同源。
- **未提交改动仍无检查点**：本卡后工作区状态需作者自行核对（不执行 `git add` / `commit` / `push`）。


## 附录 F：CI-IA-02 控制台菜单按商业/产品架构重排交付记录（done，2026-10-10）

> **范围**：作者 2026-10-10 的第二轮菜单要求——在 CI-IA-01 的 8 组结构之上重新确定**商业排序与命名**（内容创作前置、品牌与资产独立、自动化与数据/成本分离、扩展市场保留独立位置但不造页、系统设置收敛到底部），并给移动端 5 个页签补上**独立短标签**；同样**明确不新增任何没有真实页面的占位菜单**。
> **不做**：不改任何路由（30/30 逐条不变）、不改权限（侧边栏本无权限判断，也未新增）、不改 API、不改数据库、不改业务逻辑与组件行为、不移动/新增/删除任何 `page.tsx`、不动左下角帐号菜单。

### 交付内容

| 项 | 内容 |
| --- | --- |
| 组序（唯一事实来源） | `src/lib/console-nav.ts` 的 `consoleNavItems` 重排为 1 工作台 / 2 内容创作 / 3 品牌与资产 / 4 发布与渠道 / 5 自动化 / 6 数据与成本 / 7 扩展市场 / 8 系统设置（叶子数 2/6/6/6/3/3/1/3 = 30） |
| 分组改名（key 不变） | `navDataAssets` → 品牌与资产 / 品牌與資產 / Brand & Assets；`navOperations` → 数据与成本 / 數據與成本 / Data & Costs；`navAppMarket` → 扩展市场 / 擴展市場 / Extensions |
| 其他显示名（key 不变） | `agentChatShortTitle` → AI 对话 / AI 對話 / AI Chat；`navGenerationRecords` → 生成记录 / 生成記錄 / Generation logs（en 值不变）；`navAiWriting` → AI 写作 / AI 寫作 / AI Writing（en 值不变） |
| 移动端短标签 | **新增 5 个 key**（`navMobileWorkbench` / `navMobileCreation` / `navMobileAssets` / `navMobilePublishing` / `navMobileSystem`）+ `mobileLabelKey` 字段；`labelConsoleNav` 解析出 `mobileName`，`console-layout-shell.tsx` 底部栏改读 `mobileName`；`consoleMobileNavIds` 改为 workbench · creation · assets · publishing · system，因此第 3 个页签落点由 `/smart-config/positioning` 变为 `/content/library`（组序变更的必然结果） |
| 依据与逐项理由 | `docs/development/menu-information-architecture.md` §2（商业职责 + 四条排序原则）、§3（职责/输入/输出/边界契约）、§4.1（变化表）、§5.1（判断 #13–21）、§7.1（兼容性核查） |

### 最终结构（8 组 / 30 叶子，商业顺序）

工作台（仪表板·AI 对话）· 内容创作（AI 写作·选题管理·文章创作·配图创作·智能画布[白板/思维导图]）· 品牌与资产（内容中心·研究素材·品牌资料·帐号定位·知识库·产品管理）· 发布与渠道（帐号管理·动态发布·影片发布·发布记录·发布排程·内容日历）· 自动化（运行队列·执行历史·执行节点）· 数据与成本（数据中心·生成记录·AI 成本中心）· 扩展市场（应用商店）· 系统设置（模型管理·通用设置·工作区）。**CI-IA-03（2026-10-10）之后**：本行是 CI-IA-02 时点的结构；其中「动态发布」已改名「动态创作」并由发布与渠道移入内容创作（组内最后一条），「影片发布」仍在发布与渠道；当前结构见 **§附录 J**。

### 与 CI-IA-01 相比的实际变化

| 类型 | 内容 |
| --- | --- |
| 组序 | 4 处位置变化（CI-IA-01 位置 → CI-IA-02 位置）：内容创作 3→2、品牌与资产 2→3、数据与成本 7→6、扩展市场 6→7；工作台 / 发布与渠道 / 自动化 / 系统设置位置不变 |
| 分组显示值 | 3 个（品牌与资产 / 数据与成本 / 扩展市场）；CI-IA-01 改的分组名（内容创作 / 发布与渠道 / 系统设置）不再改动 |
| 叶子显示值 | 3 个（AI 对话 / 生成记录 / AI 写作） |
| 新增 i18n key | 5 个移动端短标签 key（三语同步） |
| 路由 / key 名 / 页面 / 权限 / 数据模型 | **零改动**：30 条 `href` 逐条相同，全部既有 key 名保留，无 `page.tsx` 增删改 |
| 刻意保留（附证据） | 「影片发布」（`zh-cn` 相关文案 51 处用「影片」）、「帐号定位 / 帐号管理」（「帐号」76 处 vs「账号」5 处）、智能画布**嵌套分组**（平铺会丢掉 `/whiteboard` 这条叶子）、「AI 写作 + 文章创作」两条入口（能力重叠登记为遗留，不擅自删页） |

### 实测（2026-10-10）

| 命令 / 方式 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**，无输出 |
| `node_modules\.bin\vitest.cmd run`（全量，默认 reporter） | **exit 0**：`Test Files 147 passed (147)`、`Tests 1200 passed (1200)`、`Duration 30.19s`。基线（CI-IA-01）为 147 / 1198 → 净增 **2 个用例**，全部来自 `console-nav.test.ts` 新增/加强的不变式（组序、移动页签顺序与短标签、同语系标签无重复），**既有用例零改动** |
| `node_modules\.bin\eslint.cmd <本卡 3 个改动源文件>` | **exit 0**，无输出 |
| `node_modules\.bin\eslint.cmd .`（基线对照） | exit 1，问题与基线**逐条相同**：3 个 error（`tmp-probe-db.cjs:1:26`、`tmp-probe-zod-json-schema.cjs:7:15` / `:42:29`）+ 1 个 warning（`chat-conversation.tsx:146`）。本卡触碰的文件**零问题** |
| 真实浏览器冒烟（Playwright / Chromium，dev server `:3000`，`zh-cn` / `zh-hk` / `en` 各 40 项） | **120/120 通过（exit 0）**：8 组名称与顺序（三语实测值）、每组件数 2/6/6/6/3/3/1/3、30 叶子且 href 无重复且与改动前逐条相同、分组收起/展开、深链 `/system/cost-center` 自动展开与分组+叶子高亮、跨 4 组点击的标题与高亮（分组序号实测 2/5/7/8）、3 个改名标签渲染、控制台零 error、移动端 390px **5 页签**短标签与 5 个落点逐一实测。逐项见 `docs/development/menu-information-architecture.md` §8.2 |
| 菜单不变式单测 | `src/lib/console-nav.test.ts`：新增 `expectedGroupOrder` 顺序断言、移动页签顺序与短标签断言、标签无重复断言（+2 用例） |

> 日志与冒烟脚本写在 **`%TEMP%\cp-ia-02\`**（`tsc.log` / `vitest-final.log` / `eslint-changed.log` / `menu-smoke.log` / `menu-smoke.mjs`），仓库根**未新增**任何 `tmp-*`。
> 冒烟脚本自身两处缺陷已修正并如实记录（未 `await` 的移动端断言导致 `page.$$eval` 在 context 关闭后执行、Chromium `ERR_NO_BUFFER_SPACE` 资源压力），修正方式与最终结果见 IA 文档 §8.2 末尾。
> 另注：`vitest --reporter=basic` 在本仓库的 vitest 4 里已不存在（会以「Failed to load custom Reporter from basic」退出 1），故本卡改用默认 reporter 复跑；这是命令用法问题，与代码无关，同一坑早已登记在本文件 §7 第 13 条。

### 文档一致性说明与本卡副作用

- **本轮改动**：本附录为新增（追加于文末，既有 §1–§15 与附录 A–E 正文**未改写**）；`docs/development/menu-information-architecture.md` 重写 §2、扩写 §3，新增 §4.1 / §5.1（#13–21）/ §7.1 / §8.2 / §9（#8–10）/ §11.3，并同步 §6 / §10 / §11.1 / §11.2；`docs/menu-inventory.md` 新增 §2.2 与 §4.1（原 §2、§4 表格原样保留为历史证据）；`docs/development/capability-integration-numbering-map.md` 新增 §9 与 §7 第 16 条。
- **一处行号位移（如实登记，待作者处置）**：§1 新增 `CI-IA-02` 一行（第 **62** 行，插在 `CI-IA-01` 行之后），因此主线**第 62 行之后的所有行号整体再 +1**；叠加 CI-IA-01 的位移，**第 61 行之后的引用相对 CI-IA-01 之前共偏 +2**。按规则「先报告差异、不顺手修正」，本卡**未**批量改写既有行号引用（如 §13 起 442、§5 的 192/210、§附录 B 的 96 等），交由作者裁定。
- **未提交改动仍无检查点**：本卡后工作区状态需作者自行核对（不执行 `git add` / `commit` / `push`）。

---

## 附录 G：CI-P7-03 补完记录（闸门覆盖全部调用点 + 逐调用点拒绝用例 + 一处测试隔离修复；done，2026-10-10）

> **为什么单独一节、且追加在文件末尾**：§附录 D 第 1740 行记的「闸门落点（5 处 / 4 文件）」是 `CI-P7-03` **首次交付**时的落点，而设计稿 §10 列出的调用点共 **14 条**（含 1 条间接点，`src/lib/article-images.ts` 经第 13 条）。交付后按作者要求把其余调用点接线完毕并补上**逐调用点的拒绝用例**。为遵守 §附录 D 头注「追加到文件末尾、使既有行号保持有效」的同一约定，本节追加于文末：`§附录 D` / `E` / `F` 与 §1、§13 的行号**均未移动**；`§附录 D` 第 1745 行只**同行加字**指向本节（未增行）。
> **范围与边界**：本轮**只改测试文件**（7 个）与本附录；**未改**任何产品代码、**未改** `src/features/ai-runtime`（冻结面）、**未改** C2 发布语义、**未加**表 / 列 / 迁移；未执行 `git add` / `commit` / `push` / `stash`。§附录 D 第 1743 行的全部「未交付 / 诚实边界」（`P7-03-04` 三种执行策略未交付、暂停是「终止 + 重跑」、并发仅 `in-process-soft`、预留不带 `runId` / `nodeId`、无持久化决策记录、预估是区间）**继续有效**，本附录不开任何一条。

### G.1 闸门落点（实测，非测试代码：14 文件 / 15 处 `beginAiBudget*`）

`src/lib/scraper.ts:90` / `:145`、`src/app/api/content/[id]/rewrite/route.ts:87`、`src/app/api/content/[id]/translate/route.ts:60`、`src/app/api/content/mindmap/route.ts:94`、`src/app/api/knowledge-base/ai-parse/route.ts:70`、`src/app/api/metrics/insights/route.ts:62`、`src/app/api/positions/generate/route.ts:70`、`src/lib/article-generation.ts:173`（`/api/content/generate` 与 `/api/ai-writing/generate` 共用）、`src/lib/research-extraction/extraction-task.ts:192`、`src/lib/agent/langgraph-engine.ts:177`（planner）、`src/lib/agent/local-tools.ts:217`（`generate_image_prompt`）、`src/lib/agent/chat-thread-title.ts:89`、`src/lib/agent/image-generation.ts:70`（`generateImage` 的唯一调用点，`/api/images` 的闸门由它承担）、`src/worker/runner.ts:291`（playbook 步骤闸门）与 `:123`（导入类 playbook 的逐 URL 闸门，仅 `rewrite: true` 时）。设计稿 §10 的 14 条由此逐条落到代码；各调用点一律在 `try` **之外**取闸门，故被拒时零请求、零账本行，且不会被压成「供应商失败」的措辞。

### G.2 逐调用点的拒绝用例

夹具 `refuseEveryAiBudgetCall()`（各文件本地实现，语义同 `src/test/route-harness.ts` 的共享版本）= 上限 **0** + `policy: block` + `unknownCostPolicy: block`，任何价格目录都不可能「刚好放行」。

| 层 | 覆盖的调用点 | 断言要点 |
| --- | --- | --- |
| 路由级（7） | `content/mindmap`、`content/[id]/translate`、`content/[id]/rewrite`、`knowledge-base/ai-parse`、`positions/generate`、`metrics/insights`、`images` | `status 402` + `code AI_BUDGET_EXCEEDED` + 传输层零调用；再按各自语义加断言：insights 无账本尝试、positions 无本地兜底草稿、translate 无 502 行、mindmap 无 `data` 键、rewrite 文章未被改写、images 无产物 |
| 服务级（5） | `src/lib/article-generation.ts`、`src/lib/scraper.ts`（`rewriteArticle` / `generateTopicPost`）、`src/lib/agent/langgraph-engine.ts`、`src/lib/agent/local-tools.ts`、`src/lib/agent/chat-thread-title.ts` | article-generation：未发送、未建内容项、未写账本行；scraper：保留闸门自己的 `AppError` / 402，**不**被压成 `AI rewrite failed: …`（两个入口都原样抛出）；langgraph：拒绝**不**回落成会再发一次模型调用的 draft 兜底；local-tools：`generate_image_prompt` 以闸门自己的 402 失败；chat-thread-title：非关键路径降级为本地兜底标题且零请求 |
| worker 级（3，本卡原有） | `src/worker/runner.ts` 步骤闸门与逐 URL 闸门 | 见 §附录 D 第 1741 行 |
| extraction（4，本卡原有） | `src/lib/research-extraction/extraction-task.ts` | 见 §附录 D 第 1741 行与 `extraction-task.test.ts` |

**本轮新增 7 例**：`content/[id]/rewrite`（1）、`article-generation`（1）、`scraper`（2）、`langgraph-engine`（1）、`local-tools`（1）、`chat-thread-title`（1）。

### G.3 顺带修掉一处测试隔离缺陷（只改测试）

`src/lib/agent/{chat-thread-title,langgraph-engine,local-tools}.test.ts` 原先用**静态** `import` 引入被测模块，而被测模块 → `lib/ai-budget-guard` → `db/client` 在**模块求值**时就按**安装自己的**库解析 URL，于是这三个文件读的是 `web-data/social-auto-post.db`（闸门一碰数据库就暴露）。修法：改为先 `await import("@/test/route-harness")`（它已把 `SOCIAL_AUTO_POST_DB_URL` 指到临时目录）再动态 `await import(...)` 被测模块，与 `article-generation.test.ts` 同一约定；`beforeEach` 用 `allowEveryAiBudgetCall()` 复位预算行。

**取证**：`web-data/social-auto-post.db` 的 `LastWriteTime` 在该三文件运行前后**均为** `2026-10-10T04:58:25.6920388+08:00`（未变），且同一次运行内 `%TEMP%` 下新增 `coolpilot-route-*` 临时库目录 **3** 个。

### G.4 发现（**未修**，按规则先报告、待作者裁定）

`src/lib/transcription/providers.ts:190` 经 `@/features/ai-runtime` 的 `transcribe` 导出调用**远端语音转写**（**不是** `aiRuntime.*` 的成员，因此设计稿 §10 第 201 行的 `git grep "aiRuntime\." src` 复核没抓到它，§10 的 14 条也不含它）。该路径与本地 `local-windows-speech` 并列，**既无预算闸门也无账本行 / 计价维度**：只加闸门不加计量，会变成「拦一个永远算不出钱的调用」，属本卡范围之外，故登记而不擅自改。

### G.5 实测（2026-10-10，本轮，串行）

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**，无输出 |
| `node_modules\.bin\vitest.cmd run`（全量） | **exit 0**：`Test Files 148 passed (148)`、`Tests 1218 passed (1218)`、`Duration 29.03s`（对照 §附录 F 记录的 CI-IA-02 基线 147 / 1200：**+1 文件 / +18 用例**；本轮新增 **7 例**如上，其余为同一补完任务的更早几轮，本附录不逐条归因） |
| `node_modules\.bin\eslint.cmd <本轮触碰的 12 个测试文件>` | **exit 0**；全仓 `eslint .` 的既有 3 error + 1 warning 基线不变，未新增 |
| 定向复跑 | `scraper.test.ts`（7 例）、`article-generation.test.ts`（10 例）、`content/[id]/rewrite/route.test.ts`（13 例）、三个 agent 测试文件（20 例）全绿 |

> 日志写在本机 `%TEMP%\cp-ci-p7-03-followup\vitest.log`，**未落到仓库根**；仓库根未新增任何 `tmp-*`。
> **本轮未做（不得据本附录宣称）**：未做预算面板的浏览器级渲染验证、未在 dev server 上做真实 HTTP 冒烟、**未验证打包版 Electron**。



## 附录 H. CI-P7-03-A 交付记录（持久化预算预留 / 预算决策 / 逐运行·节点对账）

> **卡片来源**：作者 2026-10-10 裁定「先让预算控制拥有持久、可审计、可对账的执行事实」，即 `CI-P7-03` 的**补完**（不新占编号，顺序 A → B → C → D 中的 A）。
>
> **本附录为文末追加**：§1 / §13 / 附录 A–G 的行号**均未移动**。

### H.1 改动内容

**新增两张表 + 账本一列**（`src/db/client.ts` 的建表清单 + `src/db/schema.ts` 的 drizzle 定义；**不用** drizzle-kit 生成迁移文件）：

| 对象 | 用途 | 要点 |
| --- | --- | --- |
| `ai_budget_reservations` | 一次调用的**预留**（上限，**不是**花费） | `status` = `held` / `settled` / `expired`；`amount` = 该次预估的上限；`period_key` / `period_start` / `period_end` / `currency`；`run_id` / `node_id` / `task_id` / `content_item_id`（业务身份）；`owner`（取预留的进程实例，仅记录"谁"，**不**据此推断存活）；`created_at` / `expires_at` / `settled_at` / `settle_kind` |
| `ai_budget_decisions` | 每一次闸门判定（**含被拒**） | `gate` = `call` / `node`；`status` / `reasons_json` / `policy` / `unknown_cost_policy` / `enforcement`；`limit_amount` 与 `remaining_amount` 在「无上限」时是 **NULL（不是 0）**；`estimate_*`；`reservation_id` / `reservation_amount`；`run_id` / `node_id`。**不存** prompt / response / 凭据 |
| `ai_usage_ledger.budget_reservation_id` | 账本行与预留的**连接键** | 新增列，默认 `''` = 「这次调用没有被闸门预留」（也是本列存在之前所有行的真实含义） |

索引：`(status, period_key, currency, expires_at)`、`(run_id, created_at)`、`(node_id, created_at)`、`(created_at)`、决策表 `(at)` / `(period_key, at)` / `(reservation_id)` / `(run_id, at)`、账本 `(budget_reservation_id)`。

跨进程写等待：`PRAGMA busy_timeout = 5000`（**仅** `file:` 库；设置后**读回校验**，不吻合就 `console.warn`，不静默假装）。

保留期：`aiBudgetRecordRetentionMs` = 180 天；清扫只删除**非 `held`** 的旧行，**live 预留永不删除**。

**产品代码接线（不是只加表）**：

- `src/lib/ai-budget-guard.ts`：进程内 `Map` 预留**整体删除**。`beginAiBudgetCall` = 纯算术判定 →（拒绝则记决策并抛 402）→ `sweepAiBudgetReservations` → **一条原子 INSERT** 取预留 →（未取到则重读状态、以 `hold-lost-to-concurrent-call` 记决策并抛同一 402）→ 返回 handle（带 `reservationId`）。`handle.release()` 改为 **async 且永不抛**，返回 `{settled, alreadySettled, failed}`；`tryAiBudgetCall` 的 `finally` 改 `await`。`beginAiBudgetNode` 也**记录决策**（gate = `node`）。`getAiBudgetStatus` 的 `reserved` / `inFlightCount` 改为读**全体进程**的 live 预留。
- `src/db/repository.ts`（+ `src/db/repositories/ai-budget.ts` 桶）：`readAiBudgetSpend`（**SQL 聚合**，取代原先 5000 行上限的 JS 求和）、`readAiBudgetHolds`、`readAiBudgetPeriodState`、`reserveAiBudgetHold`（原子条件 INSERT）、`settleAiBudgetReservation`（`WHERE status='held'` = 幂等键）、`sweepAiBudgetReservations`（TTL 标记 + 保留期裁剪）、`listAiBudgetReservations` / `listAiBudgetDecisions` / `recordAiBudgetDecision`、`reconcileAiBudgetReservations`。
- `src/lib/ai-usage-ledger-recorder.ts` + `createAiUsageLedgerEntry`：`AiUsageCallContext.budgetReservationId` → 落到每一行账本。
- **15 处闸门落点全部接线**：13 个文件（7 路由 + 6 服务/agent）加 `identity: usageCall`、`usageCall.budgetReservationId = budget.reservationId ?? undefined`、`await budget.release()`；worker 的两处步骤闸门加 `identity: { runId: run.id }`。
- 语义升级：`aiBudgetEnforcement` 由 `"in-process-soft"` → **`"cross-process-atomic"`**；新增 reason `hold-lost-to-concurrent-call`；`budget-panel.tsx` + 三语 locale（`budgetEnforcementGuarantee` / `budgetReasonHoldLost` / `budgetStatusInFlight` 措辞）同步为「共享数据库一条语句」的口径，并**保留**「TTL 后停止计入 / 无价格模型不预留」两条仍不成立的承诺。
- **冻结面未触碰**：`src/features/ai-runtime` 零改动；C2 发布语义零改动；未加/改任何迁移脚本。

### H.2 关键语义（实测口径）

1. **原子准入**：判定与写入是**同一条语句**（`INSERT … SELECT … WHERE spent + held + amount <= limit`，`held` 子查询按 `status='held' AND expires_at > :at`）；`rowsAffected` 为 0 = 被预算拒绝，**异常 = 技术故障**（绝不伪装成 402）。
2. **恢复靠行 + TTL**：`expires_at` 一过即不再计入（每个读都带该谓词），清扫只把它**标记**为 `expired`（`settle_kind='expired'`）。崩溃 = 最多多占 30 分钟，**不会少占**。
3. **结算幂等**：`UPDATE … WHERE id=? AND status='held'`；第二次返回 `settled: false`，**不改行**。预留 id 本身就是幂等键，无需另造 settlement key。
4. **对账靠 id 不靠猜**：join 键是 `ai_usage_ledger.budget_reservation_id`；判定为 `held` / `expired-unspent` / `expired-with-ledger` / `no-ledger` / `ledger-unknown` / `currency-mismatch` / `under-reserved` / `over-reserved` / `matched` 九种，`no-ledger` 与 `ledger-unknown` **各自成一种**（不把「没写账本」和「写不出价格」合并成 0）。

### H.3 调用链路

```
调用点（15 处）
  ├─ beginAiBudgetCall({ purpose, identity: usageCall, … })
  │     ├─ previewAiBudgetCall → readAiBudgetPeriodState(SQL 聚合花费 + 全体进程 live 预留)
  │     ├─ evaluateAiBudget（纯算术；拒绝 → recordAiBudgetDecision 后抛 AI_BUDGET_EXCEEDED/402）
  │     ├─ sweepAiBudgetReservations（TTL 标记 + 保留期裁剪）
  │     ├─ reserveAiBudgetHold（一条 INSERT…SELECT…WHERE；未取到 → 重读 + hold-lost-to-concurrent-call 后抛同一 402）
  │     └─ recordAiBudgetDecision（allowed，带 reservation_id）
  ├─ 调用本身（aiRuntime.*，未触碰）
  ├─ recordAiUsageCall / recordAiUsageFailure（账本行带 budgetReservationId）
  └─ finally → await budget.release() → settleAiBudgetReservation（幂等）
worker/runner.ts 步骤闸门 → beginAiBudgetNode（不取预留，记 gate='node' 决策）→ recordAiBudgetDecision
对账读取 → reconcileAiBudgetReservations({ periodKey | runId | nodeId }) → 预留 ⋈ 账本（按 id）
```

### H.4 验证结果（2026-10-10 本轮实跑）

| 命令 / 证据 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**，无输出 |
| `node_modules\.bin\vitest.cmd run`（全量） | **exit 0**：`Test Files 151 passed (151)`、`Tests 1235 passed (1235)`、`Duration 38.41s`（对照 §附录 G 基线 148 / 1218 → **+3 文件 / +17 用例**） |
| `node_modules\.bin\eslint.cmd <本卡触碰的源文件与测试>` | **exit 0（0 error，0 warning）** |
| **数据库事务能力实测** | `src/db/client.transaction.test.ts`（**新增 3 例**）：drizzle `db.transaction` 在本机 `file:` 库上**可回滚、可提交**（各 2 行一起生效/一起撤销）；单条语句**带参绑定 + `rowsAffected` 精确**（条件不成立时插 0 行、不抛错、不留残行）。**这是本卡全部原子性主张的前提，故先测后用** |
| **跨进程并发（真实子进程）** | `src/lib/ai-budget-guard.process.test.ts`（**新增 3 例**，子进程为 `tsx src/test/ai-budget-probe.ts`，与父进程只共享一个 SQLite 文件）：**8 个进程同时抢「只够 4 个」的额度 → 恰好 4 个通过、4 个拿到 `AI_BUDGET_EXCEEDED`**，表里恰好 4 行 live 预留；父进程（"应用"）自己也随之被拒 |
| **服务重启 / 失败重试** | 同文件：**进程崩溃后留在表里的预留**被新进程按 `expires_at` 计量（live 计、过期不计），且**下一次闸门调用把它标记为 `expired`**（不删除）；`reserve` 后未释放的预留**不**被新进程遗忘 |
| **重复结算** | 同文件 + `src/db/repositories/ai-budget.test.ts`：**两个进程同时结算同一预留 → 恰好一个 `settled: true`**，行只被改一次；「释放失败的预留 → 重试可再取到」（闸门级用例） |
| **账本一致性与对账** | `src/db/repositories/ai-budget.test.ts`（**新增 7 例**）：SQL 聚合与纯函数 `summarizeBudgetSpend` 在同一批数据上**逐字段一致**；九种对账判定各一例（含 `over-reserved` 与 `expired-with-ledger`）；`limit_amount` / `remaining_amount` / `estimate_amount_*` 在无人给数字时为 **NULL**；保留期裁剪删旧行、**live 行留**；闸门级用例另有「一次调用 → 一行账本 → `under-reserved`」的端到端链路 |
| **页面只读性** | `src/app/api/ai-cost-center/budget/route.test.ts` 扩写：读/写预算页前后，**账本行数、预留行数、决策行数三者均不变** |

> 日志在 `%TEMP%\cp-p7-03-a\`（`tsc*.log` / `vitest1.log` / `vitest-final.log` / `guard.log` / `probe.log` / `eslint.log`），**未落仓库根**。

**真实库副作用（如实登记，非测试污染）**：`web-data/social-auto-post.db` 的 `LastWriteTime` 由本卡开工前的 `2026-10-10T04:58:25+08:00` 变为 `2026-10-10T12:36:05+08:00`。原因不是测试写入了它，而是**应用在连接数据库时应用 schema**（`ensureDatabase()` → `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD COLUMN`），本机运行的 dev server 因源码改动重编译时即会执行一次。以**只读**方式复核该文件：`ai_budget_reservations` 与 `ai_budget_decisions` **已建**、`ai_usage_ledger.budget_reservation_id` **已加**，但两张新表 **0 行**、账本 **0 行** → **未写入任何行**，影响仅为新增式 DDL（这也是用户下次运行应用时会自然发生的事）。

### H.5 遗留问题

**阻塞（须作者裁定后才能继续）**：无。

**可延后 / 明确不做**：

1. **预算暂停与续跑**（原 `CI-P7-03` 完成标准 5）**未做** —— 按作者裁定留给 **B**；本卡把"可恢复"所需的事实（预留行 + 决策行 + 身份）备好，但**不**改运行状态机。
2. **三种执行策略**（省成本 / 均衡 / 质量优先）**未做** —— 留给 **C**（须先由作者给策略语义）。
3. **非文本维度闭环**（远端语音转写闸门 + 计量、图片/视频录价界面）**未做** —— 留给 **D**；`src/lib/transcription/providers.ts:190` 的「无闸门 + 无账本行」仍是 §附录 G.4 登记的原状。
4. `spend-truncated` 这条 note **从此不会再出现**（聚合不可能撞行上限）：字段与文案保留，未删（`AiBudgetSpend.truncated` 仍是纯函数的入参）；**页面不会因此说谎**，因为该值只会是 `false`。
5. **打包版 Electron 未验证**、**dev server 上的真实 HTTP 冒烟未做**、**预算面板浏览器级渲染未验证**（与 §附录 G 相同的三项）。
6. `owner` 列只记录"谁取的预留"，**不**用于存活判断；崩溃后的预留只能等 TTL，这是刻意的（重启无法知道另一个进程是否已死）。

### H.6 下一步编号

**待作者指定的下一张卡：`CI-P7-03-B`（预算暂停与续跑）**；顺序 A → B → C → D，允许按实际缺口重新评估。

---

## 附录 I：`CI-AI-IMG-CONFIG` 卡族（文本与图片模型独立配置，2026-10-10 补记）

> **登记缘由**：该卡族由**作者直接授权**，不落在 §3~§9 的任何 P0–P6 小节内，此前**只在 `docs/architecture/*` 有记录**。2026-10-10 复核：本文件与 `docs/development/capability-integration-numbering-map.md` 内 `CI-AI-IMG` 命中数**均为 0**（连 `独立图片` / `openAIImageBaseUrl` 也都为 0）—— 即"架构文档已完成、总计划无对应记录"。§1 状态表已补记 5 行；本附录给出状态、真实证据、未验证项与后续依赖。**本节只登记，不改任何代码。**

### I.1 卡族状态

| 卡片 | 名称 | 状态 | 交付记录 |
| --- | --- | --- | --- |
| CI-AI-IMG-CONFIG-01 | 审计与设计（只读：现状证据、方案 A/B/C、推荐 B+C 的 Gemini 结论、冻结面清单、四阶段计划、测试矩阵） | done（**未改**业务代码 / 数据库 / 迁移） | `docs/architecture/independent-image-provider-configuration.md` |
| CI-AI-IMG-CONFIG-02 | 阶段 1：字段 / 校验 / 默认值 + 图片 Key 独立存储 + 设置 UI（**不触 runtime**） | done | `docs/architecture/ci-ai-img-config-02-delivery.md` |
| CI-AI-IMG-CONFIG-03 | 阶段 2：`openai-image` / `gemini-image` 身份 + 独立端点 + 独立凭据 + 图片模型按能力绑定（**触冻结面**，CR 已批准并实施） | done（作者 2026-10-10 验收：**功能实现成功、真实安装端到端通过**） | `docs/architecture/ci-ai-img-config-03-delivery.md`；CR：`ci-ai-img-config-03-freeze-surface-change-request.md`（:3 状态行 = 已批准并实施，§0~§7 正文未改写） |

### I.2 真实证据（CI-AI-IMG-CONFIG-03；在用户本地安装上、用用户自配端点与凭据跑 1 次真实调用）

- 配置读回：`imageProvider="openai"`、`openAIImageBaseUrl="https://quanzil.com/v1"`、`openAIImageModel="gpt-image-2.5-sunburst"`、图片 Key 已存储（掩码回显）；文本端点仍为 `https://api.deepseek.com` —— 正是"若兜底就会打错地方"的场景。
- `POST /api/images` → **HTTP 201（约 22s）**，`provider="openai-image"`、`model="gpt-image-2.5-sunburst"`。
- 产物：`web-data/artifacts/agent-image-1791624790750-HKrUVD40.png`，1,668,289 字节，PNG 魔数正确，IHDR **1024×1024**（= 配置尺寸）；`GET /api/agent/artifacts?file=…` → HTTP 200 `image/png`，字节数一致。
- 账本 `ai_usage_ledger`：`provider_id="openai-image"`、`endpoint_id="openai-image/default"`、`outcome="success"`、凭据仅掩码、`quantity_json={"images":1}`、`cost_amount=NULL` + `cost_source="unknown"`（**未把未知成本写成 0**）。
- 预算决策 `ai_budget_decisions`：`provider_id="openai-image"`、`route_resolved=1`；同库 17:20 的旧行仍是 `provider_id="openai"` + `route_resolved=0`（`route-unresolved`）→ 本卡落地前图片路由**解析不出来**。
- 文本端点全程未被使用；定向测试 26 通过 / 0 失败；i18n + 冷启动回归 7 文件 / 63 用例全通过。证据留痕：`tmp-ci-img-03-live-verify.log`（凭据全部掩码）。

### I.3 未验证项（**不得写成通过**；详见 -03 交付记录 §3.3）

1. 真实安装上"清空图片 URL → 结构化失败（不回退文本端点）"—— 仅隔离环境自动化覆盖（破坏性操作，会打断用户在用的配置）。
2. **打包版 Electron**：设计稿 §9.3 验收标准 3（`independent-image-provider-configuration.md:395`）明确要求"以打包产物验证" —— 目前**仅 dev server 实测，该条验收标准未满足**。
3. 真实 Gemini 图片调用（只验证了 `gemini-image` 端点行 / 凭据独立 / 可路由）。
4. 真实安装上图片端点"禁用 → 恢复"的 UI 操作。
5. 真实端点上的图片 Key 轮换 / 多 Key 池 / 冷却。

### I.4 后续依赖（作者 2026-10-10 裁定：均为**独立后续事项**，不扩大 -03 范围）

| 事项 | 归属 | 说明 |
| --- | --- | --- |
| 设计文档按 Q4 修订（§4.2 规则 1/3、§5.1、§5.3、§6.3、§6.4 冲突行号见 -03 交付记录 §5）+ **§10 的 Q1–Q4 回填**（`:400-409`）+ 设计稿 §8 阶段 4"清理与文档"（`:363-365`） | CI-AI-IMG-CONFIG-04（**建议编号**，待作者确认） | -03 交付记录 §5 当时只列了 §4/§5/§6 的冲突行，未列 §10 |
| `provider` 新值（`openai-image` / `gemini-image`）在账本 / 预算 / 用量分组与成本中心的归口口径 | 同上（-04） | 可见的行为变化：按 `provider` 分组的统计会分成两条 |
| 图片计量与**定价**（成本口径） | **`CI-P7-05-01`**（本文 §13）+ **§附录 H.5 第 3 条（D）** | 现状 `cost_amount=NULL` + `cost_source="unknown"` 是**正确的未知值处理**；缺的是价格来源 / 计价单位（按张 · 分辨率）/ 币种 / 计费规则。**不新造卡号** |
| 图片端点绑定边界：`ensureLegacyModel`（`src/features/ai-runtime/registry.ts:603-637`）对"先存模型、后存 URL"只置 `enabled=true`、**不重绑 `endpointId`** → 该行不可路由 | CI-AI-IMG-CONFIG-05（**建议编号**，待作者确认） | UI 表单一次性提交（URL + 模型同一次保存）的正常路径不受影响 |
| 旧图片模型行（挂 `openai/default`）的清理提示 | 并入 -04 / -05 | 设计稿 §6.2 约定不删旧行；是否提示属体验项 |

### I.5 下一步（作者指定）：回到 `CI-P5-03` 发布业务闭环，**开工前必须先裁决远程封面问题**

作者指定顺序：**先完成本附录的记录闭环 → 回到 `CI-P5-03`**（-04 / -05 排在其后），不再扩张图片配置功能。

> **必答项（不解决就会"发布成功但封面丢失"）**：发布侧当前**静默丢弃**远程封面，已有实测证据，且已被登记为 CI-P5-03 的决策项：
>
> - 代码事实：`src/lib/publish.ts:34-40` `resolveLocalImagePath()` —— `if (/^https?:\/\//i.test(imagePath)) return "";`（远程封面解析为空串，无任何用户可见反馈）；`resolveLocalVideoPath()` `:42-46` 同一形状。
> - 根因陈述：`src/lib/media-artifact-ref.ts:9-10` —— "nothing could express a *remote* reference at all, which is how the publish path came to drop a remote cover silently"。
> - 实测复现：`tmp-p5-01-import-url.log.json`（CI-P5-01/P5-01-08）—— `POST /api/content/import-url` 201，`imagePath="https://example.com/e2e05-remote-cover.png"` 原样保留、artifacts 37 → 37（未本地化）；同文件 `followUp.publishDropsRemoteCover` 明确写"属 **CI-P5-03** / 审计 C4 决策项"。
> - 缺陷台账：`docs/e2e-baseline-inventory.md:276-277` 缺陷 #3（"`POST /api/content/import-url` 不本地化远程图"），关联 `CI-P5-01-08`。
> - 既有验收口径（旧审计序列"卡 3：A04 远程素材本地化"，**未开始、未冻结**）：`docs/p0-acceptance-and-p1-sequencing.md:199-205` 验收 ③ —— "**发布不再丢弃封面**：`resolveLocalImagePath()` 对远程输入不再是'静默空串'，改为**可解释的失败或本地等价回退，且用户可见**"；`docs/dev-exec-list.md:188-192` A04 同义（复用 `src/lib/remote-image.ts` 的下载 / SSRF 校验 / 大小与超时；失败可见、**不静默丢封面、不伪造成功**）。
>
> **待作者三选一（本附录不代为裁决）**：(a) 导入侧本地化（A04 原口径）；(b) 发布侧解析远程引用（`media-artifact-ref.ts` 指向的方向）；(c) 显式失败 / 用户可见提示（可与 a 或 b 叠加）。**在选定之前不得开工 `CI-P5-03` 的发布成功分支**，否则可能出现"发布成功但封面丢失"。
>
> 另注：旧审计序列的"卡 2 / 卡 3（A04）"同样**未进入 §1 状态表**（其依据文件 `docs/p0-acceptance-and-p1-sequencing.md` 的卡 2/卡 3 状态为"未开始"）；是否把它们并入 `CI-P5-03` 或另立 `CI-` 卡，属作者编号决定。

### I.6 工作区与 Git

本卡族全程**未执行** `git add` / `git commit` / `git push`；用户未提交改动未被覆盖、清理或重置。真实 E2E 在用户本地安装上产生的 1 个产物文件与账本 / 预算行已如实登记（见 I.2 与 -03 交付记录 §3.2）。

---

## 附录 J：CI-IA-03 控制台菜单归属与命名修订交付记录（done，2026-10-10）

> **范围**：作者 2026-10-10 的第三轮菜单要求——直接指定「**动态发布 → 动态创作，并移入内容创作**；影片发布保留在发布与渠道」。本卡先做**只读盘点**（作者目标架构 8 组 × 逐叶子 vs 当前代码），核对结果是：**除这一条叶子外，8 组的顺序、分组名与其余叶子归属均已与目标架构一致**（CI-IA-01 / CI-IA-02 已完成的部分不重做）。因此本卡的实际改动就只有 1 处归属 + 1 处显示名。
> **不做**：不改任何路由（30/30 逐条不变）、不改权限（侧边栏本无权限判断）、不改 API、不改数据库、不改业务逻辑与组件行为、不移动/新增/删除任何 `page.tsx`、不动左下角帐号菜单、不改「影片发布」的归属。

### 交付内容

| 项 | 内容 |
| --- | --- |
| 归属改动（唯一事实来源） | `src/lib/console-nav.ts` 的 `consoleNavItems`：叶子 `posts`（`/creation/posts`）由 `publishing` 移入 `creation`，作为该组**最后一条**；`creation` 6 → **7** 条、`publishing` 6 → **5** 条，叶子总数仍 **30** |
| 显示名改动（key 不变） | `navDynamicPublishing` → 动态创作 / 動態創作 / **Post Creation**（en 由 `Posts` 改为 `Post Creation`，与既有「X 创作 = X Creation」对照一致：配图创作 = Image Creation） |
| 刻意保留（作者明示） | 「影片发布」（`/creation/videos`）**留在发布与渠道**——它走的是三步骤影片发布组装（上传 + 标题/描述/可见性 + 多帐号），不是创作工具。这是对 IA-01 决策 2「终态写 `publish_records` 的入口归发布与渠道」的**唯一例外**，已写进代码注释并由新不变式测试固定 |
| 依据与逐项理由 | `docs/development/menu-information-architecture.md` §3（职责/输入/输出/边界契约，已按新归属改写该行）、§5.2（判断 #22–24）、§6（i18n 改名表）、§7.2（兼容性核查） |
| 测试契约 | `src/lib/console-nav.test.ts`：`expectedOwnership` 的 `creation` 追加 `posts`、`publishing` 去掉 `posts`；新增 1 例不变式「keeps the CI-IA-03 author decision…」（`posts` 属 `creation` 且为组内最后一条、`videos` 属 `publishing`） |

### 最终结构（8 组 / 30 叶子，与 CI-IA-02 组序相同，仅 1 条叶子换组）

工作台（仪表板·AI 对话）· 内容创作（AI 写作·选题管理·文章创作·配图创作·智能画布[白板/思维导图]·**动态创作**）· 品牌与资产（内容中心·研究素材·品牌资料·帐号定位·知识库·产品管理）· 发布与渠道（帐号管理·**影片发布**·发布记录·发布排程·内容日历）· 自动化（运行队列·执行历史·执行节点）· 数据与成本（数据中心·生成记录·AI 成本中心）· 扩展市场（应用商店）· 系统设置（模型管理·通用设置·工作区）。叶子数 **2/7/6/5/3/3/1/3 = 30**。

### 与 CI-IA-02 相比的实际变化

| 类型 | 内容 |
| --- | --- |
| 组序 | **零改动**（8 组顺序与 CI-IA-02 完全一致） |
| 分组显示值 | **零改动** |
| 叶子归属 | 1 处：`posts` 由第 4 组「发布与渠道」移入第 2 组「内容创作」 |
| 叶子显示值 | 1 处：`navDynamicPublishing`（动态创作 / 動態創作 / Post Creation） |
| i18n key | **key 名零改动、未新增 key**（只改 1 个既有 key 的 3 语值） |
| 路由 / 页面 / 权限 / 数据模型 | **零改动**：30 条 `href` 逐条相同（含 `/creation/posts` 本身），无 `page.tsx` 增删改 |
| 移动端 | **零改动**：`consoleMobileNavIds` 仍为 workbench · creation · assets · publishing · system；因 `creation` 首项仍是 `/creation/ai-writing`、`publishing` 首项仍是 `/publishing/accounts`，5 个页签落点**全部未变** |

### 实测（2026-10-10）

| 命令 / 方式 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**，无输出 |
| 定向 `node_modules\.bin\vitest.cmd run src/lib/console-nav.test.ts` | **exit 0**：`Test Files 1 passed (1)`、`Tests 13 passed (13)`（CI-IA-02 为 12 例 → 净增 **1 例**） |
| `node_modules\.bin\vitest.cmd run`（全量） | `Test Files 153 passed / 1 failed (154)`、`Tests 1263 passed / 2 failed (1265)`。**2 条失败全在 `src/worker/runner.test.ts`**（`expected 'paused' to be 'failed'`）——该文件与**在途未提交**的 `src/worker/runner.ts` 属作者的 CI-P7-03 系列工作，主线 **§附录 B-10 第 1385 行**已登记同一基线失败；**本卡未触碰该文件，不属本卡回归**。交付记录整理阶段**复跑一次并留档** `%TEMP%\cp-ia-03\vitest-full.log`：`Test Files 1 failed | 153 passed (154)`、`Tests 2 failed | 1263 passed (1265)`、`Duration 44.68s`，失败仍是同一文件的同两条 |
| `node_modules\.bin\eslint.cmd <本卡 2 个改动源文件>` | **exit 0**，无输出 |
| 真实浏览器冒烟（Playwright / Chromium，dev server `:3000`，`zh-cn` / `zh-hk` / `en` **各 26 项**） | **78/78 通过（exit 0）**：8 组名称与顺序、每组件数 2/7/6/5/3/3/1/3、`/creation/posts` 是「内容创作」组内最后一条且显示名为 动态创作 / 動態創作 / Post Creation、「发布与渠道」不再含 `posts` 且仍含 `/creation/videos`、30 条 href 与改动前逐条相同、`/creation/posts` 与 `/creation/videos` 深链的标题/叶子/分组高亮、移动端 390×844 五页签与 5 个落点、控制台零 error。逐项见 IA 文档 §8.3 |
| 菜单不变式单测 | `src/lib/console-nav.test.ts`：归属期望修正 + 新增 CI-IA-03 不变式（+1 用例） |

> 日志与冒烟脚本写在 **`%TEMP%\cp-ia-03\`**（`menu-smoke.log` / `menu-smoke.mjs`；交付记录整理阶段同一脚本复跑一次 = `menu-smoke-rerun.log`，同样 **78/78 / exit 0**；全量测试复跑留档 = `vitest-full.log`，同样 `153/154` 文件、`1265` 用例、2 条失败仍全在 `src/worker/runner.test.ts`），仓库根**未新增**任何 `tmp-*`。
> 冒烟脚本分 3 次 here-string 追加写入（编辑器单次写入上限），首行 BOM 已由脚本自身剥离；日志为 UTF-8，GBK 控制台直接 `Get-Content` 会乱码，用 `-Encoding UTF8` 或 Node 读取。
> 冒烟在改动**完成后**运行中的 dev server 上执行，**未重启**该实例、**未写入**其数据库（全部只读 GET）。

### 文档一致性说明与本卡副作用

- **本轮改动**：本附录为新增（**追加于文末**，§1 与附录 A–I 正文未改写）；主线 §1 **新增 `CI-IA-03` 一行**（第 **63** 行）；`docs/development/menu-information-architecture.md` 同步 §1–§4、新增 §5.2（#22–24）、§6 增 CI-IA-03 改名表、新增 §7.2 / §8.3、§9 新增第 11 条、§11.1–§11.3 补记；`docs/menu-inventory.md` 新增 §2.3；`docs/development/capability-integration-numbering-map.md` 新增 §11 与 §7 第 19 条（并顺带把 §11.2 里 CP-IA-02 的日志文件名 `vitest-final.log` 更正为实际的 `vitest-full.log`）。
- **一处行号位移（如实登记，待作者处置）**：§1 新增 `CI-IA-03` 一行（第 63 行，插在 `CI-IA-02` 行之后）→ 主线**第 63 行之后的所有行号整体再 +1**；叠加 CI-IA-01/02，**第 61 行之后的引用相对 CI-IA-01 之前共偏 +3**。按规则「先报告差异、不顺手修正」，本卡**未**批量改写既有行号引用（如 §13 起 442、§5 的 192/210、§附录 B 的 96 等），交由作者裁定。
- **两项未随动的差异（只登记）**：目标稿写「发布排期」「执行队列」，实际显示名是「发布排程」（`navSchedules`）与「执行伫列」（`navRuns` 的 `zh-cn`，且「伫」为繁体字形；CI-IA-01 曾刻意对齐既有 `queueRun` 译法）。二者属全库用词问题，已并入 IA 文档 §9 第 10/11 条的「术语统一卡」一并处理。
- **未提交改动仍无检查点**：本卡**未**运行 `git status`，**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`，用户未提交工作未被覆盖或清理。

### 作者验收与关闭（2026-10-10）

> 本节**只登记作者验收结论与后续分派**，不新增任何代码 / 配置改动，也不改写本附录上文与 §1 的既有事实。

| 项 | 结论（作者 2026-10-10） |
| --- | --- |
| 验收 | **通过并关闭（done/closed）**。逐维度确认：菜单结构（8 组 / 30 叶子）、`posts` 归入「内容创作」、三语文案同步、路由与权限边界未改、移动端 5 个落点未变、定向单测 13/13、浏览器冒烟 78/78 |
| 本卡范围 | **不再扩展**；也**不**立即启动新的菜单调整卡（下一张卡据现有代码与真实缺口确定，而非为保持节奏继续调菜单） |
| 「智能画布」归属判定 | **信息架构判断成立**：保留在「内容创作」（本卡已由代码注释 + 不变式测试固定）。**产品价值判断另立**：它与选题 / 文章 / 素材 / 后续 Agent·Workflow 的实际连接**不塞进本卡**，改为先做**只读能力盘点**（不预设结论） |
| 在途问题（独立跟踪） | 全量 `vitest run` 的 **2 条 `src/worker/runner.test.ts` 失败**仍归 **CI-P7-03 系列**（作者在途未提交工作），**不**并入菜单或智能画布任务 |
| 待裁定清单（保留） | IA 文档 §9 的两项遗留——「『AI 对话』与页面标题『Agent 聊天室』不一致」、「『生成记录』的分组归属」——**继续留在待裁定清单**，不因本卡关闭而立即启动术语统一卡 |
| 下一步 | ①「智能画布」已有能力**只读盘点**（AI 生成结果能否保存 / 复用、能否转化为文章大纲或视频脚本，以实际代码为准）；② 由作者据盘点结果与真实缺口指定下一张卡 |




## 附录 K：CI-SC-01 智能画布产物进入文章编辑器最小闭环交付记录（2026-10-10）

> **本附录为追加**（文末新增）；§1 只**新增** `CI-SC-01` 一行与一条登记依据说明，上文正文与附录 A–J **未改写**。卡号来源与作者对三个决策点的裁定见 `docs/development/capability-integration-numbering-map.md` **§12**。
>
> **本卡非目标（作者明示，逐条遵守）**：不重写画布；不新增顶级菜单；不动 AI 写作素材链；不做视频脚本生成；不触 AI Runtime / 预算闸门 / 使用量账本 / 数据库表结构；不动 Drawnix 客户端与其 5 语言 i18n；不清理 `src/components/content-type-workspace.tsx`（0 引用死代码，**只登记**）；不改列表过滤规则与发布语义。

### K.1 断层（以实际代码为准，不采信文档声称）

| # | 断层 | 代码事实 |
| --- | --- | --- |
| 1 | 白板导出进不了文章列表 | 修复前的 `src/app/api/content/whiteboard/route.ts` 只写 `metadata: { source: "whiteboard" }`；`metadata.type` 是控制台**唯一**列表过滤键——`listContentItems()`（`src/db/repository.ts:375` 起，按 `type` 生成 `metadata` 子串条件，且 `type` 必须匹配 `/^[a-z0-9-]+$/i`），文章页请求 `?type=article`（`src/components/creation/articles-workspace.tsx`） |
| 2 | 思维导图**没有**入库出口 | 修复前 `mindMapToMarkdown()` 只有两个消费者：汇出 Markdown（`src/mindmap/mindmap-canvas.tsx` 的 `exportAs("markdown")`）与 AI 往返（`src/mindmap/mindmap-markdown.ts` 的 `markdownToMindMap`）；画布不存在写内容的路径 |
| 3 | 深层导图在编辑器里会退化成字面 `####` | 文章桥 `plainTextToHtml()` 只认 `#{1,3}`（`src/lib/article-themes.ts`），而 `mindMapToMarkdown()` 默认序列化到 `######` |
| 4 | 画布产物在来源列被标成「手动录入」 | `articles-workspace.tsx` 的旧局部函数 `articleSourceKey()` 没有 `mindmap` / `whiteboard` 分支 |
| 5 | 内容中心没有续编入口 | 内容库详情对话框（`src/app/[locale]/(console)/content/library/page.tsx`）修复前是只读面板，没有指向编辑器的链接 |

### K.2 改动内容（与作者裁定的实施范围一一对应）

| 步骤 | 文件 | 改动 |
| --- | --- | --- |
| 1 白板入库类型修复 | `src/app/api/content/whiteboard/route.ts` | `metadata: { type, source: "whiteboard" }`；`type` 默认 `article`，仅当客户端传来的值匹配 `/^[a-z0-9-]+$/i` 时原样采用（与 `listContentItems()` 同一条守卫，避免写入任何列表都读不回来的 kind）；`{ item }` / **201** 响应形状与 `status: "draft"` 未变 |
| 2 思维导图入库 | 新增 `src/mindmap/mindmap-content.ts`；`src/mindmap/mindmap-markdown.ts`；`src/mindmap/mindmap-canvas.tsx` | `mindMapContentDraft(root, fallbackTitle)` 产出 `POST /api/content` 载荷：`title` = 根主题（空则回退 `mmDefaultRoot`）、`body` = `postReadyText` = **子节点**大纲（`mindMapToMarkdown(root, 3, false)`）、`type: "article"`、`source: "mindmap"`；根无子节点时回退整棵树，避免空正文；`mindMapToMarkdown()` 新增第三参数 `includeRoot`（**默认 `true`**，既有调用与汇出行为不变，单测固定）；画布工具栏在「汇出」旁新增「存入内容库」按钮，成功/失败走既有 `notice` 条 |
| 3 来源映射 | 新增 `src/lib/content-source.ts`；`src/components/creation/articles-workspace.tsx` | `contentSourceKey(metadata)`：`mindmap` → `arSourceMindmap`、`whiteboard` → `arSourceWhiteboard`，其后分支（`topicId` > `aiWriting` > `generationType`）与旧实现**逐条一致**，兜底 `arSourceManual`；列表改为 `t(contentSourceKey(item.metadata))` |
| 3′（第 2 步所必需） | `src/lib/validation.ts`；`src/app/api/content/route.ts` | `contentCreateSchema` 增加可选 `source`（默认 `""`）；路由**只在提供时**写 `metadata.source`，默认不写 → 既有 4 个调用方（`articles-workspace.tsx` 新建、`posts-composer.tsx`、`videos-composer.tsx`、`content-type-workspace.tsx`）的 metadata **逐字节不变**（有专门用例固定）。依据：`z.object` 非 strict，未声明的键会被**静默丢弃**——不扩这一处契约，画布来源根本到不了库 |
| 4 续编入口 | `src/app/[locale]/(console)/content/library/page.tsx` | 详情对话框新增「在编辑器中打开」，`href = articleEditorHref(locale, item.id)`（既有 `?edit=<id>` 深链），仅 `metadata.type === "article"` 时渲染；文案复用**既有** `awOpenEditor`（未新增 key） |
| i18n | `src/locales/zh-cn.json`、`zh-hk.json`、`en.json` | 各新增 5 个 key：`arSourceMindmap` / `arSourceWhiteboard` / `mmSaveToLibrary` / `mmSaveToLibraryDone` / `mmSaveToLibraryFailed`；**key 名零改动**，三语键集一一对应（`src/lib/i18n-coverage.test.ts` 强制） |

### K.3 调用链路

```text
白板：Drawnix 导出对话框 → POST /api/content/whiteboard { title, body }
      → createContentItem({ metadata: { type: "article", source: "whiteboard" }, status: "draft" })
      → 内容库列表（无过滤） / 文章创作列表（?type=article → metadata 命中）

导图：工具栏「存入内容库」→ mindMapContentDraft(rootRef.current, t("mmDefaultRoot"))
      → POST /api/content { title, body, postReadyText, type: "article", source: "mindmap" }
      → contentCreateSchema（已声明 source）→ createContentItem({ metadata: { type, images: [], source }, status: "ready" })
      → 文章创作列表 ?type=article → 打开 → /{locale}/creation/articles?edit=<id>（既有深链）
      → 编辑器保存：PATCH /api/content/<id>（载荷不含 type/source；repository 合并 metadata）→ type/source 保持

内容库：详情对话框 →「在编辑器中打开」→ articleEditorHref(locale, id) → 同一 ?edit=<id> 深链
```

### K.4 新增测试（+19 例）

| 文件 | 例 | 固定的事实 |
| --- | --- | --- |
| `src/app/api/content/whiteboard/route.test.ts` | 6 | 201 + `metadata = { type: "article", source: "whiteboard" }` + `status: "draft"`；**真的能被 `listContentItems({ type: "article" })` 检索到**；`body` 与 `postReadyText` 一致；非法 kind（`"White Board!"`）回退 `article`；合法但非 article 的 kind（`post`）原样存且**不**出现在文章列表；无标题时沿用默认标题；**创建 → 编辑器式 `PATCH /api/content/[id]` → 仍能被 `?type=article` 检索到**（`type`/`source` 跨保存不丢） |
| `src/app/api/content/route.test.ts` | 2 | 不传 `source` → metadata **不含** `source` 键（既有调用方不变）；传 `source: "mindmap"` → 落库 |
| `src/mindmap/mindmap-content.test.ts` | 5 | 正文只含子节点（根不重复）；四级深度被夹到 `#`–`###`，且经**真实** `ensureArticleHtml()` 产出 `<h1>/<h2>/<h3>` 且结果中无 `#`；根无子节点回退整棵树；标题取根主题且 `body === postReadyText`；空根回退标题 |
| `src/lib/content-source.test.ts` | 5 | 两个画布来源优先；`topicId` > `aiWriting`；wizard；`generationType` 的 URL / topic；未知或缺失 metadata → 手动录入（不猜测未来来源） |
| `src/mindmap/mindmap-markdown.test.ts` | +1 | `includeRoot: false` 输出分支且层级上移；**默认仍为 `true`**（汇出与 AI 往返不变） |

> 既有用例（如 `src/app/api/content/mindmap/route.test.ts` 对 AI Runtime 与路由契约的覆盖）**未改动**。

### K.5 验证结果（本轮实跑，逐条真实命令与结果）

| 命令 / 方式 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**，无输出 |
| 定向 `node_modules\.bin\vitest.cmd run src/app/api/content/whiteboard/route.test.ts src/app/api/content/route.test.ts src/lib/content-source.test.ts src/mindmap/mindmap-content.test.ts src/mindmap/mindmap-markdown.test.ts src/lib/i18n-coverage.test.ts` | **exit 0**：`Test Files 6 passed (6)`、`Tests 30 passed (30)`（含 `i18n-coverage.test.ts` 3/3，证明三语键集一一对应） |
| `node_modules\.bin\vitest.cmd run`（全量） | `Test Files 1 failed \| 157 passed (158)`、`Tests 2 failed \| 1282 passed (1284)`。**2 条失败全在 `src/worker/runner.test.ts`**（第 89 / 114 行 `expected 'paused' to be 'failed'`），属作者**在途未提交**的 `src/worker/runner.ts`（CI-P7-03 系列；§附录 B-10 与 §附录 J 已登记同一基线失败），**本卡未触碰该文件**。基线对比：改前 **153 文件 / 1265 用例**（2 失败）→ 改后 **158 文件 / 1284 用例**（**同一 2 失败**）= 净增 4 文件 / 19 用例 |
| `node_modules\.bin\eslint.cmd .` | exit 1，报告 4 个问题：仓库根 `tmp-probe-db.cjs`（1 error）与 `tmp-probe-zod-json-schema.cjs`（2 errors）是**作者的未跟踪探测脚本**，`src/components/agent-chat/chat-conversation.tsx:146` 是既有 warning。**可主张的（已收窄，遵作者 2026-10-10 验收意见）**：这 4 个文件**都不在**本卡 19 个改动文件清单内（按时间戳核对），且全量报告里**未出现**本卡改动的任何文件。**不再主张**「改前即已失败」——本轮**未**产出改动前的独立基线日志（不 stash、不回退作者在途改动），故原「改前已存在」的措辞按作者要求撤回 |
| 真实服务器只读冒烟（用户**已在运行**的 dev server `127.0.0.1:3000`，**只发 GET，未写任何数据**） | `/api/content?type=article&pageSize=5` → **HTTP 200**（返回 10 条，`metadata.type` 全部为 `article`）——证明列表过滤语义在真实服务器上成立，且本卡改动已被该实例编译通过；`/zh-cn/creation/articles`、`/zh-cn/content/library`、`/zh-hk/creation/articles`、`/en/creation/articles` → **200 / 200 / 200 / 200**——本卡改动未破坏启动与页面渲染。日志：`%TEMP%\cp-sc-01\smoke-readonly.log` |

### K.6 未运行的部分（**不得写成通过**）

| 项 | 状态 | 原因（实测，非推断） |
| --- | --- | --- |
| 画布按钮点击 → 入库 → 列表出现（**真实浏览器交互**） | **未运行** | 本卡未做浏览器冒烟。写入链路的证据止于**真实路由处理器 + 真实 repository + 真实 SQLite + 真实 `listContentItems()` 过滤**（`whiteboard/route.test.ts` 6 例，其中一例是 201 → 编辑器式 PATCH → 仍可被 `?type=article` 检索） |
| 真实 HTTP 写入探针（隔离数据库） | **未运行**（两次尝试均被本机限制挡住） | ① 在仓库内起第二个 `next dev`：Next 16 报 `Another next dev server is already running`（用户实例 PID 15520 占用 `.next`）→ **不启动服务**；我**不会** kill 用户的运行实例；② 改为在 `%TEMP%` 复制源码 + 对 `node_modules` 建**目录联接**：Turbopack 拒绝（`Symlink [project]/node_modules is invalid, it points out of the filesystem root`）；`--webpack` 的 dev 每个请求 500（缺 `.next/dev/fallback-build-manifest.json`）；`next build --webpack` 亦失败（把 next 的客户端入口解析成跨目录相对路径 `./D:/…/.pnpm/next@16.2.4…/client/next.js`）。脚本与日志留在 `%TEMP%\cp-sc-01\`（`http-probe.cjs`、`next-dev.log`、`build.log`），**仓库根未新增任何文件**（已按时间戳逐条核对：根目录最新两个文件是用户 dev server 的 `dev-server.log` 与 `tsc` 产物 `tsconfig.tsbuildinfo`） |
| 打包版 Electron 行为 | **未运行** | 本卡不含 Electron 侧改动（画布与内容库都渲染在既有页面内）；按规则**不以 dev server 结果冒充打包产物验证** |
| 真实发布（`/api/publish`） | **未运行** | 本卡不发布；发布语义未改（`recordPublishSuccess` 写入顺序、verify 消费 receipt、列表过滤规则全部未触碰） |

> 作者若要亲手补一次真实写入验证，两步即可（**会向该实例的数据库写入 1 条测试条目**，故本卡未代为执行）：`POST http://127.0.0.1:3000/api/content/whiteboard`，body `{"title":"CI-SC-01 冒烟","body":"# 白板\n- 要点"}` → 再 `GET http://127.0.0.1:3000/api/content?type=article`，确认返回中出现该条目且 `metadata = {"type":"article","source":"whiteboard"}`。`%TEMP%\cp-sc-01\http-probe.cjs` 是同一链路（白板导出 → 导图草稿 → 编辑器式 PATCH → 过滤核对）的可复用脚本。

### K.7 工作区与 Git

- 本卡**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`；作者**在途未提交**的 `src/worker/runner.ts`（及其 2 条既有失败）等改动**未被触碰**。
- 证据与探针脚本全部落在 `%TEMP%\cp-sc-01\`（`http-probe.cjs`、`smoke-readonly.log`、`next-dev.log`、`build.log`），**仓库根未新增文件**。
- 唯一由本卡`tsc` 间接更新的既有产物是 `tsconfig.tsbuildinfo`（增量编译缓存，非源码）；用户 dev server 的 `dev-server.log` 因代码改动触发的重编译而追加，其进程**未被停止或重启**。
- **一处行号位移（如实登记，待作者处置）**：§1 在 `CI-IA-03` 行之后**新增 `CI-SC-01` 一行（第 64 行）**，并在表下新增 1 条登记依据说明（第 74–75 行）→ §1 之后的行号整体 **+1**；叠加 CI-IA-01 / 02 / 03，**第 61 行之后的既有行号引用相对 CI-IA-01 之前共偏 +4**。按规则「先报告差异、不顺手修正」，本卡**未**批量改写 §13 起 442、§5 的 192/210、§附录 B 的 96 等处引用；§附录 K 为**文末追加**，故附录 A–J 的引用不受影响。

### K.8 真实浏览器端到端验收（2026-10-10 作者要求补做；**20/21 通过，1 项阻断待裁定**）

> 作者验收意见（2026-10-10）：实现与两个工程决策（扩展 `contentCreateSchema.source` 而非新建写入路径；`includeRoot` 默认 `true`）认可；要求**只补一轮真实浏览器端到端**，并明确：测试条目要**明确标注**、事后**按既有规则清理**；**不得另起 Next 实例**、**不得终止正在运行的 dev server**；真实发布与 Electron 打包**不属于**本卡必须关闭的验证项。

| 项 | 内容 |
| --- | --- |
| 手段 | 本机**既有** Playwright 1.60（`node_modules\playwright`）+ 已缓存真实 Chromium（`%LOCALAPPDATA%\ms-playwright\chromium-1243`）驱动**真实浏览器**，打用户**已在运行**的 `127.0.0.1:3000`；**未**启动第二个 Next 进程，**未**触碰该进程 |
| 脚本 / 证据 | `%TEMP%\cp-sc-01\e2e-acceptance.cjs`（成品日志 `e2e-run-2026-10-10T18-41-15.log`、报告 `e2e-report-2026-10-10T18-41-15.json`、截图 `e2e-A1/A2/A6/A9/B3/B4/D1/D3/D6*.png`）；对照探针 `probe-softnav.cjs` + `probe-softnav.log`；API 结构探针 `probe12/13.cjs` + `probe12.txt`/`probe13.txt`（`ok()` 包装：数据在 `json.data`，`getByRole` 之外的事实） |
| 结果 | **20 PASS / 1 FAIL**：A 链路 9/9、B 2/2 + 1 FAIL、C 1/1、D 5/5、E 2/2 |

通过的关键事实（**真实点击 + 真实写入**，非模拟）：

- **A1–A4**（点画布「存入内容库」按钮）→ 新条目 `metadata = {"type":"article","images":[],"source":"mindmap"}`；正文 = `# 分支一 / # 分支二 / # 分支三`（**只含子节点、根标题不重复、层级在 `#`–`###` 内**）；且能被 `?type=article` 检索到。
- **A5–A10**（真实编辑器）：`?edit=<id>` 打开带入原标题「中心主题」→ 改名 + 在正文打字 → 点「存草稿」→ **真实 `PATCH`**（`status` → `draft`）→ **刷新后标题与新增标记仍在**；返回的 `metadata` 仍为 `{"type":"article","images":[],"source":"mindmap","themeId":"default"}`（**编辑器保存未覆盖来源**）。
- **B1/B2** 内容库按标题搜索能命中该条；详情对话框「在编辑器中打开」`href` = `/zh-cn/creation/articles?edit=<id>`（逐字符比对相等）。
- **C1** 文章创作列表该行「来源」列显示 **思维导图**。
- **D1–D5**（真实白板）：Drawnix 工具栏「匯出到內容庫」→ 对话框正文预览非空（`# 中心主题`）→ 提交 → 新条目 `{"type":"article","source":"whiteboard"}` → 出现在 `?type=article` 列表 → 该行「来源」列显示 **白板**。
- **E/E2 清理**：两轮运行合计删除 **6 条**测试条目（3 条为更早失败运行留下的残留 `UnJvrv…`/`ZIYxj…`/`MIFLxy…`，3 条为本轮新建），每条均为 `delete=200` + 随后 `get-after=404`；每轮末尾 `E2` 复查全量列表**无**任何标题含 `CI-SC-01` 的条目（`remaining=(none)`）。

**唯一失败 B3（阻断项，待作者裁定）**：在内容库详情里**点击**「在编辑器中打开」后，地址栏已变为 `/zh-cn/creation/articles?edit=<id>`，但页面**停在文章列表**（**无任何报错提示**，输入框清单里只有列表的搜索框）→ **用户要求的那条续编路径（点击进入编辑器）不成立**；而**硬加载同一 URL**（新标签/刷新）能正常打开编辑器（A5 与对照探针双证）。

- 独立对照（`probe-softnav.cjs`，只读）：S2 内容库链接 → **软导航 `编辑器打开=false`**，同一 URL **硬加载 `编辑器打开=true`**；S1（选题管理页的既有 `?edit=` 链接）因当前数据无 `contentItemId` → **跳过（未验证，不得写成通过）**。
- 定位（证据支持，**根因未定论**）：`?edit=` 由 `src/components/creation/articles-workspace.tsx:82-83` 经 **`useSearchParams()`** 消费（该页 `src/app/[locale]/(console)/creation/articles/page.tsx:13` 需 `Suspense` 包裹）；实测现象是**软导航时该 hook 未交付参数**，而 `next.config.ts` **未**启用 `cacheComponents` / `ppr` / `staleTimes` 等开关。作者此前在同文件 `:151-160` 注释里已记录过该路由 `useSearchParams` + `Suspense` 的异常（`router.replace` 不提交，production build 实测）。
- 归属（可核）：本卡对 `articles-workspace.tsx` 的改动**只有**「来源列」与相关导入（`git --no-pager diff -- src/components/creation/articles-workspace.tsx` 可验），**未触碰** `?edit=` 的消费逻辑；同一机制的既有跨页入口还有 `src/components/creation/ai-writing/ai-writing-step-output.tsx:127`（AI 写作 → 在编辑器中打开）与 `src/components/generate-content-panel.tsx:213`（其宿主 `content-type-workspace.tsx` 是 0 引用死代码）。既有入口本轮**未运行**（需先产生一次 AI 生成，未为验收引入成本）。
- 处置选项（**本卡未擅自实施**，等作者裁定）：① 另开一张卡把该消费改为读 `window.location.search`（与内容库页既有 `?open=` 的做法一致，见 `src/app/[locale]/(console)/content/library/page.tsx:81-85` 注释：该页刻意避开 `useSearchParams`）+ `popstate` 兜底；② 或让该路由动态渲染；③ 或作为已知缺陷接受，但**不得**在文档/交付里写成「点击即可续编」。
- **口径澄清（实测修正，不是代码差异）**：作者验收表里「正文使用三级标题」实测含义是 **`includeRoot: false` 下子节点从 `#` 起、深度钳制到 `###`**（与 `src/mindmap/mindmap-content.test.ts` 固定的一致），**不是**「正文以 `###` 开头」。本轮 E2E 第一版断言按后者写，属**测试断言写错**（A3 首轮 FAIL），修正断言后 A 链路 9/9；实现与单测**无差异**。
- 本轮仍未运行：打包版 Electron 行为、真实发布（`/api/publish`）、`?edit=` 的既有入口（AI 写作）、`?open=` 的软导航对照。
- **更正（2026-10-10，由后继卡 `CI-ARTICLE-NAV-01` 实测，见 §附录 K.9）**：上面「定位」一行的假设 —— 软导航时 `useSearchParams()` **未交付**参数 —— **不成立**。浏览器侧调用栈证据显示参数**已交付**、工作区 effect **已发出** `GET /api/content/<id>` 并拿到 200，失败原因在消费逻辑本身（「已消费」守卫 ref 在请求在途时即置位 + effect 重跑时的 cleanup 把这次唯一请求作废）。原假设按规则**保留在案**、不删除，以本行更正；B3 已修复，作者验收套件复跑 **21/21**。

### K.9 软导航修复（`CI-ARTICLE-NAV-01`，2026-10-10 作者直派的后继支线）

> 背景：K.8 的 B3 是 CI-SC-01 唯一失败项（真实点击「在编辑器中打开」后停在列表、无报错；硬加载同一 URL 正常）。作者要求**先定位根因再定最小修复**，并明确：**不得预设**必须改成读 `window.location.search`，要先与项目既有方案比较。

| 项 | 内容 |
| --- | --- |
| 结论（更正 K.8 的假设） | K.8「定位」行写的「软导航时 `useSearchParams()` **未交付**参数」**被实测推翻**：参数**已交付**，工作区 effect **已发出** `GET /api/content/<id>` 并拿到 200（浏览器侧调用栈证明发起者是 `ArticlesWorkspace.useEffect`），失败发生在消费逻辑本身。 |
| 根因（实测） | `articles-workspace.tsx` 的 `?edit=` effect 把「该 id 已消费」写在实际请求**开始之前**（`openedTargetRef.current = editorTarget` → `await apiGet(...)`），而 cleanup 会把在途请求作废（`live = false`）。当 effect 在挂载后立刻又跑了一轮（React **开发态**对客户端挂载会多跑一轮 setup/cleanup；本仓库未关闭 `reactStrictMode`，Next 16 App Router 默认 `true`）→ 第 1 轮：置位 ref + 发请求，紧接着 cleanup 置 `live=false`；第 2 轮：因 ref 已等于目标而**早退**（不再发请求）→ 第 1 轮响应回来时 `live=false` → `setEditingItem` **永不执行**。硬加载之所以正常：参数在挂载后的**更新**阶段才到达，effect 只跑一次、中间没有 cleanup。 |
| 证据（可复核） | ① 临时在 effect 各分支加 `console.log` 的真实浏览器轨迹（`%TEMP%\cp-sc-01\probe-nav-console.log`）：软导航 `start → cleanup(live=true) → skip-consumed → resolved(live=false)`；硬加载 `start → resolved(live=true)`。**该临时日志已完整移除**，最终 diff 无残留。② 网络归属探针（`probe-nav-rootcause.log`）：点击后 bare-item 请求由 `ArticlesWorkspace.useEffect` 发起、`pushState` 由 Link 点击产生；软导航后 10s 停在列表、无 `arEditorOpenFailed` 提示。③ 对照探针：硬加载前 `/content/library?open=` 的既有入口在一次挂载里只发 1 次请求（说明该现象只出现在**客户端挂载**，不在水合挂载）。 |

| 修复（最小、复用既有写法） | 把「已消费」的记忆从**请求开始前**改到**请求落地后**（成功与失败两条分支都写），即与 AI 写作向导 `?topicId=` 入口的既有写法一致（`src/components/creation/ai-writing/ai-writing-workspace.tsx:50-71`）。**未**改 `useSearchParams`（实测证明其交付正常，无需替换该 hook）、**未**引入 `window.location.search`/`popstate`、**未**改路由渲染模式、**未**改数据模型 / AI Runtime / 发布链路。 |
| 改动文件 | ① `src/components/creation/articles-workspace.tsx`（仅 `?edit=` effect：ref 写入位置后移 + 3 处 `if (!live) return;` + 说明注释；`git --no-pager diff -- src/components/creation/articles-workspace.tsx` 可核对，CI-SC-01 自身的来源列改动未被触碰）；② `scripts/creator-editor-link-smoke.ts`（回归断言）。 |
| 回归测试（并反向验证） | 在既有 `scripts/creator-editor-link-smoke.ts`（Playwright + 自建/自删 fixture，属项目既有 harness）中补两条**真实触发路径**：**点击内容库链接**进入编辑器、**历史前进**重新进入编辑器；并用 `window` 标记断言点击确实是客户端导航（防止将来变成整页加载后测试仍「通过」）。有效性验证：把修复**回退**后该脚本**恰在「点击后编辑器没打开」处失败**（`The editor never opened after clicking the library link`）；恢复修复后 `exit 0`（JSON `libraryClickOpenedTheEditor` / `historyForwardReopenedTheEditor` 均为 `true`）。另修掉本卡脚本自身的 1 处断言 bug：`waitForFunction` 的谓词被序列化到页面执行，不能引用模块级常量（曾报 `ReferenceError`）→ 改为以实参传入。 |
| 验证结果（真实浏览器，dev server 127.0.0.1:3000；未另起实例、未终止用户进程） | ① 作者验收套件 `e2e-acceptance.cjs` **复跑 21/21 PASS / 0 FAIL**（B3 由 FAIL 转 PASS；2 条测试条目已删、`remaining=(none)`）→ `%TEMP%\cp-sc-01\e2e-run-2026-10-10T19-22-37.log`；② 本卡验收探针 `probe-nav-acceptance.cjs` **9/9**：软导航进入 A、URL 切到 B 后编辑器加载 B、后退回 A、前进到 B、参数被外部移除后 URL 无 `?edit=` 而编辑器仍开（`?edit=` 是**入口不是状态**，与设计注释一致）、刷新后落在列表；③ 回归脚本 `creator-editor-link-smoke.ts` exit 0；④ 历史/网络/控制台三条探针日志（`probe-nav-history.log`、`probe-nav-history2.log`、`probe-nav-rootcause.log`、`probe-nav-console.log`）。 |
| 兄弟入口影响评估（作者要求「只做必要评估」） | `?topicId=`（AI 写作向导）**无同样问题、本卡未改**：其代码形状本就是「settle 后再记」（不会把在途尝试作废）；并用真实浏览器复核「选题管理 → 写这个」（软导航）→ 向导素材框已预填 `选题：<该选题标题>`（探针第 8 项 PASS；临时选题建后即删、`get-after=404`）。`?edit=` 的既有入口 `ai-writing-step-output.tsx:127` 需先真实生成一次，**未运行**；`generate-content-panel.tsx:213` 的宿主仍是 0 引用死代码。 |
| 其它静态/定向检查 | `tsc --noEmit` exit 0；`eslint src/components/creation/articles-workspace.tsx scripts/creator-editor-link-smoke.ts` exit 0；`vitest run src/lib/editor-link.test.ts src/lib/content-source.test.ts` exit 0（URL 契约 + 来源映射）。**未跑全量** `vitest run`（本卡不改接口/数据模型）；`src/worker/runner.test.ts` 的 2 条失败仍是作者在途 CI-P7-03 基线，未触碰。 |
| 数据与进程纪律 | 探针/脚本**自建自删**：内容条目 2 条、临时选题 1 条，均 `delete=200` + `get-after=404`；结束时 `/api/content` 无任何含 `CI-` / `smoke` / `探针` 的条目、`/api/topics` 计数为 0。**未**启动第二个 Next 实例、**未**终止用户 dev server；**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`。 |
| 仍未验证（如实登记） | ① **打包版 Electron** 行为 —— 本卡只在 dev server 实测；且此缺陷的触发条件是 React **开发态**多跑的一轮 setup/cleanup，**生产构建是否曾受影响未测**，不得据此推断「生产也坏过」或「生产一定好」；② 真实发布 `/api/publish`；③ 多语（本轮只跑 `zh-cn`）；④ `?open=` 的软导航对照（本轮改用更直接的同类证据：`/content/library` `?open=` 硬加载单次请求）。 |
| 行号说明 | §1 在 `CI-SC-01` 行之后新增 `CI-ARTICLE-NAV-01` 一行（第 65 行）并在表下新增 1 条登记依据说明 → 第 65 行之后的既有行号引用在既有 +4 基础上**再 +1**；按规则只登记、不批量改写既有引用。§附录 K.9 为**文末追加**，附录 A–J 引用不受影响。 |


## 附录 L：CI-P7-04 质量与成本优化交付记录（done，2026-10-11）

> **为什么追加在文件末尾**：与 §附录 D / H 同一约定——交付记录**追加到文件末尾**，§1 与 §13（`### CI-P7-04：质量与成本优化` 标题行仍为 **465**、卡体 **465–469**）的行号**保持不变**；§1 第 60 行那一格只做**同行改写**，未增行。
> **交付范围**：§13 第 467–469 行三条 —— `P7-04-01`（首轮通过率 / 人工修改幅度 / 平均重试次数 / 内容采用率）、`P7-04-02`（单位合格产出的成本 = 优化目标函数）、`P7-04-03`（基于真实数据提出优化建议；用户确认后才调整策略）。落点是「质量与优化」页签本身：**真实读数 → 单位成本 → 可解释建议 → 一键应用**这一整圈。
> **不属本卡**：账本导出；任何形式的「质量评分」（本页不产生分数，也不把「请求成功」说成「质量好」）；超出「已发布 = 采用」的采用判定（属 P8-07 可观测性 / 评估）。

### L.1 交付物（真实文件与实测行数）

| 层 | 文件 | 行数 | 作用 |
| --- | --- | --- | --- |
| 纯函数（可单测） | `src/lib/quality-cost.ts` | 612 | 调用质量（沿 `parentUsageId` 重建调用链）、采用率、人工改写信号、目标函数（按币种）、5 条建议规则与其 payload / applied 类型 |
| 其单测 | `src/lib/quality-cost.test.ts` | 500 | **27 例**：只钉算术与口径，不依赖 DOM / 库 |
| 读库 | `src/db/repositories/quality-cost.ts` | 140 | 状态聚合（`content_items.status`）、已采用 id 列表、逐条内容的平台渲染扫描（带行数上限） |
| 接口 | `src/app/api/ai-cost-center/quality/route.ts` | 168 | `GET`（**只读**，窗口 = 与相邻页签同一条日历规则）+ `POST`（**先重新推导建议**，成立才写） |
| 其测试 | `src/app/api/ai-cost-center/quality/route.test.ts` | 331 | **10 例**：HTTP 契约（含 `409` / `400` / 只读不变式 / 币种除法 / 渲染版本信号） |
| 页面 | `src/components/cost-center/quality-panel.tsx` | 511 | 九个读数 + 目标函数表 + 建议卡（basis / effect / risk）+ 唯一那个会写设置的按钮 |
| 接线 | `src/components/cost-center/cost-center-client.tsx` | +6 / −18 | 接入面板、删掉「未开工」占位与不再需要的 `tabTasks` |
| 请求校验 | `src/lib/validation.ts` | +32 / −3 | `aiQualitySuggestionRequestSchema`（body 只允许一个建议 id） |
| 文案 | `src/locales/en.json`、`zh-cn.json`、`zh-hk.json` | 各 +121 / −2 键 | 本卡新增 **79 个 `quality*` 键**（三语同步）、删除 2 个占位键（`costCenterTaskQuality` / `costCenterStubNote`）；同一次 diff 里其余新增键来自工作区**其他在途卡**（`imageEstimate*` / `budget*` / `modelPriceUnit*` / `runPause*`），本卡未触碰 |

### L.2 口径：这一页把「不知道」当读数，而不是当 0

| # | 约束（写进类型、文案与测试，可在代码注释里逐条核对） |
| --- | --- |
| 1 | **没有分母的比率一律 `null`，永不 `0`**：窗口无调用 → 首轮通过率 `null`；无采用产出 → 单位成本 `null`；无平台渲染版本 → 人工改写率 `null`。页面上与 API 里都读作「无法计量」。 |
| 2 | **`人工修改幅度` 只报得到的那一半**：本安装只存「某个平台渲染版本被人工重写过」与时间戳（`platformVersions` 的 `source`），**不存前后文本**，条目自身的 `updatedAt` 又会因任何写入而变动 → 幅度**不可测**。页面因此给出「人工重写过的渲染版本占比」并**显式**声明 `magnitudeRecorded: false`，不编造字符数（这正是卡面「人工修改幅度」的诚实边界）。 |
| 3 | **`首轮通过率` 的定义收窄到读得到的调用**：一次调用只发了一个请求、那个请求是该调用的**第一个**请求（`attemptIndex === 0`）、且成功。沿 `parentUsageId` 找不到前任的请求（前任落在窗口外）**不计入分子也不计入分母**——但**仍计入 `calls` 与 `requests`**，并单独报出 `unresolvedPredecessorRequests`，因此两个通过率是**偏保守**而不是偏乐观。自纠重试与密钥轮换 / 降级同列不同因，只能沿调用链读，不能只看 `attempt_index > 0`（P8-01 的既有纪律）。 |
| 4 | **`平均重试次数` 以 `requestsPerCall` + `retryShare` 表达**，口径 = 「不是该次调用的第一个请求」，界面上不写成「自纠次数」。 |
| 5 | **目标函数 = 已采用产出的归因金额 ÷ 已采用产出数**，**按币种分别算**（不跨币种相加）；窗口内**没有指向已采用产出的**金额**不丢弃**，单列 `unattributedByCurrency`；无法定价 / 未计量的请求数单列 `unpricedRequests` / `unmeasuredRequests`，金额不完整时单位成本标为下限（`≥`）。 |
| 6 | **采用 = 内容状态到达 `posted`**（真实发布），页面上明确写出「采用不代表内容好」。 |
| 7 | **5 条建议规则各自携带自己的 basis**，标题与数字永远来自同一条规则；建议只有三种动作：`strategy`（唯一会写设置的）、`link`（价格目录 / 预算页签）、`none`（明说「这条背后没有开关」）。 |
| 8 | **POST 只带一个建议 id**，档位在请求到达时由服务端**重新推导**：premise 不再成立 → `409 suggestion-not-applicable`（`details.applied: false`），**不写任何设置**；body 非法 → `400 INVALID_PAYLOAD`。写入成功后返回的是**写完之后的窗口**，页面不再自行猜测变化。 |
| 9 | 本卡写入的只有预算的**执行档位**（`strategy`），不改模型路由 / 不改回复长度 / 不动历史账本行；`strategyLines`（档位自身的停止线）来自服务端 `aiBudgetStrategyLines`，页面不自行转述。 |

### L.3 验证结果（本轮实跑，逐条为命令 + 真实输出）

| 检查 | 命令 | 实测结果 |
| --- | --- | --- |
| 本卡定向单测 | `npx vitest run src/lib/quality-cost.test.ts src/app/api/ai-cost-center/quality/route.test.ts` | **exit 0**：`Test Files 2 passed (2)`、`Tests 37 passed (37)`（纯函数 27 + 接口 10） |
| 全量单测 | `npx vitest run` | **exit 0**：`Test Files 167 passed (167)`、`Tests 1408 passed (1408)`、`Duration 42.82s`。相对本卡开工时的既有基线**净增 2 文件 / 37 用例，全部来自本卡**；既有断言零改动。**如实登记一处口径变化**：此前各卡登记的 `src/worker/runner.test.ts` 2 条失败在本轮**不再复现**（工作区其他在途改动所致，**本卡未触碰该文件**，不据此声称「本卡修好了」） |
| 类型 | `npx tsc --noEmit` | **exit 0**（含面板对 `AiBudgetStrategyLines` 的新引用与 schema 泛型） |
| 静态检查 | `npx eslint` 本卡 8 个改动文件 | **exit 0 / 0 problems**。初跑有 **2 条 warning**（面板里 `budget` 解构未使用、测试里一个未用 import）：均在卡内修掉——测试删掉未用 import；面板改为把**服务端 `strategyLines` 里「当前档位自身的停止线」印在建议卡上**（与预算页签同一读法、同一 payload 字段，并让文件头注释与实现重新一致） |
| 三语完整性 | `node %TEMP%\cp-p7-04\check-keys.cjs`（本卡取证脚本，未落到仓库）+ 三文件键集合比较 | **exit 0**：`ok: 214 referenced keys resolve in all 3 locales`；**三文件键集合排序后完全一致**、各 **2378** 键；删除的 `qualitySuggestionRule` 键与其引用**一并移除**（`grep -r qualitySuggestionRule src` = **0 命中**） |
| 真实接口（作者正在跑的 dev server `127.0.0.1:3000`；**未另起实例、未终止用户进程**） | `GET /api/ai-cost-center/quality?range=7` | **200**，1804 字节，真实 payload：`calls 6 / requests 6 / retries 0 / retryShare 0 / requestsPerCall 1 / singleRequestSuccessRate 1 / firstRequestSuccessRate 1 / failedCalls 0 / unresolvedPredecessorRequests 0`；`content created 20 {draft 7, ready 13, posted 0, failed 0} / adopted 0 / adoptionRate 0`；`humanEdits versions 0 → editRate null / magnitudeRecorded false`；`objective adoptedOutputs 0 / tokensPerOutput null / byCurrency [] / unpricedRequests 5 / unmeasuredRequests 1 / costIsComplete false`；`suggestions [record-prices(link→价格目录), review-adoption(none)]`；`budget.settings {policy off, monthlyLimit null, currency CNY, strategy balanced}`。**读数与库里的真实状态一致**：价格目录为空 → 只给「补录价格」；无 `posted` 内容 → 只给「复核采用率」，且单位成本如实为「无法计量」。证据：`%TEMP%\cp-p7-04\live-get.json` |
| 真实接口（**无写入**的拒绝面） | `POST /api/ai-cost-center/quality?range=7`，body `{"suggestionId":"review-adoption"}` | **409**（该建议 `action: none`，服务端重新推导后拒绝）——**未写任何设置**，符合「先确认、且只写档位」的约定 |

### L.4 未验证 / 遗留（如实登记，不掩盖）

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | **本卡未跑真实浏览器（Playwright）渲染验证** | 新页签的 UI 层只有 `tsc --noEmit` + `eslint` + 接口契约测试三层保障；本轮 live 验证止于 **API**。页面的空态 / 降级态由服务端读数决定，DOM 断言（点击面板上的按钮、看到 `applied` 提示条）**未在浏览器里跑过** |
| 2 | **未在真实库上真的点一次「应用」** | 那会改写作者真实库里的预算档位，故本轮**故意不点**；写入路径只在**临时库**上由 `route.test.ts` 覆盖：`200` + 写入后状态、`409` 陈旧前提（`suggestion-not-applicable`）、`409` `action: none`、`400 INVALID_PAYLOAD`（含空 body / 未知 id），以及「全部导出的 `qualitySuggestionIds` 都能被接受」 |
| 3 | **`人工修改幅度` 的「幅度」在本安装中不存在** | 不是实现缺失，而是**数据不存在**（无前后文本；条目 `updatedAt` 会因任何写入变动）。页面与 API 都以「无法计量 + 原因」呈现，且带显式布尔 `magnitudeRecorded: false`；将来若要真幅度，须**先有存储**（新卡） |
| 4 | **真实数据只走到了空态 / 降级态** | 本轮库里 `posted = 0`、价格目录为空 → 页面走的是「无单位成本 + 两条保守建议」。反之：非空的目标函数表、`switch-to-cost-saving` 按钮、`applied` 提示条只由**临时库**单测覆盖，**未在真实库的自然状态下见过** |
| 5 | 打包版 Electron 行为 | 各卡共通基线，本卡同样**只在 dev server 实测**（未打包） |
| 6 | 窗口边缘口径 | 被窗口切开的一次调用在两侧**各计一次**（`calls` 与金额同此口径），已在读数注释与源码说明中写明，属**已知取舍**而非缺陷 |

### L.5 登记与下一步

> **登记**：§1 第 60 行（`CI-P7-03…CI-P7-05` 行）**同行改写**为「`CI-P7-04` 已于 2026-10-11 交付并实测」；编号对照见 `docs/development/capability-integration-numbering-map.md` **§3 第 103 行**（已由 `todo` 改为 `done`）与同文件新增 **§14**。
> **下一步编号**：**`CI-P7-05` 覆盖全部 AI 能力与 Marketplace**（主线 §13 第 **471** 行起）；其中的 `CI-P7-05-01`（图片 / 视频 / 语音 / Embedding 接入同一计量与**定价**）与 **§附录 I** 及 **§附录 B-11 §7 第 3 条**的遗留一致 —— 本卡的读数已经把这条缺口的后果摆在界面上：`unpricedRequests` 非零时，「单位合格产出的成本」只能是下限或「无法计量」。
> **Git 纪律**：本轮**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅用只读 `git status` / `git diff` 取证）。工作区基线本轮实测 **116（19 M + 97 ??）**；仓库根 `?? tmp-*` = **73**，**本卡未新增任何仓库根临时文件**（日志与证据落在 `%TEMP%\cp-p7-04\`）。

## 附录 M：CI-P7-05-02 按运行与节点的成本交付记录（done，2026-10-11）

> **为什么追加在文件末尾**：与 §附录 D / H / L 同一约定——交付记录**追加到文件末尾**，§1 与 §13（`### CI-P7-05：覆盖全部 AI 能力与 Marketplace` 标题行仍为 **471**、卡体 **471–476**，行号本轮实测）的行号**保持不变**；§1 第 60 行那一格只做**同行改写**，未增行。
> **交付范围**：§13 第 **474** 行这一条 —— `P7-05-02`「Agent / Workflow 的**节点级调用记录**、**总成本**与**失败重试成本**」。落点是成本中心「调用明细」页签里的新卡片 **「按运行与节点」**：一次执行的账面金额（= 它自己的节点行之和）+ 逐节点明细 + 失败成本 + 重试成本，四种读数**全部读自同一个窗口的同一批账本行**。
> **不属本卡**：图片 / 视频 / 语音 / Embedding 的录价入口（`-01`）；Marketplace 扩展的归属字段（`-03`）；「无法准确计量」的显式标记体系（`-04`）；账本导出；任何跨币种相加；以及**任何写入**（本卡是纯只读读数）。

### M.1 交付物（本卡真实改动）

| 层 | 文件 | 本卡改动（实测） | 作用 |
| --- | --- | --- | --- |
| 类型 | `src/lib/types.ts` | 新增 `AiUsageRunNodeCost`（第 **1100–1117** 行）与 `AiUsageRunCost`（第 **1132–1164** 行），并把 `byRun` 接到 `AiCostCenterCallsPayload`（第 **1199** 行） | 把「运行 = 节点行的**划分**」「重试 / 失败成本是**同一批请求的两种读数**而不是两笔账」写进类型注释，界面上的读法有处可查 |
| 纯函数（可单测） | `src/lib/ai-usage-ledger.ts` | 新增 `summarizeLedgerByRun`（配套 `rollLedgerRows` / `ledgerEntryRepeatsCall` / `summarizeRunNodes`） | 只对**已取出的窗口行**做滚账：先按 `runId` 分组、组内再按 `nodeId` 分桶、每次尝试**只进一个桶**，然后分别给出账面 / 失败 / 重试三种读数 |
| 接口 | `src/app/api/ai-cost-center/calls/route.ts` | **+4 行**：`summarizeLedgerByRun` 的 import、两行注释、`byRun: summarizeLedgerByRun(inWindow)` | 与 `byContent` 共用同一条 `inWindow`，所以这张卡不随上表的**筛选器 / 翻页**跳动 |
| 页面 | `src/components/cost-center/cost-center-client.tsx` | `callByRun`（第 **204** 行）、`amountCell()`（第 **234–247** 行：`≥` 下限标记 + 未计价徽标 + 「无金额读数」）、`retryText()`（第 **250–261** 行：重试数 + 未定位前任的标注）、`ConsoleCard`（第 **789–882** 行：运行信息 + 节点表 + 合计行 + 两条常驻说明） | 一张卡里同时给出「账」（合计）与「明细」（节点行），并让「不知道」在界面上看得出来 |
| 单测（口径） | `src/lib/ai-usage-ledger.test.ts` | 新增 `describe("run and node cost readers (CI-P7-05-02)")`（第 **822** 行起、文件最后一个 `describe`，**6 例**） | 钉住：划分、失败按其自报金额计入、两种读数不相加、前任在窗口外的重试、未记录 run / node 的桶、空账本 |
| 单测（契约） | `src/app/api/ai-cost-center/calls/route.test.ts` | 新增 **1 例**（+116 行） | 在**临时库**里真写账本行（含 1 条失败、1 条重试、1 条未计价），逐字段断言 `byRun`，并对答复里**每一个** run 断言 `sum(nodes.attempts) === attempts` |
| 文案 | `src/locales/en.json`、`zh-cn.json`、`zh-hk.json` | 三语各新增 **17** 个 `costCenterRuns*` 键（实测；三语键集合完全一致） | 卡标题 / 注脚 / 列头 / 「未归类」名 / 下限与未解析重试两种标记 |

> **同一 diff 里不属于本卡的改动**：三语 locale 本轮共新增 **140** 键（本卡占 17），其余来自工作区**其他在途卡**（预算 `budget*`、质量 `quality*`、预估 `estimate*` 等）；`src/lib/types.ts`（+92）、`src/lib/ai-usage-ledger.ts`、`src/lib/ai-usage-ledger.test.ts`（+227，同文件另有两个在途卡新增的 `describe`）与 `cost-center-client.tsx`（+157）的文件级 diff 同样含这些卡的改动，本卡**未触碰**它们的逻辑。

### M.2 口径：把这四张读数钉成可以互相验收的东西

| # | 约束（写进类型注释、界面文案与测试，可逐条在源码里核对） |
| --- | --- |
| 1 | **运行总额 = 它自己的节点行之和**：节点是一份**划分**——每条请求恰好进一个桶（有 `nodeId` 的进对应节点，没记的进 `''`）。所以「合计」能被「明细」验算，而不是两个各自算出来的数字。路由测试对答复里**每一个** run 都断言 `sum(nodes.attempts) === attempts`，不只对主角那一个。 |
| 2 | **重试成本与失败成本是同一批请求的两种读数，永不相加**：一笔请求可以**既是**重试（重复了它调用里的前一笔）**又是**失败，把两张表相加就会把同一笔请求算两次。卡片下方常驻一句 `costCenterRunsRetryOverlap` 把这条写在用户眼皮底下；唯一那笔「总和」是账面金额 `costByCurrency`。 |
| 3 | **失败的请求按其自己报出的金额与 token 计入，不当作免费**：失败不等于没花钱（模型已经跑过）。因此失败行照常进 `costByCurrency` / `totalTokens`，另由 `failureCostByCurrency` 回答「这些钱花在了没成功的请求上」。 |
| 4 | **没图的地方一律是「下限」，不是 0**：无法定价的行进 `unpricedAttempts`、未计量的行进 `unmeasuredAttempts`，对应读数标 `≥` 并挂「有未计价请求」徽标；两者的分别沿用 CI-P7-01 / -02 的既有定义。窗口里**一条金额都没有**时，界面写的是「无金额读数」（`costCenterSourceNoAmount`）——与「金额为 0」在视觉上就是两句话。 |
| 5 | **找不到前任的重试仍算重试，但不编造它重复了什么**：前任落在本次读取的行之外时，仍计入 `retries`，另报 `unresolvedRetries`，单元格标「其中 N 条看不到前置请求」+ 卡片注脚。这条与 §附录 L 里 `unresolvedPredecessorRequests` 的保守口径同源（宁可少说，不猜）。 |
| 6 | **未记录 run / 未记录 node 的行保留在读数里**：`''` 桶分别显示为「未归类（未记录运行）」与「未记录节点」，**不折进任何命名节点、也不丢行**——「漏记」必须看得见，这正是 §13 第 **476** 行 `-04` 那条纪律的同族要求。 |
| 7 | **金额按币种分别给出，不跨币种相加**（沿用 CI-P7-02-04 / 05 的既有纪律）：`costByCurrency` / `retryCostByCurrency` / `failureCostByCurrency` 都是数组，页面上按币种并列。 |
| 8 | **这张表跟随窗口，不跟筛选器**：与 `byContent` 同一条 `inWindow`，所以上表换筛选条件 / 翻页时，运行与节点的读数**不动**（它答的是「这个窗口里发生过什么」，不是「这一页里有什么」）。 |

### M.3 验证结果（本轮实跑，逐条为命令 + 真实输出）

| 检查 | 命令 | 实测结果 |
| --- | --- | --- |
| 本卡定向单测 | `npx vitest run src/lib/ai-usage-ledger.test.ts src/app/api/ai-cost-center/calls/route.test.ts src/lib/i18n-coverage.test.ts` | **exit 0**：`Test Files 3 passed (3)`、`Tests 70 passed (70)`、`Duration 2.63s` |
| 全量单测 | `npx vitest run` | **167 文件全部通过 / 1429 用例全部通过**（`Test Files 167 passed (167)`、`Tests 1429 passed (1429)`、`Duration 42.09s`；日志里出现的 `failed` 字样全是被测用例标题，无失败行）。本卡净增 **7 例**（账本 6 + 路由 1）；其余相对 §附录 L 基线的增量来自工作区**其他在途卡**，本卡不据此声称既有断言有变化 |
| 类型 | `npx tsc --noEmit` | **exit 0**（0 行输出；含新类型在 `AiCostCenterCallsPayload`、路由与页面三处的引用） |
| 静态检查 | `npx eslint` 本卡 6 个改动源文件 | **exit 0 / 0 problems**（无输出） |
| 三语完整性 | `node %TEMP%\cp-p7-05-02\locale-parity.cjs`（本卡取证脚本，未落到仓库） | **exit 0**：三语各 **2395** 键，`en↔zh-cn`、`en↔zh-hk` **两个方向差集全为空**；本卡新增 **17** 个 `costCenterRuns*` 键；`src/lib/i18n-coverage.test.ts` 绿（被引用键全部可解析） |
| 真实接口（作者正在跑的 dev server `127.0.0.1:3000`；**未另起实例、未终止用户进程**） | `curl GET /api/ai-cost-center/calls?range=7` | **200**，10326 字节。`scan {rows 6, limit 5000, truncated false, traceCapped false}`；`byRun` **1 组**：`runId ""`（未归类）、`attempts 6`、**节点行之和 6**、`retries 0 / failures 0 / interrupted 0 / unresolvedRetries 0`、`totalTokens 6156`、`costByCurrency []`、`unpricedAttempts 5 / unmeasuredAttempts 1 / costIsComplete false`、`retryCostByCurrency []`、`failureCostByCurrency []`、`lastAt 1791624790754`、`purposes ["article","image"]`、`nodes [{nodeId "", attempts 6}]`。**与库里的真实状态一致**：本安装尚未录价 → 金额表为空且如实标为不完整；6 条请求都没有记 run / node → 只有「未归类」那一组，而卡片照样把它印出来（不丢行）。证据：`%TEMP%\cp-p7-05-02\live-get-calls.json` |
| 真实浏览器（Playwright，**三语 × 真实页面**） | `node %TEMP%\cp-p7-05-02\cost-center-runs-probe.cjs`（本卡取证脚本，未落到仓库） | **exit 0**、**72 项断言 0 失败**（zh-cn / en / zh-hk 各 24 项）。做法：探针**拦下页面自己发的那一条** `/api/ai-cost-center/calls`，用它的 payload 逐格核对 DOM——①每个 run 都渲染出一行合计；②`合计行请求数 = 节点行之和 = payload.attempts`；③失败 / 中断 / Token / 重试逐格与 payload 一致；④未归类组与其节点名按**本语言**文案出现（`costCenterRunsUnattributed` / `costCenterRunsNodeUnattributed`）；⑤列头、卡标题、两条说明在本语言可见；⑥无金额读数如实呈现为「无金额读数」；⑦页面无运行时错误。**如实登记一次探针自身的缺陷**：表头带 `uppercase`，`innerText` 返回的是 CSS 变换后的文本（`EXECUTION NODE`）导致 5 项误报，改用 `textContent` 后全绿——是**探针问题，不是实现问题**。证据：`%TEMP%\cp-p7-05-02\probe-run2.txt`（首跑误报留档：`probe-run.txt`） |

### M.4 未验证 / 遗留（如实登记，不掩盖）

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | **真实库里没有一条记录写过 run / node** | 本轮窗口 6/6 条请求的 `runId` / `nodeId` 均为空 → 真实页面上只有**一个**「未归类」组、**一行**节点。多节点形态（≥2 个节点行、命名节点、未记录节点的桶）**只由临时库单测与探针读取的 payload 覆盖**，未在真实库自然状态下见过 |
| 2 | **真实库的重试 / 失败读数都是 0** | `retries 0 / failures 0 / interrupted 0 / unresolvedRetries 0` → 界面上「其中 N 条看不到前置请求」的标注、`≥` 下限与未计价徽标两条分支在真实页面**没有走到**（探针会按 payload 分支断言，真实 payload 命中的是「无金额读数」那一支），其余分支由**临时库**单测覆盖 |
| 3 | **金额读数为空** | 本安装尚未录价（`unpricedAttempts 5`）→ 卡片显示「无金额读数」；`costByCurrency` 非空、`costIsComplete true/false` 两种渲染只在单测里走过。**根因就是本卡范围外的那条缺口**（见下行） |
| 4 | `-01` / `-03` / `-04` **未交付** | 非文本维度（图片 / 视频 / 语音 / Embedding）的录价入口、Marketplace 扩展的费用归属、以及「无法准确计量」的显式标记体系仍是缺口。本卡把它们的后果摆在了界面上：**没有价格就没有金额，只有「无金额读数」** |
| 5 | 窗口边缘口径 | 被窗口切开的一次运行在两侧**各计一次**（沿用 CI-P7-02 的既有口径），属**已知取舍**而非缺陷 |
| 6 | 打包版 Electron 行为 | 各卡共通基线，本卡同样**只在 dev server 实测**（未打包） |

### M.5 登记与下一步

> **登记**：§1 第 60 行（`CI-P7-03…CI-P7-05` 行）**同行改写**为「**`CI-P7-05-02` 已于 2026-10-11 交付并实测**」，未增行；编号对照见 `docs/development/capability-integration-numbering-map.md` **§3 第 104 行**（`P8-06 = CI-P7-05` 由「部分就绪」补记 `-02` 已交付）与同文件新增 **§15**。
> **下一步编号**：`CI-P7-05` 卡体的其余三条 —— `-01`（图片 / 视频 / 语音 / Embedding 接入同一计量 + **录价**，即 §7 第 6 条与 §附录 I 的遗留）、`-03`（Marketplace 扩展标识与费用归属）、`-04`（无法计量必须显式标记）。本卡与 §附录 L 已从两个方向把 `-01` 的必要性摆出来：**没有价格，运行时成本与单位产出成本都只能是「无法计量」或下限**。
> **Git 纪律**：本轮**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status` / `git diff` 取证）；只读 `git status --porcelain` 实测 **127** 条（含工作区其他在途卡）。仓库根 `?? tmp-*`（`tmp-probe-*.cjs` / `tmp-probe-registry.ts` 等）为**此前各卡遗留**，**本卡未新增任何仓库根临时文件**——探针、三语取证脚本、live 响应与日志全部落在 `%TEMP%\cp-p7-05-02\`。另如实登记：**主线计划文档本身未被 git 跟踪**（`?? docs/coolpilot-capability-integration-plan.md`），故本卡对它的追加**不出现在 `git diff`** 里；编号映射 `docs/development/capability-integration-numbering-map.md` 是**已跟踪**文件（本卡 **+30 / −2**）。

## 附录 N：CI-P7-05-03 Marketplace 扩展标识与费用归属交付记录（done，2026-10-11）

> **为什么追加在文件末尾**：与 §附录 D / H / L / M 同一约定——交付记录**追加到文件末尾**，§1 与 §13（`### CI-P7-05：覆盖全部 AI 能力与 Marketplace` 标题行仍为 **471**、卡体 **471–476**）的行号**保持不变**；§1 第 60 行那一格只做**同行改写**，未增行。

### N.1 卡与来源

| 项 | 内容 |
| --- | --- |
| 卡号 | `CI-P7-05-03`「Marketplace 扩展的扩展标识、任务标识与调用费用归属」= 主线 §13 第 **475** 行（`CI-P7-05` 卡体 471–476 之一） |
| 上游契约 | 新清单 P1-05 / P5-06 / P7-01 / P7-02（`docs/development/CoolPilot-开发清单-10个开源项目整合版.md`）；编号对照见 `docs/development/capability-integration-numbering-map.md` **§3 第 104 行**（本轮同行补记）与新增 **§16** |
| 前置只读盘点（决定了本卡能声称什么） | Marketplace 在本仓库是**货架**而不是**执行入口**：没有 install 流程、没有独立的 task 生命周期实体（工作流只有 `runId`）。真正可归属的身份只有两种——**已上架 position 的清单 id**（`position-<id>`，由 `api/app-store` 的「我的」页签回答）与**真实存在的目录 agent id**；其余（选择器的默认 id、未上架的草稿 position、匿名调用）没有可归属的清单，如实记为 `''` |
| 本卡之前的真实状态 | 账本已有 `task_id` / `run_id` / `node_id` / `parent_usage_id` / `output_asset_id` 等业务身份列，**没有**扩展列；且三个真实调用点**知道**自己属于哪个 position / agent，却在写账本时把它丢掉了（知识库解析甚至没把 payload 里的 `positionId` 读出来）→ 用户的这笔钱在界面上无法归属 |
| 刻意不做 | **不伪造 Marketplace 执行条目**：不补安装动作、不补任务实体、不依「看起来该有个 id」而编造清单；`''` 是「这次调用没有作为任何清单运行」的**真话**，界面上显示为「未归属」而不是缺口，也不被折进别的扩展 |

### N.2 交付物（本轮实测行号）

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 数据 | `src/db/schema.ts`（**540** 列；**536–539** 列注释；**503–505** 身份列约定注释纳入 `extension_id`） | `ai_usage_ledger.extension_id TEXT NOT NULL DEFAULT ''`，与 `task_id` / `run_id` 等同一约定（空串而非 NULL） |
| 迁移 | `src/db/client.ts`（**714** `ALTER TABLE`、**719** `CREATE INDEX`） | 加列 + `idx_ai_usage_ledger_extension_created(extension_id, created_at)`；**不回填历史行**——旧行的 `''` 是「当时没有记」，不是猜测出来的清单 |
| 仓储 | `src/db/repository.ts`（**1251** 读取映射、**1317** 写入入参、**1362** 默认值） | 映射与写入一起补齐 |
| 类型 | `src/lib/types.ts`（**779** `AiUsageLedgerEntry.extensionId`、**1089** `AiUsageCallContext`、**1198–1225** `AiUsageExtensionCost`、**1277** `AiCostCenterCallsPayload.byExtension`、**1285** `options.extensions`、筛选类型 `extensionId`） | 口径写进类型注释 |
| 归属规则（单一裁决点） | `src/lib/marketplace-attribution.ts`（**36** `MarketplaceExtensionSource`、**52** `marketplaceExtensionIdOf`；**新文件**） | 优先级：**已上架 position 清单 > 目录 agent id > `''`**；picker 专用 id（`general` / `marketing`）与草稿 position 一律不归属 |
| 清单 id 同源 | `src/lib/app-store-catalog.ts`（**72** `appStoreListingIdOfPosition`、**78** `appStoreAgentIds`、**90** `isAppStoreAgentId`）；`src/app/api/app-store/route.ts`（**14** 改用同一 helper） | 清单 id 只有一处生成：货架回答的 id 与账本写的 id 不可能分叉 |
| 真实调用点 | `src/lib/article-generation.ts`（**93** `extensionAgentId` 入参、**181–187** `usageCall.extensionId`）；`src/app/api/content/generate/route.ts`（**181** `extensionAgentId: agent.id`）；`src/app/api/knowledge-base/ai-parse/route.ts`（**63–77** 读 `positionId` → 归属、**104** 记录、**115/134** 消费） | 三条真实链路接线；`extensionAgentId` 用来把「目录里的清单 agent」与「选择器的默认 id」分开 |
| 读数 | `src/lib/ai-usage-ledger.ts`（**498** 按扩展筛选、**932–990** `summarizeLedgerByExtension`） | 按扩展汇总，含 `''` 桶 |
| 接口 | `src/app/api/ai-cost-center/calls/route.ts`（**101** `extensionId` 查询参数、**206–208** `options.extensions`、**286** `byExtension`） | `''` 不进下拉选项；空参数 = 不筛选 |
| 页面 | `src/components/cost-center/cost-center-client.tsx`（**80 / 177** 筛选状态与查询串、**207** `callByExtension`、**399–439** 下拉 + chip + 清除、**905–1010** 「按 Marketplace 扩展归属的成本」明细卡） | 组内可点 id 直接下钻到上表筛选 |
| 文案 | `src/locales/zh-cn.json`、`en.json`、`zh-hk.json` | 三语各新增 **10** 个键（**9** 个 `costCenterExtensions*` + **1** 个 `costCenterCallsFilterExtension`） |

### N.3 单测（本轮实跑计数）

| 文件 | 本卡新增 | 覆盖的口径 |
| --- | --- | --- |
| `src/lib/marketplace-attribution.test.ts`（新文件，**5** 例） | 5 | 已上架 position 用货架自己的清单 id；草稿 position 拒绝命名；目录 agent 只在货架真的列出它时才命名；**已上架清单优先于目录 agent**；没有清单时什么都不说、且不编造 |
| `src/lib/app-store-catalog.test.ts`（**5** 例，+2） | 2 | `appStoreListingIdOfPosition` 对一个已存 position 只发布一个 id、对匿名 position 不发布；`isAppStoreAgentId` 分得清「它真的列出」与「它没有」 |
| `src/lib/ai-usage-ledger.test.ts`（**69** 例，+7） | 7 | `describe("extension attribution readers (CI-P7-05-03)")`：按扩展分桶且 `''` 桶保留；**划分**（每行恰好进一组一次、组内合计 = 其自身行之和）；双币种不相加 + 未计量行标下限；按扩展筛选且不动其他筛选（`''` = 不筛选）；失败按自报金额计入且与重试读数分开；组内列出花掉钱的 task / run / node / contentItem；空账本什么都不说 |
| `src/lib/ai-usage-ledger-recorder.test.ts`（**13** 例，+1） | 1 | 在**临时库**里真写：`extensionId` 落库并在读回时保留；未命名调用写空串（不是 NULL、不是猜的 id） |
| `src/app/api/ai-cost-center/calls/route.test.ts`（**6** 例，+1） | 1 | 临时库里真写账本行（含 `position-*`、目录 agent、`''`），断言 `byExtension` 逐字段、`options.extensions` 列出真实 id 且**不含空串**、`extensionId` 查询参数筛选生效 |
| `src/app/api/content/generate/route.test.ts`（**16** 例，+2） | 2 | 目录 agent 被选中时行归属到该 agent；**已上架 position 优先**，picker 专用 id（`general`）不产生归属——两组行逐条断言（真写账本） |
| `src/app/api/knowledge-base/ai-parse/route.test.ts`（**11** 例，+1） | 1 | 端到端：同一粘贴分别带**已上架**与**未上架**的 `positionId`，两次请求各写一行、各一次尝试；已上架那行归属到 `position-<id>`，草稿那行 `''`——**两次拒绝合并成一行** |
| 夹具补齐 | — | `src/lib/ai-budget.test.ts`（**110**）、`src/lib/quality-cost.test.ts`（**47**）的账本行夹具补 `extensionId: ""`，使其与新的必填字段一致（口径不变） |

### N.4 关键口径（写进类型、注释与文案）

1. **归属规则只有一个裁决点**：`marketplaceExtensionIdOf()`。优先级 = **已上架 position 的清单 id**（`position-<id>`）> **目录里真实存在的 agent id** > `''`。任何调用点都不自己拼 id。
2. **草稿不是清单**：未上架的 position 有 id、有名字，但货架没有它——所以不归属。这一条是本卡最容易出错的地方，单测与端到端各钉一遍。
3. **picker 专用 id 不是清单**：`general` / `marketing` 是选择器的默认值，`extensionAgentId` 的存在就是为了把「用户选了一个目录 agent」与「路由填了个默认值」分开。
4. **`''` 是读数，不是缺口**：未归属的行**照样进明细**，显示为「未归属」，不被折进任何命名扩展、也不丢行；`options.extensions` 不把空串当成一个可选项；查询参数传空 = **不筛选**（而不是「筛选出未归属」）。
5. **每个扩展组的总计 = 它自己那些行之和**；重试成本与失败成本是**同一批请求的两种读数**（一笔请求可以既重试又失败），**永不相加**成第三个数字；卡片下方常驻说明这两条。
6. **一条请求只有一个身份**：一次解析 / 一次生成各自成行，不按扩展合并、也不把一个调用拆成多行。
7. **没有金额时如实写「无金额」**：`''` 归属 + 未录价 → 金额读数仍是空的（与 `-01` 的录价缺口一致），不写 0。
8. **本卡没有任何写入 Marketplace 的路径**：不安装、不建任务实体，账本里出现的每个非空 `extension_id` 都能在货架里找到同名 id。

### N.5 验证结果（本轮实跑）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `npx vitest run`（本卡 7 个文件：归属规则 / 货架目录 / 账本读数 / 账本写入 / 成本中心接口 / 文章生成 / 知识库解析） | **exit 0 / 7 文件 125 用例全通过** |
| 全量单测 | `npx vitest run` | **exit 0 / 168 文件 1448 用例全通过**（§15 记录上一张卡为 167 / 1429；差额 **1 文件 / 19 用例**与本卡增量一致） |
| 类型 | `npx tsc --noEmit` | **exit 0**（首轮曾如实报出 1 个错误：新测试夹具用了不属于 `aiUsageCostSources` 的 `"unmeasured"`，已改为词表内的 `"unknown"`） |
| 风格 | `npx eslint`（本卡 21 个改动文件） | **exit 0 / 0 problems** |
| 空白 | `git diff --check` | 无空白告警（仅 Windows `core.autocrlf=true` 的三语 JSON 换行提示，非本卡引入）；本卡改动的两个测试文件 EOF 多余空行已清除 |
| 三语 parity | `%TEMP%\cp-p7-05-03\check-keys.cjs`（无 BOM 断言 + 键集合比对 + 客户端引用检查） | 三语各 **2405** 键、**missing 0 / extra 0**；新增键 **10**（9 个 `costCenterExtensions*` + 1 个 `costCenterCallsFilterExtension`）；`cost-center-client.tsx` 引用 **139** 个 `costCenter*` 键、**0 未解析** |
| live 接口 | 作者在跑的 dev server：`GET http://127.0.0.1:3000/api/ai-cost-center/calls?range=7` | **200**、11131 字节，答复键含 `byExtension`；`byExtension` **1 组**：`extensionId ""`、`attempts 6`（= 上表 `totals.attempts` 6 = 全部请求）、`totalTokens 6156`、`costByCurrency []`、`unpricedAttempts 5 / unmeasuredAttempts 1`、`costIsComplete false`；`options.extensions = []`；`filters.extensionId = ""`；原始响应存证 `%TEMP%\cp-p7-05-03\calls-live.json` |
| live 空筛选 | `GET …/calls?range=7&extensionId=` | **200**、`matched 6` = 与不传参数一致 → 空串确实是「不筛选」，不是「筛未归属」 |

### N.6 未验证（如实登记）

1. **真实库里没有非空的扩展 id**：本安装尚未上架任何 position、本轮也没有在真实库跑过文章生成或知识库解析，所以 live 的 6/6 条请求都是 `''`。其中一部分是**加列前的历史行**（迁移默认 `''` = 「当时没有记」，不是猜测出的清单），另一部分是**未接线的调用点**（下面第 2 条）。因此真实的 `position-<id>` / 目录 agent 分组**只在临时库单测里出现过**，未在真实库自然状态下出现过。
2. **只接线了「调用时真的知道自己是谁」的两个链路**：`article-generation`（`api/content/generate` 的文章生成，覆盖「目录 agent 被选中」与「已上架 position 优先」两条分支）与 `api/knowledge-base/ai-parse`（带 `positionId` 的解析）。工作区里还有 **12 个**账本写入模块（13 条写入路径 —— `scraper` 的 rewrite 与 topic-post 各一条；agent 运行时 `langgraph-engine` / `local-tools`、`image-generation`、`transcription/providers`、`scraper`（rewrite / topic-post）、`content/[id]/rewrite`、`content/[id]/translate`、`content/mindmap`、`metrics/insights`、`research-extraction`、`chat-thread-title`、`positions/generate`）**未接线**，其行一律 `''`。其中**最值得注意的一条缺口**：agent 运行时与图片生成在真实使用中可能正跑在某个已上架 position 的工作流内（它们当前只带 `runId` / `nodeId`，没有清单 id 可用），因此这些行的钱今天仍显示为「未归属」。本卡**不猜测**这段关系（编造会让读数看起来完整而实际不可追溯），如实登记为 `-03` 的剩余面。
   - 反向说明：`api/positions/generate`（由一句话生成 position 草稿）**本就该是 `''`** —— 那一刻还没有清单，不是缺口。
3. **未跑真实浏览器三语冒烟**：本卡对页面的验证是「接口 payload 逐字段（live + 临时库单测）+ 三语键集合与客户端引用检查（脚本）+ `tsc` / `eslint`」，**没有**用 Playwright 打开页面逐格核对 DOM（上一张卡 `-02` 跑过的那类探针）。
4. 打包版 Electron 未验证（各卡共通基线）；金额读数为空这件事的根因仍是**范围外的 `-01`**（非文本维度录价未交付），不是本卡引入。

### N.7 登记与下一步

> **登记**：§1 第 60 行（`CI-P7-03…CI-P7-05` 行）**同行改写**为「**`CI-P7-05-03` 已于 2026-10-11 交付并实测**」，未增行；§13 的 `CI-P7-05` 卡体（第 **471–476** 行，含第 **475** 行本卡）**保持原样**、行号不变；编号对照见 `docs/development/capability-integration-numbering-map.md` **§3 第 104 行**（`P8-06 = CI-P7-05` 由「部分就绪」补记 `-03` 已交付）与同文件新增 **§16**。
> **下一步编号**：`CI-P7-05` 卡体剩余两条 —— `-01`（图片 / 视频 / 语音 / Embedding 接入同一计量 + **录价**；见 §附录 I 与 §7 第 6 条）与 `-04`（无法计量必须显式标记）。本卡留下的是 `-03` 自身的**剩余面**：把 agent 运行时 / 图片生成 / 其余调用点接到同一个裁决点上（需要「run → 清单」这条关系落地），以及界面上把 `options.extensions` 从「已出现的 id」升级为「货架里的清单」（今天的下拉只列出窗口内真的出现过的 id，这是诚实的、也是不完整的一条）。
> **Git 纪律**：本轮**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status` / `git diff` / `git ls-files --eol` 取证）。只读 `git status --porcelain` 实测 **140** 条（含工作区其他在途卡）。仓库根 `?? tmp-*` 与 `?? dev-server.*` / `?? ai-settings.json` / `?? models*.json` 等均为**此前各卡遗留**，**本卡未新增任何仓库根临时文件**——探针输出、locale 取证脚本、aiparse 调试输出与 live 响应全部落在 `%TEMP%\cp-p7-05-03\`。另如实登记：**主线计划文档本身未被 git 跟踪**（`?? docs/coolpilot-capability-integration-plan.md`），故本卡对它的追加**不出现在 `git diff`** 里；编号映射 `docs/development/capability-integration-numbering-map.md` 是**已跟踪**文件。

## 附录 O：CI-P7-05-03 剩余面（改写 / 翻译 / 效果解读 / 文章配图 接线与归属单测）补完记录（done，2026-10-11）

> **为什么追加在文件末尾**：与 §附录 D / H / L / M / N 同一约定——交付记录**追加到文件末尾**，§1 与 §13（`### CI-P7-05：覆盖全部 AI 能力与 Marketplace` 标题行 **471**、卡体 **471–476**）的行号**保持不变**；本轮**未改动 §1 第 60 行与 §13 任何行**（`CI-P7-05-03` 的登记仍以 §附录 N.7 的同行改写为准，本附录只补**剩余面**）。

### O.1 卡与来源

| 项 | 内容 |
| --- | --- |
| 卡号 | `CI-P7-05-03` 的**剩余面** = 主线 §13 第 **475** 行那一条的续做（首次交付见 §附录 N） |
| 依据 | §附录 N.6 第 2 条与 N.7：首次交付**只接线了「调用时真的知道自己是谁」的两条链路**（`article-generation` / `api/knowledge-base/ai-parse`），工作区另有 **12 个模块 / 13 条写入路径**未接线而一律 `''`；N.7 明确写下「`-03` 自身剩余面 = 把其余调用点接到同一裁决点」 |
| 本轮范围 | 接上**调用自己真的知道自己是谁**的剩余调用点：**改写**（`content/[id]/rewrite`）、**翻译**（`content/[id]/translate`）、**效果解读**（`metrics/insights`）三条 API 路径，以及**文章配图**（`article-generation` → `article-images` → `image-generation`）这条图片链路里**调用方已经知道清单**的那一半；仍无法知道自己是谁的调用点**保持 `''`** 并逐条登记（O.3 / O.7） |
| 归属来源（口径不变） | 只读**已存的 provenance**：`metadata.positioningId` + `metadata.agentId`，交给同一个裁决点 `marketplaceExtensionIdOf()`。**不**从页面、编辑器对话框、文章标题、平台名推断，也不把请求里的 id 当清单 |
| 刻意不做 | 不新建「run → 清单」关系；不给 `/api/images`（独立配图）与 agent 运行时编造「当前选中的清单」；`''` 仍是「这次调用没有作为任何清单运行」的真话 |

### O.2 交付物（本轮实测行号）

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 归属桥（**新文件**） | `src/lib/content-item-listing.ts`（**1–2** 依赖、**6–26** 口径注释、**29–51** `contentItemListingProvenance`、**63–69** `marketplaceExtensionIdOfContentItem`） | 把一个**已存文章**的 provenance 读出来交给同一裁决点；非字符串一律 `""`（旧行、手改行、没见过的 metadata 形状都不抛错，因为「这里没什么可归属」是正常答案）；「这条 position 现在上架没有」只有 position 记录知道，所以由它去问货架，四个调用点都不再各自实现一遍 |
| 改写 | `src/app/api/content/[id]/rewrite/route.ts`（**7** 引入、**69–74** 口径注释、**75–79** `usageCall.extensionId`、**123 / 150** 成功与失败两条写行） | 对话框不带选择器，文章自己的 provenance 是唯一答案 |
| 翻译 | `src/app/api/content/[id]/translate/route.ts`（**7** 引入、**50–51** 注释、**52–56** 归属、**93 / 119** 两条写行） | 与改写同一来源、同一答案；自纠重问 = 两行，两行同一个 id |
| 效果解读 | `src/app/api/metrics/insights/route.ts`（**6** 引入、**53–56** 注释、**57–63** 归属、**89 / 100** 两条写行） | 记录本身不是文章：由 `record.contentItemId` 指向的文章取归属；记录没指向文章 → `""`（平台名与标题都不是清单，不借） |
| 文章配图 | `src/lib/article-generation.ts`（**18** 引入、**183–190** 问一次并写进 `usageCall`、**221–229** 同一个 id 交给 `resolveArticleImages`、**213 / 282** 两条写行）；`src/lib/article-images.ts`（**70–76** 入参口径、**130** 透传）；`src/lib/agent/image-generation.ts`（**73–82** 入参口径、**104–111** 只在非空时带入账本上下文、**138 / 148 / 157** 三处写行） | 图片行的 id 由文章行的**同一个答案**给出：文章与它的封面不会分叉；空串不注入（`trim()` 之后为空 = 没有） |

### O.3 13 条写入路径的最终状态（本轮实测；§附录 N.6 第 2 条那张清单的逐条收口）

| # | 写入路径（模块 → 写行） | 本轮状态 | 归属来源 / 为什么还是 `''` |
| --- | --- | --- | --- |
| 1 | `src/app/api/content/[id]/rewrite/route.ts`（**123 / 150**） | **已归属（本轮新增）** | 文章的已存 provenance → `marketplaceExtensionIdOfContentItem(existing)`（**78**） |
| 2 | `src/app/api/content/[id]/translate/route.ts`（**93 / 119**） | **已归属（本轮新增）** | 同上（**55**） |
| 3 | `src/app/api/metrics/insights/route.ts`（**89 / 100**） | **已归属（本轮新增）** | `record.contentItemId` → 该文章的 provenance（**60–62**） |
| 4 | `src/lib/agent/image-generation.ts`（**138 / 148 / 157**） | **部分归属（本轮新增：有调用方知道清单的那一半）** | 调用方交进来的 id（**111**）：`article-generation` **189** 问一次 → `article-images` **130** 透传。**独立配图 `/api/images` 与 `local-tools` 里那条生成图片的路径仍 `''`**（见下） |
| 5 | `src/lib/scraper.ts` 改写（**105 / 115**） | 仍 `''` | identity 只有 `runId`（**84**），请求里没有清单 |
| 6 | `src/lib/scraper.ts` 选题成文（**168 / 173**） | 仍 `''` | 同上（**145**） |
| 7 | `src/lib/agent/langgraph-engine.ts`（**193 / 198**） | 仍 `''` | 只有 `runId` + `nodeId`（**170**）；「run → 清单」这条关系今天并不存在 |
| 8 | `src/lib/agent/local-tools.ts`（**233 / 238**） | 仍 `''` | 同上（**197**） |
| 9 | `src/app/api/content/mindmap/route.ts`（**108 / 117**） | 仍 `''` | 一个主题字符串不指任何文章（**82**：`purpose` 就是全部归属） |
| 10 | `src/lib/research-extraction/extraction-task.ts`（**212 / 215**） | 仍 `''` | 只有 `runId`（**181**） |
| 11 | `src/lib/agent/chat-thread-title.ts`（**107 / 115**） | 仍 `''` | 只有 `runId`（**72**），与 agent 会话同一条缺口 |
| 12 | `src/lib/transcription/providers.ts`（**344 / 351**） | 仍 `''` | 只有转录任务 / 文件身份（**307**） |
| 13 | `src/app/api/positions/generate/route.ts`（**89 / 106**） | 仍 `''`（**本就该是 `''`**，不是缺口） | 那一刻还没有清单（**62**） |

> 首次交付时已接线的两条路径（`src/lib/article-generation.ts` **213 / 282**、`src/app/api/knowledge-base/ai-parse/route.ts` **104 / 132**）本轮**未改口径**：前者仍是 `marketplaceExtensionIdOf({ position, agentId: request.extensionAgentId })`（**189**），后者仍是 payload `positionId`（**76**）。合计：**6 条已知身份**（4 条本轮 + 2 条既有，其中图片那条只覆盖「调用方交 id」的一半）+ **9 条如实 `''`**。

### O.4 单测（本轮实跑计数；5 个文件 **14** 例，文件数不变）

| 文件 | 本轮新块 | 例数 | 覆盖的口径 |
| --- | --- | --- | --- |
| `src/app/api/content/[id]/rewrite/route.test.ts` | **589** 起（用例 **635 / 649 / 662**） | 3 | 已上架 position 的清单 id 真的落到行的 `extensionId`；没有已上架 position 时用目录 agent；provenance 什么都没说 → `""`（是空串而不是 null，「未归属」照旧是一条读数） |
| `src/app/api/content/[id]/translate/route.test.ts` | **433** 起（**483 / 496 / 519**） | 3 | 同上；并且**自纠重问的两行都带同一个 id**（两次请求都真的发出去了） |
| `src/app/api/metrics/insights/route.test.ts` | **296** 起（**362 / 377 / 395**） | 3 | 由记录指向的文章取归属；**provider 失败的那一行照样带 id**；记录没指向文章 / 文章没 provenance → `""` |
| `src/lib/article-images.test.ts` | **602** 起（**630 / 644**） | 2 | 调用方交进来的 id 落到图片生成行；没有 id → `""` |
| `src/lib/article-generation.test.ts` | **529** 起（**573 / 593 / 608**） | 3 | 一次生成写**两行**（文章 + 封面）**同一个** `position-<id>`；没有已上架 position 时退回目录 agent；两者都没有 → 两行都 `""` |

> 手法与前几轮一致：`src/test/route-harness.ts` 的临时库 + 请求前后 `listAiUsageLedgerEntries()` 按 id 差集，读的是**真的写进去的行**而不是被 mock 掉的调用；5 个测试文件合计 `+542` 行（`git diff --stat`）。

### O.5 关键口径（本轮钉住的行为，写进测试注释）

1. **归属只读已存的 provenance**：`metadata.positioningId`（生成时真的解析到的 position，不是调用方要的那个 id）+ `metadata.agentId`（生成面板选中的应用商店智能体）；页面、对话框、标题、平台名一律不作证据。
2. **一次请求只有一个身份**：成功行、重试行与失败行共用同一个 `usageCall`，因此**自纠重问的两行、provider 失败的那一行都带同一个 id**（本轮翻译与效果解读各有一条用例专门钉这个）。
3. **一篇章一个身份**：文章行与它的封面行由**问过一次的同一个答案**给出（`article-generation` → `article-images` → `image-generation`），不会分叉。
4. **`''` 是读数不是缺口**：未归属的行照样进明细、在界面上显示「未归属」、不被折进别的扩展；`options.extensions` 不把空串当选项。
5. **「被拒绝」与「失败」不是同一件事**：预算闸门拒绝时**不写行**（gate 在写入之前），provider 失败时**照写并带 id**——本轮新增用例 `keeps the attribution on the row of a call whose provider failed` 就是这条的分界。
6. **不猜**：谁真的不知道自己是谁（agent 运行时、独立配图、采集、思维导图、研究抽取、会话标题、转录）就继续 `''`，逐条登记在 O.3 与 O.7，而不是给读数补一个看起来完整的名字。

### O.6 验证结果（本轮实跑）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测（本卡 5 文件） | `npx vitest run`（`content/[id]/rewrite` 路由、`content/[id]/translate` 路由、`metrics/insights` 路由、`article-images`、`article-generation`） | **exit 0 / 5 文件 73 用例全通过** |
| 定向单测（图片 + 生成） | `npx vitest run src/lib/article-images.test.ts src/lib/article-generation.test.ts` | **exit 0 / 2 文件 36 用例全通过** |
| 定向单测（content 路由目录） | `npx vitest run 'src/app/api/content/'` | **exit 0 / 10 文件 96 用例全通过** |
| 全量单测 | `npx vitest run` | **exit 0 / 168 文件 1462 用例全通过**（§附录 N.5 记录上一轮为 168 / 1448；差额 **+14 用例** = 本轮 3+3+3+2+3，**文件数不变**，与本轮增量一致） |
| 类型 | `npx tsc --noEmit` | **exit 0**（首轮即通过；`createPublishRecord` / `updatePosition` 的夹具用法按既有签名写，未新增类型断言） |
| 风格 | `npx eslint`（本轮 5 个测试文件 + 7 个接线源文件：`content-item-listing.ts`、三个路由、`article-generation.ts`、`article-images.ts`、`image-generation.ts`） | **exit 0 / 0 problems** |
| 隔离修复（如实登记） | 两处新 `describe` 的 `beforeEach` 先 `await allowEveryAiBudgetCall()`，再 `resetRuntime()` | 首轮如实报出 **6 例 402 而不是 200**：预算行是**存储状态**（设置里的预算行），`resetRuntime()`（重建运行时）清不掉同一文件前面那条「拒绝」用例留下的拒绝。修复后 402 / 200 各就各位——与 §附录 G 的「一处测试隔离修复」同类 |
| 读数口径（如实登记） | 第一次全量运行曾报 **2 例失败**，发生在与同终端另一条 `npx tsc` / 上一轮 vitest **同时进行**的时候（两轮 vitest 共用被 pin 的临时库）；随后**单独复跑**为全绿，上表与本节记录**以复跑的 168 / 1462 为准** |

### O.7 未验证（如实登记）

1. **13 条路径里 4 条归属、9 条仍 `''`**（逐条见 O.3）。其中**最值得注意的一条仍在**：agent 运行时（`langgraph-engine` / `local-tools`）与**独立配图 `/api/images`** 在真实使用中很可能正跑在某个已上架 position 的工作流内，但**「run → 清单」这条关系今天并不存在**。本轮取证（只读取证，未改代码）：`POST /api/images` 的 payload 只有 `prompt`（`imageGenerateSchema`）、`POST /api/agent/chat` 只有 `threadId` / `site` / `params` 与随后的 `runId`、`langgraph-engine` 的 identity 只有 `runId` + `nodeId`、`chat-thread-title` 只有 `runId`。**不编造**：这些行继续 `''`。
2. **本轮未取真实库 / live 读数**：没有在真实库跑改写 / 翻译 / 效果解读 / 文章生成，因此真实的 `position-<id>` 与目录 agent 分组**仍只在临时库单测里出现过**；§附录 N.5 的 live 结论（窗口内 6/6 行 `''`）本轮没有改变的依据，也没有被新的实测覆盖。
3. **本轮未改源与文案，也未跑真实浏览器三语冒烟**：改的是测试与文档，三语键集合与 §附录 N 相同（各 **2405** 键）。
4. 打包版 Electron 未验证（各卡共通基线）；金额读数为空的根因仍是范围外的 `-01`（非文本维度录价未交付）。

### O.8 登记与下一步

> **登记**：本轮**未改动** §1 第 **60** 行与 §13 的 `CI-P7-05` 卡体（第 **471–476** 行，含第 **475** 行本卡）——`CI-P7-05-03` 在 §1 的登记仍以 §附录 N.7 的「已于 2026-10-11 交付并实测」为准，本附录只补**剩余面**、不动行号；编号对照见 `docs/development/capability-integration-numbering-map.md` **§16**（首次交付）与本轮新增 **§17**（剩余面）。
> **下一步编号**：`CI-P7-05` 卡体仍缺 **`-01`**（图片 / 视频 / 语音 / Embedding 接入同一计量并**录价**，见 §附录 I 与 §7 第 6 条）与 **`-04`**（无法计量必须显式标记）；`-03` 自身剩余面 = 让「run → 清单」这条关系落地，然后把 agent 运行时 / 独立配图 / 采集（改写与选题成文）/ 思维导图 / 研究抽取 / 会话标题 / 转录接到同一个裁决点上（即 O.3 的第 5–13 行）。
> **Git 纪律**：本轮**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status --short` / `git diff --stat` 取证）。本轮改动 = **5 个测试文件（+542 行）** + 本文件的**附录 O** + `docs/development/capability-integration-numbering-map.md` 的 **§17**；`src/lib/content-item-listing.ts`、3 个路由与 3 个 lib 的接线是同一张卡剩余面的**源改动**（工作区在途，未提交）。仓库根 `?? tmp-*` / `?? dev-server.*` / `?? models*.json` 等为**此前各卡遗留**，**本轮未新增仓库根临时文件**。另如实登记：**主线计划文档本身未被 git 跟踪**（`?? docs/coolpilot-capability-integration-plan.md`），故本附录**不出现在 `git diff`** 里；编号映射是**已跟踪**文件。

---

## 附录 P：CI-P7-05-04 AI 服务可计量性边界交付记录（done，2026-10-11）

> **为什么追加在文件末尾**：与 §附录 D / H / L / M / N / O 同一约定——交付记录追加到末尾，§1 与 §13 的行号保持不变。本轮**只在 §1 第 60 行的同一行内**补记本卡（与 §附录 N 对 `CI-P7-05-03` 的处理一致），**未插入任何新行**，§13 第 **471–476** 行一字未动。
> **交付范围**：主线 §13 第 **476** 行那一条 —— 「`P7-05-04` 无法准确计量的服务必须**显式标记**，而不是漏记」。
> **一句话**：账本一直如实记着「金额说不出来」，却从没说过**为什么**；本卡把「为什么」变成账本自己就能陈述的读数（`meteringReasonFor()`：**只读行内既有证据**，**不新增列、不回填、不推断**），并把**六个计量维度全部列出**——其中 video / embedding 在本运行时**没有任何调用路径**，它们在界面上被点名，而不是从列表里消失。

### P.1 现状核查（先核实现有枚举与字段，再决定是否需要新字段）

| 既有物（实测） | 内容 | 本卡怎么用 |
| --- | --- | --- |
| `ai_usage_ledger.cost_amount` | 可空，NULL = 没有任何金额可述（**从不写 0 冒充**） | 只读：`null` 就是「说不出来」 |
| `cost_source` | 四态：`provider-reported` / `computed` / `unpriced` / `unknown` | **原样复用**，不新建状态枚举 |
| `completeness` | 三态：`reported` / `partial` / `unknown` | **原样复用**（`partial` 即「部分未知」） |
| `metered_kind` + `quantity_json` + `pricing_json` | 六维度、该行的用量单位、冻结的价格快照 | **原因的证据来源**：这三列加上 `outcome` 足以复原 `computeUsageCost()` 当初为什么说不出来 |
| `computeUsageCost()` | 注释自己写着「**四种不同的『不』**」，但行上只落得下 3 个 `cost_source` | 本卡把「哪几种『不』」变成可读、可显示的原因 |
| 现有的成本中心展示 | 总览：`byCostSource` + `costIsComplete` + `unpricedAttempts` / `unmeasuredAttempts` + 「价格目录覆盖」卡；调用明细：用量完整度 / 费用来源 / 金额；质量页：`unpricedRequests` / `unmeasuredRequests` | **不重复建模**：既有四个读数列一个没动，新增的是**原因**与**按维度的覆盖** |

**结论：不新增数据库列。** 原因所需的证据（`outcome` + `completeness` + `pricing_json` + `quantity_json`）**已经在行上**，读侧按同一个规则派生即可——历史行同样立刻可读，且**没有任何回填**：这正好同时满足「保留历史账本兼容性」与「不预设新的字段一定必要」。

### P.2 原因词表与映射规则（`aiUsageMeteringReasons`，10 条，写在 `src/lib/types.ts`）

| 原因 | 触发证据（行内） | 对应既有状态 | 用户该做什么 |
| --- | --- | --- | --- |
| `no-price-for-dimension` | `completeness: reported` 且 `pricing_json: null` | `unpriced` | 录一条该「供应商 + 模型 + 维度」的价格 |
| `price-kind-mismatch` | 价格快照存在但 `pricing.meteredKind !== metered_kind` | `unpriced` | 录一条该维度的价格（文本价不能给图片计价） |
| `price-unit-unspecified` | 非 token 价格行没有单位或单价 | `unpriced` | 补齐那行价格的单位与单价 |
| `usage-not-reported` | 成功 + token 维度 + `completeness: unknown` | `unknown`（未测量） | 没有可做的动作，供应商没回报用量 |
| `quantity-not-recorded` | 非 token 成功，该维度计价单位**一个数字都没写** | `unknown`（未测量） | 调用点需要写入用量 |
| `quantity-unit-mismatch` | 非 token 成功，用量写在**该维度不认的单位**下 | `unknown`（未测量） | 调用点写错了单位键（**真实发生**，见 P.6） |
| `quantity-unusable` | 该维度单位存在但不是可用数字（字符串 / 负数 / 嵌套） | `unknown`（未测量） | 调用点写错了值 |
| `attempt-failed` | `outcome !== success`（且非中断） | `unknown`（未测量） | 无需动作：请求没成功 |
| `call-interrupted` | `outcome: interrupted` 或 `completeness: partial` | `unknown` + `completeness: partial`（**部分未知**） | 无需动作：收到的用量可能少于计费 |
| `not-recorded` | 证据**不足以**说明原因（如已回报用量 + 价格匹配却仍无金额） | 任意空金额 | 无需动作：这是**如实留白**，不是推断 |

> **映射规则只有一条**：原因**只从行内字段派生**（`meteringReasonFor(entry)`），**绝不**读 purpose / 模型名 / 页面 / `extensionId`。证据不足时返回 `not-recorded` —— 「无法确定原因时保留未知，不作推断」；`extensionId` 为空**不参与**任何判断（业务归属与成本计量是两个维度）。

### P.3 交付内容（本轮改动逐件实测）

| 件 | 位置 | 做了什么 |
| --- | --- | --- |
| 原因词表（**新**） | `src/lib/types.ts`（第 **645–685** 行） | `aiUsageMeteringReasons` + `AiUsageMeteringReason`；与 `aiUsageCostSources` 同级、同样「只增不改」的封闭词表 |
| 维度缺口词表（**新**） | 同上（第 **975–1020** 行） | `aiUsageMeteringGaps`（`no-runtime-path` / `metered-through-text`）+ `AiUsageMeteringCoverage`（每维度：行数 / 已述明 / 未定价 / 未述明 / 原因去重集 / 生效价格 / 声明缺口） |
| 读数（**新文件**） | `src/lib/ai-metering.ts`（**204** 行） | `meteringReasonFor()`：按 `outcome` → `completeness` → 价格快照 → 用量单位的顺序派生；`summarizeLedgerMeteringCoverage()`：**按词表**建表（不是按数据），维度一个不落；`aiMeteredKindProducers`：每维度的写入点**声明**（文本 12 个调用点、图片 1、语音 1、video/embedding 无路径、agent 按 text 行计量） |
| 逐行原因 | `src/app/api/ai-cost-center/calls/route.ts`（第 **4 / 259–262** 行） | `AiUsageCallView.reason` 由**服务端**决定（页面不重算规则，与 `inForce` / 重试分类同一纪律） |
| 维度覆盖 | `src/app/api/ai-cost-center/route.ts`（第 **3 / 33–66** 行） | `catalog.metering`；总览改为**一次读取**（`listAiUsageLedgerEntries` + `summarizeAiUsageLedger`），覆盖读数与总额**来自同一批行**，不可能描述不同窗口 |
| 页面 | `src/components/cost-center/cost-center-client.tsx` | 见 P.4 |
| 文案 | `src/locales/{en,zh-cn,zh-hk}.json` | **+25 键 ×3**（2405 → **2430**，`dictionaries.test.ts` 校验三语键集合一致） |
| 测试 | `src/lib/ai-metering.test.ts`（**新，234 行 / 12 例**）、`src/app/api/ai-cost-center/route.test.ts`（+1 例）、`src/app/api/ai-cost-center/calls/route.test.ts`（+1 例 + 既有用例内 +1 断言） | **净增 14 例**（12 + 1 + 1） |

> **未改**：`ai_usage_ledger` 表结构（**无新列、无迁移**）、写入器（`ai-usage-ledger-recorder.ts`）、`computeUsageCost()` 的金额算法、预算与闸门、AI Runtime 的**路由 / 重试 / 故障转移 / 密钥轮换**（本卡一行都没碰）、`usage_records` 与「用量统计」口径。

### P.4 用户界面变化（成本中心）

| 位置 | 变化 |
| --- | --- |
| 调用明细 → 新列「**未述明原因**」 | 每一行的金额说不出来时给出 P.2 的那句话；能述明金额的行写「已述明金额」。展开行表格列数 11 → 12（`colSpan` 同步） |
| 成本总览 → 「价格目录覆盖」卡内新增「**计量覆盖**」表 | 六个维度**恒列出**：本窗口行数 / 已述明·未定价·未述明（三个既有状态各占一列，从不合成一个「说不清」的总数）/ 生效价格 / **计量状态与原因**。判定顺序：先看维度的**声明缺口**（video / embedding → 「无法准确计量：本运行时没有该维度的调用路径」；agent → 「按 text 行计量」），再看「本窗口没有该维度的调用」，最后才列该维度行上真实存在的原因 |
| 既有四列读数列 | `成本` / `费用来源` / `用量完整度` / 「含未定价调用」徽标**一字未改**——新读数不是取代它们，而是补上「为什么」 |

### P.5 验收场景 → 测试映射（五种情形逐一有例）

| 情形 | 例子 |
| --- | --- |
| **已计量** | `computed` / `provider-reported` 有金额 → 原因为空；`0` 元（declared-free 价）同样不算「说不出来」 |
| **未定价** | `reported` 用量 + 价格快照为空 → `no-price-for-dimension`；另配 `price-kind-mismatch`（文本价给图片计价）与 `price-unit-unspecified`（价格行没写单价） |
| **未测量** | 成功但供应商没回报用量 → `usage-not-reported`；失败的请求 → `attempt-failed`；非 token 维度没写用量 → `quantity-not-recorded` |
| **部分未知** | `interrupted` / `completeness: partial` → `call-interrupted`（两种触发路径各一例） |
| **无法准确计量** | ① 行级：用量写在该维度不认的键下 → `quantity-unit-mismatch`（**真实安装里就有这一行**，见 P.6）；写成了不可用数字 → `quantity-unusable`；② **服务级**：`video` / `embedding` 在**空窗口**下仍出现在覆盖表里并带 `no-runtime-path` |
| **不推断** | 「用量已回报 + 价格匹配却仍无金额」→ `not-recorded`；可用的用量数字落在被存成 `unknown` 的历史行上 → 同样 `not-recorded`（不把原因赖到单位上） |

### P.6 验证结果（真实与临时库分别报告）

**① 真实接口（作者正在跑的 dev server `127.0.0.1:3000`；只读 GET，未另起实例、未终止用户进程、未发出任何真实模型请求、未写入真实库）**

| 探测 | 结果 |
| --- | --- |
| `GET /api/ai-cost-center?range=7` | **200**，**2585** 字节（改动前同端点 1678 字节，差额 = 新增 `catalog.metering`）。真实 payload：`totals attempts 6 / unpriced 5 / unmeasured 1 / costIsComplete false`；`pricedKinds []`（真实安装**没有录过任何价格**）；`metering`：**text** 5 行（`measured 0 / unpriced 5 / unmeasured 0`，`reasons [no-price-for-dimension]`）、**image** 1 行（`0 / 0 / 1`，`reasons [quantity-unit-mismatch]`）、**video** `0` 行 + `gap no-runtime-path`、**speech** `0` 行（`gap ''` —— 本卡没有把它说成缺口）、**embedding** `0` 行 + `gap no-runtime-path`、**agent** `0` 行 + `gap metered-through-text`。证据：`%TEMP%\cp-p7-05-04\live-overview-2.json` |
| `GET /api/ai-cost-center/calls?range=7&limit=25` | **200**，**11335** 字节；6 行逐行读数与库一致：5 行 `text / success / reported / unpriced / 金额 null / qty {}` → `reason no-price-for-dimension`；1 行 `image / success / unknown / unknown / 金额 null / qty {"images":1}` → `reason quantity-unit-mismatch`。证据：`%TEMP%\cp-p7-05-04\live-calls-2.json`（改动前同端点存于同目录 `live-calls.json`，用于前后对照） |
| **读数与账本一致** | 覆盖表里 `text.unpricedAttempts = 5` = 总额 `unpricedAttempts 5`；`image.unmeasuredAttempts = 1` = 总额 `unmeasuredAttempts 1`（同一批行，两个读数不可能互相矛盾） |

> **真实安装里那一行「无法准确计量」**：`purpose=image`、`meteredKind=image`、`completeness=unknown`、`quantityJson={"images":1}`、无价格快照。该维度按 `image`（单数）计价、用量却写在 `images`（复数）下 —— **即使明天录了价，它的金额也永远说不出来**。这一行是**本卡之前**的版本写入的（历史行），而**读侧派生**依然从它自己的证据里读出了原因：这正是「原因不落列、在行内既有证据上派生」的代价换来的一点好处——**历史行同样能被如实解释**，同时**没有任何回填**。另注：此行与 `extensionId` 无关（业务归属与计量是两个维度）。

**② 测试数据库（`src/test/route-harness.ts` pin 的临时库，非真实库）**

| 命令（本轮实跑） | 退出码 | 结果 |
| --- | --- | --- |
| 定向 `npx vitest run`（`ai-metering` / `ai-usage-ledger` / `ai-usage-ledger-recorder` / `dictionaries` / 成本中心 `route` / `calls` / `quality`） | **0** | **7 文件 / 118 用例全通过**（其中新文件 `ai-metering.test.ts` **12/12**） |
| 全量 `npx vitest run` | **0** | **169 文件 / 1476 用例全通过**，`Duration 35.52s`；相对 §附录 N/O 的基线（168 / 1462）**+1 文件 / +14 用例**，与本卡净增完全一致 |
| `npx tsc --noEmit` | **0** | 无输出 |
| `npx eslint`（本卡 8 个变更文件） | **0** | **0 problems** |
| `git diff --check` | **0** | 无空白错误（仅 locale 文件既有的 CRLF 提示，非本卡引入） |

> 临时库里的用例覆盖了真实安装**本轮没机会产生**的形状：失败行、中断行、`price-kind-mismatch`、`price-unit-unspecified`、以及「写对单位键的图片行只缺价格」。**没有**用模拟数据冒充真实运行：上表 ① 是真实接口读数，② 是临时库读数，两者分开列出，且 ① 的数字全部来自库中真实存在的 6 行。

### P.7 仍未准确计量的真实服务（如实登记，不美化）

| # | 服务 / 路径 | 事实（实测） | 本卡的处理 |
| --- | --- | --- | --- |
| 1 | **视频生成 `video`** | `src/features/ai-runtime/adapters.ts` 的适配器契约只声明 `chat`（必选）、`generateImage?`（第 **82** 行）、`transcribe?`（第 **87** 行）——**没有任何视频调用路径**；`meteredKind: "video"` 在全仓生产代码**零命中** | 覆盖表**恒列出**并标 `no-runtime-path`（「无法准确计量：本运行时没有该维度的调用路径」），**不再漏记** |
| 2 | **Embedding `embedding`** | 同上：契约里没有向量调用方法；生产代码里 `meteredKind: "embedding"` **零命中**（单测里才有） | 同上；且与范围约束一致（**本卡不开发 Embedding**） |
| 3 | **Agent / Workflow `agent`** | 该维度没有独立行：Agent 的花费是**节点 text 行**（§附录 M） | 覆盖表写「**按 text 行计量**」，与 video / embedding 的「没有路径」**分开表述**，不混为一个「无法计量」 |
| 4 | **能力探测 `POST /api/ai/models/probe`** | `features/ai-runtime/probe.ts` 第 **72–95** 行**真的**向供应商发一次请求（`adapter.chat`，`maxTokens: 32`），但它**绕过 runtime 轨迹**（自己 `runWithCredentialKey` + `adapter.chat`），因此**没有任何 `ModelAttempt`、也不写账本行**；也没有预算闸门 | **如实登记为「未接入账本」**：本卡**没有**为它补写行（那需要先为它构造轨迹与身份，属新工作），也**没有**为了让它好看而改 runtime 行为。这是本卡留下的**最具体的显式缺口**，同时也是「按维度列覆盖」这种读法的边界：它覆盖不了「同一维度下某条路径没接入」 |
| 5 | `provider-reported` / `interrupted` | 仍**没有生产者**（§附录 B-11 §4 已登记） | 词表与原因都支持它们（`provider-reported` 有金额即无需原因；`interrupted` → `call-interrupted`），但**只在临时库单测里出现过**，真实库中不存在这两类行 |

**未验证（与 §附录 N / O 同基线，如实登记）**

1. **未跑真实浏览器三语渲染**：本卡改了三语文案（**+25 键 ×3**）与两处页面结构，但**没有**用 Playwright 打开页面；三语键集合由 `dictionaries.test.ts`（三语键集合一致 + 无空值/乱码）与 `tsc`（`TranslationKey` 类型）兜底，页面渲染本身未验证。
2. **未在真实库触发新的 AI 调用**：因此真实库里**没有**本卡写入的失败行 / 中断行 / 正确单位键的图片行——那三类只在临时库单测里验证（P.6 ②）。
3. 打包版 Electron 未验证（各卡共通基线）。

### P.8 登记与下一步

> **登记**：**只在 §1 第 60 行的同一行内**补记本卡（`CI-P7-05-04` 已于 2026-10-11 交付并实测，见 §附录 P），该行字数增加但**行号不变**；§13 的 `CI-P7-05` 卡体（第 **471–476** 行，含第 **476** 行本卡）**一字未动**，本附录整体追加在文件末尾。编号对照见 `docs/development/capability-integration-numbering-map.md` **§18**（本卡）与 §3 第 **104** 行的同行补记。
> **下一步编号**：`CI-P7-05` 卡体**只剩 `-01`**（图片 / 视频 / 语音 / Embedding 接入同一计量并**录价**，见 §附录 I 与 §7 第 6 条）——本卡的覆盖表已经把它的后果摆在界面上：真实安装 `pricedKinds []`、text 5 行全部 `no-price-for-dimension`，即**没有价格就没有金额**；`-03` 自身剩余面（「run → 清单」这条关系落地）仍待做。此外本卡新登记一条候选：**把 `POST /api/ai/models/probe` 接入账本**（P.7 第 4 条）——它是一次真实的付费调用却没有行，需要先为它定义身份与轨迹，属新卡，本卡不擅自开工。**（2026-10-11 更新**：该候选已于 2026-10-11 交付并实测，见 **§附录 Q**；其编号仍**由作者指定**，本记录不自行命名。**）**
> **Git 纪律**：本轮**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status --short` / `git diff --stat` / `git diff --check` 取证）。本轮改动 = **2 个新文件**（`src/lib/ai-metering.ts` 204 行、`src/lib/ai-metering.test.ts` 234 行）+ 6 个变更文件（`src/lib/types.ts`、两个成本中心路由、`cost-center-client.tsx`、两个路由测试）+ 3 个 locale + 本附录 + 编号对照 **§18**。**如实登记**：`git diff --stat` 里这些文件同时**含有此前各卡的未提交改动**（`budget/route.ts`、`budget-panel.tsx` 等本卡一行未碰），因此**不能**用聚合 diff 数字声称本卡的行数增量；主线计划文档**未被 git 跟踪**（`?? docs/coolpilot-capability-integration-plan.md`），故本附录**不出现在 `git diff`** 里，编号映射是**已跟踪**文件。

## 附录 Q：能力探测（`POST /api/ai/models/probe`）预算闸门与账本接入交付记录（done，2026-10-11；**编号待作者指定**）

> **为什么追加在文件末尾**：与 §附录 D / H / L / M / N / O / P 同一约定——交付记录追加到末尾，§1 与 §13 的行号保持不变。本轮**未在 §1 新增任何行**（本卡尚无编号），**未改 §13 一字**；唯一触碰既有行的地方是在 **§附录 P · P.8 的「下一步编号」同一行内加一句**指向本附录（与 §附录 G 对 §附录 D 第 1745 行「同行加字指向它」的做法一致），**不产生任何行号位移**。
> **交付范围**：兑现 **§附录 P** 与编号对照 `docs/development/capability-integration-numbering-map.md` **§18** 的「下一步」里登记的**同一张候选卡**——「把 `POST /api/ai/models/probe` 接入账本」：能力探测是一次真实的付费调用，却既没有预算闸门、也没有账本行。
> **编号纪律（如实登记）**：作者尚未为本卡指定编号，本记录**不给出编号**、**不占用 `CI-P7-05-*` 任何子号**（`CI-P7-05` 卡体仍只剩 `-01`）。编号确定后再补 §1 一行、本节标题与编号对照 §3 的对应行。
> **一句话**：探测一直是这个产品里**唯一**绕过预算与账本的供应商调用路径；本卡把闸门放在**发出请求之前**、把账本行放在**请求之后**，两处都复用既有的 `beginAiBudgetCall` / `recordAiUsageCall`，没有为它另造一套记账。

### Q.1 落地前实测的缺口（先说清「缺什么」）

| 项 | 实测 |
| --- | --- |
| 调用路径 | `probe.ts` 第 **104–262** 行：`loadCallableModel` → `adapterFor` → `runWithCredentialKey` → `adapter.chat`，一次真实付费请求（含密钥轮换，结果落 `PROBE_TEST` 能力标记与 `model_probe_records`） |
| 预算 | `beginAiBudgetCall(` 的**调用点**在 `src` 下实测 **15 处 / 13 个文件**（不含 `import`、注释与函数定义；另有 `src/lib/ai-budget-guard.ts:623` 一处闸门内部自身调用、`src/test/ai-budget-probe.ts:42` 一处测试探针）。**其中本卡只新增 1 处**——`src/app/api/ai/models/probe/route.ts:38`，其余 14 处一行未碰 |
| 口径说明 | §附录 G 记的是「14 文件 / 15 处 `beginAiBudget*`」，统计前缀不同，**两者不做加减**（本记录只数 `beginAiBudgetCall(` 的调用点） |
| 账本 | 探测路由此前**没有任何** `recordAiUsageCall`：请求成功或失败都只写能力标记与探测记录，**不进 `ai_usage_ledger`** |
| 结论 | 这是一条**真实付费路径**（用户自己的 Key、自己付钱），却没有闸门、没有行、没有价格快照——与 §13 第 **480 / 485** 行的产品原则（「所有 AI 支出必须可追踪」/「未来新增 AI 功能必须遵循统一接入规范」）直接冲突 |

### Q.2 闸门：位置、估算口径与拒绝语义

| 项 | 内容与依据 |
| --- | --- |
| 闸门位置 | **发出请求之前**：`probe.ts` 第 **146–155** 行在 `runWithCredentialKey`（第 **166** 行）之前 `await metering.begin(...)`；实现落点是 `route.ts` 第 **34–61** 行的 `meteredProbe()` → `beginAiBudgetCall`（第 **38** 行） |
| 估算口径 | 用**这次探测自己的请求**：真实输入文本（`requestTextOf(messages)`，第 **95–97** 行）、线上同一个上限 `modelProbeMaxOutputTokens = 32`（第 **24** 行，就是真正写进 `max_tokens` 的那个数）、用户选中的 `providerId` / `modelId` 与这次要验的 `capability`——**不是**解析器可能改选的模型（否则等于拿一个永远不会被调用的模型的价格去比预算） |
| 身份 | `identity` **有意留空**（`route.ts` 第 **30–32** 行）：探测不属于任何 run / task / article / listing，被验的模型已经在每行的 `provider_id` / `model_id` 上；不编造业务 id |
| 拒绝语义 | 闸门拒绝在发请求前抛出，由路由的 `failFromError` 转为 **402 + `AI_BUDGET_EXCEEDED`**（`route.ts` 第 **81–83** 行）：**没有请求、没有 `PROBE_TEST` 标记、没有探测记录、没有账本行** |
| 预留对账 | `budgetReservationId` 从闸门回执写到该探测的每一行（`route.ts` 第 **50** 行）→ 预留与花费按 **id** 对账，而不是按用途 + 时间相关（CI-P7-03-A） |
| 不需要计量的探测 | `probeableCapabilities` 之外的能力（如 `image_generation`）在闸门**之前**就返回 `unsupported`（`probe.ts` 第 **124–135** 行）：既不占额度也不写行，结果仍如实落库 |

### Q.3 账本：一行一请求，说不出来就留 NULL

- **单位 = 一次请求**：把 runtime 自己的 `ModelAttempt[]` 轨迹交给 `recordAiUsageCall`（`probe.ts` 第 **240–243** 行）→ 一行一请求；被拒的密钥**排在前**，因为被拒的请求也可能已被计费（第 **165–204** 行）。
- **价格冻结在行上**：`purpose: model-probe`、`metered_kind: text`、`costSource: computed` / `unpriced`，币种随价格快照。
- **供应商没报用量** → `completeness: unknown` + `costAmount: NULL`（**从不写 0 冒充**）。
- **模型没有价格** → `completeness: reported` + `costSource: unpriced` + `costAmount: NULL`，且**不占额度**（算不出金额就不预留）；行上也**没有**预留 id，而不是编一个。
- **用户把未知成本设为拒绝** → 402 且不写行（拒绝是用户自己的设置说话，不是目录缺行）。
- **顺序**：先记账、再还预留，两者都在 `finally` 里且都不抛（第 **236–244** 行）——记账不能把探测自己的答案带下去。

### Q.4 依赖方向（为什么闸门逻辑不在冻结面里）

- 冻结面 `src/features/ai-runtime` 保持**只定义、不接线**：新增的是端口与数据形状 `ModelProbeMetering` / `ModelProbeTarget` / `ModelProbeMeteringSession`（第 **48–71** 行），**不 import 任何 `src/lib` 预算或账本模块**。
- 实现放在**调用方（路由）侧**：只有 `route.ts` import `beginAiBudgetCall` / `recordAiUsageCall` → 不产生 `probe → lib → runtime` 环。
- **不传 `metering` 的调用方 = 本卡之前的行为**（未计量的探测），因此 runtime 自己的行为测试一行未改。

### Q.5 改动清单（本轮）

| 文件 | 现况 | 本卡做了什么 |
| --- | --- | --- |
| `src/features/ai-runtime/probe.ts` | **262** 行（相对 HEAD `+152 / −7`，**含此前未提交改动**，不单独归因本卡） | 新增端口与三段数据形状、`modelProbeMaxOutputTokens`、`requestTextOf()`、`attempts` 轨迹、`finally` 里的记账与还预留 |
| `src/app/api/ai/models/probe/route.ts` | **84** 行（相对 HEAD `+63 / −2`） | 新增 `meteredProbe()`（`beginAiBudgetCall` 落点）、`usageCall.budgetReservationId`、把 metering 注入 `probeModelCapability` |
| `src/lib/ai-metering.ts` | **208** 行（本卡 **+4**：第 **66–69** 行） | 把探测路由登记为 `text` 行的**生产者**，并写明它为什么在名单里——维度声明与实际写作者保持一致，避免「有行无生产者」的漂移 |
| `src/app/api/ai/models/probe/route.test.ts` | **新文件，293 行 / 7 用例** | 见 Q.6 |

### Q.6 测试与验证（本轮实跑）

| 用例 | 断言什么 |
| --- | --- |
| records the request the probe sent, prices it, and gives the hold back | 真实链路（route → probe → registry → key pool → adapter，**只替换传输**）：发 1 次 `chat/completions`，`model` 为用户所选、`max_tokens: 32`；账本 1 行 `purpose: model-probe` / `meteredKind: text` / `outcome: success` / `completeness: reported` / `costSource: computed` / `costCurrency: CNY`，用量 `3 in / 2 out / 5`，`costAmount = 5`（价格目录 1 CNY/token 的生效行）；行上带 `budgetReservationId`，且在途预留已为空 |
| answers the gate's 402 before the provider is asked, and writes nothing at all | 402 + `AI_BUDGET_EXCEEDED`；`calls == []`、**无账本行、无 `PROBE_TEST` 标记** |
| records a rejected request as its own row, with no figure invented for it | 被拒的请求也是账本行（`outcome: failed`），金额留空 |
| leaves a provider that reports no usage unmeasured instead of writing a zero | `success` + `completeness: unknown` + `costSource: unknown` + `costAmount: null`（**不写 0**） |
| records a probe on a model with no price, and holds nothing for it | `reported` + `unpriced` + `costAmount: null` + `pricing: null` + `budgetReservationId: ""`（没有可述金额就没有预留） |
| refuses an unpriceable probe when the user asked unknown costs to be refused | `unknownCostPolicy: block` → 402，无请求、无行 |
| does not gate or record a capability a single request cannot test | `image_generation` → 200 / `status: "unsupported"`，无请求、无行，但探测记录仍落库 |

**数字（本轮实跑）**：定向 `npx vitest run src/app/api/ai/models/probe/route.test.ts` → **exit 0 / 1 文件 7 用例**；全量 `npx vitest run` → **exit 0 / 170 文件 1483 用例全通过**（§18 记录上一轮 169 / 1476，差额 **+1 文件 / +7 用例**，与本卡新增一致）；`npx tsc --noEmit` → **exit 0**；`npx eslint`（本卡 4 个文件）→ **exit 0 / 0 problems**；`git diff --check` → **exit 0**（仅三份 locale 的 LF/CRLF 既有 warning）。

**隔离口径**：本文件共享一个临时库，因此每个用例用**自己的模型 id**，并按 `Date.now()` 取时间窗读自己的行（`probeRows(since)`）；价格用「1 CNY / 百万 token × 1,000,000」，让金额直接读成 token 数。

### Q.7 未做 / 未验证（如实登记）

1. **未发过真实供应商请求**：全部验证在临时库 + 被替换的传输上进行；真实库**没有**本卡写入的行（也不应新增列 / 表 / 迁移）。
2. **探测不归属到触发它的用户动作**：`identity` 有意留空，因此成本中心里的探测行只有 `model-probe`，不挂到任何运行 / 任务上。这是**有意选择**（不编造身份），但「谁触发了这次付费探测」目前无法从账本回答——若要这一层，需另行定义身份来源。
3. **vision 探测的图片不计入输入 token**：1×1 PNG 是 wire 上的字节而不是文本，`requestTextOf()` 只量文本（`probe.ts` 第 **90–97** 行）；估算因此是**保守**的（少算），账本行仍以供应商回报的用量为准。
4. `provider-reported` / `interrupted` 仍无生产者（各卡共通，见 §附录 P）。
5. 打包版 Electron 未验证（各卡共通基线）；本卡无 UI 改动，故未做浏览器渲染验证。

### Q.8 登记与下一步

> **登记**：§1 **未新增行**（本卡无编号）、**未改任何既有行**；§13（第 **471–489** 行）**一字未动**；**§附录 P · P.8 的「下一步编号」同一行内加字**指向本附录（行号不变）；编号对照文件新增 **§19**（本卡）与 **§7 第 20 条 / 第 21 条**。
> **下一步编号**：① 本卡编号由作者指定后，在 §1 新增一行（**会使 §1 之后所有行号 +1**；按「先报告差异、不顺手修正」的既有规则，本次不动）；② `CI-P7-05` 卡体仍只剩 **`-01`**（图片 / 视频 / 语音 / Embedding 接入同一计量并**录价**）；③ 本卡新登记一条**待编号候选卡**：**Embedding 能力端到端接入**，见 **§附录 R**——它有一个**必须先由作者拍板**的前置决策（向量存储方案），因此本卡**不开工、不选型**。
> **Git 纪律**：本轮**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`（仅只读 `git status` / `git diff --numstat HEAD` / `git diff --check` 取证）。本轮改动 = **1 个新文件**（`src/app/api/ai/models/probe/route.test.ts`）+ **3 个变更文件**（`probe.ts` / `route.ts` / `ai-metering.ts`）+ 本附录 + 编号对照 §19 / §7 第 20–21 条。**如实登记**：`ai-metering.ts` 与 `route.test.ts` 均为**未跟踪**文件（`??`）；`git diff --numstat HEAD` 给出的 `probe.ts` / `route.ts` 行数**含此前各卡的未提交改动**，**不**作为本卡增量；主线计划文档**未被 git 跟踪**（`?? docs/coolpilot-capability-integration-plan.md`），编号对照是**已跟踪**文件。

## 附录 R：待编号候选卡登记 · Embedding 能力端到端接入（2026-10-11；**已登记；§15 Q1 已裁定，未开工**）

> **为什么追加在文件末尾**：与 §附录 C 同一位置约定（那里登记的是「参考项」而不是交付），追加在末尾 → §1 / §13 与所有既有附录的行号**不动**。
> **这是什么**：一条**正式登记、尚无编号、未开工**的候选卡。作者指示：**先登记，再实现**；**编号由作者指定**——执行方**不得**自行命名，尤其**不得**占用 `CI-P7-05-05`（`CI-P7-05` 卡体仍只剩 `-01`）。
> **为什么现在登记**：① §附录 P / Q 刚把成本与计量面收口成「六个维度全部点名」，其中 **`embedding` 被声明为 `no-runtime-path`**（`src/lib/ai-metering.ts:77`）——它是本安装里**唯一「有完整价格与计量设计、却没有任何调用路径」的维度**；② 知识库目前**没有语义检索**，取用规则只有「启用 + 定位 + 权重 + 最近更新」（R.1）；③ 设计稿 `docs/model-layer-spec.md` §11.4 已经写好 embedding 的调用形状；它原先**卡在 §15 的未决问题 Q1（向量存储放哪）**——**该 Q1 已于 2026-10-11 裁定为方案 (a)：SQLite JSON 持久化向量 + TypeScript 内存暴力检索**（裁定正文见设计稿文末 **§15-Q1 决策记录**），执行拆分见本文件 **§附录 S**。
> **一句话**：这条卡要把「已经设计好、却没人能调用」的 embedding 变成一条**真实可运行、可计量、可定价**的链路，并让知识库第一次有**语义召回**可用——而它的第一件交付物是**作者的决策**，不是代码。

### R.1 现状证据（本轮实查，先钉住「已经有什么」）

| 项 | 实测 | 出处 |
| --- | --- | --- |
| 计量维度 | `aiUsageMeteredKinds` 已含 `embedding`；`aiUsageKindUnits.embedding = []` → **按输入 token 计价（token 列），没有输出侧** | `src/lib/types.ts:688`、`:710–714` |
| 计价 | `computeUsageCost()` 已有 embedding 用例：输入 token × 单价（另有「embedding 只按输入 token 计价」的注释） | `src/lib/ai-usage-ledger.ts`；`src/lib/ai-usage-ledger.test.ts:335` |
| 计量声明 | `embedding: { producers: [], gap: "no-runtime-path" }` —— 该维度**被点名**，而不是从列表里消失 | `src/lib/ai-metering.ts:77`（§附录 P 交付） |
| 调用路径 | `src/features/ai-runtime` 下**没有任何** `/embeddings` 或 embedding 适配代码（本轮 grep 命中 **0**） | 本轮实测 |
| 能力声明 | `embedding` 已经是模型能力枚举的合法值（校验层认它） | `src/lib/validation.ts:712` |
| 探测 | `probeableCapabilities` 不含 embedding → 探测对它返回 `unsupported`（**设计如此**，不是缺口） | `src/features/ai-runtime/probe.ts:17` |
| 向量存储 | 仓库里**没有向量列、没有向量表**：`knowledge_base` 只有 `id / title / content / category / weight / enabled / origin / tags_json / source_url / file_name / position_id / created_at / updated_at` | `src/db/schema.ts:195–209` |
| 数据库形态 | `@libsql/client` + `drizzle-orm/libsql`（本地文件库），并有 `PRAGMA busy_timeout` 的「设置后读回校验」 | `src/db/client.ts:1–2`、`:53–78` |
| 知识库检索（现状基线） | `selectKnowledgeReferences()`：**启用 + 定位匹配 + 权重序 + 最近更新**，最多取 **8** 条、每条正文截 **300** 字——**没有关键词打分，也没有语义相似度** | `src/lib/knowledge-base.ts:18`、`:147–158` |
| 知识库接口 | 只有 `route.ts` / `ai-parse` / `import-products` / `upload` / `[id]`，**没有检索 / 搜索端点** | `src/app/api/knowledge-base/**` |
| 前置决策 | 设计稿把「向量存储放哪」列为 **Q1 未决**，并注明它直接决定闭环第 3 步（去重）与第 12–13 步（聚类）能否落地；开工清单里「§15 的 Q1–Q5 有结论」仍是**未勾选**项 | `docs/model-layer-spec.md:972`、`:987–993` |

### R.2 目标（价值三问）

- **用户价值**：知识库从「按权重和新鲜度抓取」扩展到**按语义相关性召回**——同样的资料，写作时被命中的是**对的那几条**。
- **商业价值**：向量化 + 检索是 Creator 工作流、可复用知识能力与 Marketplace 扩展的**公共底座**。
- **技术价值**：把**已经存在的 embedding 价格与计量设计**对应到一条**真实可运行**的调用链（今天它是唯一「有设计、无路径」的维度）。

### R.3 向量存储方案：**已裁定（2026-10-11，方案 (a)）**（比较材料保留如下；裁定正文见设计稿文末 §15-Q1）

| 方案 | 做法 | 优点 | 代价与风险 | 与「本地优先」的关系 |
| --- | --- | --- | --- | --- |
| (a) `ai_embeddings` 表 + JSON 列存向量 + 内存暴力检索 | 复用现有建表机制（本仓库既有惯例：**无 drizzle-kit 迁移文件**），随库一起备份 / 导出 / 删除 | 万级以内可用；实现与维护最直白；无新依赖 | 规模上去后检索成本线性增长、内存放大 | 最贴合「本地优先 / 数据主权 / 离线可用」 |
| (b) `sqlite-vec` 类扩展 | SQL 内近似最近邻检索 | 检索能力与规模上限最好 | 需要 libsql 侧扩展支持（本仓库用 `@libsql/client`），有**构建与分发风险**；打包版 Electron 还要再验一次 | 数据仍在本地库，但运行时分发面变复杂 |
| (c) 独立本地索引文件（自研） | 索引可单独重建、换模型可并存 | 与库解耦，换模型影响可控 | **自研工作量最大**；要自己保证索引与库一致；删除 / 重索引逻辑变多 | 本地，但多一份需要维护的真相 |

**建议的比较维度（作者拍板时按这些看）**：离线可用性 / 数据主权（能否随库整体导出与删除）/ 维护成本（谁看得懂、谁修得动）/ 规模上限 / 换模型时的重建成本。

> **作者已裁定（2026-10-11）：方案 (a) —— SQLite JSON 持久化向量 + TypeScript 内存暴力检索**。上表三个方案的比较材料**保留**（它是裁定依据）。结论文本已写入 `docs/model-layer-spec.md` 文末 **§15-Q1 决策记录**（并就地标注 §15 的 Q1 行与落地检查清单那一行），执行拆分见本文件 **§附录 S**。**本轮仍不进实现阶段**：「不写迁移 / 不建表 / 不选型」是裁定前的前置约束，现已解除，但本轮仍**不动业务代码**。

### R.4 建议的交付顺序（每步都有可验证的完成标准；**本记录只登记，不实施**；**已由 §附录 S 细化为「阶段 0–7」**）

1. **决策记录 —— 已完成（2026-10-11）**：Q1 定案 = 方案 (a)（材料见 R.3；正文见设计稿文末 **§15-Q1**）。**完成标准达成情况**：§15 的 Q1 有结论 ✅；落地检查清单那一行**已就地标注 Q1 已结论，但整行仍保持未勾选** —— 该行是「Q1–Q5 全有结论」，Q2–Q5 未决，**不勾是对的**。
2. **打通调用链**：AI Runtime 增加 embedding 能力（复用 Provider / 用户密钥 / 预算闸门 / 账本 / 价格目录），支持批量文本向量化（设计稿 §11.4：`openai-compatible → POST {base}/embeddings`，批 32~256 条/次）→ **完成标准**：真实调用成功；账本出现 `metered_kind: embedding` 行（按输入 token 计价；**没有价格时如实 `unpriced` + NULL，不写 0**）；闸门在**发出之前**生效。
3. **接入一个真实业务场景**：知识库语义检索（切片 → 向量化 → 存储 → 按查询召回），**保留现有规则路径**（`selectKnowledgeReferences`）作为对照 → **完成标准**：同一批资料下两种召回**可对比**，结论有数据，不是「看起来更好」。
4. **闭环验证**：导入 → 向量化 → 召回 → 计量 → 删除 / 重索引；并验证**换模型后向量维度变化**的兼容性 → **完成标准**：删除与重索引不留残迹；旧维度向量不与新维度**混算**；成本可读。

### R.5 范围与不做

- **做**：一条 embedding 调用链 + 一个业务消费者（知识库）+ 计量与价格的复用 + 可对比的召回证据。
- **不做**：完整 RAG 系统（`CI-P3-03` / `P3-03-05` 的「本轮不以建设完整 RAG 系统为前置条件」口径继续有效——本卡**不改写那张卡的历史结论**，只是**新开一张卡**）；跨维度混算；**不新建 AI 调用旁路**（必须经过冻结面 `src/features/ai-runtime`）；不改 C2 发布语义；不做 Marketplace 侧功能。
- **与 `CI-P7-05-01` / 新清单 `P8-06` 第一条的关系**：那条卡管的是**计量与录价入口**（含 embedding 的价格录入），`-01` 至今**未交付**。本卡**不占用**它、也不替它交付；本卡上线后、录价之前，embedding 行会如实 `unpriced`——那是那条卡的缺口在界面上的表现，不是本卡的缺陷。
- **与 `CI-P3-03` / `P3-03-05` 的关系**：那张卡**有意**没做 RAG 预留（§附录 B-10 §4 已登记）。本卡不重开它；若作者希望把「预留接口」也算进 `CI-P3-03`，请另行裁定，本记录不擅自改那张卡的状态。

### R.6 编号处理（**必须由作者指定**）

- **本记录不给编号**，也**不写** `CI-P7-05-05` 或任何 `CI-P7-05-*` 子号。
- **可选归属（由作者裁定）**：① 作为**新卡**给一个编号（新前缀，或既有阶段的下一个空号）；② 若作者认为它属 `CI-P7-05` 家族，则为该家族**新增子项**并给出子号；③ 若作者认为它属新清单的能力卡（P3 / P4 系），则在新清单里给号——三种都**不由执行方代填**。
- **编号确定后的登记动作（本次未做）**：§1 新增一行（**会使该行之后所有行号 +1**）、§13 或新阶段小节加卡体、编号对照 §3 加对照行（若新清单也有号）。本节标题随之补编号。

### R.7 Git 纪律

本轮**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`。**第一轮改动**（2026-10-11）= 主线计划 **§附录 Q / §附录 R**（追加于末尾）+ 编号对照 **§19 / §20 / §7 第 20–21 条**。**第二轮改动**（同日，Q1 裁定登记）= 设计稿 `docs/model-layer-spec.md` 文末新增 **§15-Q1 决策记录**（另加 §15 表格 Q1 行、落地检查清单行、§11.4 第 ⑦ 步**三处同行标注**）+ 主线计划新增 **§附录 S**（执行清单）+ 编号对照 **§20 状态更新** 与 **§7 第 22 条**。两轮**均未改任何业务代码**、**未新增表 / 列 / 迁移**、**未新开任何 AI 调用**、**未写任何实现代码**。

## 附录 S：Embedding 开发执行清单（候选卡的执行拆分；**本清单不分配编号**；2026-10-11 登记）

> **为什么追加在文件末尾**：与 §附录 C / §附录 Q / §附录 R 同一位置约定 —— 追加在末尾 → §1 / §13 与所有既有附录的**行号不动**。
> **这是什么**：**§附录 R** 登记的候选卡「Embedding 能力端到端接入」的**执行拆分清单**（阶段 0–7，按依赖排序）。它是 **R.4 四条交付顺序的细化**（粗/细关系，不替换 R.4），供后续**正式开发卡拆分**使用。
> **前置阻塞已解除**：R.3 的阻塞项 —— 设计稿 `docs/model-layer-spec.md` **§15 Q1「向量存储放哪」** —— **已于 2026-10-11 裁定为方案 (a)**（SQLite JSON 持久化向量 + TypeScript 内存暴力检索）；决策正文见该文件文末 **§15-Q1 决策记录**。因此本清单**不再等决策**。
> **本条清单不分配编号**：不写 `CI-P7-05-05` 或任何 `CI-P7-05-*` 子号，也不占用 `CI-P7-05-01` 的录价职责；正式编号由计划维护者按现行编号规则指定（可选归属见 **R.6**）。
> **本轮不动业务代码、不进入实现阶段**：只登记清单 —— **未**改任何业务代码、**未**新增表 / 列 / 迁移、**未**新开任何 AI 调用、**未**改 C2 发布语义、**未**执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`。

### S.1 阶段 0：开发前核对

- 核对现有 AI Runtime 的 Provider、Adapter、模型配置与能力声明机制。
- 核对现有 AI 预算门禁、用量记录、成本计算与计量覆盖率机制。
- 核对知识库表结构、文本切片来源、现有召回入口和业务实体隔离规则。
- 核对现有 SQLite 初始化、建表和版本升级方式。
- 确认 Embedding 模型配置需要哪些字段，包括 Provider、模型标识、向量维度及必要的能力信息。
- 明确哪些内容可以复用，避免重复建设模型调用、计量、数据库和知识库基础设施。

**完成标准：** 形成基于现有代码的实现路径；不新增重复机制，不因本任务顺带重构无关模块。

### S.2 阶段 1：Embedding 模型调用能力

- 在现有 AI Runtime 扩展 Embedding 调用能力，避免业务代码绕过 Runtime 直接调用 Provider。
- 按现有模型层规范实现 OpenAI-compatible Embedding 请求适配。
- 支持单条文本和批量文本输入；批量上限应依据 Provider 限制与现有规范确定。
- 解析响应中的向量及其对应关系，校验返回数量、维度和数值有效性。
- 明确处理请求失败、响应不完整、超时和不支持 Embedding 的模型。
- 将 Embedding 调用接入既有预算门禁和用量计量流程。
- 在真实用量未知时保持成本未知，不以输入字符数或预估值伪装成实际 Token 用量。
- 保持未接入 Embedding 的既有模型调用路径不变。

**完成标准：** 能通过统一 Runtime 调用受支持的 Embedding 模型，得到经过校验且可追溯的向量；失败和预算拒绝行为明确。

### S.3 阶段 2：向量数据模型与 SQLite 持久化

- 根据现有数据库结构决定向量记录与知识库切片的关联方式，优先复用现有实体标识。
- 明确向量记录至少需要保存的关联信息：来源切片或实体标识、Embedding 模型标识、向量维度、向量数据，以及现有架构所需的创建或更新时间。
- 将向量序列化为 JSON 保存到 SQLite。
- 明确向量记录的唯一性、更新和删除规则，避免重复生成导致重复记录。
- 明确来源文本更新、切片删除、知识库删除及模型变更时的向量失效与清理策略。
- 使用现有数据库迁移或初始化机制完成必要的结构变更。
- 不将 API Key、凭据或其他敏感信息写入向量记录。
- 不引入 `sqlite-vec`、独立向量数据库或独立索引文件。

**完成标准：** 向量可以可靠保存、读取、更新和删除，并且能够追溯到正确的来源切片和 Embedding 模型。

### S.4 阶段 3：内存暴力检索

- 定义独立的向量存储接口和相似度检索接口。
- 从 SQLite 读取符合业务范围的候选向量。
- 在 TypeScript 应用层实现余弦相似度计算。
- 对查询向量和候选向量执行维度、数值有效性及零范数校验。
- 排除无效向量，不将无效数据静默转换为有效匹配结果。
- 按相似度排序，支持 Top-K 返回。
- 明确相似度并列时的稳定排序规则。
- 明确无候选数据、无有效向量及无匹配结果时的返回行为。
- 在查询前或候选筛选阶段落实知识库启用状态、业务实体归属及现有访问约束。
- 避免不必要的重复 JSON 解析和向量读取，但暂不建设复杂缓存或索引系统。

**完成标准：** 几百到几千个文本切片可以通过内存暴力检索获得可重复、可验证的 Top-K 结果。

### S.5 阶段 4：接入现有知识库召回

- 梳理现有 `selectKnowledgeReferences()` 的调用链与业务约束。
- 在现有知识库召回流程中接入向量检索，而不是另建一条绕过现有规则的业务路径。
- 明确 `knowledgeMode` 的现有行为与向量召回之间的关系；不得未经确认就改变 `position` 和 `off` 的既有语义。
- 明确向量召回结果如何与来源文本切片关联，以及如何截取最终上下文。
- 明确 Top-K、相似度阈值和上下文长度的默认值及配置位置；未确定的参数在实现前核对现有规范。
- 避免把不相关或越权的知识切片加入模型上下文。
- 验证召回结果能够进入现有 AI 请求，并且不会重复拼接同一切片。
- 保留合理的空结果与失败处理，不让 Embedding 服务故障无条件破坏既有业务路径。

**完成标准：** 从知识库文本切片到向量召回，再到 AI 上下文使用，形成真实的端到端闭环。

### S.6 阶段 5：验证与回归

- 验证 Embedding 请求成功、失败、超时、预算拒绝及未知成本场景。
- 验证向量 JSON 的写入、读取、更新和删除。
- 验证余弦相似度、Top-K 排序、并列排序及无效向量处理。
- 验证不同模型或不同维度的向量不会被直接混合比较。
- 验证知识库禁用、业务实体隔离和空知识库场景。
- 验证来源切片更新或删除后不会继续召回失效数据。
- 验证 `knowledgeMode` 的现有行为与其他 AI 调用路径未发生非预期变化。
- 执行必要的针对性测试，以及项目现有的 TypeScript、Lint 和相关回归检查。
- 对端到端验证中未覆盖的真实 Provider 行为、模型兼容性或成本准确性明确标注，不宣称已验证。

**完成标准：** 核心功能通过测试，现有业务行为得到保护，未验证事项在交付记录中明确列出。

### S.7 阶段 6：规模与性能验证

- 使用符合首版预期的几百到几千个文本切片进行检索测试。
- 记录候选向量数量、向量维度、检索耗时和必要的内存指标。
- 观察 SQLite 读取、JSON 解析、相似度计算和排序各环节的开销。
- 暂不引入向量索引优化；只有测量结果证明存在实际瓶颈时，才提出升级方案。
- 如果将来评估其他存储或索引方案，验证结果与现有实现的一致性，并评估 Electron 构建和发行兼容性。

**完成标准：** 首版规模下的检索性能有实际测试依据，并为未来是否升级提供可比较的数据。

### S.8 阶段 7：交付记录

- 记录最终采用的接口、数据关联方式和检索流程。
- 记录实际支持的 Embedding Provider 与模型能力。
- 记录预算、用量、成本未知及失败处理方式。
- 记录测试结果、验证范围和未验证事项。
- 将执行结果登记到主线计划的相应位置（按既有惯例：交付记录追加为新的 **§附录**，并在编号对照文档补齐对照行）。
- 由计划维护者依据现有编号规则分配正式开发卡编号；本清单不预先分配编号。

**完成标准：** 交付记录可核对到具体文件与测试结果；未验证事项如实列出。

### S.9 执行顺序与范围控制

建议按以下依赖关系推进：

0. 现状核对与接口确认 → 1. Embedding Runtime（模型调用、计量、预算）→ 2. 向量持久化（SQLite JSON、关联与生命周期）→ 3. 内存相似度检索 → 4. 接入知识库召回与 AI 上下文 → 5. 回归验证、性能测试与交付登记。

- **可并行**：阶段 1 与阶段 2 在**接口与数据关联方案确认后**可以并行开发。
- **串行约束**：阶段 4 **依赖**前面的能力完成；阶段 5 / 6 的结论必须基于真实测量与真实库数据（不得用推测替代）。
- **范围控制**：本清单不因顺带发现而扩张 —— 不重构无关模块、不新建 AI 调用旁路、不改 C2 发布语义、不做完整 RAG / Marketplace。

### S.10 最终验收（本卡整体的完成定义）

本地知识库能够完成文本切片 Embedding 生成、SQLite JSON 持久化、TypeScript 内存相似度检索及 AI 上下文召回，并继续遵守 CoolPilot 的本地优先、用户数据主权和现有预算计量约束。

> **本轮实际动作的边界（如实登记）**：本轮只做两件文档事 —— ① 把 Q1 的裁定正文写入设计稿（文末 **§15-Q1 决策记录**，并就地标注 §15 的 Q1 行与落地检查清单那一行）；② 登记本清单。**未**进入实现阶段、**未**修改业务代码。

## 附录 T：`CI-EMB-01` Embedding 端到端接入登记（支线卡；**编号已正式确认（2026-10-11 作者裁定）**；2026-10-11）

> **本附录 = 该卡的登记与实现边界**，**不是交付记录**（本卡**未开工**）。作者 2026-10-11 裁定：① 编号归属采用**独立支线 `CI-EMB-*`**，**不归入任何 `CI-P*` 阶段**；② §1 **同行追加**（不新增独立行），状态写「**建议编号，待作者确认**」，**不**把建议编号写成已正式分配编号；③ 卡体**追加于本文件末尾**（即本附录），既有行号**零位移**；④ **不分配** `CI-P7-05-05` 或 `CI-P3-04`，**不改**其他卡号，**不批量修复**已发现的既有引用漂移。

### T.1 卡片身份与编号状态

| 项 | 内容 |
| --- | --- |
| 支线名称 | **Embedding 端到端接入**（知识库文本切片 → 向量 → 语义召回） |
| 建议编号 | **`CI-EMB-01`**（支线族 `CI-EMB-*` 的第一个；实测本文件 `CI-EMB` 命中 **0**，无冲突）——**2026-10-11 作者正式确认**为正式编号（确认前阶段 0 复核：本文件与编号对照文档内 `CI-EMB` 仅出现在本卡登记段，**0 冲突**） |
| 编号状态 | **编号已正式确认（2026-10-11 作者裁定）**；原「建议编号，待作者确认」为**历史状态**。确认时**未改名**（沿用 `CI-EMB-01`），故 §1 第 **72** 行、本附录标题、编号对照 **§20 标题 / §21** 三处均**同行更新**，**零位移** |
| 主状态 | **实现中（2026-10-11 起）** —— §附录 S 的阶段 0–4 已实现并通过测试，阶段 5 的定向与全量验证已执行；真实 Provider 未验证（见 **T.10**） |
| **明确不占用**的编号 | `CI-P7-05-05`（`CI-P7-05` 家族只剩 `-01`，见本文件第 **2796** / **2863** 行）、`CI-P3-04`、以及任何 `CI-P*` 与 Marketplace 的 `P7-*` 号 |
| 登记位置 | 本附录 + §1 第 **72** 行（**同行追加**）+ §13 第 **473** 行（**同行追加**）+ 编号对照 `docs/development/capability-integration-numbering-map.md` **§20** / 新增 **§21** |

### T.2 实现范围（作者裁定，全部属于本卡）

1. **Embedding Runtime 调用**（经冻结面 AI Runtime，不新建旁路）。
2. **模型能力声明**（Embedding 作为可被解析 / 判定的能力值）。
3. **SQLite JSON 向量持久化**（向量与来源行、模型标识、维度一并可查）。
4. **TypeScript 内存相似度检索**（余弦暴力检索；即设计稿 §15-Q1 裁定的方案 (a)）。
5. **知识库召回集成**（接入既有召回路径，**不改**既有语义）。
6. **相关测试**。

### T.3 复用边界（不重复建设，但必须真实接入）

- **必须复用**：预算门禁 `beginAiBudgetCall`（`src/lib/ai-budget-guard.ts:432`）、用量账本 `recordAiUsageCall` / `recordAiUsageFailure`（`src/lib/ai-usage-ledger-recorder.ts:214` / `:262`）、成本计算（`aiUsageKindUnits.embedding = []` → 按输入 token 计价**已存在**）、计量覆盖率（`src/lib/ai-metering.ts`）。以上机制归 **`CI-P7-05-01`**（§1 第 **74** 行既有规则：计量与定价**不新造卡号**），**本卡不新建第二套预算 / 账本 / 计价**。
- **接入形式沿用探测卡模式**：端口类型定义在冻结面内，门禁与账本的**实现只在调用方 import**（先例：`src/features/ai-runtime/probe.ts:48/53/66` 与 `src/app/api/ai/models/probe/route.ts:1–9`）。
- **必须改变的可观测事实**：`src/lib/ai-metering.ts` 现在把 `embedding` 记为 `no-runtime-path`（缺口是**点名**而非漏记）；本卡完成后该维度必须有**真实调用行与生产者声明**，不再是 `no-runtime-path`。
- **不占用** `CI-P7-05-01` 的**录价职责**：用户录入 embedding 价格之前，账本行如实 `unpriced` + 金额 NULL（不得写 0）。
- **不做**：不重构无关模块、不新建 AI 调用旁路、不改 C2 发布语义、不做完整 RAG / Marketplace、不做跨维度混算。

### T.4 技术裁定依据（已闭环）

- **向量存储（Q1）**：设计稿 `docs/model-layer-spec.md` 文末 **§15-Q1 决策记录**（`:1002` 起）= **方案 (a)：SQLite JSON 持久化向量 + TypeScript 内存暴力检索**；**否决** (b) `sqlite-vec` 类扩展（`@libsql/client` 打包 Electron 的构建与分发风险）与 (c) 独立本地索引文件（自研成本最高）。三方案比较材料保留在本文件 **§附录 R.3**。
- **执行拆分**：本文件 **§附录 S：Embedding 开发执行清单**（阶段 0–7，S.1–S.10）—— 本附录**不复制**该清单，只登记卡的边界；两者冲突时以 §附录 S 为准。

### T.5 数据关联与生命周期（现状实测，供阶段 0 核对）

- **关联键只能是 `knowledge_base.id`**：`knowledge_base`（`src/db/schema.ts:195–209`）只有 `id / title / content / category / weight / enabled / origin / tags_json / source_url / file_name / position_id / created_at / updated_at`，**没有切片表**；今天的「切片」就是一行，召回时才 `content.slice(0, 300)`（`src/lib/knowledge-base.ts:157`）。业务隔离沿用 `position_id`。
- **失效 / 重算触发器（阶段 0 确认完整枚举）**：`content` 或 `updated_at` 变化、`enabled` 切换、行被删除、`position_id` 变化、嵌入模型或维度变化（换模型不得与旧向量混算）。
- **建表机制（决定阶段 2 怎么动手）**：所有表由 `src/db/client.ts#ensureDatabase()` 的 `CREATE TABLE IF NOT EXISTS` 创建（`knowledge_base` 在 `:242`），drizzle 表定义在 `src/db/schema.ts`；`drizzle.config.ts` 指向 `./src/db/migrations` 但**该目录不存在**（仓库无迁移文件），既有列变更走同文件内的 pragma 式手工迁移（`migrateAiModelPriceCatalog()` `:939`）→ 新向量表按**同一路径**新增。
- **批量向量化**：复用已交付的统一长任务（`runs` = `src/db/schema.ts:46` + `src/worker/{worker,runner}.ts`），**不新造任务机制**。

### T.6 召回集成边界（不得扩张既有语义）

- 现状：`selectKnowledgeReferences(entries, positioningId?, limit = 8)`（`src/lib/knowledge-base.ts:147–158`，纯函数）= `enabled` + 位置匹配（**空 `positionId` 视为通用**）+ 权重序 + `updatedAt` 倒序 + 最多 8 条 × 300 字；唯一生产调用点 `src/lib/article-generation.ts:159`（由 `src/app/api/content/generate/route.ts`、`src/app/api/ai-writing/generate/route.ts` 驱动）。
- `knowledgeMode` 的语义**只有** `["position", "off"]`（`src/lib/ai-writing.ts:172`，默认 `"position"` `:221`）—— 本卡**不改变**这两个值的含义；是否新增枚举值须另行裁定（新增值会牵动三语文案键 `knowledgeModeLabelKeys` `:175–177`）。**2026-10-11 裁定（D7=b）**：**新增独立枚举值 `semantic`**（`knowledgeModes = ["position", "semantic", "off"]`），`position` / `off` 的既有语义**保持不变**；文案键新增 `awKnowledgeModeSemantic`（三语）。落地位置见 **T.10**。
- **查询向量化本身是一次真实计费调用**（位于召回路径内）→ 必须过预算闸门 + 写账本行；**Embedding 故障 / 无价格 / 超时必须有明确回退**（回到既有规则路径或明确报错），不得让「增强」变成单点故障。

### T.7 阶段与验收（引用 §附录 S，不重复）

按 **§附录 S** 的阶段 0–7 推进：**阶段 0（现状核对与接口确认）必须先完成**；阶段 1（Runtime 调用 + 计量）与阶段 2（JSON 向量持久化）在接口与数据关联方案确认后**可并行**；阶段 4（知识库召回集成）依赖前置能力；阶段 5 / 6 的结论必须基于**真实测量与真实库数据**。

**最终验收**：真实本地知识库完成「文本切片 → Embedding 生成 → SQLite JSON 持久化 → 内存相似度检索 → AI 上下文召回」的**端到端**闭环，并继续遵守本地优先、用户数据主权与既有预算计量约束。

### T.8 登记方式与引用影响（零位移，如实登记）

- **零位移**：本附录**追加于文件末尾**；§1 与 §13 各 **1 处同行追加**（第 **72** 行、第 **473** 行）。因此本文件**行号全部未移动**：§13 卡体 **436 / 447 / 458 / 465 / 471–476**、§1 第 35–60 行、以及全部 `§1 第 N` / `§13 第 N` 既有引用**继续有效**。
- **未批量修复的既有漂移（报告不修）**：编号对照文档第 **100 / 130 / 137** 行把「菜单改名与首个真实费用界面同卡交付」记为 **`§13` 第 405 行**，但实测第 405 行属 **§10 顺序说明末段**（`§13` 自第 **428** 行起）—— 疑似前缀笔误或位移残留，**本轮不修**，交作者裁定。
- **反事实（若将来改用「§1 新增独立行」）**：第 71 行之后全部 +1，上述 `§13` 引用与 5 个文档内约 40 处引用会同时失效（实测清单见编号对照文档 **§21.5**）。
- **未执行**：`git add` / `commit` / `push` / `reset` / `clean` / `stash`；**未改**任何业务代码、**未**新增表 / 列 / 迁移、**未**发任何 AI 调用、**未**写任何实现代码。

### T.9 下一步（阶段 0 的启动条件）
阶段 0 = **只读**的现状核对与接口确认，**不写业务代码**。启动条件（均**已满足**）：① 本附录登记完成（本文件 + 编号对照文档）；② 三处接口对象已定位（Runtime / 存储 / 召回，见 T.2–T.6 与 §附录 S 阶段 0）；③ 全程只读 —— 不触碰用户正在运行的 dev server，不对真实库做写入。**阶段 0 不在本轮执行**（作者裁定：先登记并报告，再启动阶段 0）。

### T.10 实现记录（2026-10-11；编号已正式确认；**阶段 0–4 落地 + 阶段 5 定向/全量验证**）

> **定位**：本小节是**实现记录**，追加在文件末尾（**零位移**）。T.1–T.9 是登记与边界（登记当时的口径，其中 T.6 的 `knowledgeMode` 两句已就地更新为 D7=b），本小节只如实记录**已落地的文件、裁定与验证结果**。**未**改任何既有行号。

1. **编号**：`CI-EMB-01` **正式编号**（阶段 0 复核 0 冲突）。未分配 `CI-P7-05-05` / `CI-P3-04`，未改其他卡号，未批量修复既有引用漂移（漂移仍登记在 T.8 与编号对照 §21.5）。
2. **裁定落地（D1–D11）**：D1 预算/台账在**业务服务层**（`recall.ts`、`embedding-task.ts`），Runtime 不 import `src/lib` 的预算实现；D2=b **分块级**多向量；D3=c **标题+正文+分类+标签** 的确定性输入 + 源 hash（含分块与模板版本）；D4 按 **provider/model/维度** 兼容性过滤，旧模型向量**保留**（行 id 含模型）；D5 源 hash 判定 stale + 删除级联；D6=c **先业务过滤、再相似度、再组合排序**（相似度近并列窗口 `0.02` 内按 weight/updatedAt/title）；D7=b 新增独立 `semantic`；D8 查询文本取自 `titleFallback` + 素材，**独立闸门 + 独立台账行**；D9 预算拒绝**不外降级**、其他故障回退 `selectKnowledgeReferences()` 且**具名可观测**；D10 复用 `runs` / `run_events` / Worker 与预算暂停；D11 表 `knowledge_embeddings`（分块级，含 stable id / 顺序 / 文本 / 模型 / 维度 / 向量 JSON / 双 hash / 时间）。
3. **代码落点**：Runtime/Adapter = `src/features/ai-runtime/{adapters.ts,contracts.ts,runtime.ts,index.ts}`；错误码 = `src/lib/app-errors.ts`（新增 `MODEL_EMBEDDING_INVALID`）；纯契约 = `src/lib/knowledge-embedding/{embedding.ts,source.ts}`；召回 = `src/lib/knowledge-embedding/recall.ts` + `src/lib/knowledge-base.ts`（语义排序）；持久化 = `src/db/{schema.ts,client.ts}` + `src/db/repositories/knowledge-embeddings.ts`（+ `knowledge-base.ts` 删除级联）；批量任务 = `src/lib/knowledge-embedding/embedding-task.ts` + `src/worker/runner.ts`；入口 = `src/app/api/knowledge-base/embeddings/route.ts` + 知识库工作台按钮；文案 = 三语 `awKnowledgeModeSemantic` / `kb*`；计量覆盖 = `src/lib/ai-metering.ts`（`embedding` 的 `gap` 由 `no-runtime-path` 改为 `""`，producers 指向两处真实写入方）。
4. **验证（实跑）**：定向 → `src/features/ai-runtime/runtime.test.ts`（23/23）、`src/lib/knowledge-embedding/embedding.test.ts`（13/13）、`src/db/repositories/knowledge-embeddings.test.ts`（8/8）、`src/lib/knowledge-embedding/recall.test.ts`（6/6）、`src/lib/knowledge-embedding/embedding-task.test.ts`（6/6）、`src/app/api/knowledge-base/embeddings/route.test.ts`（4/4）、`src/lib/knowledge-base.test.ts`（12/12）、`src/lib/article-generation.test.ts`（14/14）；全量 `npm exec vitest run` → **exit 0 / 175 文件 / 1537 用例全通过**；`npm exec tsc -- --noEmit` → **exit 0**；`npm run lint` → **exit 0**（本卡新增文件 **0 error / 0 warning**；仓库既有 `tmp-probe-*.cjs` 与 `chat-conversation.tsx` 的既有告警不计入本卡）。
5. **未验证（如实登记）**：① **未调用任何真实 Embedding Provider**（全部用临时库 + 被替换的传输；真实库没有本卡写入的行）；② Gemini 协议**未实现** `embed`（与 CI-P3-02 的 `transcribe` 同一先例），模型声明 `embedding` 时按 `MODEL_CAPABILITY_UNAVAILABLE` 拒绝；③ 分块上限是**字符**上限（`800`），不是 token 上限，未按模型对齐；④ 大批量（数千切片）性能与并发未做基准；⑤ 打包版 Electron 未验证。
6. **Git**：未执行 `git add` / `commit` / `push` / `reset` / `clean` / `stash`；本轮结束时的 `git status` 与开工基线相比**只增不减本卡相关文件**（详见交付报告第 7 节）。


## 附录 U：`CI-LEAD-01` 营销线索与成交登记与交付记录（**作者 2026-10-12 立项**；done）

> **本附录 = 该卡的登记与交付记录**。作者 2026-10-12 在「面向业务目标的功能盘点」之后**直接立项**（原话：先选 B，立项开发「营销线索与成交记录」），并给出三条约束：① 先核对现有数据库与发布记录模型、避免重复建已有实体；② 不接平台私有 API、无法自动归因的来源必须允许手动关联；③ 不重构已完成的指标采集 / AI Runtime / 视频生产。同一裁定还要求**先把编号对照 §3 的 `CI-P2-07` 状态修正**（已在同一轮完成，见 §24.1）。**本卡不是文档卡**：改动主体是代码与测试，文档只登记事实。

### U.1 卡片身份与编号核验

| 项 | 内容 |
| --- | --- |
| 卡名 | **营销线索与成交**（线索录入 → 跟进状态 → 成交记录 → 内容关联 → 统计视图） |
| 编号 | **`CI-LEAD-01`**（支线族 `CI-LEAD-*` 的首个） |
| 编号状态 | 作者给的**建议编号是 `CI-P2-06A`**，并明确「正式编号需先检查全仓编号冲突后确定」。核验后**改取独立支线 `CI-LEAD-01`**，理由见下 |
| 主状态 | **done（2026-10-12）**；未做项见 U.6 |
| **明确不占用**的编号 | `CI-P3-04`（`CI-EMB-01` 卡已明确不占用/保留）、`CI-P7-05-05`、`CI-P2-06`（清单 §四 第 279 行「创作者资料与内容分群」保留给那张卡）、任何 `CI-P*` 与 Marketplace 的 `P7-*` |
| 登记位置 | 本附录 + §1 第 **71** 行（新增一行）+ 编号对照 `docs/development/capability-integration-numbering-map.md` **§3**（新增一行）与新增 **§24** |

**冲突核验（2026-10-12，`docs/**` 与 `src/**` 全量检索；以代码与文档实测为准）**

| 候选 | 命中 | 结论 |
| --- | --- | --- |
| `CI-LEAD` | **0** | **采用** `CI-LEAD-01` |
| `CI-P2-08` | **0** | 可用但**未采用**（理由见下） |
| `CI-P2-06A`（作者建议） | **0** | **未采用**：`CI-P2-06` 已被清单 §四 第 279 行「创作者资料与内容分群（erxes Contacts / Segments）」保留为那张卡的槽位；把线索/成交写成 `P2-06A` 会被读成「`P2-06` 的子项」，而两者不是同一件事 |
| `CI-P3-04` | 已有（被 `CI-EMB-01` 明确不占用） | 不使用 |
| `CI-P2-06` | 3 处（均为「该号已被清单占用」的说明） | 不使用 |

**为什么用独立支线而不是 `CI-P2-08`**：本仓对「**不来自清单、作者直接授权**」的卡有既定先例 —— `CI-SC-01`、`CI-AI-IMG-CONFIG-*`、`CI-ARTICLE-NAV-01`、`CI-EMB-01` 都走独立前缀（见 §1 表对应行与各自附录）。`CI-P2-*` 是清单 §四「内容生产工作流」的槽位，而本卡记录的是**业务结果**（发布 → 咨询 → 成交），不是内容生产步骤；占用同族号会误导后续编号分配。**若作者仍偏好 `CI-P2-08`，改名成本 = 6 个文件里的一次文本替换**（本附录、§1 行、编号对照 §3 / §24、`src/db/schema.ts` 的表注释、`src/lib/app-errors.ts` 的两条注释），随时可执行。

### U.2 范围对照（作者功能表 → 实现）

| 作者要求 | 状态 | 证据（以代码为准） |
| --- | --- | --- |
| 线索记录：客户称呼、联系方式（可选）、来源平台、关联内容、创建时间 | ✅ | 新表 `marketing_leads` 的 `name` / `contact` / `source_platform` / `content_item_id` / `publish_record_id` / `created_at`；`POST /api/leads` |
| 跟进状态：待跟进、跟进中、已成交、已关闭 | ✅ | 唯一词表 `marketingLeadStatuses`（`new`/`following`/`won`/`closed`，`src/lib/types.ts`）+ `marketingLeadStatusLabelKeys` + 四态徽标色（`marketingLeadStatusTones`） |
| 成交记录：成交金额、成交时间、备注 | ✅ | `deal_amount_minor`（**可空**）/ `deal_currency` / `deal_closed_at` / `deal_note`；写入规则见 U.3 |
| 内容关联：关联已有文章、视频或发布记录，尽量复用现有数据模型 | ✅（复用 `content_items` / `publish_records`，**未新增任何内容类实体**） | `resolveMarketingLeadContentItem()`：命名的发布记录**自己的内容优先**；`GET /api/leads` 用既有 `listContentItemRefs()` / `listPublishRecords()` 解析标题与平台 |
| 统计视图：线索数量、成交数量、成交金额、内容维度转化 | ✅ | `summarizeMarketingLeads()` + 页面四张统计卡 + 「内容维度转化」卡（含未关联内容分组） |
| 数据录入：手动录入 | ✅ | `/publishing/leads` 的单一对话框（创建与编辑同形，含发布记录下拉） |
| 数据录入：支持现有数据结构的导入方式 | **未做（如实登记）** | 本卡只做手动录入 + API；**批量导入（CSV/表格）未实现**，仓库内也无任何导入 UI 先例。如需，请另裁一张卡 |
| 数据原则：无真实数据时显示空状态，不虚构转化效果 | ✅ | 空库返回 `leads: []` + 全 0 计数 + 空态文案；`wonWithoutAmount` 单列；页面**无样本数据、无估算转化** |

**约束逐条回应**：① **未重复建实体** —— 新表只存「线索与成交」本身，内容与发布关系全部复用既有表与既有读取函数（`listContentItemRefs` / `listPublishRecords` / `getPublishRecord`）；② **不接平台私有 API** —— 本卡不做任何自动归因，来源平台是**用户填写的自由文本**（命名了发布记录时，只从该记录自己的 `platform` 取值），无法自动归因的一律走手动关联；③ **未重构** —— 指标采集（`metric-collector` / `metric-sync` / `/api/metrics/*`）、AI Runtime（`src/features/ai-runtime`）、视频生产（`/api/videos`、`video-render-*`）**一行未改**，C2 发布语义（`recordPublishSuccess` 写入顺序、verify 消费 receipt）**未触**。

### U.3 数据模型与写入规则（本卡唯一的持久化改动）

- **唯一新表 `marketing_leads`**（`src/db/schema.ts` 定义 + `src/db/client.ts` 的 `CREATE TABLE IF NOT EXISTS` 与 3 条索引 `idx_marketing_leads_created` / `_status_created` / `_content`）。**未改任何既有表、未加任何既有表的列**，既有库启动时只新增这张表与索引（`CREATE TABLE IF NOT EXISTS`，对已有数据零影响）。
- **四条诚实口径**（均写进表注释与 U.5 的用例）：
  1. **未记录 ≠ 0**：`deal_amount_minor` 为 `NULL` 表示「未记录」，`summarizeMarketingLeads()` 把它计入 `wonWithoutAmount` 并**排除在金额合计之外**，绝不当 0 相加。
  2. **金额是整数**：以**最小单位**（1/100，见 `dealAmountMinorScale`）存储与合计，前端用 `parseDealAmountInput()` 把输入文本转成整数后才调用 API，服务端**不做四舍五入**（`zod` 只收整数）。**已知限制**：本版对所有币种按 2 位小数处理（JPY/KRW 会被显示成 `.00`），币种一并存储所以口径错误可见而非被隐藏。
  3. **币种不混算**：`amounts` 按币种分行（`[{currency, amountMinor, deals}]`），**没有任何跨币种总额**。
  4. **成交不因改状态被静默删除**：`resolveMarketingLeadDeal()` 是唯一裁决点 —— 非 `won` 状态**不得**携带成交；把已记录成交的线索改回非成交状态会以 `400 LEAD_DEAL_RECORDED` 拒绝，**必须**在同一次写入里显式 `dealCleared: true` 才算用户同意清除。金额没有币种时以 `400 LEAD_DEAL_CURRENCY_MISSING` 拒绝（一个没有单位的数字不是金额）。
- **两条新错误码**进入既有词表（`src/lib/app-errors.ts` 的 `appErrorCodes` + fallback 文案），三语各有 `error_LEAD_DEAL_RECORDED` / `error_LEAD_DEAL_CURRENCY_MISSING`，前端经 `marketingLeadErrorKey()` 显示**具体规则**而不是「操作失败」。

### U.4 改动内容与调用链路

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 数据模型 | `src/db/schema.ts`（+45 行）、`src/db/client.ts`（+22 行） | `marketing_leads` 表定义 + `CREATE TABLE IF NOT EXISTS` + 3 索引 |
| 纯逻辑 | `src/lib/leads.ts`（新增，287 行）、`src/lib/types.ts`（+90 行） | 词表 / 金额口径 / 成交裁决 / 关联裁决 / 汇总 / 错误码映射 / 徽标色 |
| 错误词表 | `src/lib/app-errors.ts`（+9 行） | 两条 `LEAD_*` 码 + fallback 文案 |
| 校验 | `src/lib/validation.ts`（+45 行） | `marketingLeadCreateSchema` / `marketingLeadUpdateSchema`（金额只收整数最小单位） |
| 仓储 | `src/db/repositories/leads.ts`（新增，139 行） | `listMarketingLeads` / `getMarketingLead` / `createMarketingLead` / `updateMarketingLead` / `deleteMarketingLead`；**写入前**跑 `resolveMarketingLeadDeal`，拒绝时抛 `MarketingLeadFailure` |
| 路由 | `src/app/api/leads/route.ts`（新增，106 行）、`src/app/api/leads/[id]/route.ts`（新增，96 行） | `GET`/`POST` 列表与创建、`GET`/`PATCH`/`DELETE` 单条；`runtime = "nodejs"`、`dynamic = "force-dynamic"` |
| 界面 | `src/components/marketing-leads-workspace.tsx`（新增，600 行）、`src/app/[locale]/(console)/publishing/leads/page.tsx`（4 行） | 容器 + 表格 + 统计卡 + 内容维度卡 + 新建/编辑对话框 + 删除确认 |
| 导航 | `src/lib/console-nav.ts`（+3 行）、`src/lib/console-nav.test.ts`（+2 行） | 发布与渠道组新增叶子 `leads`（`/publishing/leads`），紧随「发布记录」；**不变式测试同步更新**（见 U.5） |
| 三语 | `src/locales/{en,zh-cn,zh-hk}.json`（各 **+80** 键） | 三文件均 2556 行、键集完全相同（`i18n-coverage` 用例把守） |

**调用链路**：页面 → `GET /api/leads` → `listMarketingLeads()`（唯一新表读取）→ `listContentItemRefs()` / `listPublishRecords(2000)`（**既有**读取，只解析线索命名的 id）→ `summarizeMarketingLeads()` → 校验与统计一次返回。
写入 → 对话框（本地把金额文本转成最小单位）→ `POST /api/leads` 或 `PATCH /api/leads/[id]` → `getPublishRecord()`（只有命名了记录时才读）→ `resolveMarketingLeadContentItem()` → 仓储 `createMarketingLead` / `updateMarketingLead` → `resolveMarketingLeadDeal()` **通过后才写**；拒绝则以 `400 LEAD_*` 返回，界面显示该规则。**全链路未经过 AI Runtime（本卡不调用任何模型）、未写入 `runs` / `publish_records` / `content_items`。**

**文档边界**：`docs/coolpilot-integration-contracts.md` **未改** —— 本卡不新增媒体产物、不新增长任务类型、不注册工具，因此不触发三份契约（§1 媒体产物 / §2 长任务 / §3 工具调用）；两个新端点属常规 CRUD，与 `CI-P2-05` / `CI-P2-07` 的处理一致（那两张卡也未改契约正文）。

### U.5 验证结果（**本轮 2026-10-12 实跑**）

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**（输出 0 字节） |
| 定向 `vitest run`（`src/lib/leads.test.ts` + `src/app/api/leads`） | **3 文件 / 35 用例通过**；按文件实测：`leads.test.ts` **15**、`leads/route.test.ts` **10**、`leads/[id]/route.test.ts` **10** |
| 全量 `vitest run` | **181 文件 / 1600 用例全通过**（上一张卡基线 §23.3 记 178 / 1565 → **+3 文件 / +35 用例**，正是本卡新增的三个用例文件，无其它文件变动） |
| `eslint src` | **exit 0 / 0 error / 1 warning**，唯一 warning 是**既有**项 `src/components/agent-chat/chat-conversation.tsx:146`（`react-hooks/exhaustive-deps`，非本卡） |
| `eslint .`（仓库级） | **本轮未跑**（如实标注）：仓库根尚有 3 条既有的未跟踪脚本 error（`tmp-probe-db.cjs` / `tmp-probe-zod-json-schema.cjs`），与前几张卡记录一致，**非本卡** |

**钉死的用例（按关注点列出，全部通过）**

| 关注点 | 用例（文件） |
| --- | --- |
| 未记录 ≠ 0 | 已成交无金额 → `wonWithoutAmount` 计数但**不进**金额合计（`leads.test.ts`；`leads/route.test.ts` 的汇总用例） |
| 金额整数化 | `"1200.5"` → `120050`、三位小数 / 分隔符 / 负号一律 `invalid`（`leads.test.ts`） |
| 币种不混算 | 两币种分别成行、按金额降序（`leads.test.ts`） |
| 成交不得被静默删除 | `PATCH` 改状态 → `400 LEAD_DEAL_RECORDED`，**且复查库里金额 / 币种 / 成交时间 / 备注仍在**（`leads/[id]/route.test.ts`） |
| 清除必须显式 | `dealCleared: true` 才清空（纯逻辑 + 路由各一条） |
| 金额必须带单位 | `LEAD_DEAL_CURRENCY_MISSING`（创建与编辑各一条） |
| 关联由记录裁决 | 命名发布记录 → `contentItemId` 取该记录自己的内容；`sourcePlatform` 为空时才用记录的 `platform`；`publishRecordId: null` = 解除关联（路由两条 + 纯逻辑两条） |
| 不存在的记录不写 | `PUBLISH_RECORD_NOT_FOUND`（`INVALID_PAYLOAD` + details），并复查表行数未变（路由两条） |
| 空库不虚构 | `GET` 空库 → 全 0 计数 + 空数组（路由一条） |
| 菜单不变式 | 新增叶子后 `console-nav.test.ts` 的 8 组顺序 / 归属 / 无影子 segment / 三语标签唯一性全过（含 `expectedOwnership.publishing` 与 `routesBeforeRegrouping` 的**有意更新**，各 1 行） |

### U.6 未做的事与遗留（区分阻塞与可延后）

- **未做（可延后）**：① **批量导入**（作者功能表里的「支持现有数据结构的导入方式」）—— 只做了手动录入 + API，仓库无导入先例；② **真实 dev server HTTP 冒烟**与**打包版 Electron 验证** —— 本轮未起任何服务、未停/未重启作者在跑的 dev server（路由测试是**真实路由处理器 + 真实 SQLite 临时库**，但**不是** HTTP 层）；③ 直接按「内容」关联（不经过发布记录）—— API 支持 `contentItemId`，界面只提供发布记录下拉（原因：`/api/content` 的 `pageSize` 上限 20，没有可用的内容全量列表端点，做搜索式选择器属另一张卡）。
- **阻塞**：无。
- **界面状态未做 DOM 测试（如实登记）**：页面的加载 / 成功 / 失败 / 空态与「成交但未记录金额」提示都由组件实现（代码可见），但**没有 DOM 级用例** —— 本仓 vitest 无 DOM 环境（无 jsdom / happy-dom / @testing-library），与 `CI-P2-07` 的既定做法一致（当时也**未**新增依赖）；界面分支的可测部分被抽到 `src/lib/leads.ts` 的纯函数里（金额解析、成交裁决、汇总），已由 15 条纯逻辑用例覆盖。
- **口径提醒**：`dealAmountMinorScale = 100` 对所有币种一律两位小数（JPY / KRW 会被显示成 `.00`）——已如实写进代码注释与本附录，**不是**对真实币种规则的实现。
- **下一步编号建议**：① 若要补「批量导入」或「按内容直接关联」，各自一张新卡（不占用本卡号）；② 业务链路上与本卡相邻的**仍是未开发**的清单卡 **`P2-06 创作者资料与内容分群`**（§1 表内**无**对应 `CI-` 号），以及 `CI-P5-01…03` 的业务闭环验证（`in_progress`）。

### U.7 Git 边界、文件清单与行号影响

- **Git 边界**：本轮**未**执行 `git add` / `commit` / `push` / `stash` / `reset` / `clean`；工作区里既有的未提交改动（开工时 `git --no-pager status --porcelain` 共 **197** 项）**未被触碰、未被回滚、未被清理**。
- **新增 9 个文件**：`src/lib/leads.ts`(287)、`src/lib/leads.test.ts`、`src/app/api/leads/route.ts`(106)、`src/app/api/leads/route.test.ts`、`src/app/api/leads/[id]/route.ts`(96)、`src/app/api/leads/[id]/route.test.ts`、`src/db/repositories/leads.ts`(139)、`src/components/marketing-leads-workspace.tsx`(600)、`src/app/[locale]/(console)/publishing/leads/page.tsx`(4)。
- **修改 12 个文件**：`src/db/schema.ts`、`src/db/client.ts`、`src/lib/types.ts`、`src/lib/validation.ts`、`src/lib/app-errors.ts`、`src/lib/console-nav.ts`、`src/lib/console-nav.test.ts`、`src/locales/en.json`、`src/locales/zh-cn.json`、`src/locales/zh-hk.json`、本文件、`docs/development/capability-integration-numbering-map.md`。
- **行号影响（登记事实，不代改其它文档）**：本卡在 §1 **新增一行**（第 71 行）并在文末**追加本附录**，因此 71 行之后的既有引用整体下移 **1** 行：

| 引用对象 | 本卡前实测 | 本卡后实测 |
| --- | --- | --- |
| 本文件总行数 | 3113 | **3242**（§1 +1 行、本附录 +128 行） |
| §1 的 `CI-LEAD-01` 行 | — | **71** |
| `## 附录 B-5` 标题行 | 1002 | **1003** |
| `## 附录 B-9` 标题行 | 1304 | **1305** |
| `## 附录 B-10` 标题行 | 1424 | **1425** |
| B-10 的「152 文件 / 1247 用例」行 | 1447 | **1448** |
| `## 附录 U` 标题行 | — | **3116** |

> 前一张卡（`CI-P1-04-07`）已在编号对照 §23.5 登记：三处既有引用写作「主线 §附录 B-10 第 **1385** 行」时**早已漂移**。本卡使 B-10 标题再 +1（1424 → 1425），**仍不代改**那三处，只在此登记事实。





