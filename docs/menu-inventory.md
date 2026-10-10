# CoolPilot 菜单清单（Menu Inventory）

只读盘点：本文档**没有修改任何代码**，只把界面上现有的菜单/导航/页签逐项列出并给出功能简述。
所有项目都带 `file:line` 证据，可逐条回查。盘点基准：Next.js 16.2.4，默认语系 `zh-cn`
（`src/lib/i18n-config.ts:1-3`）。

## 1. 唯一事实来源

| 界面层 | 定义位置 | 说明 |
| --- | --- | --- |
| 桌面侧边栏（含嵌套分组） | `src/components/console-layout-shell.tsx:111-200` | `navItems` 数组是**唯一**的菜单定义处，改名/加项只改这里 |
| 路径匹配与高亮 | 同上 `:202-220` | `segmentMatches` / `entryIsActive` / `activeItem`（取匹配的叶子，找不到回退 `navItems[0]`＝仪表板） |
| 分组展开收合与缩排 | 同上 `:318-351` | 有 `children` 的项渲染成按钮（`renderNavEntry`），叶子渲染成 `<Link>` |
| 顶部标题 | 同上 `:459` | header 的 `<h1>` 显示 `activeItem.name`（即当前路由对应的菜单名） |
| 左下角帐号菜单 | 同上 `:413-422`；帐号名/副标题 `:442-443` | 点头像展开 |
| 移动端底部导航 | 同上 `:222-228`（取哪几项）、`:467-472`（渲染） | `md` 断点以下显示 |
| 系统设定页签 | `src/components/settings/settings-tabs.tsx:9,14-21` | 6 个页签 |
| 各菜单落点 | `src/app/[locale]/(console)/**/page.tsx` | 路由 → 页面组件 |
| 菜单文案 | `src/locales/{zh-cn,zh-hk,en}.json` | `nav*` / `settingsTab*` 等 key（本文以 `zh-cn` 为准） |

布局要点：

- 侧边栏在 `md` 以上显示，宽度 260px ⇄ 56px 可收合（`console-layout-shell.tsx:361`）；收合后只剩图标，鼠标悬停用 `title` 显示菜单名。
- `/chatroom` 是**唯一**全宽例外：不套 `main`/header 卡片（`console-layout-shell.tsx:105`、`:453-464`）。
- 菜单的「文字」全部走 i18n，切换语系时菜单名跟着变。
- 行号偏移（2026-10-09，CI-P2-01 选题管理）：`console-layout-shell.tsx` 新增 1 行 `lucide-react` import（第 22 行）与 1 行导航叶子（第 123 行）。
- 行号偏移（2026-10-09，CI-P2-02 品牌资料）：同一文件再新增 1 行 `lucide-react` import（`Tag`，第 42 行）与 1 行导航叶子（第 125 行「品牌资料」）。
  两次累计后：第 42 行之后的引用 +1、第 125 行之后的引用再 +1（本表所有 `file:line` 已按当前文件复核）。
- 行号偏移（2026-10-09，CI-P3-01 研究素材）：同一文件再新增 1 行 `lucide-react` import（`BookMarked`，第 9 行）与 1 行导航叶子（第 128 行「研究素材」）。
  第 9 行之后的引用 +1、第 128 行之后的引用再 +1；叶子数与创作页数各 +1（见 §2）。

## 2. 桌面侧边栏（9 个顶层项 / 30 个可点击叶子）

层级用缩排表示：`└` 为子项，`　└` 为嵌套分组的子项；「分组」项本身点击只展开/收合，不跳页。

| 菜单 | i18n key | 路由 | 图标 | 功能简述 |
| --- | --- | --- | --- | --- |
| 仪表板 | `navDashboard` | `/dashboard` | House | 四张概览卡（网站、内容项目、进行中执行、启用中排程）+ 最近执行列表，卡片可点进对应页面 |
| 聊天 | `agentChatShortTitle` | `/chatroom` | MessageCircle | ChatGPT 式 Agent 对话：`@` 指定目标网站，讯息与工具调用存本机 SQLite；全宽布局 |
| 数据中心 | `navDataCenter` | `/data-center` | Database | 全局数据总览：KPI（阅读/播放、互动、粉丝、互动率、完播率）、平台概览、内容排行、增长趋势、AI 覆盘、指标编辑与同步／CSV 汇出 |
| 创作（分组） | `navCreation` | —（组首子项 `/creation/ai-writing`） | PenSquare | 内容生产入口：10 个创作页 + 1 个嵌套分组「智能画布」 |
| └ AI写作 | `navAiWriting` | `/creation/ai-writing` | Sparkles | 三步产出文章：选择素材 → 写作配置（风格/行业/字数/受众/平台/关键词/语言/图片策略/去 AI 味/知识库/定位/品牌资料）→ 生成文章，可存内容库或进编辑器；带 `?topicId=` 打开时以该选题为素材（CI-P2-01），选中的品牌资料会进入生成上下文并记录版本（CI-P2-02） |
| └ 选题管理 | `navTopics` | `/creation/topics` | Lightbulb | 选题库增删改查（标题/描述/关键词/来源/来源连结/状态），按关键词搜索与状态筛选、归档与恢复、从热点导入；每行可「开始创作」（带 `?topicId=` 进 AI 写作向导）或打开它产出的文章 |
| └ 品牌资料 | `navBrands` | `/creation/brands` | Tag | 品牌库增删改查（名称/简介/目标受众/语气/关键词/禁用表达），按名称与关键词搜索；「选择」在 AI 写作向导的写作配置里完成（品牌资料是生成输入，不是这里的选择），与「系统设定 → 品牌」（logo/配色/Agent 提示词的单例）是两件事（CI-P2-02） |
| └ 研究素材 | `navResearch` | `/creation/research` | BookMarked | 研究素材库增删改查（标题/类型/正文/来源连结/标签）+ 导入本地文件 + 「读取来源」抓取网页正文，按标题正文来源搜索、按处理状态筛选；类型（文本/网页/文件/音频/视频）与处理状态（待读取/正文就绪/读取成功但无正文/读取失败）都按真实结果记录，「读取失败」不会伪装成已抓到正文；每行可「用此素材创作」（带 `?researchMaterialId=` 进文章创作并打开 AI 生成对话框，正文由服务端读出：CI-P3-01）；页面中部「音视频转录」面板（CI-P3-02）：选已导入的音/视频文件 + 引擎（可用性先由 `GET /api/transcription/providers` 问一次，不可用会显示原因与回退顺序）→ 提交后跟随 `GET /api/tasks/{id}` 的真实进度、状态原文与日志，完成后出现「查看转写」与最近任务列表；带转写的行多一个转写按钮，打开「转写内容」对话框：上方是引擎原始分段（引擎报了时间位置才显示时间戳，没报就直说），下方是可编辑正文，保存只写正文、不覆盖引擎记录（CI-P3-02）；每行还有一个「研究提炼」按钮，打开对话框可对这份正文跑一次提炼（摘要 / 核心观点 / 带原文片段的事实与引述 / 选题建议，逐项可编辑保存、可重新生成，版本历史与「素材改过、提炼是旧的」都按数据判断，不从模型话里采信：CI-P3-03）；把提炼带进文章的入口是 `?researchMaterialId=&includeExtraction=1`（正文 + 提炼一起进 prompt），用过的素材与提炼版本可在内容库「内容详情」的「研究来源」一栏回看（CI-P3-03） |
| └ 产品管理 | `navProductManagement` | `/creation/products` | Package | 产品资料库增删改查（名称/品牌/分类/关键词/图片/连结），可按有无图片筛选，供知识库与配图取材 |
| └ 文章创作 | `navArticleCreation` | `/creation/articles` | Newspaper | 文章列表（标题/字数/配图/来源/状态）+ 全文编辑器（改稿、排版、翻译、发布）与 AI 生成文章（生成前可选「选题库」与「品牌资料」，两者会被服务端读出并进入生成上下文，文章记下来源与品牌版本：CI-P2-03） |
| └ 动态发布 | `navDynamicPublishing` | `/creation/posts` | Send | 图文动态撰写：文案 + 从配图库挑图，勾选多个平台帐号一次发布 |
| └ 影片发布 | `navVideoPublishing` | `/creation/videos` | Video | 上传影片（格式/大小校验）+ 标题/描述/可见性，三步骤（内容/平台/检视）后多帐号发布 |
| └ 配图管理 | `navImageManagement` | `/creation/images` | Image | AI 生图（提示词驱动）+ 图库名称搜索（模糊/精确）、分页与批量删除 |
| └ 内容中心 | `navContentCenter` | `/content/library` | Library | 素材库：手动建立／AI 生成／撷取网址，标题搜寻、来源与日期筛选、格状/列表视图、详情与「草稿/已就绪」状态 |
| └ 智能画布（嵌套分组） | `navDrawing` | —（组首子项 `/whiteboard`） | Brush | 画布类工具分组 |
| 　└ 白板 | `navWhiteboard` | `/whiteboard` | PenTool | 自由绘制白板（客户端动态载入，`ssr:false`） |
| 　└ 思维导图 | `navMindMap` | `/mindmap` | Network | 思维导图编辑画布（同上，客户端动态载入） |
| 应用商店 | `navAppStore` | `/app-store` | Store | 写作智能体商店：浏览／我发布的、分类与搜寻排序（推荐/最新），标官方/自发布；条目由「帐号定位」的「发布到商店」提交 |
| 智能配置（分组） | `navSmartConfig` | —（组首子项 `/smart-config/positioning`） | Settings2 | 定位与知识两类「配置」入口 |
| └ 帐号定位 | `navAccountPositioning` | `/smart-config/positioning` | Target | 定位档案 7 页签（基础定位/人设/写作管控/内容策略/平台定制/RSS/绑定帐号），支持 AI 建档、设为预设、发布到商店 |
| └ 知识库 | `navKnowledgeBase` | `/smart-config/knowledge-base` | BookOpen | 本地知识库（条目管理、智能入库、上传文件、产品导入）+ 外部知识库·Dify 连接与检索设置 |
| 自动化（分组） | `navAutomation` | —（组首子项 `/schedules/list`） | Workflow | 排程、日历、日志与执行入口 |
| └ 排程 | `navSchedules` | `/schedules/list` | CalendarClock | 排程列表（启用/暂停、下次执行、时间规则：单次/每日/每周/每月/固定间隔）+ 建立排程对话框 |
| └ 内容日历 | `navContentCalendar` | `/schedules/calendar` | CalendarDays | 月历视图整合「计划／执行／发布」三类纪录，含当日计划、即将执行与 KPI，可用最佳时段直接建立排程 |
| └ 产生记录 | `navGenerationRecords` | `/automation/generations` | History | 已生成内容的记录列表（每 5 秒刷新、分页） |
| └ 营运日志 | `navOperationLogs` | `/automation/logs` | ScrollText | 最近执行项目与其事件日志（2–3 秒刷新）；空态可直接跳到「执行」 |
| └ 执行节点 | `navExecutionNodes` | `/automation/nodes` | Globe2 | 执行终端可用性清单：Web 工作台（可用）、Windows 桌面端与 Linux 自托管节点（未配置） |
| └ 执行 | `navRuns` | `/runs/queue` | Play | 执行伫列：选帐号/剧本/参数 JSON 加入伫列（可仅模拟执行）；正式发布须先勾选前端确认，并可建立每日排程 |
| 发布（分组） | `navPublishing` | —（组首子项 `/publishing/accounts`） | Rocket | 帐号与发布结果两类入口 |
| └ 帐号管理 | `navAccountManagement` | `/publishing/accounts` | Users | 平台帐号增删改查/登入、状态（已登入/待登入/已暂停）、分组、保湿度、批量同步、帐号预设（标签/分类/可见性/受众/描述模板）与 CMS 站点 |
| └ 发布记录 | `navPublishRecords` | `/publishing/records` | ListChecks | 发布结果审计：统计（记录/已发布/运行中/失败）、按平台/状态/类型/发布方式/执行终端/日期筛选、搜寻、汇出、详情、开连结与批量删除 |
| 系统（分组） | `navSystem` | —（组首子项 `/system/models`） | Settings | 模型、AI 成本与质量优化中心、设定与工作区入口 |
| └ 模型管理 | `navModelManagement` | `/system/models` | Boxes | 5 页签：可用模型（网关目录，可复制 model id/厂商文件/API Key/相容端点）、模型注册表、供应商与密钥、模型配置、**价格目录**（CI-P7-01-05：只增不改的单价；允许录文本 token 价与生效时间，维度不匹配的价一律拒收，其他计量维度显示「尚未定价」） |
| └ AI 成本与质量优化中心 | `navAiCostCenter` | `/system/cost-center` | WalletCards | 4 页签：**成本总览**（CI-P7-02 已落地：按币种分别核算的 API 成本、账本 token、成功交付产出、单篇平均成本、金额四态来源、按业务类型/模型/本机日历日分解、价格目录覆盖，并把文章数/字数降级为辅助产出指标）、调用明细（CI-P7-02-04/05，未开工）、预算与预估（CI-P7-03，未开工）、质量与优化（CI-P7-04，未开工）。原「用量统计」页（`/system/usage`）已保留为重定向 |
| └ 系统设定 | `navSettings` | `/settings` | SlidersHorizontal | 6 页签：执行环境、权限、语言、品牌、提示词、备份（见 §4.1） |
| └ 工作区 | `navWorkspace` | `/system/workspace` | HardDrive | 只读工作区报告：位置、工作区里有什么、需要留意项与读取时间；只有「重新整理」，不移动/改名/删除任何档案 |

统计：顶层 **9** 项（4 个单页：仪表板/聊天/数据中心/应用商店，5 个分组：创作/智能配置/自动化/发布/系统），
可点击叶子 **30** 项，其中「智能画布」是唯一嵌套在分组内的分组（`console-layout-shell.tsx:135-145`）。

> 注：「系统」组的子项顺序是刻意的——`console-layout-shell.tsx:193-195` 的注释说明，移动端「系统」页签会打开该组的
> **第一个**子项（`leafHref`，`:211-213`），所以「工作区」被放在最后以免改变那个页签原本的落点。

### 2.1 CI-IA-01 之后的运行态分组（2026-10-10 起；唯一事实来源 `src/lib/console-nav.ts`）

上表 §2 是**改动前**的只读盘点，原样保留作为历史证据。

### 2.2 CI-IA-02 之后的运行态分组（2026-10-10，商业排序 + 改名）

CI-IA-01 曾按 8 个业务分组渲染（工作台 / 数据与资产 / 内容创作 / 发布与渠道 / 自动化 / 应用与市场 / 运营管理 / 系统设置）。CI-IA-02 **只改组序与显示值**，落定为：

| 位置 | 组（i18n key） | 子项（按渲染顺序） | 叶子数 |
| --- | --- | --- | --- |
| 1 | 工作台 `navWorkbench` | 仪表板 · AI 对话 | 2 |
| 2 | 内容创作 `navCreation` | AI 写作 · 选题管理 · 文章创作 · 配图创作 · 智能画布（白板 / 思维导图） | 6 |
| 3 | 品牌与资产 `navDataAssets`（原「数据与资产」） | 内容中心 · 研究素材 · 品牌资料 · 帐号定位 · 知识库 · 产品管理 | 6 |
| 4 | 发布与渠道 `navPublishing` | 帐号管理 · 动态发布 · 影片发布 · 发布记录 · 发布排程 · 内容日历 | 6 |
| 5 | 自动化 `navAutomation` | 运行队列 · 执行历史 · 执行节点 | 3 |
| 6 | 数据与成本 `navOperations`（原「运营管理」） | 数据中心 · 生成记录 · AI 成本中心 | 3 |
| 7 | 扩展市场 `navAppMarket`（原「应用与市场」） | 应用商店 | 1 |
| 8 | 系统设置 `navSystem` | 模型管理 · 通用设置 · 工作区 | 3 |

- **路由集合仍与 §2 的 30 条逐条相同**：CI-IA-02 没有新增、删除或改写任何 `href`（旧→新逐项映射见 `docs/development/menu-information-architecture.md` §4；CI-IA-02 的变化见同文件 §4.1）。
- CI-IA-01 改了 9 处显示名；CI-IA-02 再改 6 处显示名（品牌与资产 / 数据与成本 / 扩展市场 / AI 对话 / 生成记录 / AI 写作），**i18n key 全部未改**。详见同文件 §6。
- 移动端底部仍是 5 个页签，顺序跟随新组序：工作台 · 创作 · 资产 · 发布 · 设置；标签改用 CI-IA-02 新增的 5 个 `navMobile*` 短标签 key（见 §4）。
- 下面 §3 帐号菜单与 §4 全宽路由清单**未随本卡改动**（本卡只动菜单定义与文案）。


### 2.3 CI-IA-03 之后的运行态分组（2026-10-10，动态创作归入内容创作）

CI-IA-03 **只改 1 条叶子的归属与显示名**（作者直派）：`/creation/posts` 由「发布与渠道」移入「内容创作」（组内最后一条），显示名「动态发布」→「动态创作」。完整归属仍以 `src/lib/console-nav.ts` 为唯一事实来源：

| 位置 | 组（i18n key） | 子项（按渲染顺序） | 叶子数 |
| --- | --- | --- | --- |
| 1 | 工作台 `navWorkbench` | 仪表板 · AI 对话 | 2 |
| 2 | 内容创作 `navCreation` | AI 写作 · 选题管理 · 文章创作 · 配图创作 · 智能画布（白板 / 思维导图）· **动态创作**（`/creation/posts`，原属发布与渠道） | **7** |
| 3 | 品牌与资产 `navDataAssets` | 内容中心 · 研究素材 · 品牌资料 · 帐号定位 · 知识库 · 产品管理 | 6 |
| 4 | 发布与渠道 `navPublishing` | 帐号管理 · **影片发布**（`/creation/videos`，刻意保留） · 发布记录 · 发布排程 · 内容日历 | **5** |
| 5 | 自动化 `navAutomation` | 运行队列 · 执行历史 · 执行节点 | 3 |
| 6 | 数据与成本 `navOperations` | 数据中心 · 生成记录 · AI 成本中心 | 3 |
| 7 | 扩展市场 `navAppMarket` | 应用商店 | 1 |
| 8 | 系统设置 `navSystem` | 模型管理 · 通用设置 · 工作区 | 3 |

- **路由集合仍与 §2 的 30 条逐条相同**（含 `/creation/posts` 本身）：CI-IA-03 没有新增、删除或改写任何 `href`；页面、权限、API、数据库与业务逻辑零改动。
- 显示名「动态发布」→「动态创作」（三语：动态创作 / 動態創作 / Post Creation），**i18n key 名未改**（仍是 `navDynamicPublishing`），未新增 key。
- 移动端底部仍是 5 个页签，顺序与 5 个落点**均未变**（`creation` 首项仍是 `/creation/ai-writing`，`publishing` 首项仍是 `/publishing/accounts`）。
- 为何「动态创作」随本卡移动、而「影片发布」不动：见 `docs/development/menu-information-architecture.md` §5.2 #22（作者明示：「影片发布」保留在发布与渠道）。


## 3. 左下角帐号菜单（点头像展开，7 项）

定义：`console-layout-shell.tsx:413-422`（点外空白或按 Esc 关闭，`:266-284`）。

| 菜单 | i18n key | 路由 | 图标 | 功能简述 |
| --- | --- | --- | --- | --- |
| 模型管理 | `navModelManagement` | `/system/models` | Boxes | 与侧边栏「系统 → 模型管理」同一页（快捷入口） |
| 工作区 | `navWorkspace` | `/system/workspace` | HardDrive | 只读工作区报告 |
| 权限 | `settingsTabPermissions` | `/settings/permissions` | ShieldCheck | 哪些本机 agent 操作可免确认（自动批准/每次确认） |
| 语言 | `settingsTabLanguage` | `/settings/language` | Globe2 | 界面语言（简体中文/繁體中文/English） |
| 品牌 | `settingsTabBrand` | `/settings/brand` | WalletCards | 品牌信息与 logo 等写作素材设定 |
| 提示词 | `settingsTabPrompt` | `/settings/prompt` | MessageCircle | 各场景的系统提示词 |
| 备份 | `settingsTabBackup` | `/settings/backup` | Database | 汇出/还原本机资料 |

## 4. 移动端底部导航（`md` 断点以下，5 项）

> 下表是 **CI-IA-02 之前**的状态（行号为当时的 `console-layout-shell.tsx`），保留作历史证据；当前状态见 §4.1。
> 定义位置：取哪几项（`mobileMenuItems` 的组 id 列表）与渲染（底部 `nav[class*='md:hidden']`）。

### 4.1 CI-IA-02 之后的移动端（2026-10-10）

| 顺序 | 页签标签（`navMobile*`） | i18n key | 对应分组 id | 点击落点（`leafHref`＝组内第一个子项） |
| --- | --- | --- | --- | --- |
| 1 | 工作台 | `navMobileWorkbench` | `workbench` | `/dashboard` |
| 2 | 创作 | `navMobileCreation` | `creation` | `/creation/ai-writing` |
| 3 | 资产 | `navMobileAssets` | `assets` | `/content/library` |
| 4 | 发布 | `navMobilePublishing` | `publishing` | `/publishing/accounts` |
| 5 | 设置 | `navMobileSystem` | `system` | `/system/models` |

- 页签顺序 = 组序（`workbench` · `creation` · `assets` · `publishing` · `system`），由 `consoleMobileNavIds` 决定。
- 标签**不再复用桌面组名**，改用独立的 5 个短标签 key（桌面组名如「品牌与资产 / 发布与渠道 / 系统设置」在窄屏会被截断）；`console-nav.ts` 的 `mobileLabelKey` 经 `labelConsoleNav` 解析为 `mobileName`，由 `console-layout-shell.tsx` 读取。
- 落点仍是「组内第一个子项」：`assets` 组现处于第 3 位，但组内首项仍是「内容中心」，所以第 3 个页签落点由旧的 `/smart-config/positioning` 变为 `/content/library`（这是组序变更的必然结果，不是新逻辑）。
- `system` 组内顺序刻意保持「模型管理」在首（见 §2 注），移动端「设置」页签因此仍落在 `/system/models`。

说明：移动导航只放这 5 项（不是 9 项），数据中心/聊天/应用商店/自动化没有底部页签，需从桌面版或直接输入路径进入。

## 5. 页面内二级页签（属于「菜单」范畴，但不是侧边栏）

### 5.1 系统设定 —— `/settings`（6 页签）

定义：`settings-tabs.tsx:9`（顺序）、`:14-21`（路径）。

| 页签 | i18n key | 路由 | 功能简述 |
| --- | --- | --- | --- |
| 执行环境 | `settingsTabRuntime` | `/settings` | 本机 agent 执行环境与默认模型等 |
| 权限 | `settingsTabPermissions` | `/settings/permissions` | 逐项操作的自动批准/每次确认 |
| 语言 | `settingsTabLanguage` | `/settings/language` | 界面语言 |
| 品牌 | `settingsTabBrand` | `/settings/brand` | 品牌资料与素材 |
| 提示词 | `settingsTabPrompt` | `/settings/prompt` | 场景提示词 |
| 备份 | `settingsTabBackup` | `/settings/backup` | 汇出/还原 |

### 5.2 其余页面内页签与步骤

| 页面 | 页签/步骤 | 证据 |
| --- | --- | --- |
| 模型管理 | 可用模型 / 模型注册表 / 供应商与密钥 / 模型配置 | `system/model-management-client.tsx:360-365`；以 `?tab=` 决定初始页签，`system/models/page.tsx:3-8` |
| 帐号定位 | 基础定位 / 智能体人设 / 写作管控 / 内容策略 / 平台定制 / RSS 订阅 / 绑定帐号 | `src/lib/positions.ts` `positionTabIds` |
| 知识库 | 本地知识库 / 外部知识库 · Dify | `kbTabLocal` / `kbTabExternal` |
| 应用商店 | 浏览 / 我发布的 | `app-store/page.tsx` `storeTabs`；`appStoreTabBrowse` / `appStoreTabMine` |
| 数据中心 | 看板 / 覆盘 | `metricsTabBoard` / `metricsTabRetro` |
| AI写作 | 步骤：选择素材 / 写作配置 / 生成文章 | `src/lib/ai-writing.ts` `aiWritingStepIds` |
| AI写作 · 素材来源 | 热点新闻 / 产品选择 / 自由创作 | 同上 `materialSources` |
| 影片发布 | 步骤：内容 / 平台 / 检视 | `videos-composer.tsx` `vcTabContent` / `vcTabPlatform` / `vcTabReview` |
| 内容中心 | 检视模式：格状 / 列表（另有来源、日期区间筛选） | `content/library/page.tsx` `contentGridView` / `contentListView` |
| 发布记录 | 筛选器：平台 / 状态 / 类型 / 发布方式 / 执行终端（各含「全部」） | `publishRecordFilter*` 系列 key |

## 6. 没有菜单入口的路由（盘点记录）

| 路由 | 行为 | 证据 |
| --- | --- | --- |
| `/schedule` | 重定向到 `/schedules/list`（旧路径别名，`navItems` 里没有它） | `app/[locale]/(console)/schedule/page.tsx` |
| `/settings/[tab]` | `tab` 为 `ai`/`providers` 或任何未知值时重定向回 `/settings`；`brand`/`prompt` 走另一支客户端，`backup` 单独一支 | `settings/[tab]/page.tsx:21-37` |
| `/content/library` | 挂在「创作」组下（id=`content-center`），但路径不带 `/creation` 前缀 | `console-layout-shell.tsx:131` |
| `/whiteboard`、`/mindmap` | 属于嵌套分组「智能画布」 | `console-layout-shell.tsx:132-142` |

## 7. 盘点发现（只报告，未改动任何文件）

1. **帐号菜单副标题固定显示「系统设定」**：`console-layout-shell.tsx:354` 把 `accountPlan` 设为 `t("navSettings")`、`:443` 把它渲染成副标题，
   所以头像下方永远是「系统设定」而不是套餐/环境信息——读起来像占位文案。
2. **两个 i18n key 已无人引用**：`navSites`、`navContent`（`src/locales/zh-cn.json:5-6` 等三份语系皆有定义），
   在 `src/**/*.{ts,tsx}` 内没有 `t("navSites")`/`t("navContent")` 引用（`navWhiteboard`/`navSettings`/`navContentCalendar`/`agentChatShortTitle` 仍在用）。
3. **「聊天」菜单名与页面标题不同**：菜单用 `agentChatShortTitle`（「聊天」），页面自身标题为 `agentChatTitle`（「Agent 聊天室」）；
   而顶部 header 显示的是 `activeItem.name`，因此进入该页时标题栏显示「聊天」。
4. **新增页面若不挂进 `navItems`，顶部标题会回退成「仪表板」**：`activeItem` 在匹配不到叶子时回退 `navItems[0]`（`:216`）。

## 8. 维护提示（改菜单时动这里）

- 增删/改名/换图标/换路径：只改 `console-layout-shell.tsx:111-200` 的 `navItems`，文案加在 `src/locales/*.json`。
- 想让某页进入顶部标题与高亮：确保它的 `segment` 能被 `segmentMatches`（`:202-204`）匹配到。
- 新增「系统设定」页签：改 `settings-tabs.tsx:7-21` 与 `src/app/[locale]/(console)/settings/[tab]/page.tsx` 的分支。
- 新增移动端页签：改 `console-layout-shell.tsx:223` 的 id 清单（注意它取的是组内第一个子项）。

