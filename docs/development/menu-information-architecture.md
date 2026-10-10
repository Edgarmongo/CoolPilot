# CoolPilot 菜单信息架构（CI-IA-01 结构 + CI-IA-02 商业排序 + CI-IA-03 归属修正，2026-10-10）

> **这三张卡做什么**：CI-IA-01 在**不改路由、不改权限、不改业务逻辑与数据**的前提下，把左侧导航按「用户来这里完成什么业务」重新分组、统一命名；CI-IA-02 在此之上重新确定 8 组的**商业职责、排序与命名**（内容创作提前、品牌与资产独立、自动化与数据/成本分离、扩展市场保留独立位置但不造页），并给移动端 5 个页签补上**独立短标签**；CI-IA-03 在此之上只做**一处归属修正 + 一处改名**（作者直派：`/creation/posts` 由「发布与渠道」移入「内容创作」，显示名「动态发布」→「动态创作」；「影片发布」按作者要求**不动**）。三张卡都**没有**改路由、权限、接口、数据模型与页面。
> **实现真相在代码里**：菜单树的唯一事实来源是 `src/lib/console-nav.ts`（`consoleNavItems`），不变式由 `src/lib/console-nav.test.ts` 固定（8 组 / 顺序 / 30 条路由 / 页面落盘 / 三语 key / 移动短标签 / 高亮规则）。
> **本文件的角色**：记录**商业职责与排序依据**、**每个页面的职责/输入/输出/边界证据**、**旧→新逐项映射**、**与作者建议稿不一致之处及原因**、**验证与实际结果**、**遗留争议**、**菜单治理规则**。菜单是产品契约，不是代码目录或数据库表的映射。

## 1. 依据与原则

| 来源 | 用途 |
| --- | --- |
| 产品长期方向（Local-first、数据主权、Community 免费基础能力、Pro/Creator/Business 分层、Agent/Workflow Marketplace） | 一级分组的划分依据：能力分层要让「创作 → 自动化 → 扩展」这条主线看得出来 |
| 作者 2026-10-10 的菜单建议稿（8 组目标架构 + 逐项归位建议 + 三个「不要」） | 目标结构与命名 |
| 作者 2026-10-10 的第三轮直派（CI-IA-03：「动态发布 → 动态创作」并移入内容创作；「影片发布」保留在发布与渠道） | 本轮唯一的结构性改动与命名裁定 |
| `docs/menu-inventory.md`（2026-10-09 只读盘点） | 每个页面**实际**职责的证据（`file:line` 可回查） |
| 当前代码 | 最终裁决：以真实职责为准，不以菜单名称为准 |

四条自我约束（本卡执行时逐条遵守）：

1. **菜单只表达业务目标**，不表达「开发者把它放在哪个模块」。
2. **不新增空菜单/占位页**：Agent 市场、Workflow 市场、模板市场现阶段**没有真实页面**，因此**不展示**。
3. **不合并不同业务对象**：发布记录（写入 `publish_records` 的发布结果）与执行历史（`/api/runs` 的执行事件）是两件事，保持两个入口。
4. **不造付费门槛**：本地工作区、数据备份、密钥安全等 Community 基础能力维持可见、不藏进设置深处；本次不新增任何收费/订阅/团队菜单。

## 2. 落地后的信息架构（8 组 / 30 个叶子，CI-IA-02 商业排序 + CI-IA-03 归属修正）

```
1 工作台        navWorkbench    仪表板 · AI 对话
2 内容创作       navCreation     AI 写作 · 选题管理 · 文章创作 · 配图创作 · 智能画布（白板 / 思维导图）· 动态创作
3 品牌与资产     navDataAssets   内容中心 · 研究素材 · 品牌资料 · 帐号定位 · 知识库 · 产品管理
4 发布与渠道     navPublishing   帐号管理 · 影片发布 · 发布记录 · 发布排程 · 内容日历
5 自动化        navAutomation   运行队列 · 执行历史 · 执行节点
6 数据与成本     navOperations   数据中心 · 生成记录 · AI 成本中心
7 扩展市场       navAppMarket    应用商店
8 系统设置       navSystem       模型管理 · 通用设置 · 工作区
```

| # | 分组 | 商业职责（用户来这里完成什么） | 叶子数 |
| --- | --- | --- | --- |
| 1 | 工作台 `navWorkbench` | 进入今天的工作：任务入口、最近工作概览与**通用 AI 对话**。对话是通用交互入口，不属于内容创作，也不默认等同于自主 Agent 执行 | 2 |
| 2 | 内容创作 `navCreation` | 把需求变成可交付的内容成果（选题 → 写作 → 配图 / 画布 / 图文动态）。这是 CoolPilot 的主要购买理由，因此**排在第 2 位**；CI-IA-03 把「动态创作」并入本组 | 7 |
| 3 | 品牌与资产 `navDataAssets` | 沉淀可复用的生产基础资料（品牌、知识、定位、产品、研究素材、内容资产），形成迁移成本与长期价值 | 6 |
| 4 | 发布与渠道 `navPublishing` | 把内容送达目标渠道：帐号、影片发布、发布结果、排程与日历（CI-IA-03 后不再含「动态创作」） | 5 |
| 5 | 自动化 `navAutomation` | 管理可重复任务的执行与运行过程（队列、执行历史、执行节点），为未来 Agent / Workflow 打基础。**只放执行，不放观察** | 3 |
| 6 | 数据与成本 `navOperations` | 观察业务怎么跑：经营数据、生成活动、AI 资源消耗。**归入本组不等于已具备经营分析、利润分析或成本归因能力**——能力以页面实现为准 | 3 |
| 7 | 扩展市场 `navAppMarket` | 承载今天真实存在的应用商店，并为 Agent / Workflow / 创作者资源的 Marketplace 长期方向保留清晰边界。**没有实现的页面不提前建** | 1 |
| 8 | 系统设置 `navSystem` | 配置本机平台能力：模型、应用偏好、工作区；不承载日常生产任务（模型管理留在系统是刻意的） | 3 |

**CI-IA-02 的四条排序原则**（相对 CI-IA-01 的顺序变化）：

1. **内容创作提前**（原第 3 → 第 2）：直接突出用户购买/使用 CoolPilot 的主要理由。
2. **品牌与资产独立并紧随创作**（原第 2 → 第 3，改名）：明确哪些资料是生产内容时反复使用的基础资料。
3. **自动化与数据/成本分离**（运营管理 → 数据与成本，并移到自动化之后）：一个负责**执行任务**，一个负责**观察结果与成本**；两组不互相包含。
4. **扩展市场保留独立位置但不提前造页**（应用与市场 → 扩展市场，移到系统设置之前）：不因为战略方向就添加没有实现能力的菜单；**系统设置收敛到底部**。

### 2.1 桌面端与移动端导航规则

| 端 | 规则 | 实现位置 |
| --- | --- | --- |
| 桌面侧边栏（`md` 以上） | 按 §2 上表顺序渲染 8 个一级分组，**全部是分组**（无顶层单页残留）；组头可点开/收起；组内叶子按上表顺序排列；当前页所属组自动展开、当前叶子高亮 | `src/lib/console-nav.ts` 的 `consoleNavItems` → `console-layout-shell.tsx` 的 `renderNavEntry` |
| 桌面组头落点 | 点组名跳「组首叶子」（`consoleNavLeafHref`） | 同上 |
| 移动底部栏（`md` 以下） | **5 个页签**，顺序与桌面分组一致：工作台 · 创作 · 资产 · 发布 · 设置；每页签落到该组组首叶子；标签取自各分组**独立的** `mobileLabelKey`（短标签），**不截断**桌面标签 | `consoleMobileNavIds` + `mobileLabelKey` → `labelConsoleNav` 解析为 `mobileName` |
| 移动端未进页签的组 | 自动化、数据与成本、扩展市场这 3 组仍可从桌面侧边栏或直达 URL 进入（与移动端只有 5 个位置的历史一致）；**不为对齐桌面再加第 6 个底部入口** | `console-nav.test.ts` 断言「非页签分组不得声明 `mobileLabelKey`」 |
| 折叠状态 | 侧边栏折叠、分组折叠状态按 `id` 记忆；路由变化只自动展开当前组 | `console-layout-shell.tsx`（未改动） |


## 3. 最终菜单与页面职责（职责 / 输入 / 输出 / 边界；证据来自实际代码）

按 §2 的分组顺序排列：**8 组 / 30 个可点击叶子 + 1 个嵌套分组头**（智能画布，自身没有页面，路由栏注明指向组首子项）。`输入 → 输出` 与 `边界（不做什么）` 两列是 CI-IA-02 增补的**职责契约**：新页面该放哪一组、某个能力是否重复，以此为准；最后一列是可回查的真实行为证据（`docs/menu-inventory.md` 与页面源码）。

| 组 | 菜单 | 路由 | i18n key | 输入 → 输出 | 边界（不做什么） | 真实职责（证据） |
| --- | --- | --- | --- | --- | --- | --- |
| 工作台 | 仪表板 | `/dashboard` | `navDashboard` | 本机运行数据 → 概览与最近执行 | 不在这里编辑或发布；只读概览 + 跳转 | 四张概览卡（网站/内容项目/进行中执行/启用中排程）+ 最近执行 |
| 工作台 | AI 对话 | `/chatroom` | `agentChatShortTitle` | 用户对话 + `@` 指定目标网站 → 会话与工具调用 | 不是无人值守的自主 Agent 执行入口，也不是内容创作页；显示名用「AI 对话」是因为它是通用交互入口 | 通用 Agent 对话（`@` 指定目标网站，讯息与工具调用存本机 SQLite），唯一全宽布局页。**注意**：页面自身标题仍为 `agentChatTitle`（Agent 聊天室），本卡未改页面文案（见 §9 遗留 8） |
| 内容创作 | AI 写作 | `/creation/ai-writing` | `navAiWriting` | 选题/素材/品牌/知识 + 写作配置 → 文章（可存内容库或进编辑器） | 不发布、不写 `publish_records`；与「文章创作」的边界见 §5 决策 9 与 §9 遗留 4 | 三步产出文章（选素材 → 写作配置 → 生成），可存内容库或进编辑器 |
| 内容创作 | 选题管理 | `/creation/topics` | `navTopics` | 热点/手工录入 → 待创作选题 | 不直接产出成品文章（发布交给发布与渠道） | 选题库增删改查、筛选、归档恢复、从热点导入；可带 `?topicId=` 进创作 |
| 内容创作 | 文章创作 | `/creation/articles` | `navArticleCreation` | 已有文章/站内生成 → 改稿、排版、翻译后的文章版本 | 不发布、不写发布记录（发布动作在发布与渠道） | 文章列表 + 全文编辑器（改稿/排版/翻译/发布入口）与 AI 生成文章 |
| 内容创作 | 配图创作 | `/creation/images` | `navImageManagement` | 提示词 → 生成图片与图库条目 | 不是素材资产管理（资产在品牌与资产组）；不发布 | AI 生图（提示词驱动）+ 图库搜寻、分页与批量删除 |
| 内容创作 | 智能画布 | `/whiteboard` | `navDrawing` | — | 嵌套分组头，自身没有页面（组首子项即白板） | 嵌套分组（组首子项即白板） |
| 内容创作 | └ 白板 | `/whiteboard` | `navWhiteboard` | 手绘/图形 → 画布内容 | 非结构化创作工具，不写业务数据 | 自由绘制白板（客户端动态载入 `ssr:false`） |
| 内容创作 | └ 思维导图 | `/mindmap` | `navMindMap` | 节点/连线 → 导图 | 同上 | 思维导图编辑画布 |
| 内容创作 | 动态创作 | `/creation/posts` | `navDynamicPublishing` | 文案 + 配图库挑图 + 多帐号 → 图文动态（终态写 `publish_records`） | 由作者 2026-10-10 直派从发布与渠道移入本组并改名（对 IA-01 决策 2 的**唯一例外**）；「影片发布」不同，仍留在发布与渠道 | 图文动态撰写：文案 + 配图库挑图，勾选多平台帐号一次发布 |
| 品牌与资产 | 内容中心 | `/content/library` | `navContentCenter` | 手工建立／AI 生成／撷取网址 → 可复用素材条目 | 不在这里做发布，也不是生成入口；它是资产的**存放与检索**面 | 素材库：手动建立／AI 生成／撷取网址，搜寻、来源与日期筛选、格状/列表、详情与草稿/已就绪状态 |
| 品牌与资产 | 研究素材 | `/creation/research` | `navResearch` | 本地文件／来源连结／音视频 → 可引用的研究素材与提炼结论 | 不是创作工具：只提供素材与转录/提炼，产出文章在内容创作 | 研究素材库 + 导入本地文件 + 读取来源；含音视频转录面板与「研究提炼」对话框 |
| 品牌与资产 | 品牌资料 | `/creation/brands` | `navBrands` | 品牌语气/受众/关键词/禁用表达 → 可复用的品牌档案 | 与「系统设定 → 品牌」（logo/配色/Agent 提示词的单例）是两件事，二者**不合并**（CI-P2-02） | 品牌库增删改查（语气/受众/关键词/禁用表达），AI 写作向导的生成输入 |
| 品牌与资产 | 帐号定位 | `/smart-config/positioning` | `navAccountPositioning` | 定位问题 → 7 页签定位档案（可发布到商店） | 不是「智能配置」这类系统配置；原「智能配置」空容器已删除（IA-01 决策 4） | 定位档案 7 页签（基础定位/人设/写作管控/内容策略/平台定制/RSS/绑定帐号），可发布到商店 |
| 品牌与资产 | 知识库 | `/smart-config/knowledge-base` | `navKnowledgeBase` | 条目/文件/产品 → 可检索的本地知识（含外部 Dify） | 不是模型或供应商配置（在系统设置） | 本地知识库（条目/智能入库/上传/产品导入）+ 外部知识库·Dify |
| 品牌与资产 | 产品管理 | `/creation/products` | `navProductManagement` | 产品信息 → 供知识库与配图取材的产品资料 | **不是**软件商品管理、订阅商品或 Marketplace 商品管理（作者已明确） | 产品资料库（名称/品牌/分类/关键词/图片/连结），供知识库与配图取材 |
| 发布与渠道 | 帐号管理 | `/publishing/accounts` | `navAccountManagement` | 平台凭据/登入 → 可发布帐号与预设 | 不做内容生产；帐号仅作为发布目标 | 平台帐号增删改查/登入、状态、分组、保湿度、批量同步、帐号预设与 CMS 站点 |
| 发布与渠道 | 影片发布 | `/creation/videos` | `navVideoPublishing` | 影片档案 + 标题/描述/可见性 + 多帐号 → 发布到平台 | 不是剪辑/视频创作工具（无剪辑页）；显示名保留「影片发布」以与页面内 51 处「影片」用词一致（见 §5 决策 13） | 上传影片 + 标题/描述/可见性，三步骤后多帐号发布 |
| 发布与渠道 | 发布记录 | `/publishing/records` | `navPublishRecords` | 发布动作的结果 → 可审计的发布记录 | 与「执行历史」是**两个业务对象**，不合并（原则 3） | 发布结果审计：统计、按平台/状态/类型/方式/终端/日期筛选、汇出、详情、批量删除 |
| 发布与渠道 | 发布排程 | `/schedules/list` | `navSchedules` | 时间规则 + 帐号 + 内容 → 定时发布计划 | 不是通用工作流调度器（只调度发布） | 排程列表（启用/暂停、下次执行、单次/每日/每周/每月/固定间隔）+ 建立排程 |
| 发布与渠道 | 内容日历 | `/schedules/calendar` | `navContentCalendar` | 计划/执行/发布三类记录 → 月历视图 | 只读节奏视图，不是排程编辑器 | 月历整合「计划／执行／发布」三类纪录，含当日计划、即将执行与 KPI |
| 自动化 | 运行队列 | `/runs/queue` | `navRuns` | 帐号/剧本/参数 → 待执行或模拟执行 | 不观察历史（历史在执行历史）；不在这里做业务发布确认以外的事 | 执行伫列：选帐号/剧本/参数 JSON 加入伫列（可仅模拟），正式发布须前端确认 |
| 自动化 | 执行历史 | `/automation/logs` | `navOperationLogs` | 最近执行的真人与系统动作 → 事件日志 | 不是跨业务的运营日志；与「发布记录」是不同业务对象 | 最近执行项目与其事件日志（2–3 秒刷新）；空态可跳到运行队列 |
| 自动化 | 执行节点 | `/automation/nodes` | `navExecutionNodes` | 终端配置 → 可选执行终端清单 | 不执行业务任务本身（执行入口在运行队列） | 执行终端可用性清单：Web 工作台（可用）、Windows 桌面端与 Linux 自托管节点（未配置） |
| 数据与成本 | 数据中心 | `/data-center` | `navDataCenter` | 平台回流指标 → KPI/趋势/排行报表 | 不做编辑与生产；**归组不等于已有利润/成本归因能力** | 全局数据总览：KPI、平台概览、内容排行、增长趋势、AI 覆盘、指标编辑与同步/CSV 汇出 |
| 数据与成本 | 生成记录 | `/automation/generations` | `navGenerationRecords` | AI 生成动作 → 只读生成记录列表 | 只观察，不重跑、不编辑；它究竟是「内容资产历史」还是「执行审计记录」尚待定（§9 遗留 4/新 3） | 已生成内容的记录列表（每 5 秒刷新、分页） |
| 数据与成本 | AI 成本中心 | `/system/cost-center` | `navAiCostCenter` | 账本用量 + 价格目录 → 成本总览/明细/预算预估/质量 | **不是计费系统**：金额只显示账本记录（`provider-reported`/`computed`/`unpriced`/`unknown` 区分），缺价格或缺用量时不得伪装成 0，也不做跨币种相加 | 4 页签：成本总览（CI-P7-02 已落地）、调用明细、预算与预估（**CI-P7-03**）、质量与优化（CI-P7-04） |
| 扩展市场 | 应用商店 | `/app-store` | `navAppStore` | 已发布写作智能体 → 可浏览/安装/我发布的商店条目 | **本轮不创建** Agent 市场、工作流市场、付费模板市场、创作者中心或交易页（无实现即不建菜单） | 写作智能体商店：浏览／我发布的、分类与搜寻排序；条目由「帐号定位 → 发布到商店」提交 |
| 系统设置 | 模型管理 | `/system/models` | `navModelManagement` | 供应商密钥 + 模型注册 + 价格目录 → 可调用的模型配置 | 不是日常生产入口；不重复创建聊天模型选择器（对话页自己选模型） | 5 页签：可用模型 / 模型注册表 / 供应商与密钥 / 模型配置 / **价格目录**（CI-P7-01） |
| 系统设置 | 通用设置 | `/settings` | `navSettings` | 应用偏好 → 本机运行环境与界面行为 | 原名「系统设定」与组名重复故改名；页签内不重复已有功能入口 | 6 页签：执行环境 / 权限 / 语言 / 品牌 / 提示词 / 备份 |
| 系统设置 | 工作区 | `/system/workspace` | `navWorkspace` | 本机工作区状态 → 只读报告 | 只读，不可在这里改配置 | 只读工作区报告（位置、内容、留意项、读取时间），只有「重新整理」 |


## 4. 旧 → 新逐项映射（覆盖原侧边栏全部 30 个叶子，无入口消失）

原结构：**9 个顶层项**（4 个单页：仪表板 / 聊天 / 数据中心 / 应用商店；5 个分组：创作 / 智能配置 / 自动化 / 发布 / 系统）→ CI-IA-01 后的 **8 个分组**，CI-IA-02 再调整**组序与显示名**（见 §4.1），CI-IA-03 再调整**一条叶子的归属与显示名**（`/creation/posts`：发布与渠道 → 内容创作，动态发布 → 动态创作；见 §5.1 #22）。下表共 **31 行** = **30 个可点击叶子** + 「智能画布」这个嵌套分组头（它自己没有页面，路由栏注明指向组首子项）；「原分组」按改动前的实际渲染层级填写；`路由` 一栏全部**未改动**（CI-IA-01、CI-IA-02 与 CI-IA-03 都没有改任何 `href`，CI-IA-03 只换了 `posts` 的归属与显示名）。

| 原分组 | 原菜单名 | 路由 | 新分组 | 新显示名 | 改路由 | 归位理由（含证据） |
| --- | --- | --- | --- | --- | --- | --- |
| （顶层单页）仪表板 | 仪表板 | `/dashboard` | 工作台 | 仪表板 | 否 | 每天开始工作的入口，与「聊天」同属日常操作面 |
| （顶层单页）聊天 | 聊天 | `/chatroom` | 工作台 | **AI 对话** | 否 | 通用 Agent 对话（不限创作），保留为一级快捷入口，不塞进创作；CI-IA-02 把显示名的「聊天」改为「AI 对话」，强调它是通用交互入口而非自主 Agent 执行（key `agentChatShortTitle` 不变，3 语同步） |
| （顶层单页）数据中心 | 数据中心 | `/data-center` | 数据与成本 | 数据中心 | 否 | 它是跨业务的绩效与趋势看板（KPI/排行/趋势/AI 覆盘），不是可复用素材；CI-IA-02 把该组改名为「数据与成本」并把「生成记录」并入（都属「观察业务怎么跑」） |
| 创作 | AI写作 | `/creation/ai-writing` | 内容创作 | **AI 写作** | 否 | 创作流程入口，保持组内第一个子项（CI-IA-02 后该组升为第 2 组，移动端「创作」页签落点仍是这里）；CI-IA-02 仅在显示值里补了空格（`navAiWriting` 不变，3 语同步） |
| 创作 | 选题管理 | `/creation/topics` | 内容创作 | 选题管理 | 否 | 内容生产的第一步 |
| 创作 | 文章创作 | `/creation/articles` | 内容创作 | 文章创作 | 否 | 完整文章生产流程，与 AI 写作是两条不同工作流（见 §5 决策 9），两个入口都保留 |
| 创作 | 配图管理 | `/creation/images` | 内容创作 | **配图创作** | 否 | 页面本身就是 AI 生图工作台（提示词驱动 + 图库），是创作工具；名称随之改为「配图创作」以免与「资产」混淆 |
| 创作 | 智能画布（嵌套分组） | —（组首 `/whiteboard`） | 内容创作 | 智能画布 | 否 | 创意与内容生产工具，保持嵌套分组 |
| 创作 └ 智能画布 | 白板 | `/whiteboard` | 内容创作 | 白板 | 否 | 画布类创作工具 |
| 创作 └ 智能画布 | 思维导图 | `/mindmap` | 内容创作 | 思维导图 | 否 | 同上 |
| 创作 | 研究素材 | `/creation/research` | **品牌与资产** | 研究素材 | 否 | 可复用素材（含转录与提炼），是生成输入，不是创作动作本身 |
| 创作 | 品牌资料 | `/creation/brands` | **品牌与资产** | 品牌资料 | 否 | 品牌库是生成输入而非创作产出 |
| 创作 | 产品管理 | `/creation/products` | **品牌与资产** | 产品管理 | 否 | 产品资料供知识库与配图取材，属素材（路由仍在 `/creation/*`，未动）；**不是**软件商品/Marketplace 商品管理 |
| 创作 | 动态发布 | `/creation/posts` | 内容创作（CI-IA-03） | **动态创作** | 否 | 作者 2026-10-10 直派：改名并移入内容创作（对 IA-01 决策 2 的**唯一例外**）；页面撰写图文动态（文案 + 配图），路由本就属 `/creation/*`。「影片发布」不随动，仍留在发布与渠道 |
| 创作 | 影片发布 | `/creation/videos` | **发布与渠道** | 影片发布 | 否 | 同上 |
| 创作 | 内容中心 | `/content/library` | **品牌与资产** | 内容中心 | 否 | 内容资产的统一入口 |
| 智能配置 | 帐号定位 | `/smart-config/positioning` | **品牌与资产** | 帐号定位 | 否 | 定位档案是生成输入的可复用业务资料；原「智能配置」容器本身**没有页面**（`href` 只指向子项），保留它会与「系统设置」争同一层语义（见 §5 决策 4） |
| 智能配置 | 知识库 | `/smart-config/knowledge-base` | **品牌与资产** | 知识库 | 否 | 管理可复用知识，而非系统级模型配置 |
| 自动化 | 排程 | `/schedules/list` | **发布与渠道** | **发布排程** | 否 | 排程带帐号与内容项（发布计划），不是通用工作流调度器；名称改为「发布排程」以表达边界 |
| 自动化 | 内容日历 | `/schedules/calendar` | **发布与渠道** | 内容日历 | 否 | 月历整合「计划／执行／发布」，主体是发布节奏 |
| 自动化 | 产生记录 | `/automation/generations` | **数据与成本** | **生成记录** | 否 | 页面是「已生成内容的记录列表」（只读观察），属「观察业务怎么跑」；CI-IA-02 把显示名从「产生记录」改为**生成记录**（与页面内「生成」用词一致；key `navGenerationRecords` 不变，3 语同步） |
| 自动化 | 营运日志 | `/automation/logs` | 自动化 | **执行历史** | 否 | 页面读 `/api/runs` 与最近执行的事件，是执行历史；**i18n key 未改**（`navOperationLogs`），只改显示名，避免三语 key 与历史记录脱节 |
| 自动化 | 执行节点 | `/automation/nodes` | 自动化 | 执行节点 | 否 | 执行终端可用性，属运行/调试面 |
| 自动化 | 执行 | `/runs/queue` | 自动化 | **运行队列** | 否 | 组内第一个子项，落点保持原样；名称说明它是伫列而非「某一次执行」 |
| （顶层单页）应用商店 | 应用商店 | `/app-store` | **扩展市场** | 应用商店 | 否 | 商店条目由「帐号定位 → 发布到商店」提交，属**扩展/市场**面；单列一组为长期 Agent/Workflow Marketplace 留位（当前只有这一个真实页面，不造占位项） |
| 发布 | 帐号管理 | `/publishing/accounts` | 发布与渠道 | 帐号管理 | 否 | 渠道账号配置与发布结果同域 |
| 发布 | 发布记录 | `/publishing/records` | 发布与渠道 | 发布记录 | 否 | 发布结果审计，与被发布的「动态/影片发布」相邻 |
| 系统 | 模型管理 | `/system/models` | 系统设置 | 模型管理 | 否 | 本机模型/供应商/价格目录配置 |
| 系统 | AI 成本与质量优化中心 | `/system/cost-center` | **数据与成本** | **AI 成本中心** | 否 | 成本、调用质量、预算属运营观察面，不是系统配置；名称按作者要求改短（三语同步） |
| 系统 | 系统设定 | `/settings` | 系统设置 | **通用设置** | 否 | 页面内容为应用偏好（执行环境/权限/语言/品牌/提示词/备份）；原名与组名「系统设置」重复，改名以便两者可区分（见 §5 决策 8） |
| 系统 | 工作区 | `/system/workspace` | 系统设置 | 工作区 | 否 | 本机工作区只读报告，属基础设施；仍保持组内最后一项，避免改变移动端页签落点 |

**分组级变化一览**

| 原顶层项 | 类型（改动前） | 叶子数 | 新归属 |
| --- | --- | --- | --- |
| 仪表板 | 单页 | 1 | 工作台（组首） |
| 聊天 | 单页 | 1 | 工作台 |
| 数据中心 | 单页 | 1 | 数据与成本 |
| 应用商店 | 单页 | 1 | **扩展市场**（独占一组） |
| 创作 | 分组 | 12 | 拆分 → 内容创作 6 / 品牌与资产 4 / 发布与渠道 2 |
| 智能配置 | 分组（**空容器**，无自己的页面） | 2 | 品牌与资产 2；容器本身删除 |
| 自动化 | 分组 | 6 | 发布与渠道 2 / 数据与成本 1 / 自动化 3 |
| 发布 | 分组 | 2 | 发布与渠道 2 |
| 系统 | 分组 | 4 | 系统设置 3 / 数据与成本 1 |

- **聚合校验**：1+1+1+1+12+2+6+2+4 = **30** 个叶子，与新增 8 组的叶子数 2+6+6+6+3+3+1+3 = **30** 一一对应（无入口增加、无入口消失）。
- **分组名改动 3 个**（key 名不变，只改值）：`navCreation` 创作 → 内容创作；`navPublishing` 发布 → 发布与渠道；`navSystem` 系统 → 系统设置。
- **新增分组 key 4 个**：`navWorkbench` 工作台、`navDataAssets`、`navAppMarket`、`navOperations`（3 语同步；后三者的**值**在 CI-IA-02 又各改了一次，见 §4.1）。
- **删除空容器 1 个**：「智能配置」原本只有 `href`、没有自己的页面，其 2 个子项并入资产组；其标签 key `navSmartConfig` 因此不再被引用（见 §9 遗留 3）。
- **叶子改名 6 个**（上表 `**…**` 标记）：配图创作 / 发布排程 / 执行历史 / 运行队列 / AI 成本中心 / 通用设置；连同上一条的 3 个分组名，CI-IA-01 共改 **9 个显示值，未改任何 key 名**。

### 4.1 CI-IA-02 的变化（只动组序与显示名）

**组序调整**（`consoleNavItems` 的数组顺序即渲染顺序，`console-nav.test.ts` 逐项断言）：

| CI-IA-02 位置 | 分组（key） | CI-IA-01 位置 | 动作 |
| --- | --- | --- | --- |
| 1 | 工作台 `navWorkbench` | 1 | 不变 |
| 2 | 内容创作 `navCreation` | 3 | **提前**（创作前置） |
| 3 | 品牌与资产 `navDataAssets` | 2 | 后移一位 + **改名**（原「数据与资产」） |
| 4 | 发布与渠道 `navPublishing` | 4 | 不变 |
| 5 | 自动化 `navAutomation` | 5 | 不变 |
| 6 | 数据与成本 `navOperations` | 7 | 上移 + **改名**（原「运营管理」） |
| 7 | 扩展市场 `navAppMarket` | 6 | 下移 + **改名**（原「应用与市场」） |
| 8 | 系统设置 `navSystem` | 8 | 不变（仍在底部） |

**显示值改动 6 个（key 全部不变，3 语同步）**：

| key | zh-cn（旧 → 新） | zh-hk（旧 → 新） | en（旧 → 新） |
| --- | --- | --- | --- |
| `navDataAssets` | 数据与资产 → **品牌与资产** | 數據與資產 → **品牌與資產** | Data & Assets → **Brand & Assets** |
| `navOperations` | 运营管理 → **数据与成本** | 營運管理 → **數據與成本** | Operations → **Data & Costs** |
| `navAppMarket` | 应用与市场 → **扩展市场** | 應用與市場 → **擴展市場** | Apps & Market → **Extensions** |
| `navGenerationRecords` | 产生记录 → **生成记录** | 產生記錄 → **生成記錄** | Generation Logs（不变） |
| `agentChatShortTitle` | 聊天 → **AI 对话** | 聊天 → **AI 對話** | Chat → **AI Chat** |
| `navAiWriting` | AI写作 → **AI 写作** | AI寫作 → **AI 寫作** | AI Writing（不变） |

**移动端短标签：新增 5 个 key**（CI-IA-01 遗留 1 的落地；每个分组一个独立字段 `mobileLabelKey`，**不截断**桌面标签）：

| key | zh-cn | zh-hk | en | 对应分组（桌面标签） |
| --- | --- | --- | --- | --- |
| `navMobileWorkbench` | 工作台 | 工作台 | Workbench | 工作台（Workbench） |
| `navMobileCreation` | 创作 | 創作 | Create | 内容创作（Content Creation） |
| `navMobileAssets` | 资产 | 資產 | Assets | 品牌与资产（Brand & Assets） |
| `navMobilePublishing` | 发布 | 發佈 | Publish | 发布与渠道（Publishing & Channels） |
| `navMobileSystem` | 设置 | 設定 | Settings | 系统设置（System Settings） |

**CI-IA-03 改名（1 处，key 不变）**：

| key | zh-cn | zh-hk | en | 动作 |
| --- | --- | --- | --- | --- |
| `navDynamicPublishing` | 动态发布 → **动态创作** | 動態發佈 → **動態創作** | Posts → **Post Creation** | 改名并随归属移动（CI-IA-03）；key 名不变、3 语同步；en 沿用「X 创作 = X Creation」的既有对照（配图创作 = Image Creation） |

**未改的显示名（刻意保留，附证据）**：

| 目标稿用词 | 实际保留 | 证据 |
| --- | --- | --- |
| 视频发布 | **影片发布** | `/creation/videos` 页面与相关文案共 **51 处**使用「影片」（影片库/影片标题/影片描述…），只有 14 处通用媒体用语用「视频」；菜单改「视频发布」会与它打开的页面用词不一致（作者亦说明「以现有真实页面及三语翻译为准」） |
| 账号定位 / 账号管理 | **帐号定位 / 帐号管理** | `zh-cn` 词库里「帐号」76 处、「账号」5 处；改这 2 处会与其余 76 处不一致。`zh-hk` 用「帳號」 |
| 智能画布 + 思维导图（目标稿把它们平铺为两条叶子） | 保留**嵌套分组**「智能画布（白板 / 思维导图）」 | 目标稿的平铺写法会**丢掉 `/whiteboard` 白板**这条叶子（智能画布本身没有页面，它的 `href` 就是 `/whiteboard`），与同一张卡的验收标准 2「30 条叶子路由全部保留」冲突；按「以现有真实页面为准」保留嵌套结构 |


## 5. 关键判断与与作者建议稿的差异（逐条给理由，不机械照搬）

| # | 判断 / 差异 | 依据（实际代码） | 结果 |
| --- | --- | --- | --- |
| 1 | 建议稿把「聊天」标为「工作台或独立入口」 | 页面是通用 Agent 对话（`@` 指定目标网站），与创作无关 | 归入**工作台**（不去创作，也不新增第 9 组） |
| 2 | 「动态发布」「影片发布」在建议稿的归位表里属「发布与渠道」，但在目标架构 §3「内容创作」里又出现「视频创作」 | `/creation/posts` 是「文案 + 选图 + 多帐号发布」，`/creation/videos` 是三步骤发布组装，两者都以 `publish_records` 为终点；**没有**独立的「视频创作/剪辑」页面 | 归入**发布与渠道**；不新增「视频创作」菜单（无页面）。**（CI-IA-01 时的判断，已由 CI-IA-03 按作者 2026-10-10 直派局部推翻：`/creation/posts`「动态发布 → 动态创作」移入内容创作；`/creation/videos` 仍留在发布与渠道 —— 见 §5.2 #22）** |
| 3 | 建议稿要求「配图管理」按真实职责判断 | `/creation/images` = AI 生图（提示词驱动）+ 图库管理，是创作工具 | 归入**内容创作**，并把显示名改为「配图创作」（`navImageManagement` 的 key 不变，值在 3 个语系同步） |
| 4 | 建议稿把「帐号定位」标为「智能配置 / 系统设置」，把「知识库」标为数据与资产 | 「智能配置」是**空容器**（`navItems` 里它只有 `href`，没有自己的页面）；定位档案 7 页签是写作/发布策略输入，知识库供生成取材 | 两者都归入**数据与资产**；**删除**空容器分组（不是删除功能） |
| 5 | 建议稿：「如果排程是通用工作流调度器，则应留在自动化」 | 排程记录带帐号与内容项（发布计划），日历页整合「计划／执行／发布」 | 归入**发布与渠道**并改名为「发布排程」；自动化里不保留重复入口 |
| 6 | 建议稿把「营运日志」标为「运营管理（只在它是跨业务运营日志时迁移）」 | 该页读 `/api/runs` 与最近执行的事件，是**执行历史** | 留在**自动化**，显示名改「执行历史」；key 名 `navOperationLogs` 保持不变（见 §9 遗留 2） |
| 7 | 建议稿把「数据中心」标为「数据与资产」，把「产生记录」标为「自动化」 | 数据中心是跨业务 KPI/趋势/AI 覆盘；产生记录是「已生成内容」的只读列表 | 两者都归入**运营管理**（与成本中心同属「观察业务怎么跑」），与「可复用素材」区分开 |
| 8 | 建议稿未指定 `/settings` 的显示名 | 页面是应用偏好（执行环境/权限/语言/品牌/提示词/备份）；原名「系统设定」与组名「系统设置」几乎同字 | 改名为**通用设置**（3 语同步） |
| 9 | 建议稿要求先核实「AI 写作」与「文章创作」是否重复 | AI 写作 = 三步向导（选素材 → 配置 → 生成，可存库）；文章创作 = 文章列表 + 全文编辑器 + 站内 AI 生成。两者**工作流不同**但能力确实重叠 | **两个入口都保留**（导航只调整归属，不擅自删除页面）；重叠本身登记为遗留争议（§9 遗留 4） |
| 10 | 「产品管理」建议稿标为「内容创作或资产管理」 | 产品资料库供知识库与配图取材 | 归入**数据与资产** |
| 11 | 建议稿的三条「不要」 | — | 全部遵守：未建「AI」大杂烩菜单；发布记录与执行历史分开；未为凑结构新建空页面 |
| 12 | 建议稿的商业分层（Community/Pro/Creator/Business/Marketplace） | 当前代码里**没有**订阅、团队、市场交易、权限分层的实现 | **不新增**任何分层菜单/付费门槛入口；只在文档层面作为分组依据（应用与市场 = 长期 Marketplace 入口） |

### 5.1 CI-IA-02 的判断与差异（编号接上表）

| # | 判断 / 差异（目标稿 vs 实际） | 依据（实际代码） | 结果 |
| --- | --- | --- | --- |
| 13 | 目标稿写「视频发布」，实际页面用「影片」 | `src/locales/zh-cn.json` 中与该功能相关的 51 条文案用「影片」（影片库/影片标题/影片描述/选择影片…），「视频」仅出现在通用媒体语（音视频转录、视频渲染） | **保留「影片发布」**（`navVideoPublishing` 值不变），并把差异登记在本表；若作者要统一术语，应作为**单独一次全库用词统一卡**（会牵动 51 处文案），不在菜单卡里改 |
| 14 | 目标稿写「账号定位 / 账号管理」 | `zh-cn` 词库「帐号」76 处 vs 「账号」5 处，页面标题与帐号菜单也用「帐号」 | **保留「帐号定位 / 帐号管理」**；术语统一另立卡 |
| 15 | 目标稿把「智能画布」「思维导图」平铺为两条叶子 | 智能画布是**没有自己页面**的容器（`href` = `/whiteboard`），白板才是 `/whiteboard` 这条叶子 | **保留嵌套分组**，否则 `/whiteboard` 白板会从菜单消失，违反本卡验收标准 2（30 条路由全保留） |
| 16 | 「AI 写作」与「文章创作」是否重复 | AI 写作 = 三步向导（选素材 → 配置 → 生成，`/creation/ai-writing`）；文章创作 = 文章列表 + 全文编辑器 + 站内 AI 生成（`/creation/articles`）。两者**输入不同**（选题/素材 vs 已有文章），但**输出高度重叠**（都是文章版本，都写 `content_items`） | **本轮不删入口、不合并页面**（作者明确要求先调查再决定）；边界已写入 §3 契约列，后续整合建议见 §9 遗留 4 |
| 17 | 「生成记录」应属于哪里 | `/automation/generations` 是「已生成内容」的只读列表（每 5 秒刷新、分页），既像内容资产历史、又像执行审计 | **本轮放入「数据与成本」**；待作者判定它究竟是内容资产历史还是执行审计后，再决定是否拆分（§9 遗留 9） |
| 18 | 应用商店何时升级为 Marketplace | 当前 `/app-store` 只有「写作智能体商店」：浏览/我发布的/分类排序，**没有** Agent 安装、工作流交易、版本管理、创作者分成 | **只保留真实入口 + 组名改为「扩展市场」**（en 用 `Extensions` 而非 `Marketplace`，避免把未实现能力写成已交付）；等上述能力真正交付后再扩展菜单 |
| 19 | 菜单显示「AI 对话」，页面标题仍是「Agent 聊天室」（`agentChatTitle`） | 本卡只治理导航；页面文案属页面职责 | **只改菜单显示名**（key `agentChatShortTitle` 不变），页面标题不动；两者不一致登记为 §9 遗留 8 |
| 20 | 目标稿要求移动端用「经过验证的短标签」 | 桌面标签在 390px 下过长；截断会丢失语义 | **新增 `mobileLabelKey` 字段 + 5 个独立 i18n key**（不是复用桌面 key、不是截断）；测试断言「只有 5 个页签组声明该字段」且「短标签不长于桌面标签」 |
| 21 | 目标稿的移动端顺序为 工作台 / 创作 / 资产 / 发布 / 设置 | 与新的桌面组序一致（1/2/3/4/8），且每个都是真实分组 | **`consoleMobileNavIds` 改为 workbench · creation · assets · publishing · system**；未进页签的 3 组不加第 6 个入口 |

### 5.2 CI-IA-03 的判断与差异（编号接上表，作者直派）

| # | 判断 / 差异（作者要求 vs 实际） | 依据（实际代码） | 结果 |
| --- | --- | --- | --- |
| 22 | 作者要求：「动态发布」改名「动态创作」并**移到内容创作**；「影片发布」保留在发布与渠道 | `/creation/posts` 是图文动态撰写（文案 + 配图库挑图 + 多帐号发布），路由本就在 `/creation/*` 下；`/creation/videos` 是三步骤影片发布组装（上传 + 标题/描述/可见性 + 多帐号），**没有**剪辑/视频创作页 | **执行**：`posts` 由 `publishing` 移入 `creation`（组内最后一条）；显示名「动态发布」→「动态创作」（key `navDynamicPublishing` 不变，3 语同步）；`videos` 留在 `publishing`。这是对 IA-01 决策 2 的**唯一例外**，已写入代码注释并由 `console-nav.test.ts` 的新用例固定 |
| 23 | 作者目标稿写「发布排期」 | 实际显示名是「发布排程」（`navSchedules`），`zh-cn` / `zh-hk` 全库用「排程」（排程列表页、`schedulePost*` 系列 20+ 条文案） | **保留「发布排程」**（值不变），差异登记在本表；术语统一与 §5.1 #13/#14 一样另立卡 |
| 24 | 作者目标稿写「执行队列」 | 实际 `navRuns` 的 `zh-cn` 值是「执行伫列」、`zh-hk` 是「執行佇列」（CI-IA-01 刻意对齐既有 `queueRun` 译法） | **本卡只登记不改**（§9 遗留 11）：属全库用词问题，应与术语统一一并决定 |

**与建议稿一致的落点（CI-IA-03）**：8 组结构、顺序与命名**逐组与作者目标架构一致**（逐项比对见 §3；差异只剩 §5.2 #23/#24 两处用词）；本轮唯一的结构性改动是 §5.2 #22。

**与建议稿一致的落点（CI-IA-01 / CI-IA-02，历史记录）**：8 个一级分组、系统设置置于底部、成本中心移出系统分组并改短名称、应用商店独立成组、不造占位页；CI-IA-02 追加：内容创作提前、资产组独立并改名、自动化与数据/成本分离、扩展市场不再叫「应用市场」、移动端短标签落地。

## 6. 国际化（`zh-cn` / `zh-hk` / `en`）

- 三语文案在 `src/locales/{zh-cn,zh-hk,en}.json` 同步修改；结构一致，key 集合完全对齐。`LocaleDictionary` 以 `en` 为基准 + `satisfies Record<Locale, typeof en>`，因此**任一语系少一个 key 都会编译失败**；`src/lib/i18n-coverage.test.ts` 与 `src/lib/console-nav.test.ts`（三语非空 + 同语系内标签不重复）再各固定一次。
- 组件里**没有硬编码**新的显示文本：菜单树只写 i18n key（`labelKey` / `mobileLabelKey`，类型均为 `TranslationKey`，写错 key 编译不过），渲染时由 `labelConsoleNav` 统一 `t()`；底部导航读 `mobileName`，桌面读 `name`。
- 面包屑/顶部标题沿用 `activeItem.name`（桌面菜单名），因此标题栏文案自动跟着新名称走。
- **CI-IA-02：只改显示值，不重命名任何 key**（含既有 30 条叶子的 key）；新增 **5 个移动端专用 key**（`navMobile*`）。改前一律先用 `Select-String` 全仓确认引用位置，无引用 key 一律**保留不删**（清理属独立 i18n 卡）。
- 英文命名原则：分组用产品界面常见术语（`Workbench` / `Content Creation` / `Brand & Assets` / `Publishing & Channels` / `Data & Costs` / `Extensions` / `System Settings`）；「扩展市场」用 `Extensions` 而非 `Marketplace`，避免把尚未交付的交易能力写进界面。

| key | zh-cn | zh-hk | en | 动作（CI-IA-01） |
| --- | --- | --- | --- | --- |
| `navWorkbench` | 工作台 | 工作台 | Workbench | 新增（组；CI-IA-02 未改） |
| `navDataAssets` | 数据与资产 → **品牌与资产** | 數據與資產 → **品牌與資產** | Data & Assets → **Brand & Assets** | 新增（组，CI-IA-02 改值） |
| `navAppMarket` | 应用与市场 → **扩展市场** | 應用與市場 → **擴展市場** | Apps & Market → **Extensions** | 新增（组，CI-IA-02 改值） |
| `navOperations` | 运营管理 → **数据与成本** | 營運管理 → **數據與成本** | Operations → **Data & Costs** | 新增（组，CI-IA-02 改值） |
| `navCreation` | 创作 → **内容创作** | 創作 → **內容創作** | Creation → **Content Creation** | 改名（CI-IA-02 未改） |
| `navPublishing` | 发布 → **发布与渠道** | 發佈 → **發佈與渠道** | Publishing → **Publishing & Channels** | 改名（CI-IA-02 未改） |
| `navSystem` | 系统 → **系统设置** | 系統 → **系統設定** | System → **System Settings** | 改名（CI-IA-02 未改） |
| `navSettings` | 系统设定 → **通用设置** | 系統設定 → **一般設定** | System Settings → **General Settings** | 改名（CI-IA-02 未改） |
| `navRuns` | 执行 → **执行伫列** | 執行 → **執行佇列** | Runs → **Run Queue** | 改名（用词与 `queueRun` 既有译法一致） |
| `navSchedules` | 排程 → **发布排程** | 排程 → **發佈排程** | Schedules → **Publish Schedules** | 改名 |
| `navOperationLogs` | 营运日志 → **执行历史** | 營運日誌 → **執行歷史** | Operation Logs → **Execution History** | 改名（key 不变） |
| `navImageManagement` | 配图管理 → **配图创作** | 配圖管理 → **配圖創作** | Images → **Image Creation** | 改名（key 不变） |
| `navAiCostCenter` | AI 成本与质量优化中心 → **AI 成本中心** | AI 成本與品質優化中心 → **AI 成本中心** | AI Cost & Quality Center → **AI Cost Center** | 改名（key 不变） |
| `agentChatShortTitle` | 聊天 → **AI 对话** | 聊天 → **AI 對話** | Chat → **AI Chat** | CI-IA-02 改值 |
| `navGenerationRecords` | 产生记录 → **生成记录** | 產生記錄 → **生成記錄** | Generation Logs | CI-IA-02 改值（zh 语系） |
| `navAiWriting` | AI写作 → **AI 写作** | AI寫作 → **AI 寫作** | AI Writing | CI-IA-02 改值（zh 语系） |
| `navMobileWorkbench` / `navMobileCreation` / `navMobileAssets` / `navMobilePublishing` / `navMobileSystem` | 工作台 / 创作 / 资产 / 发布 / 设置 | 工作台 / 創作 / 資產 / 發佈 / 設定 | Workbench / Create / Assets / Publish / Settings | **CI-IA-02 新增**（移动端短标签） |

保留但当前无引用的 key（**不删**，避免动无关文件）：`navSites`、`navContent`、`navSmartConfig`（第三个因「智能配置」容器移除而变成未使用）。

## 7. 路由、权限与兼容性

| 项 | 结果 |
| --- | --- |
| URL | **30/30 未改动**：`routesBeforeRegrouping`（测试里手写的旧路由清单）与新树逐条相同 |
| 页面文件 | 未移动、未重命名、未新增、未删除任何 `page.tsx` |
| 菜单 ↔ 页面一致性 | 磁盘上 `(console)` 下的页面 = 菜单路由 + 3 个**已登记的免菜单路由**（`/schedule`、`/system/usage` 为重定向别名，`/settings/[tab]` 为动态页签路由） |
| 高亮规则 | 与改动前**同一函数**（`matchesConsoleNavSegment`：前缀匹配 + `/` 视为仪表板）；新增测试覆盖 5 个边界（含 `/settings/permissions` 命中、`/system/workspace` 不误命中 `/settings`） |
| 高亮唯一性 | 30 条路由逐条验证「命中自己」；没有两个叶子 segment 互相遮蔽 |
| 未知路由回退 | 改动前回退 `navItems[0]`（仪表板）；现在 `findActiveConsoleNavEntry` 回退**第一个叶子**（同样是仪表板）→ 行为等价，顶部标题不会空白 |
| 权限 | 侧边栏本就没有角色/权限判断（`console-layout-shell.tsx` 无 `permission` 分支），本次也未新增任何可见性规则；左下角帐号菜单（7 项）逐项未改 |
| 展开/收合、刷新、直接输入 URL、返回 | 折叠状态仍按 `id` 记忆（`collapsedGroups`）；路由切换时的自动展开仍按 segment 计算；未引入新的客户端状态 |

| 变化 | 说明 |
| --- | --- |
| CI-IA-01 新增分组 | 工作台、`navDataAssets`、`navAppMarket`、`navOperations`（前三个此前不存在；第四个此前没有承载组） |
| CI-IA-01 删除分组 | 「智能配置」空容器（2 个子项移入资产组；**没有页面因此消失**） |
| CI-IA-01 重命名分组 | 创作 → 内容创作；发布 → 发布与渠道；系统 → 系统设置 |
| CI-IA-02 组序 | `consoleNavItems` 数组重排为 1 工作台 / 2 内容创作 / 3 品牌与资产 / 4 发布与渠道 / 5 自动化 / 6 数据与成本 / 7 扩展市场 / 8 系统设置（顺序改变，**路由与叶子集合不变**） |
| CI-IA-02 重命名分组 | `navDataAssets` → 品牌与资产；`navOperations` → 数据与成本；`navAppMarket` → 扩展市场（**key 不变**） |
| CI-IA-02 显示值 | `agentChatShortTitle` → AI 对话；`navGenerationRecords` → 生成记录；`navAiWriting` → AI 写作（zh 语系） |
| CI-IA-02 移动端 | 新增 5 个 `navMobile*` key 与 `mobileLabelKey` 字段；`consoleMobileNavIds` 改为 workbench · creation · assets · publishing · system |
| 未进菜单的新页面 | 无。路由集合与改动前**逐条相同**（§7 验证 3 实测；CI-IA-02 未再改动任何路由，见 §7.1） |

### 7.1 CI-IA-02 兼容性核查

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 路由集合不变 | `console-nav.test.ts` 的 `routesBeforeRegrouping`（手写旧清单）vs 新树 href 集合 | **30/30 相同**（CI-IA-01 已建立，CI-IA-02 未触碰 `href`） |
| 归属唯一 | `expectedOwnership` 逐组比对 + `owned.sort()` vs 全树叶子 sort | **30/30 唯一归属**，无重复无缺口 |
| `(console)` 页面覆盖 | 磁盘 `page.tsx` vs 菜单路由 + `consoleNavOffMenuRoutes` | 互补，无「有页面没入口」 |
| 高亮/展开 | `findActiveConsoleNavEntry` 对 30 条 href 逐条命中自己；`/` 与未知路由回退第一个叶子（仪表板） | 通过；深链与跨组跳转在真实浏览器复验（§8.2） |
| 权限与认证 | `console-layout-shell.tsx` 无 `permission` 分支；本卡未改 Cookie/登录/接口 | 未改动 |
| 移动端 | `consoleMobileNavIds` 5 项 + 每项 `mobileLabelKey`；测试断言非页签组**不得**声明 `mobileLabelKey` | 通过（5/5，无第 6 个入口） |
| 术语/文案一致性 | 「影片 vs 视频」「帐号 vs 账号」逐项统计（§5.1 #13/#14） | 保留现状并登记，不在本卡改 |

### 7.2 CI-IA-03 兼容性核查

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 路由集合不变 | `console-nav.test.ts` 的 `routesBeforeRegrouping`（手写旧清单）vs 新树 `href` 集合 | **30/30 相同**——`/creation/posts` 的 URL 本身没动，只换了归属与显示名 |
| 归属唯一 | `expectedOwnership` 逐组比对 + `owned.sort()` vs 全树叶子 sort | **30/30 唯一归属**：`creation` 7 条（新增 `posts`）、`publishing` 5 条（去掉 `posts`） |
| `(console)` 页面覆盖 | 磁盘 `page.tsx` vs 菜单路由 + `consoleNavOffMenuRoutes` | 互不遗漏，无「有页面没入口」 |
| 高亮/展开 | 30 条 `href` 逐条命中自己；`/creation/posts` 只命中 `creation` 组 | 通过；`posts` 的 `segment` 与组内其他叶子无前缀遮挡 |
| 移动端 | `consoleMobileNavIds` 5 项 + 落点 `consoleNavLeafHref` | `creation` 首项仍为 `/creation/ai-writing`、`publishing` 首项仍为 `/publishing/accounts` → **落点 5/5 未变** |
| 权限与凭据 | `console-layout-shell.tsx` 无权限分支；本卡未动 Cookie/登录/接口 | 未改动 |
| 术语 | 「发布排程 / 发布排期」「执行伫列 / 执行队列」差异 | 保留现状并登记（§5.2 #23/#24、§9 遗留 11） |

## 8. 验证（实际命令与实际结果）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `node_modules\.bin\tsc.cmd --noEmit` | **通过**，exit 0，无输出 |
| 全量单元/集成测试 | `node_modules\.bin\vitest.cmd run` | **通过**：`Test Files 147 passed (147)`、`Tests 1198 passed (1198)`（改动前为 146 文件 / 1188 用例；净增 1 文件 / 10 用例 = 本次新增的 `src/lib/console-nav.test.ts`，无既有用例被改动或删除） |
| 动态检查 | `node_modules\.bin\eslint.cmd .` | exit 1，但问题与本次改动**无关**，为既有基线：`tmp-probe-db.cjs:1:26`、`tmp-probe-zod-json-schema.cjs:7:15`、`tmp-probe-zod-json-schema.cjs:42:29`（`@typescript-eslint/no-require-imports`）+ `src/components/agent-chat/chat-conversation.tsx:146` 警告（`react-hooks/exhaustive-deps`）。本次触碰的文件（`src/lib/console-nav.ts`、`src/lib/console-nav.test.ts`、`src/components/console-layout-shell.tsx`、3 个 locale、`system/usage/page.tsx`）**零问题** |
| 真实浏览器冒烟（Playwright，dev server `:3000`，3 语系） | `node %TEMP%\cp-ia-01\menu-smoke.mjs` | **111/111 通过（exit 0）**：`zh-cn` / `zh-hk` / `en` 各 37 项，覆盖分组名称与顺序、每组件数、30 叶子与 href 集合不变、收起/展开、深链自动展开与高亮、跨组点击的标题与 URL、改名标签渲染、控制台零 error、移动端 5 页签。逐项见 §8.1 |
| 菜单不变式（结构层） | `node_modules\.bin\vitest.cmd run src/lib/console-nav.test.ts` | **通过**：8 组/顺序、30 条路由与旧的 `routesBeforeRegrouping` 逐条相同、`(console)` 页面与菜单路由 + 3 条已登记免菜单路由互补、每个叶子归属唯一、id 与 segment 无重复、5 个移动页签 |

### 8.1 浏览器实测（Playwright / Chromium，运行中的 dev server `http://127.0.0.1:3000`，2026-10-10）

脚本 `%TEMP%\cp-ia-01\menu-smoke.mjs`、日志 `%TEMP%\cp-ia-01\menu-smoke.log`：`zh-cn` / `zh-hk` / `en` **各 37 项，共 111/111 通过（exit 0）**。

| 检查项（每个语系各跑一次） | 结果 |
| --- | --- |
| 侧边栏 8 个分组的**名称与顺序**完全等于预期 | 通过 |
| 8 个顶层项**全部**是分组（无顶层单页残留） | 通过 |
| 8 个分组默认全部展开 | 通过 |
| 每组叶子数 = **2 / 6 / 6 / 6 / 3 / 1 / 3 / 3**（合计 30） | 通过 |
| 30 个 href 无重复，且都带当前语系前缀（`/zh-cn/...`） | 通过 |
| href 集合（排序后逐字比对）与改动前 30 条路由**完全相同** | 通过 |
| 直接开 `/dashboard`：顶部标题 = 仪表板 / 儀表板 / Dashboard，该叶子高亮 | 通过 |
| 点分组标题可**收起**（子项容器消失）再**展开**（发布与渠道恢复 6 项） | 通过 |
| 直接开 `/system/cost-center`：标题 = AI 成本中心，所属分组「运营管理」自动展开且高亮，叶子高亮 | 通过 |
| 跨 4 组点击 `/creation/images`、`/automation/logs`、`/app-store`、`/settings`：URL 正确 + 标题为对应新名（配图创作 / 执行历史 / 应用商店 / 通用设置）+ 叶子与所属分组都高亮 | 通过 |
| 5 个改名标签真实渲染为新文案（执行伫列 / 发布排程 / 执行历史 / AI 成本中心 / 通用设置） | 通过 |
| 桌面与移动端浏览器控制台**无 error** | 通过 |
| 移动端 390×844：底部 5 页签 = 工作台/数据与资产/内容创作/发布与渠道/系统设置；点「数据与资产」落在 `/content/library` | 通过 |

> **脚本自身两次缺陷（已修正后一次通过；非产品问题，如实记录）**：① 第一版用 `a[href="zh-cn/creation/images"]`（缺前导 `/`）导致 30 s 超时，改为后缀匹配复跑；② 第二版把「发布与渠道」的子项数误写为 5（实际 6），修正并新增「每组叶子数」逐组断言后，**第三版 111/111 通过**。
> 三次实测都在改动**完成后**针对运行中的 dev server 执行；本卡**未重启**该 server、**未写入**其数据库。

### 8.2 CI-IA-02 验证（2026-10-10）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**，无输出 |
| 全量单元/集成测试 | `node_modules\.bin\vitest.cmd run` | **exit 0**：`Test Files 147 passed (147)`、`Tests 1200 passed (1200)`、`Duration 30.19s`（Start at 11:03:46）。CI-IA-01 基线 147 / 1198 → 净增 **2 个用例**，全部来自 `console-nav.test.ts` 新增不变式（组序、移动页签与短标签、标签无重复）；**既有用例零改动** |
| 动态检查（本卡改动文件） | `node_modules\.bin\eslint.cmd src/lib/console-nav.ts src/lib/console-nav.test.ts src/components/console-layout-shell.tsx` | **exit 0**，无输出 |
| 动态检查（全仓，基线对照） | `node_modules\.bin\eslint.cmd .` | 与 §8 表格逐条相同（3 error + 1 warning，均在未改动的 `tmp-*.cjs` / `chat-conversation.tsx`） |
| 真实浏览器冒烟 | `node %TEMP%\cp-ia-02\menu-smoke.mjs` | **120/120 通过（exit 0）**，见下表 |

浏览器冒烟脚本 `%TEMP%\cp-ia-02\menu-smoke.mjs`、日志 `%TEMP%\cp-ia-02\menu-smoke.log`：`zh-cn` / `zh-hk` / `en` **各 40 项，共 120/120 通过（exit 0）**。

| 检查项（每语系各 40 项） | 结果 |
| --- | --- |
| 侧边栏渲染 8 个顶层项且**全部是分组**，名称与顺序 = 工作台 / 内容创作 / 品牌与资产 / 发布与渠道 / 自动化 / 数据与成本 / 扩展市场 / 系统设置 | 通过 |
| 每组件数 = 2/6/6/6/3/3/1/3，叶子合计 30 | 通过 |
| 30 条 href 无重复、均带当前语系前缀、与改动前 30 条路由**逐条相同**（与测试里的 `routesBeforeRegrouping` 一致） | 通过 |
| 直接开 `/dashboard`：顶部标题 = 仪表板 / 儀表板 / Dashboard，该叶子高亮 | 通过 |
| 点分组标题可**收起**（子项容器消失）再**展开**（发布与渠道恢复 6 项） | 通过 |
| 直接开 `/system/cost-center`：标题 = AI 成本中心，所属分组「数据与成本」自动展开，分组与叶子都高亮 | 通过 |
| 跨 4 组点击 `/creation/images`、`/automation/logs`、`/app-store`、`/settings`：URL 正确 + 标题为新名（配图创作 / 执行历史 / 应用商店 / 通用设置）+ 叶子与所属分组都高亮（分组序号实测 2 / 5 / 7 / 8） | 通过 |
| 3 个改名标签真实渲染（AI 对话 / AI 写作 / 生成记录；en = AI Chat / AI Writing / Generation Logs） | 通过 |
| 移动端 390×844：底部 **5 页签**，标签 = 工作台/创作/资产/发布/设置（zh-hk = 工作台/創作/資產/發佈/設定；en = Workbench/Create/Assets/Publish/Settings），逐一点击落点 = `/dashboard`、`/creation/ai-writing`、`/content/library`、`/publishing/accounts`、`/system/models` | 通过 |
| 桌面端与移动端浏览器控制台**无 error** | 通过 |

三语实测组名（浏览器真实渲染值）：`工作台 | 内容创作 | 品牌与资产 | 发布与渠道 | 自动化 | 数据与成本 | 扩展市场 | 系统设置`；`工作台 | 內容創作 | 品牌與資產 | 發佈與渠道 | 自動化 | 數據與成本 | 擴展市場 | 系統設定`；`Workbench | Content Creation | Brand & Assets | Publishing & Channels | Automation | Data & Costs | Extensions | System Settings`。

> **脚本自身两处缺陷（已修正后一次通过；非产品问题，如实记录）**：① 移动端断言最初写成未 `await` 的独立函数调用，导致 `page.$$eval` 在 context 关闭后才执行、Node 以未捕获异常退出（该次 112/113）；② 首轮另有一次 Chromium `ERR_NO_BUFFER_SPACE`（第 3 个浏览器 context 的资源压力），改为**复用同一 context 只改视口**后消除。**最终一版 120/120 通过（exit 0）**。
> 实测针对改动**完成后**运行中的 dev server 执行；本卡**未重启**该 server、**未写入**其数据库。
> 另注：日志文件是 UTF-8 写入，`menu-smoke.log` 在 GBK 控制台里直接 `Get-Content` 会显示乱码，查看时用 `Get-Content -Encoding UTF8` 或用 Node 读取即可（断言比较发生在内存里，不受显示编码影响）。

### 8.3 CI-IA-03 验证（2026-10-10）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**，无输出 |
| 定向单测（本卡契约） | `node_modules\.bin\vitest.cmd run src/lib/console-nav.test.ts` | **exit 0**：`Test Files 1 passed (1)`、`Tests 13 passed (13)`（CI-IA-02 为 12 例 → 净增 **1 例**：新增「CI-IA-03 作者决定」不变式；既有 12 例仅 2 处期望值随归属修正更新） |
| 全量单元/集成测试 | `node_modules\.bin\vitest.cmd run` | **`Test Files 153 passed / 1 failed (154)`、`Tests 1263 passed / 2 failed (1265)`**。2 条失败都在 `src/worker/runner.test.ts`（`expected 'paused' to be 'failed'`），**与本卡无关**：该测试文件与**在途未提交**的 `src/worker/runner.ts`（312 行新增）属作者的 CI-P7-03 系列工作，主线 **§附录 B-10 第 1385 行**已登记同一基线失败（「期望 `failed`、实测 `paused`……与本卡无关」）；交付记录整理阶段**复跑并留档** `%TEMP%\cp-ia-03\vitest-full.log`：`Test Files 1 failed | 153 passed (154)`、`Tests 2 failed | 1263 passed (1265)`、`Duration 44.68s`，失败仍是同两条 |
| 动态检查（本卡改动文件） | `node_modules\.bin\eslint.cmd src/lib/console-nav.ts src/lib/console-nav.test.ts` | **exit 0**，无输出 |
| 真实浏览器冒烟 | `node %TEMP%\cp-ia-03\menu-smoke.mjs` | **78/78 通过（exit 0）**：`zh-cn` / `zh-hk` / `en` 各 26 项，见下表 |

脚本 `%TEMP%\cp-ia-03\menu-smoke.mjs`、日志 `%TEMP%\cp-ia-03\menu-smoke.log`：三语**各 26 项，共 78/78 通过（exit 0）**。

| 检查项（每语系各 26 项） | 结果 |
| --- | --- |
| 侧边栏 8 个一级项、**全部为分组**、名称与顺序 = 工作台 / 内容创作 / 品牌与资产 / 发布与渠道 / 自动化 / 数据与成本 / 扩展市场 / 系统设置 | 通过 |
| 每组件数 = **2 / 7 / 6 / 5 / 3 / 3 / 1 / 3**（叶子合计 30） | 通过 |
| `/creation/posts` **是「内容创作」组内最后一条**，显示名为 动态创作 / 動態創作 / Post Creation | 通过 |
| 「发布与渠道」**不再**出现 `/creation/posts`，且仍保留 `/creation/videos`（影片发布 / 影片發佈 / Videos） | 通过 |
| 30 条 `href` 与改动前**逐条相同**（排序后逐字比对）、无重复 | 通过 |
| 直接开 `/creation/posts`：顶部标题 = 动态创作 / 動態創作 / Post Creation，叶子高亮，所属「内容创作」组高亮，「发布与渠道」**不**高亮 | 通过 |
| 直接开 `/creation/videos`：标题 = 影片发布 / 影片發佈 / Videos，叶子与其「发布与渠道」组仍高亮 | 通过 |
| 移动端 390×844：底部 **5 页签**（工作台/创作/资产/发布/设置；zh-hk = 工作台/創作/資產/發佈/設定；en = Workbench/Create/Assets/Publish/Settings），逐一点击落点 = `/dashboard`、`/creation/ai-writing`、`/content/library`、`/publishing/accounts`、`/system/models` | 通过 |
| 桌面端与移动端浏览器控制台**无 error** | 通过 |

> 冒烟针对改动**完成后**运行中的 dev server（`http://127.0.0.1:3000`）执行；本卡**未重启**该 server、**未写入**其数据库（全部只读 GET）。交付记录整理阶段同一脚本**复跑一次**（`menu-smoke-rerun.log`）：仍为 **78/78（exit 0）**。

## 9. 遗留问题

**阻塞项：无。** 以下均为可延后项，登记以便后续卡片处理：

| # | 遗留 | 类型 | 建议后续动作 |
| --- | --- | --- | --- |
| 1 | 移动端页签文案变长（`发布与渠道` / `Publishing & Channels` 在 390px 宽度下占位更紧） | **CI-IA-02 已解决** | 已新增 5 个移动端专用短标签 key（`navMobile*`）+ `mobileLabelKey` 字段，桌面标签不动（见 §4.1、§6） |
| 2 | `navOperationLogs` 的 key 名与显示名「执行历史」不再字面一致 | 可延后 | 若未来统一 i18n key 命名，需连带更新 `docs/menu-inventory.md` 等文档与历史记录引用；本次刻意不动，避免「改名牵动无关文件」 |
| 3 | `navSmartConfig` 因「智能配置」容器删除而**无引用**（`navSites`、`navContent` 亦然） | 可延后 | 交由一次专门的 i18n 清理卡处理（删除需同步 3 语系与 parity 测试），本次保留以免动无关文件 |
| 4 | 「AI写作」与「文章创作」能力有重叠（向导式生成 vs 文章列表 + 编辑器 + 站内生成） | 可延后（**产品决策**） | 需要作者决定是否合并为一条创作工作流；导航层已按「不擅自删除页面」原则保留两个入口（CI-IA-02 #16 再次确认不合并） |
| 5 | 帐号菜单副标题仍取 `navSettings`（现显示「通用设置」），是既有的占位式实现 | 可延后（**既有问题**，非本卡引入） | 若要显示真实方案名/订阅状态，属独立卡片（涉及 Pro/Business 分层呈现） |
| 6 | 侧边栏渲染层没有 DOM 级单测（`vitest` 环境为 node，无 jsdom） | 可延后 | 两张卡都以 Playwright 实测覆盖（§8.1 / §8.2）；若后续要长期防回归，可引入组件测试环境或保留此脚本 |
| 7 | 免菜单路由 `/schedule`、`/system/usage`（重定向别名）与 `/settings/[tab]` 仍无菜单入口 | 非问题（刻意） | 已由 `consoleNavOffMenuRoutes` 显式登记并测试覆盖；`/settings/[tab]` 经「通用设置」页签与帐号菜单可达 |
| 8 | 菜单显示「AI 对话」，页面标题仍是「Agent 聊天室」 | 可延后（**CI-IA-02 登记**） | 导航层只负责入口名；若要统一，需另开卡改页面文案（`agentChatTitle`）并评估对既有链接/文档的影响 |
| 9 | 「生成记录」（`/automation/generations`）放在「数据与成本」是 CI-IA-02 的判断，未定论 | 可延后（**产品决策**） | 待作者判定它是**内容资产历史**还是**执行审计**：前者应移入品牌与资产，后者留在自动化/数据与成本；迁移只改 `consoleNavItems` 归位与测试期望（见 §5.1 #17） |
| 10 | 显示名「影片发布」与通用媒体语「视频」并存；显示名用「帐号」而部分文案用「账号」 | 可延后（**术语统一**） | 二者都是全库用词问题（51 处「影片」/ 76 处「帐号」），需单独一张「术语统一卡」；菜单层已按 §5.1 #13/#14 保留现状 |
| 11 | 另有 2 处菜单用词与作者目标稿不一致：显示名「发布排程」（目标稿写「发布排期」）、`navRuns` 的 `zh-cn` 值「执行伫列」（目标稿写「执行队列」，且「伫」是繁体字形） | 可延后（**术语统一卡**） | 与本表第 10 条合并处理：改动会牵动页面文案与 3 语，菜单层已按 §5.2 #23/#24 只登记不改 |

## 10. 今后的菜单治理规则（新增功能时先回答三个问题）

1. **这个页面产出什么？** 内容/素材 → 内容创作；可复用资料 → 品牌与资产；某平台的结果 → 发布与渠道。
2. **它服务哪个业务目标？** 执行可重复任务（队列/历史/节点）→ 自动化；观察业务怎么跑（数据/记录/成本）→ 数据与成本；配置本机（模型/偏好/工作区）→ 系统设置。
3. **它是本机能力还是扩展？** 本机能力不设门槛；商店/第三方能力 → 扩展市场。

落地要求（代码层，防止菜单与实现脱节）：

- 菜单只能改 `src/lib/console-nav.ts` 的 `consoleNavItems`；**不允许**在页面/组件里另写导航数组。
- 新增页面必须**同时**更新 `src/lib/console-nav.test.ts` 的期望路由集（否则测试会红——这是刻意的门禁），并在 3 个语系补齐 label。
- 新增页面时先确认 `(console)` 下每个 `page.tsx` 都能被「菜单路由 + `consoleNavOffMenuRoutes`」解释，避免出现「有页面没入口」或「有入口没页面」。
- **不要**为了凑分组而新增第 9 个一级分组；市场类新能力统一放进「扩展市场」。
- 菜单名只描述用户目标，不用开发模块名；i18n key 一经上线不再随显示名改动（重命名显示名时保留 key）。
- **改一级分组顺序或名称时**：同步更新 `console-nav.test.ts` 的 `expectedGroupOrder`、`docs/menu-inventory.md` §2.2、本文件 §2/§4.1 与三个语系的对应 key；**不要**顺手改 `href`。
- **移动端页签**：顺序由 `consoleMobileNavIds` 决定，标签一律用该组的 `mobileLabelKey`（短标签）；新增/调整页签组时必须补 3 语短标签 key，且**不得**给未进页签的分组声明 `mobileLabelKey`。

## 11. 附录

### 11.1 本次改动文件

**CI-IA-01**

| 文件 | 改动 |
| --- | --- |
| `src/lib/console-nav.ts` | **新增**：菜单树唯一事实来源（纯数据 + 纯函数，无 DOM 依赖） |
| `src/lib/console-nav.test.ts` | **新增**：菜单不变式测试（8 组、30 路由、磁盘页面覆盖、归属唯一、三语 key、匹配与高亮、移动页签） |
| `src/components/console-layout-shell.tsx` | 导航数组改为 `labelConsoleNav(consoleNavItems, t)`；本地 `href`/`isActive`/`leafHref` 助手换成共享函数；移动端页签 id 取自 `consoleMobileNavIds`；顶部标题用 `activeItem?.name`；移除随之失效的 import |
| `src/locales/zh-cn.json`、`zh-hk.json`、`en.json` | 新增 4 个分组 key，改名 9 个标签（见 §6） |
| `src/app/[locale]/(console)/system/usage/page.tsx` | 仅更新重定向别名的注释（说明新菜单里的显示名），**无行为改动** |
| `docs/development/menu-information-architecture.md` | **新增**：本文件 |
| `docs/menu-inventory.md` | 追加「§2.1 CI-IA-01 之后的分组」小节 + 指向本文件的旧→新映射 |
| `docs/coolpilot-capability-integration-plan.md` | 「2026-10-10」记录块新增 `CI-IA-01` 行 |
| `docs/development/capability-integration-numbering-map.md` | 追加 `CI-IA-01` 行（工作区基线说明同步） |

**CI-IA-02**（只动菜单定义、移动端标签与文案；**未新增/删除任何文件**）

| 文件 | 改动 |
| --- | --- |
| `src/lib/console-nav.ts` | `consoleNavItems` 重排为 8 组新顺序；`consoleMobileNavIds` 改为 workbench · creation · assets · publishing · system；新增 `mobileLabelKey` 字段（仅 5 个页签组声明）与 `labelConsoleNav` 的 `mobileName` 解析 |
| `src/lib/console-nav.test.ts` | 新增 `expectedGroupOrder`（8 组顺序）、重排 `expectedOwnership` 与 `expectedMobileTabs`；新增/加强不变式：组序、移动页签顺序与短标签、标签无重复（共 +2 用例） |
| `src/components/console-layout-shell.tsx` | 底部导航取 `mobileName`（短标签）而非桌面 `name`；其余渲染逻辑未改 |
| `src/locales/zh-cn.json`、`zh-hk.json`、`en.json` | 新增 5 个 `navMobile*` key；改 6 个显示值（见 §4.1）；**key 名零改动** |
| `docs/development/menu-information-architecture.md` | 重写 §2（商业排序与职责）、扩写 §3（职责/输入/输出/边界）、新增 §4.1 / §5.1（#13–21）/ §7.1 / §8.2 / §9（#8–10）；同步 §6、§10、§11 |
| `docs/menu-inventory.md` | 新增 §2.2（CI-IA-02 之后的分组）+ §4.1（移动端新页签与短标签 key）；原 §2 与 §4 表格保留为历史证据 |
| `docs/coolpilot-capability-integration-plan.md` | §1 新增 `CI-IA-02` 一行 + 追加 §附录 F |
| `docs/development/capability-integration-numbering-map.md` | 追加 §9 与 §7 第 16 条 |

**CI-IA-03**（只动菜单定义、1 个叶子标签与三语文案、测试期望；**未新增/删除任何文件**）

| 文件 | 改动 |
| --- | --- |
| `src/lib/console-nav.ts` | `consoleNavItems`：`posts` 由 `publishing` 移入 `creation`（组内最后一条）；文件头注释补 CI-IA-03 说明；该叶子与 `videos` 的归属注释同步 |
| `src/lib/console-nav.test.ts` | `expectedOwnership`：`creation` 追加 `posts`、`publishing` 去掉 `posts`；新增 1 例不变式「CI-IA-03 作者决定」（`posts` 属 `creation`、`videos` 属 `publishing`）；`describe` 标题同步 |
| `src/locales/zh-cn.json`、`zh-hk.json`、`en.json` | `navDynamicPublishing` 显示值改名（动态创作 / 動態創作 / Post Creation）；**key 名零改动、未新增 key** |
| `docs/development/menu-information-architecture.md` | §1–§4、§5.2（#22–24）、§6、§7.2、§8.3、§9（#11）、§11 同步 |
| `docs/menu-inventory.md` | 新增 §2.3（CI-IA-03 之后的运行态分组） |
| `docs/coolpilot-capability-integration-plan.md` | §1 新增 `CI-IA-03` 一行 + 追加 §附录 J |
| `docs/development/capability-integration-numbering-map.md` | 追加 §11 与 §7 第 19 条 |

### 11.2 日志留档位置（仓库外，避免污染工作区）

- `%TEMP%\cp-ia-01\`：`tsc.log`、`vitest-nav.log`、`vitest-full.log`、`eslint-changed.log`、`menu-smoke.log`、`menu-smoke.mjs`。
- `%TEMP%\cp-ia-02\`：`tsc.log`、`vitest-full.log`（exit 0，147 文件 / 1200 用例）、`eslint-changed.log`、`menu-smoke.log`、`menu-smoke.mjs`。
- `%TEMP%\cp-ia-03\`：`menu-smoke.mjs`、`menu-smoke.log`（78/78 通过，exit 0）、`menu-smoke-rerun.log`（同一脚本复跑，78/78 通过，exit 0）、`vitest-full.log`（全量测试复跑留档：`1 failed | 153 passed (154)`、`2 failed | 1263 passed (1265)`）。仓库根**未新增**任何 `tmp-*`。

### 11.3 仍未建立、或刻意不建的菜单（CI-IA-02 复核）

| 未新增的菜单 | Agent 市场 / Workflow 市场 / 模板市场 / 视频创作 / 工作流·自动化任务 / 预算管理 / 用量与调用明细 / 媒体资产（**均无真实页面，按原则 2 不展示**；「扩展市场」只承载今天真实存在的 `/app-store`） |
| CI-IA-03 未新增/未移动 | **未新增任何菜单**；未把「影片发布」移出发布与渠道；未替「内容创作」补建「视频创作」入口（磁盘实测 `(console)` 下只有 `creation/videos` 一个视频页，且它就是三步骤影片发布组装页）；未创建「数据与成本」「扩展市场」「系统设置」的任何占位页 |
| 移动端页签 | 仍 5 个，顺序与桌面组序一致：工作台 · 创作 · 资产 · 发布 · 设置（标签取自 5 个 `navMobile*` 短标签 key）；原为 仪表板 · 创作 · 智能配置 · 发布 · 系统 |
