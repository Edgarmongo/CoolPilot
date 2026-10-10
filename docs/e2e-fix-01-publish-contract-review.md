# E2E-FIX-01 审查报告：`POST /api/publish` 结果契约（F2-1）

> **性质**：只读审查（盘点 + 方案比较 + 回归范围）。**本卡不改代码**。
> **依据**：`docs/e2e-stage2-execution-record.md`（F2-1 发现）+ 本轮全仓静态盘点（`git grep --untracked`）。
> **边界**：未运行真实平台发布、未调用模型、未启动 worker、未执行 `git add` / `git commit`；本文件只**新增**。
> **基线**：`git status --porcelain` 与阶段 2 结束时一致（`posts-composer.tsx` / `videos-composer.tsx` / `src/lib/publish.ts` / `publish/draft|verify` 均属**既有未提交改动**，本卡未触碰）。

## 0. 卡定义（建议纳入执行队列）

| 项 | 内容 |
| --- | --- |
| 卡号 | **E2E-FIX-01** 发布接口结果契约审查与修正方案 |
| 目标 | 让"发布结果"在 HTTP 边界上**不再可能被误判**：先盘清调用方依赖，再给兼容方案；不在盘点阶段改状态码 |
| 执行范围 | 调用方清单、响应语义矩阵、兼容风险、方案 A/B/C、回归测试范围；**只读** |
| 验收 | ①调用方含文件:行号 ②五类结果的实际状态码与响应体 ③每种方案的兼容风险 ④推荐方案与理由 ⑤回归测试范围（含当前零覆盖的证明） |
| 停止边界 | 不改 `src/app/api/publish/route.ts`、不改 `src/lib/publish.ts`、不改两个 composer；不改任何 HTTP 状态码；不动冻结面（C2 `src/lib/publish-facts.ts` 与 `publish/draft`/`verify` 契约） |
| 交付物 | 本文件；实施另立卡 |

## 1. 盘点方法与口径

- **命令**：`git --no-pager grep --untracked -n -e '/api/publish' -- ':!docs' ':!*.log*' ':!*.json' ':!tmp-*'`（覆盖已跟踪 + 未跟踪源码）；另以 `Select-String` 对 `src/**/*.ts,tsx` 复扫 `api/publish`、`PublishSiteResult`、`publishToSite(`、`publishToSites(`、`apiPost`。
- **"调用方"定义**：真的向 `POST /api/publish` 发请求的位置。注释、文档、类型引用**不算**；本轮**未发现**任何测试或脚本调用。
- **复用证据**：`tmp-p1-05-e2e04.log.json`（受控失败与无效载荷的真实请求/响应体）。

## 2. 调用方清单

### 2.1 汇总（全仓仅 2 处）

| # | 位置 | 类别 | 关键请求字段 | 成败判定依据 | 失败时表现 |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/components/creation/posts-composer.tsx:89` | 前端交互（动态发布页） | `publish:true`、`contentType:"post"`、`method:"manual"`、`terminal:"local"`、`contentItemId` | 只读 `data.results[]`（`setResults` @ :100）；整请求失败靠 `apiPost` 抛错 | `catch` → `setError`（:106-107）；成功分支只看"请求没抛错" |
| 2 | `src/components/creation/videos-composer.tsx:317` | 前端交互（视频发布页），按"标题+文案"分组**循环调用**（分组 :286-295） | 同上 + `videoPath` | 同上（`collected.push(...data.results)` @ :329） | 同上（:334-335） |

**仓库内其它 `/api/publish*` 命中均非本路由**：`/api/publish-records`（`src/app/[locale]/(console)/publishing/records/page.tsx:122,210`、`src/components/cms-site-dialog.tsx:72`）、辅助发布 `/api/publish/draft|verify|discard|logs`（`src/components/creation/publish-run-panel.tsx:167,250,280,302,329`、`src/components/creation/content-publish-dialog.tsx:81`）、以及注释（`src/lib/account-health.ts:173`、`src/lib/publish-debug.ts:8` 等）。

### 2.2 逐处细节（含已存在的误判面）

**#1 `posts-composer.tsx`（动态发布）**
- 流程：:82 先 `POST /api/content` 建内容项成功，:89 再发布。
- 读回：:100 `setResults(data.results)` → :229-246 逐账号渲染徽章（:241 `t(publishStatusKey[result.status])`，映射见 :18-24）+ :238 `result.error` 红字。
- **成功提示无条件**：:101 `setNotice(t("pcPublished"))` **不检查 `results` 是否全部 `failed`**。文案 `pcPublished = "已提交发布任务"`（`src/locales/zh-cn.json:1447`）**并未声称"已发布"**，因此不是"谎报已发布"，但"全失败仍提示已提交"仍是可被用户观察到的偏差。
- 失败：:106-107 走 `catch`。**关键事实**：`apiPost` 的失败判定是响应体 `ok === false`（`src/lib/api-client.ts:27-46`，判定点 :38），**不是 HTTP 状态码**（状态码只在响应体无法解析时用于拼错误消息，:32-35）。

**#2 `videos-composer.tsx`（视频发布）**
- :286-295 按 `title \0 description` 分组后 :316-330 **逐组**调用（组数 ≥ 1）。:331 `setResults(collected)`、:332 `setNotice(t("vcPublished"))`（"影片已提交到所选帐号。"）。
- 结果面板 :819-844（`vcPublishResultTitle` + `publishStatusClass`，:63-69 中 `failed` 为红）。
- **行为差异（必须记住）**：某组请求**抛错**时 `catch` 终止循环 → **后续分组不再发布**。这是"改状态码"方案的直接回归点。

### 2.3 相关但**不是**调用方（防止误判）

| 位置 | 关系 | 说明 |
| --- | --- | --- |
| `src/lib/publish.ts:129-134` `publishToSites()` | 导出但**零调用** | 与路由功能重叠的"服务端批处理"入口，目前是**死导出**；将来若被使用会绕过路由，需要同一份契约口径 |
| `src/app/api/publish/draft/route.ts:19-55` | 另一条发布路径（C2 辅助发布，第 1 步） | 已有明确状态码：`fail("INVALID_PAYLOAD",400)` / `fail("Site not found",404)` / `catch → fail(...,500)` |
| `src/app/api/publish/verify/route.ts:30-49` | 同路径第 2 步 | `fail("accountId is required",400)`；成功 `ok({outcome:"published"\|"unknown"\|"waiting"})`；写库失败 500（注释 :26-28 明示"宁丢不重"） |
| `src/lib/publish-facts.ts:42-63` | 辅助发布的"事实写入" | 先写 `publish_records` 再移 `posted`；**冻结面（C2）**，本卡不得改其语义 |
| `src/lib/threads.ts:111-128` | worker `threads_auto_post` | 走 `markContentItemPosted`（:126），**不写 `publish_records`**；与本路由无调用关系 |
| `src/lib/tools/tool-library.ts:31-32` | Agent 工具面 | 可调用注册表只发布 media 工具；**无 publish 工具** → 今天没有 Agent 调用方 |
| `src/app/api/publish/route.ts` | **无 `route.test.ts`** | 该契约**零直接测试覆盖**；`publish/verify/route.test.ts:12` 只在注释里提到本路由 |

## 3. 现有响应语义（五类结果的**实际**行为）

| # | 结果 | HTTP | 响应体 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 全部成功 | 200 | `{ok:true,data:{results:[{accountId,accountName,platform,status:"published"\|"drafted",url}]}}` | `src/app/api/publish/route.ts:73-92` |
| 2 | 部分成功/部分失败 | 200 | 同上，`results[]` 混合状态 | 同上（循环逐账号 push） |
| 3 | 全部失败 | **200** | `{ok:true,data:{results:[{accountId,accountName:"",platform:"",status:"failed",error:"Site not found"}]}}` | `tmp-p1-05-e2e04.log.json:16-32`（实测） |
| 4 | 请求本身无效 | **400** | `{ok:false,error:"Invalid payload",code:"INVALID_PAYLOAD",details:<ZodError>}`，**不写任何记录** | 同上 :73-90（`accountIds:[]` 实测）；schema `src/lib/validation.ts:345-358`（`accountIds.min(1)`） |
| 5a | 平台/浏览器失败（可归因到账号） | **200**（per-account） | `results[].status:"failed"` + `error`；同时写 `publish_records(status:"failed")` | `src/lib/publish.ts:43-82`（`publishToSite` 内部 `try/catch`，:73-81） |
| 5b | 数据库/前置检查抛错（**不可归因**） | **500**（未捕获） | Next 默认错误体（**不是** `{ok:false}` 形状） | `src/app/api/publish/route.ts:26-90` 循环内 `getAccount`(:27) / `findAccountLoginBlock`(:46) / `createPublishRecord`(:30,:57,:76) **无 try/catch** |

**由 5b 派生的一致性缺口（本轮新发现，建议与 F2-1 同卡处理）**
- 循环中第 i 个账号抛错时，第 1..i-1 个账号的**平台侧动作已经发生**且已写记录，响应却是 500 → "已发布但报错"**不可回滚**；且**无幂等键**，调用方重试会再发一次并再写一条记录。
- 反例对照：前置检查失败（`login_required`）走的是 **200 + 明确 per-account 状态**（`route.ts:46-71`），与 5b 的"整体 500"**不一致**。
- 该缺口与状态码方案**正交**：即使选方案 A（保留 200），也需要把"整体请求异常"与"账号级失败"分开表达。

## 4. 兼容风险矩阵

| 面 | 方案 A（保留 200 + 强化契约） | 方案 B（按整体业务结果给状态码） | 方案 C（版本化契约） |
| --- | --- | --- | --- |
| 现有 #1 `posts-composer` | 无风险（新增字段被忽略） | **不会崩**：`apiPost` 看 `body.ok`，`{ok:false}` 走 `catch` 显示错误——这正是期望行为 | 无风险 |
| 现有 #2 `videos-composer` | 无风险 | **中风险：多组循环会中断**（某组非 2xx → `catch` 跳过剩余分组），必须同批改成"继续下一组" | 无风险 |
| 仓库外调用方（自动化/脚本） | 依赖"200 即成功"者**继续误判**，除非改读新字段 | 依赖 200 者**开始收到非 2xx**（报错优于误判，但属破坏性变更） | 需双跑期 |
| 本地验证脚本（`tmp-*.cjs`、`scripts/*`） | 无影响 | 无影响（**已确认目前无脚本调用本路由**） | — |
| 可观测性（Next 日志/5xx 计数） | 无影响 | 失败会进入 5xx 计数（是优点也是噪声） | — |
| 冻结面 C2（`draft`/`verify`/`publish-facts`） | 无影响 | 无影响 | 无影响 |

## 5. 方案比较与推荐

| 方案 | 做法 | 优点 | 代价 | 适用条件 |
| --- | --- | --- | --- | --- |
| A. 保留 200，强化契约 | `data` 增加顶层汇总（如 `outcome` + `requested/failed/loginRequired/unsupported` 计数）；把 5b 定义为 `{ok:false,code:"PUBLISH_RUN_FAILED"}` | 零破坏；现有调用方不必改；可同时解决 F2-1 与 5b | 调用方**必须**读业务结果；纯"看状态码"的外部方仍会误判 | 调用方以本仓库 UI 为主（现状即如此） |
| B. 按整体业务结果给状态码 | 全成功 2xx；全失败按原因非 2xx；部分成功用明确约定（207 或 200+`outcome:"partial"`） | 语义直观；HTTP 即可判断 | 破坏"200 即成功"的既有假设；**必须同批修 `videos-composer` 的多组循环**；需定义 5 类结果的状态码矩阵 | 出现仓库外正式调用方，或产品要求状态码直读 |
| C. 版本化契约 | 旧路由保持兼容，新路由（或 `?contract=2`）采用明确结果语义 | 迁移期最长、风险最低 | 迁移成本最高；两份契约需并行维护 | 调用方数量多、无法一次性改 |

**推荐：A 为先，B 待命，C 暂不评估。**

1. **P0（不涉及对外语义，可先做）**：修 `posts-composer.tsx:101` / `videos-composer.tsx:332` 的**无条件成功提示**——仅当 `results` 全部为 `published`/`drafted` 时显示"已提交"，否则显示"部分/全部失败"摘要。这是**当前唯一可被用户观察到的误判**，且不触碰契约。
2. **P1（方案 A）**：加顶层汇总字段 + 为 5b 定义契约错误体；向后兼容，两个现有调用方无需改动即可继续工作（但它们应改读新字段，属 P0 的自然延伸）。
3. **P2（若产品选择方案 B）**：同批修 `videos-composer` 循环为"不中断"，并事先在契约文档写死"部分成功"的约定。
4. **不建议**：只把 `route.ts:92` 的 `ok({results})` 改成失败状态码就收工——那会"修掉误判、弄坏多组发布"，且 5b 仍无契约。

## 6. 回归测试范围

**现状**
- `src/app/api/publish/draft/route.test.ts`、`src/app/api/publish/verify/route.test.ts` 覆盖的是**另一条路径**，本卡不得改其期望值。
- **`src/app/api/publish/route.ts` 没有 `route.test.ts`** → 本次改动**必须**先补该文件（当前零覆盖是 P1 与 P2 的共同前置）。

**需新增的用例（建议基线）**

| # | 场景 | 断言 |
| --- | --- | --- |
| 1 | 单账号成功 | 200 + `results[0].status="published"`；`publish_records` 1 行 `published`、`published_at` 非空 |
| 2 | 账号不存在 | **现状口径**：200 + `status="failed"` + 记录 `failed` / `url=""` / `published_at=null`（与 `tmp-p1-05-e2e04.log.json:40-71` 一致）；方案 B 落地后改为期望非 2xx |
| 3 | 混合（成功 + `login_required` + 不存在） | `results` 顺序与 `accountIds` 一致；`publish_records` 3 行；`login_required` 不启动浏览器（不得调用 `publishToSite`） |
| 4 | 无效载荷（`accountIds:[]`） | 400 `INVALID_PAYLOAD`；0 行写入（回归 E2E-04 step 3） |
| 5 | `createPublishRecord` 抛错（mock） | 现状：500（先**锁定快照**）；实施后：契约错误体 + 明确"部分账号已发布" |
| 6 | `publishToSite` 抛错（mock） | 200 + `status="failed"` + `error` 为异常消息（5a 口径不得被方案 B 误改） |

**前端回归（手工或组件级）**
- `posts-composer`：全部失败时**不**出现成功提示；徽章显示"失败"且 `error` 文案可见。
- `videos-composer`：多组中某组失败后**其余分组仍被发布**；结果面板计数与分组数一致。

**命令**：`node_modules\.bin\vitest.cmd run src/app/api/publish` + `node_modules\.bin\tsc.cmd --noEmit`

## 7. 未决问题（需产品/负责人回答后才进实施）

1. "全部失败"时调用方应看到非 2xx，还是 200 + `outcome`？（决定 A 或 B）
2. "部分成功"用 **207** 还是 **200 + `outcome:"partial"`**？（方案 B 必须回答）
3. 账号级失败（`login_required` / `unsupported`）是否算"业务失败"，从而影响状态码归类？
4. 5b 的"半执行"是否需要**幂等键**（重试去重）？当前 `createPublishRecord`（`src/db/repository.ts:1023+`）无幂等标识，记录与平台动作都可能重复。
5. `src/lib/publish.ts:129` 的 `publishToSites()` 死导出是删除还是收进路由？（影响未来服务端调用方的契约统一）

## 8. 本轮未做的事（边界确认）

- 未修改任何源码/既有文档；未新增/修改测试；未改 `.eslintrc`；
- 未执行真实发布、未调用模型、未启动 worker；未 `git add` / `git commit`；
- 未清理阶段 2 遗留的 `usage_records` 那一行（属 F2-9 成本台账，须产品给规则）。
