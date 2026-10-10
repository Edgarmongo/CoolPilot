# F2 契约决策单（F2-2 / F2-3 / F2-7）

> **用途**：把三件"技术侧不应自行选边"的事变成可签字的一页纸。每张单只回答**产品要不要、要哪一种**，不含实现。
> **依据**：`docs/e2e-stage2-execution-record.md`（阶段 2 发现 F2-2/F2-3/F2-7）+ 本轮静态复核（文件:行号）。
> **边界**：本文件只**新增**；未改任何源码；未触发发布/模型调用。实现由 `docs/e2e-fix-01-publish-contract-review.md` 之后的实施卡承接。
> **填法**：在每张单末尾的"决策"栏写 `A` / `B` / `C` / `D` 与签字人；未签字即视作"维持现状"。

## 决策记录（已签字）

| 事项 | 决策 | 一句话依据 | 实施去向 |
| --- | --- | --- | --- |
| **F2-1** 发布结果契约 | **A**（保留 HTTP 200 兼容语义 + 顶层业务汇总 + 异常响应契约） | 调用方只有仓库内 2 处 UI，`apiPost` 判定依据是 `body.ok` 而非状态码；改状态码会连带弄坏多组发布 | `docs/e2e-fix-01-implementation-card.md`（阶段 A→D） |
| **DS-1 / F2-2** 删除后关联记录 | **A**（保留，不级联） | 发布与用量是"事实台账"；与 `publish-facts.ts:38-40` 既有设计一致 | 文档化（执行顺序 2），无数据变更 |
| **DS-2 / F2-3** 引用解析契约 | **B**（只解析、不保证存在；不加 `exists`、不改 404） | 该路由是纯解析层，仓库内无消费者；存在性校验留给未来的显式能力 | 契约文档化（执行顺序 2） |
| **DS-3 / F2-7** 降级可见性 | **C**（在响应中暴露降级状态） | `route.requirement` 在运行时层已可见，缺的只是 HTTP 边界透传 | 设计 + 实施另卡（执行顺序 3）：先盘点 5 处 `chatStructured` 调用方，定字段形态与兼容方式 |

**本轮共同边界（随决策一并生效）**
1. 不改变已冻结的 C2 辅助发布语义（`publish/draft`、`publish/verify`、`publish-facts.ts`）；
2. 不在没有幂等键与恢复策略的前提下**自动重试**可能已产生平台侧副作用的发布批次；
3. 不改数据库 schema、不清理成本台账、不处理与本轮无关的临时探针脚本；
4. 不执行 `git add` / `git commit`；
5. 每项修改都要有**定向测试与回归结果**，不以 TypeScript 检查代替业务契约验收。

**执行顺序（已确认）**：① F2-1 发布提示修正与契约测试 → ② DS-1 / DS-2 文档化 → ③ DS-3 降级信息设计与实施 → ④ 集中回归（定向 + 全量 + 工作区状态与数据副作用核对）。真实平台发布成功分支仍独立等待凭据与授权，不计入已通过的验收范围。

**实施进度（2026-10-09）**：F2-1 **阶段 A 已完成并验收**（`posts-composer` / `videos-composer` 的成功提示改为按批次判定、并在未成功时保留表单；新增纯函数模块 `src/lib/publish-results.ts` 与 `src/lib/publish-groups.ts` 及其 13 条单测）。四项评审裁决**全部通过**：① `summary.other` 保留（**不采用**"未知状态计入 `failed`"的退路）；② `errorKind` 提前到 A0；③ 非成功时保留表单；④ `ConsoleNotice` 增 `warning`——裁决与落地情况见实施卡 §9.1。**阶段 B 已完成**：新增 `src/app/api/publish/route.test.ts`（7 用例）按 T1–T6、T8/B4 **锁定现状**（T6 为"异常离开 handler ⇒ 裸 500"的前置快照，是阶段 C 唯一预期被改写的用例；`login_required` 走真实 `saveAccountHealthSnapshot` 路径）；`vitest run src/app/api/publish` = 3 文件 / 29 用例全绿，`tsc --noEmit` 与 `eslint` 无错，临时库隔离与真实开发库未变均有跑前跑后比对证据（实施卡 §9）。**阶段 C 已完成**（2026-10-09）：`POST /api/publish` 逐账号 `try/catch`（异常不中断整批，异常账号以"标记而非替换"入 `results`）+ 顶层 `summary`（复用 `summarizePublishResults`）+ Case B 结构化错误 `500 PUBLISH_RUN_FAILED`（`details = { results, summary, retrySafe: false }`）；`app-errors.ts` 与三份语言文件同步新增该错误码；`posts-composer` 的 `catch` 合并 `details.results` 并按 `error_<CODE>` 出文案；`videos-composer` 无需改动（多分组的 `details.results` 已由 `publishGroups` 合并）。**T6 按约定改写，T1–T5 / T8 的既有断言一字未改**（只追加 `summary` 断言）——这是方案 A 兼容性的直接证据。定向 5 文件 / 45 用例、扩展回归 65 文件 / 483 用例全绿，`tsc --noEmit` 与改动文件 `eslint` exit 0，工作区 `*.db` 前后完全一致。阶段 D（全量回归 + 手工核对 M1–M4 + 打包态冒烟）**未开始**；真实平台发布成功分支仍需凭据与授权。证据见 `docs/e2e-fix-01-implementation-card.md` §9 / §9.1 / §9.2。

---

## DS-1（F2-2）删除内容后，`publish_records` / `usage_records` 留还是删？

**现象（实测）**
- 删除内容项**不级联**：关联行保留，`content_item_id` 变成悬空引用。
- 证据：E2E-04 step 5 `publishRowCascadedWithContent=false`（内容删除后失败记录仍在）；E2E-01 step 8 `usage_records=15`（内容已删但用量行保留）。见 `tmp-p1-05-e2e04.log.json:125-161`。

**事实（代码）**
| 事实 | 位置 |
| --- | --- |
| schema **没有声明外键**（`account_id` / `content_item_id` 都是普通 `text` 列） | `src/db/schema.ts:181-208`（发布记录）、`:241-254`（用量记录）；全仓唯一 `PRAGMA` 用法是表结构自省 `src/db/client.ts:502` |
| 删除只删一张表，**只有一句 SQL** | `src/db/repository.ts:487-490` |
| 已有**手工**清理出口：`DELETE /api/publish-records/[id]`，界面入口也在 | `src/app/api/publish-records/[id]/route.ts:29-37`、`src/app/[locale]/(console)/publishing/records/page.tsx:210` |
| `usage_records` **没有任何删除接口**（纯台账） | 全仓无 `deleteUsageRecord` |
| 辅助发布的设计注释**明确要求保留**："内容在 draft 与 verify 之间被删除时记录仍保留，因为发布确实发生过" | `src/lib/publish-facts.ts:38-40` |
| worker 路径（`threads_auto_post`）写 `posted` 但**不写**发布记录 | `src/lib/threads.ts:126` |

**受影响面**：发布记录页（按 `content_item_id` 关联）、指标同步/回填（`publish_records` → `metric_snapshots`）、成本报表、备份恢复审计（`docs/backup-restore-audit.md` 记录过"发布事实丢失会被重复发布"）。

**选项**
| 选项 | 做法 | 代价 | 与现有设计的关系 |
| --- | --- | --- | --- |
| **A. 保留并显式承认** | 不动数据；在文档 + 发布记录页标注"来源内容已删除"，把悬空引用变成**已知语义** | 需要 UI/文案工作 | **与 `publish-facts.ts:38-40` 既有设计一致**（推荐起点） |
| **B. 置空关联** | 删除内容时 `UPDATE ... SET content_item_id = NULL`（或 `''`）；行数与成本仍保留 | 需要一次"删除时写关联表"的实现；与"记录描述当时发生的事"略有张力 | 需新增一条跨表写入（无 schema 变更） |
| **C. 级联删除** | 删除内容时连带删除发布/用量行 | 会抹掉审计与成本事实；且与 `publish-facts.ts` 注释直接冲突，须先改那条设计声明 | 破坏面最大 |
| **D. 软删除** | `content_items` 加 `deleted_at`，记录不悬空 | 需要 schema 变更 + 全部查询加过滤 | 改数据模型，成本最高 |

**需要产品回答**
1. 发布记录与用量记录是**台账事实**还是**用户数据**？
2. 用户删除内容后，期望在发布记录页看到这些行吗？（看到时是否要标"来源已删除"？）
3. 成本/审计的保留期限是多少（是否允许用户清空）？

**决策**：**☑ A（保留关联历史记录，不级联）**　签字人：产品 / 负责人　日期：2026-10-09
**决策后的技术动作**：A=文档 + UI 文案（无数据变更）；B=`deleteContentItem` 内追加上下文置空（无 schema 变更）；C=改删除实现 **且** 修订 `publish-facts.ts` 的设计声明；D=迁移 + 全查询过滤（另立卡）。
**未决策前兜底**：**不改**（当前行为与既有设计一致；阶段 2 已如实记录为 F2-2 观察项）。

---

## DS-2（F2-3）`?ref=` 指向不存在的媒体时，应该 404 还是"解析成功"？

**现象（实测）**
- `GET /api/media/assets?ref=<不存在的名字>` → **200**，并**合成**一个引用对象：`source:"unknown"`、`mimeType` 按扩展名猜、`url` 指向一个会 404 的地址。见 E2E-02 step 5。
- 调用方**无法仅凭响应**区分"引用格式有效"与"资源真实存在"。

**事实（代码）**
| 事实 | 位置 |
| --- | --- |
| 该路由是**纯解析、不读盘**（三条契约：列表 / 按 ref / 按 ref+root） | `src/app/api/media/assets/route.ts:15-17`；实现 `src/lib/media-artifact-ref.ts` |
| 仓库内**无消费者**（grep `api/media/assets` 只命中该 route 自身）→ 影响面是外部/未来调用方 | 本轮 grep |
| 相邻问题 F2-4：无 `ref` 时 `?root=videos` 被**静默忽略**（仍返回全部 45 条）；列表**无分页/无筛选** | E2E-02 step 4 |

**受影响面**：媒体引用解析的未来消费方（编辑器/发布前校验）；当前无仓库内调用方，所以**改契约的即时风险低**，但改完会固定成对外语义。

**选项**
| 选项 | 做法 | 代价 |
| --- | --- | --- |
| **A. 增加 `exists` 字段** | 保留 200，路由内做一次存在性检查并回传 `exists:false` | 让"解析层"开始读盘，改变分层（性能与职责） |
| **B. 契约声明"只解析、不保证存在"** | 不改行为；在契约文档写明，消费方在 404/`source:"unknown"` 时降级 | 调用方必须自己判存在；纯文档变更，成本最低 |
| **C. 不存在返回 404** | 需要同时定义"`ref` 语法无效"是 400 还是 404 | 破坏"用 ref 查元数据"的现有用法（如果外部已依赖） |
| **D. 拆成两个入口** | 解析接口不变，新增"存在性校验"查询 | 多一个接口要维护 |

**需要产品回答**
1. 调用方需要的是"引用**格式**有效"还是"资源**存在**"？
2. 是否允许解析层读盘（分层/性能取舍）？
3. `root` 与 `ref` 的关系：带 `root` 而不带 `ref` 时，是 400（与 `root=bogus` 的 400 一致）还是允许列全部？
4. F2-4 的筛选/分页是否本次一并定（否则媒体列表会随文件数增长持续膨胀）？

**决策**：**☑ B（只解析、不保证存在）**　签字人：产品 / 架构　日期：2026-10-09
**决策后的技术动作**：A=路由增加存在性检查字段（响应向后兼容）；B=只改契约文档 + 消费方降级；C=改状态码并同步调用方；D=新增只读入口。
**未决策前兜底**：**不改**；仅在契约文档补一句"该接口只做引用**解析**，**不保证存在**"（若 B 被选，即此一步）。

---

## DS-3（F2-7）`chat` 可用 ≠ `structured_output` 可用：降级要不要对外可见？

**现象（实测）**
- 能力盘点：`structured_output` 在 195 个模型行中**可调用数 = 0**；设置里 `defaults = {}`、`preferences = []`（无默认模型、无偏好）。
- 但 E2E-01 的 `POST /api/content/generate` **成功**产出真实正文（走的是 `chatStructured`）→ 说明请求被**降级**执行，而外部无法从响应判断。

**事实（代码）**
| 事实 | 位置 |
| --- | --- |
| 运行时**有意**的两级降级：`strict`（含 `structured_output`）解析不到 → 退到只要求入口能力（`chat`） | `src/features/ai-runtime/runtime.ts:36-64`（:51-63 的 fallback 构造） |
| 降级**在运行时层可见**：`route.requirement` = "实际被强制执行的要求" | `src/features/ai-runtime/registry.ts:301-302,437`；随 `StructuredChatResponse.route` 返回（`runtime.ts:370`） |
| 但 **HTTP 边界不回传**：文章生成只取 `providerId/model/usage` 落库，路由只 `ok(result,{status:201})` | `src/lib/article-generation.ts:131-160`、`src/app/api/content/generate/route.ts:85` |
| 受同一降级影响的 `chatStructured` 调用方（5 处） | `content/generate`（经 `article-generation.ts:131`）、`content/[id]/translate/route.ts:52`、`knowledge-base/ai-parse/route.ts:58`、`metrics/insights/route.ts:48`、`positions/generate/route.ts:55` |
| 校验失败有明确错误（**不是**降级）：两次解析都不通过 → `AI_STRUCTURED_OUTPUT_INVALID`（502） | `src/features/ai-runtime/runtime.ts:388-400` |

**受影响面**：所有要求结构化输出的生成路径（文章正文、翻译、知识解析、指标洞察、定位生成），以及"这次结果是**降级成功**还是**真结构化成功**"的外部可判断性。

**选项**
| 选项 | 做法 | 代价 |
| --- | --- | --- |
| **A. 只补配置/元数据** | 给模型补 `structured_output` 能力声明或设置默认模型，让 strict 能命中 | 不改代码，但依赖模型真实支持；不解决"外部看不见降级" |
| **B. 服务端记录** | 契约不变，把 `route.requirement` 写进日志/运行事件 | 外部仍不可判断，仅内部可追溯 |
| **C. 响应回传降级标记** | 生成响应增加 `degraded` / `runtime.route.requirement` 字段（向后兼容的新增字段） | 需改动多个路由的响应形状（建议单独一张卡，逐路由评审） |

**需要产品回答**
1. 哪些功能**必须**真结构化输出（无能力时应当**报错**，而不是降级）？
2. 哪些功能允许降级，但**必须告知**调用方/用户？
3. 降级状态是否必须出现在 **API 响应**里（即选 C），还是内部日志即可（选 B）？
4. `defaults`/`preferences` 为空是**有意**（让能力匹配自动选型）还是**漏配**？

**决策**：**☑ C（响应中暴露降级状态）**　签字人：产品 / AI 负责人　日期：2026-10-09
**决策后的技术动作**：A=配置/元数据变更（无代码）；B=至少一处日志点；C=各生成路由响应加字段（多路由，另立卡）。
**未决策前兜底**：**不改**；把"chat 可用 ≠ 结构化可用、本轮成功可能来自降级"写进验收口径（阶段 2 已如实记录）。

---

## 附 A：修复优先级排序（本轮判断）

| 优先级 | 项 | 类型 | 动作 | 为什么是这一级 |
| --- | --- | --- | --- | --- |
| **P1** | **F2-1**（发布失败仍 200；含 5b"半执行 + 无幂等"） | 产品缺陷（对外语义） | 先做零风险项（UI 成功提示），再按方案 A 强化契约；详见 `docs/e2e-fix-01-publish-contract-review.md` | 唯一"用户可见误判"；且 500 路径不可回滚、无幂等 |
| **P2** | F2-2 删除保留关联记录 | 需产品决策 | DS-1 | 可能是审计台账，也可能是悬空引用；**不应由实现者自行级联** |
| **P2** | F2-3 不存在引用返回合成引用 | 需产品决策 | DS-2 | 调用方无法仅凭成功响应判断引用是否真实存在 |
| **P2** | F2-7 结构化输出不可用 / 降级不透传 | 需产品决策 | DS-3 | 有真实生成成功证据，但**不能据此证明结构化输出可用** |
| **P3** | F2-4 `root` 被忽略、无筛选/分页 | 产品缺陷（API 一致性） | 并入 API 一致性清理批次 | 参数被忽略会让调用方产生预期偏差 |
| **P3** | F2-5 字幕/清单不可经视频路由读取（404） | 设计内行为 | 契约文档写明即可 | 不应仅因 404 判为缺陷 |
| **不列为缺陷** | F2-6 / F2-8 | 用例自身缺陷（已修正并重跑通过） | 关闭 | `imagePath` 断言口径错；`resultUrl` 是服务地址不是路径 |
| **保留** | F2-9 `usage_records 14→15` | 真实成本台账 | 不清理（除非产品给出清理规则） | 删除会掩盖真实花费 |

## 附 B：决策/修复落地后的定向回归（最小集）

| 模块 | 回归内容 | 命令 / 方式 |
| --- | --- | --- |
| F2-1 | 新增 `src/app/api/publish/route.test.ts`（6 条基线用例，见审查报告 §6）+ 两个 composer 的提示与"多组继续发布"验证 | `node_modules\.bin\vitest.cmd run src/app/api/publish`；前端手工/组件级 |
| F2-2 | `DELETE /api/content/<id>` 之后：按所选选项断言 `publish_records` / `usage_records` 的行数与 `content_item_id` 取值 | 复用阶段 2 的只读指纹脚本 `node tmp-e2e-baseline.cjs <label>` 前后对比 |
| F2-3 | `?ref=` 三类输入（存在 / 不存在 / 语法无效）× `root` 有无；列表的筛选/分页（若 F2-4 一并处理） | 现有 route 测试 + 只读 curl |
| F2-7 | `/api/content/generate` 在"无 `structured_output` 模型"与"已补能力"两种配置下的响应字段断言（用既有测试 harness mock，不发真实请求） | `node_modules\.bin\vitest.cmd run src/app/api/content` |
| 全量 | 类型与规范 | `node_modules\.bin\tsc.cmd --noEmit`、`node_modules\.bin\vitest.cmd run`、`node_modules\.bin\eslint.cmd .` |

## 附 C：本文件不包含的内容（防止被当成设计文档）

- 不含实现方案细节、不含 schema 变更、不含状态码矩阵的最终定稿；
- 不含对真实平台发布成功分支的任何结论（该分支等待真实凭据与授权，单独记录）。
