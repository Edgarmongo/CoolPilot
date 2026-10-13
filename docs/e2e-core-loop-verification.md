# E2E 核心闭环验证记录（2026-10-09，只验证不改代码）

> **本轮性质**：以**实际运行**建立可信基线——启动本地服务、按依赖顺序跑既有 smoke、对核心闭环逐场景取证。**未修改任何业务代码**、未 `git add` / 未提交、未启动 P1 卡 2 / 卡 3。
> **不是**："跑完所有脚本即通过"。**单个 smoke 通过 ≠ 端到端通过**；未实际贯通的步骤一律标为「已实现未验证 / 验证失败 / 外部阻塞」，见状态口径。
> **依据**：`docs/p0-acceptance-and-p1-sequencing.md` §四 的 10 个场景设计与 §4.1 的自动化/人工分界；复用既有脚本（`scripts/*.ts`），**未新建测试框架**。
> **跑前关闭结论保持**：P0 文档层通过、P1 卡 1 关闭、D1（F1+F3）关闭（F3-f 未达成项保留为 F5）——本轮不重开、不修改这些结论。

## 一、状态口径（本记录的统一判定）

| 状态 | 判定标准 |
| --- | --- |
| **已验证通过** | 实际执行成功，并有可复查的输出或证据（本次命令 + 退出码 + 关键输出） |
| **已实现、未验证** | 代码/端点存在，但没有真实运行证据（或只有自动化契约测试） |
| **验证失败** | 已执行、结果不符合预期，附复现步骤与实际输出 |
| **外部阻塞** | 需要真实平台账号、登录态、外网服务或已配置可调用模型等条件 |
| **待人工验证** | 必须由人在真实界面上操作（如平台侧点发布） |
| **待打包验证** | 属打包产物（Electron）行为，须在打包结果上确认 |

## 二、环境与前提（实测）

| 项 | 实测值 |
| --- | --- |
| 启动命令 | `node_modules\.bin\next.cmd dev --hostname 127.0.0.1`（等价 `pnpm dev`） |
| 版本/就绪 | **Next.js 16.2.4 (Turbopack)**；`✓ Ready in 516ms`；`http://127.0.0.1:3000`；`Environments: .env.local` |
| 数据根 | `D:\devworkspace\software\workspace\myproject\CoolPilot\web-data`（`resolveAppDataDir()` 默认分支：无 `SOCIAL_AUTO_POST_DATA_DIR` 时取 `<cwd>/web-data`，`src/lib/runtime-config.ts:15-23`） |
| 数据库 | `web-data\social-auto-post.db`（913,408 B，**29 表**；`/api/workspace/manifest` 实测） |
| 前端工具链 | `tsx ^4.21.0`、`playwright ^1.60.0` 均在；smoke 全部真实 Chromium |
| 浏览器语言 | smoke 以 `zh-cn` 运行（`scripts/*.ts [baseUrl] [locale]`） |

**一次环境纠错（重要，影响结论可信度）**：首次启动时，本终端会话残留了 `SOCIAL_AUTO_POST_DATA_DIR=%TEMP%\coolpilot-a02-smoke`（早前 smoke 的遗留），服务因此把 **artifacts 根指向临时目录**，而 DB 仍是真实 `web-data`（`.env.local` 显式设置了 `SOCIAL_AUTO_POST_DB_URL`）。已**终止旧进程（PID 47968/42048）**，用**子进程级清空该变量**的方式重启（未改动会话/用户环境变量），复验工作区根回到真实 `web-data` 后才继续取证。下文所有 smoke 结果均取自**真实工作区根**的这次运行。

## 三、数据安全与隔离证明（跑前 / 跑后一致）

| 指纹 | 跑前 | 跑后（全部脚本与手工场景执行完毕） |
| --- | --- | --- |
| `content_items` 总数（`GET /api/content` → `data.total`） | **17** | **17** |
| `publish_records`（`GET /api/publish-records`） | **3** | **3** |
| `accounts` | **5** | 5 |
| `runs` | **1** | 1 |
| `web-data\artifacts` 文件数 | **37**（manifest：linked 2 / unlinked 35） | **37** |
| `web-data\uploads` / `videos` | 0 / 0 | 0 / 0 |

- 每个 smoke 与手工场景**自建自删**（`creator-editor-link-smoke`：`POST /api/content 201` → `DELETE /api/content/<id> 200`；`whiteboard-smoke`：`apiRoundTrip.createStatus=201 / deleteStatus=200`）。
- **未**清空开发库、**未**改配置、**未**执行破坏性迁移、**未**触发真实平台发布。
- 数据库文件运行中被服务进程占用，无法取 MD5；改用**接口级计数 + 目录计数**作为指纹（上表）。
- 未新增仓库内文件（smoke 不使用隔离目录时会自清理）；本轮日志一律写在 `%TEMP%\coolpilot-e2e\`。

## 四、场景 → 执行 → 结果（对照 P0-08 §四 ①～⑩）

| # | 场景 | 执行步骤 | 预期结果（验收口径） | 实际结果 | 证据 | 状态 | 后续任务 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ① | 创建内容 | `POST /api/content {"title","type":"article"}`（smoke 与手工各一次） | 立即产生一条可打开的内容 | **201**，`status="ready"`，`GET` 可读回 | `creator-editor-link-smoke` 输出；手工：`CREATE status=201 itemStatus=ready` | **已验证通过** | 卡 6/卡 9 补 `POST /api/content` 路由测试（当前无） |
| ② | 生成 → 编辑器 | `GET /{locale}/creation/articles?edit=<id>`（深链＝生成器实际拼出的表达式） | 打开刚写入的那条内容；退出后回到列表；失效 id 有可读提示 | **真实浏览器全部成立**：`opened=文章ID: 0VND83XT`、`titleMatched=true`、`exitDroppedTheParameter=true`、`reloadStayedOnTheList=true`、`unopenableLinkReported=true`、`pageErrors=[]` | `tsx scripts\creator-editor-link-smoke.ts ... zh-cn` → `EXIT=0`；服务日志逐条 `200/404` 可对账 | 链接层**已验证通过**；**真实模型调用未验证**（见 §七-1） | 卡 9 回归；生成用例的真实调用需人工授权 |
| ③ | 编辑 → 保存 → 重开 | 建 → `PATCH /api/content/<id>`（title/body/images）→ `GET` → `DELETE` | 只有写库成功才算保存；重开不丢字段；首项＝封面且 `image_path` 一致 | **全部成立**：`PATCH 200`，`title="E2E-03 saved"`，`imagePath="e2e-cover.png"`（＝`images[0]` 镜像），重开读回三字段一致，`DELETE 200`，总数回落 17 | 本轮手工 API 序列（见 §八-2） | **已验证通过**（保存反馈与失败恢复入口仍属 D02/D07 未实现） | 卡 6（D01～D07）：保存失败恢复、来源记录 |
| ④ | 关联本地素材 + 远程导入素材 | (a) 上传 → 内容中心封面 / 编辑器封面 / 正文插图；(b) `POST /api/content/import-url` 导入含 `og:image` 的真实页面 | 三处看到**同一个**地址；**发布不丢封面** | (a) **成立**：`uploadAnsweredTheStoredShape=true`、`contentLibraryPaintedTheCover=true`、`editorCoverPaintedTheSameFile=true`、`insertImagePutItInTheBody=true`、`pageErrors=[]`（封面真被浏览器画出，`naturalWidth>0`）；(b) **失败**：封面被写成**远程 URL**（`imagePath=https://opengraph.githubassets.com/.../microsoft/TypeScript`），`metadata` 无本地引用，artifacts 仍 37（未本地化），发布侧 `resolveLocalImagePath()` 对 `https?:` 返回 `""` → **封面被静默丢弃** | `artifact-image-url-smoke` `EXIT=0`；`import-url` 实测 201 + `GET /api/content` 读回字段；`src/lib/publish.ts:27-33`（第 29 行） | (a) **已验证通过**；(b) **验证失败（缺陷复现）** | **卡 2（A03+A05）→ 卡 3（A04 + P0-07 B6）**；卡 3 的 B6 直接消除“发布丢封面” |
| ⑤ | 选择平台及帐号 | `GET /api/accounts`、`GET /api/account-health` | 失效帐号被拦截并说明原因，不空跑浏览器 | 5 个账号全部 `active`；健康汇总 `healthy=2 / warning=0 / danger=0 / unknown=3`；`scan.state=idle`（从未扫描）→ **失效账号拦截未被真实触发** | `/api/accounts`（5 条）、`/api/account-health`（`checkedAt=1791413164205`，早于本轮） | **已实现、未验证**（账号风险判定的自动化用例存在：`src/lib/account-risk.test.ts`） | 卡 9；健康扫描需真实登录态 |
| ⑥ | 准备平台草稿 | `POST /api/publish/draft`（需真实浏览器会话 + 平台登录态） | 逐字段证据 `filled/empty/not_offered`；页面什么都没接住 → 失败 | **本轮未执行**（会打开真实平台会话，属隔离环境/人工动作） | 契约层有自动化用例：`src/app/api/publish/draft/route.test.ts` + `src/test/browser-session-fixture.ts`（静默） | **外部阻塞 / 待人工验证** | 卡 7 的 DE04/DE06/DE07；真实交接须人工或隔离演练 |
| ⑦ | 人工确认发布 | 人在实时预览里点平台发布按钮 | CoolPilot 不代点发布；关闭前确认 | **本轮未执行**（依设计只能人工） | `docs/p0-acceptance-and-p1-sequencing.md` §4.3-1 | **待人工验证** | 人工执行并记录 |
| ⑧ | 核验发布结果 | `POST /api/publish/verify`（需 ⑥/⑦ 产生的 receipt） | 只有强信号写事实；弱信号 `unknown` 且不写 | **本轮未执行**（无真实 receipt）；契约层自动化用例全绿（一次成功＝一条记录＋一次状态迁移；重复轮询不新增；无 receipt 不写） | `src/app/api/publish/verify/route.test.ts`（`vitest` 591 用例中含此项） | **外部阻塞 / 已实现、未验证**（真实成功路径） | 卡 9 人工闭环 |
| ⑨ | 结果与内容/帐号/平台关联 | `GET /api/publish-records`；`GET /zh-cn/publishing/records` | 能从内容找到发布记录与证据 | 记录可读（**3 条**既有记录），记录页 `200` | `/api/publish-records`（len 1584）、页面扫描 | **已验证通过（读路径）**；关联正确性依赖真实发布 | 卡 9 |
| ⑩ | 未知/失败/取消/重复触发/应用重启 | 制造 5 种情形 | 未知不写、失败不写、取消不写、重复不产生第二条事实、重启后能识别未完成流程 | 前 4 项契约由 ⑧ 的用例覆盖（静默）；**“重启后识别未完成流程”无持久化**（DE01 未做） | `docs/p0-acceptance-and-p1-sequencing.md` §四 ⑩ | **已实现、未验证 + 待打包验证** | 卡 6/卡 7/卡 8/卡 9；打包产物验证 |

## 五、smoke 与工具实测明细（逐条命令 + 退出码 + 关键输出）

全部命令以 `http://127.0.0.1:3000`、`zh-cn` 运行，**逐个执行**（不并发，避免状态互相污染）。

### 5.1 `scripts/creator-editor-link-smoke.ts` → **EXIT=0**

```json
{ "ok": true, "locale": "zh-cn", "link": "/zh-cn/creation/articles?edit=CONTENT_ID",
  "opened": "文章ID: 0VND83XT", "titleMatched": true,
  "exitDroppedTheParameter": true, "reloadStayedOnTheList": true,
  "unopenableLinkReported": true, "pageErrors": [] }
```

服务端日志逐条对账（节选）：`POST /api/content 201` → `GET /zh-cn/creation/articles?edit=0VNd83xTQ_JHUjluCv6FZ 200` → `GET /api/content/0VNd83xTQ_JHUjluCv6FZ 200` → `DELETE /api/content/0VNd83xTQ_JHUjluCv6FZ 200` → 再次访问同一深链 `GET /api/content/<id> 404`（这正是 `unopenableLinkReported` 走的分支）。

### 5.2 `scripts/artifact-image-url-smoke.ts` → **EXIT=0**

```json
{ "ok": true, "imageUrl": "/api/agent/artifacts?file=upload-1791505097643-eNueXYkE.png",
  "uploadAnsweredTheStoredShape": true, "contentLibraryPaintedTheCover": true,
  "editorCoverPaintedTheSameFile": true, "insertImagePutItInTheBody": true, "pageErrors": [] }
```

四条断言分别覆盖：上传路由回包形状（`/api/agent/artifacts?file=...`）→ 内容中心封面 → 编辑器封面同一文件 → 正文插图。判定为「真被画出」而非仅 DOM 存在。

### 5.3 `scripts/workspace-overview-smoke.ts` → **EXIT=0**

```json
{ "ok": true, "headings": ["工作区","工作区里有什么","需要留意"],
  "root": "D:\\devworkspace\\software\\workspace\\myproject\\CoolPilot\\web-data",
  "rows": [{"id":"database","empty":false},{"id":"artifacts","empty":false},
           {"id":"browserProfiles","empty":false},{"id":"videos","empty":true}],
  "attention": [{"id":"unlinkedProfiles","count":2},{"id":"unknownTables","count":2},
                {"id":"unaccountedFiles","count":1}],
  "attentionCount": 5, "checkedFragments": 26 }
```

即：页面上的数字真的来自 `GET /api/workspace/manifest`，且 `root` 是**真实工作区**（不是临时目录）。

### 5.4 `scripts/model-management-smoke.ts` → **EXIT=0**

```json
{ "ok": true, "firstModel": "gpt-5.6-sol", "tagCount": 431, "allModelsChip": "全部模型420",
  "vendorHeadings": 22, "gatewayToggle": "已停用", "gatewaySyncButton": 1,
  "note": "模型清单于 2026-10-08 由 quanzil.com/api/user/models 汇入，共 420 个模型……" }
```

### 5.5 `scripts/whiteboard-smoke.ts` → **EXIT=0**

```json
{ "ok": true, "buttonCount": 5, "groups": {"beforeCreate":5,"afterCreate":17},
  "exportToLibrary": { "emptyBoardSubmitDisabled": true, "previewIncludesRoot": true,
    "postedTitle": "smoke-whiteboard-export", "exportedBodyHasRoot": true, "toastVisible": true },
  "apiRoundTrip": { "createStatus": 201, "deleteStatus": 200, "deleted": true },
  "pageErrors": [], "nativeDialogs": [], "duplicateKeyEntries": [], "otherConsoleEntries": [] }
```

白板不只是“能打开”：导出到内容库的往返（写 201 / 删 200）也在真实服务上完成且自清理。

### 5.6 `scripts/ai-runtime-smoke.ts`（隔离临时库，不触碰开发者数据）→ **EXIT=0**

在**全新临时库**上：目录类目 420 个模型 / 0 可调用；各供应商 `models=0 callable=0`；`route(chat)` = `none - no-models-synced`；`facade image unavailable: No model is configured for this request`；密钥轮换演示（`qwen` 两把 key，一把 `rate_limited` 被跳过、另一把 `ok`）；`key storage fingerprints only: true`。
→ 结论：**运行时骨架、路由、密钥轮换、fingerprint 存储可用**；该次运行没有可调用模型，是因为它是空库（**不代表真实库**，见 §七-1）。

### 5.7 `scripts/electron-dry-run.ts` → **EXIT=0**

```json
{"ok":true,"url":"http://127.0.0.1:3130","appDataDir":"C:\\Users\\...\\Temp\\coolpilot-electron-XjcVdt"}
```

校验项（脚本内断言）：`next.config.ts` 必须 `output: "standalone"`；Electron 运行时必须绑定 `127.0.0.1`；必须注入 `SOCIAL_AUTO_POST_DATA_DIR`。三项均通过。
**仍属「待打包验证」的部分**：真实 `electron-builder` 产物的窗口/重启行为（本轮未执行 `electron:pack`，见 §七-5）。

### 5.8 真实库的模型运行时（只读查询）

| 查询 | 结果 |
| --- | --- |
| `GET /api/ai/runtime` → `totals` | **422 个模型，2 个可调用** |
| `GET /api/ai/runtime` → `providers` | 16 个供应商，13 个有已实现端点；**仅 `openai` 同时满足「端点已实现 + 密钥已配置」**（2 个模型可调用） |
| `implementedProtocols` | `openai-compatible, gemini` |
| `defaults` | `{}`（**未设置默认模型**） |
| `GET /api/ai/models` | 422 个模型；`syncs` 中 `openai/default` 状态 `ok`（`0 new / 2 known` 等 4 条） |
| `GET /api/accounts` | 5 个账号（`active`），平台分布：头条号 ×2、知乎 ×2、小红书 ×1 |
| `GET /api/account-health` | `total=5 / healthy=2 / warning=0 / danger=0 / unknown=3`，`attention=[]`，`scan.state=idle`（`checkedAt` 早于本轮，即**从未扫描过**） |
| `GET /api/publish-records` | 3 条既有记录（读路径可用） |

## 六、页面可达性扫描（HTTP，读路径）

29 个控制台页面（`/{locale}` 前缀 `zh-cn`）+ 入口路径：**29/29 → 200**。

| 页面 | 状态 | 页面 | 状态 | 页面 | 状态 |
| --- | --- | --- | --- | --- | --- |
| app-store | 200 | creation/images | 200 | schedules/calendar | 200 |
| automation/generations | 200 | creation/posts | 200 | schedules/list | 200 |
| automation/logs | 200 | creation/products | 200 | settings | 200 |
| automation/nodes | 200 | creation/videos | 200 | settings/ai | 200 |
| chatroom | 200 | dashboard | 200 | smart-config/knowledge-base | 200 |
| content/library | 200 | data-center | 200 | smart-config/positioning | 200 |
| creation/ai-writing | 200 | mindmap | 200 | system/models | 200 |
| creation/articles | 200 | publishing/accounts | 200 | system/usage | 200 |
| | | publishing/records | 200 | system/workspace | 200 |
| | | runs/queue | 200 | whiteboard | 200 |
| | | schedule | 200 | | |

入口路由行为（实测）：

| 请求 | 结果 | 说明 |
| --- | --- | --- |
| `GET /` | **307 → `/zh-cn/dashboard`** | 默认入口正常 |
| `GET /zh-cn` | **404** | **语言根没有页面**（观察项，见 §八-4） |
| `GET /zh-cn/` | **308 → `/zh-cn`** → 404 | 同上，尾斜杠只是重定向到 404 的目标 |
| `GET /en/dashboard` | 200 | 多语言入口在带完整路径时正常 |

> 说明：本扫描是 **HTTP 层可达性**（页面可服务），**不等于**页面内交互与数据正确；后者由 §五 的真实浏览器 smoke 覆盖（且只覆盖到已验证的那几条）。

## 七、未验证项与阻塞（不得写成通过）

1. **真实模型调用（场景② 的"生成"那一半）——外部阻塞（需人工授权）**。真实库**已具备调用条件**：`openai` 端点已实现且已配置密钥、2 个模型可调用（§5.8）；但 `defaults={}`（未设默认模型），且真实调用会消耗用户额度与外部服务，**本轮未执行**。契约层证据：`src/app/api/content/generate/route.test.ts`、`src/app/api/ai-writing/generate/route.test.ts` 在全量 591 用例中通过（**契约测试 ≠ 真实调用**）。
2. **⑥ 平台草稿准备 / ⑦ 人工发布 / ⑧ 结果核验——外部阻塞 + 待人工验证**。需要真实登录态（`web-data\browser-profiles\`）与真实平台；本轮**未执行**。契约层：`src/app/api/publish/draft/route.test.ts`、`src/app/api/publish/verify/route.test.ts` 通过。
3. **⑤ "失效账号被拦截"——已实现、未验证**。5 个账号全部 `active`；健康汇总 `unknown=3`、`scan.state=idle`（从未扫描），因此**拦截分支未被真实触发**。自动化用例存在（`src/lib/account-risk.test.ts`）。
4. **⑩ "重启后识别未完成流程"——未实现**（DE01 未做，无持久化）；重启类判定属打包产物行为 → **待打包验证**。
5. **Electron 打包产物行为——未执行**（本轮未跑 `electron:pack` / `electron:build` / `electron:dry-run` 之外的任何打包动作）。已通过的是运行时**契约**（§5.7）。
6. **不在本轮范围**：多平台适配（MP01～MP10）、Agent 端到端（P2 的 G1～G6）、备份/恢复演练（P0-07 A3～A6）、Marketplace（P5）。

## 八、本轮新发现（按影响排序）

### 8.1 新发现 1：远程封面不本地化 + 发布静默丢弃（**核心闭环内，已实测复现**）

| 项 | 原始证据 |
| --- | --- |
| 第 1 次导入 | `POST /api/content/import-url {"url":"https://github.com/microsoft/TypeScript","rewrite":false,"maxWords":80}` → **500**，服务端 `application-code: 21.9s`（同一请求第 2 次 **201 in 1.12s**）→ 慢响应表现为**偶发 500**（`failFromError` 扁平 `UNKNOWN_ERROR`），无重试 |
| 落库字段（第 2 次成功那次） | `imagePath = https://opengraph.githubassets.com/d5cd447d1bb7eb289370740cefecfa46f3e3f123237fa5722d6ff9ad0cec52ed/microsoft/TypeScript`；`sourceUrls = ["https://github.com/microsoft/TypeScript"]`；`metadata = {"provider":"local","model":"none","sourceTitle":"GitHub - microsoft/TypeScript: …","generationType":"url_import"}`；**无 `images` 数组**；`bodyLen=160` |
| 是否本地化 | `web-data\artifacts` 跑前 **37** → 导入后 **37** → **未落地为本地文件** |
| 发布侧后果 | `src/lib/publish.ts:27-33` 的 `resolveLocalImagePath()`：`/^https?:\/\//i` → `return ""`（第 29 行）→ 封面**不会**随发布提交，且**无用户可见提示** |
| 清理 | `DELETE /api/content/A3s5A2NHya9MZvWb0LVl_` → 200；总数回落 **17**、artifacts 仍 **37** |
| 归类 | 属既有登记项（`docs/p1-card-01-acceptance.md` §8.5 的 F-C0-5；`docs/p0-acceptance-and-p1-sequencing.md` §四 ④ 的"现状差距"）。本轮把它从**文档论断**升级为**实测复现**，并补上"偶发 500"这一新事实 |
| 归属卡 | **卡 2（A03+A05，写入形态）→ 卡 3（A04 本地化 + P0-07 B6 发布侧解析）** |

### 8.2 新发现 2：会话变量会让 artifacts 根跑偏（本轮纠错记录）

会话里残留 `SOCIAL_AUTO_POST_DATA_DIR` 时，`resolveAppDataDir()`（`src/lib/runtime-config.ts:15-23`）优先取它 → **artifacts/浏览器配置根指向别处，而 DB 仍按 `.env.local` 的 `SOCIAL_AUTO_POST_DB_URL`**（这就是本轮首次启动时"工作区根 = `%TEMP%\coolpilot-a02-smoke`、DB = 真实库"的原因）。**排查"图库为空 / 工作区根不对"时必须先看这个变量。**

### 8.3 新发现 3：工作区清单的三个观察项（非本轮引入）

`GET /api/workspace/manifest` / 工作区页"需要留意"实测：`unknownTables = ["ai_providers","sites"]`（DB 中存在、schema 映射中缺失 → 与 `docs/backup-restore-audit.md` 的"纳入/不纳入"清单、`docs/data-model-inventory.md` 的表清单需要对齐）；`unaccountedFiles = 1`（工作区根有 1 个未被归类的文件；结合 `docs/backup-restore-audit.md` V4 疑为 **0 字节**的 `web-data\_tmp-e2e.db`）；`unlinkedProfiles = 2`。

### 8.4 新发现 4：语言根没有页面

`GET /zh-cn` → **404**；`GET /zh-cn/` → **308 → `/zh-cn`** → 404（尾斜杠只是重定向到 404 的目标）。正常入口 `GET /` → **307 → `/zh-cn/dashboard`**，`GET /en/dashboard` → 200。→ 直接输入/收藏"语言根"会看到 404；仓库内**没有** `middleware.ts`，改的是 `src/proxy.ts`（Next 16 的代理约定）。

## 九、结论与下一步

### 9.1 核心闭环是否真实跑通？（直接回答）

**未完整跑通。**

| 闭环环节 | 结论 |
| --- | --- |
| 创建内容 | **已验证通过**（201，`status=ready`） |
| 模型调用 → 文章生成 | **未验证**（真实调用未执行，需授权；契约测试通过） |
| 生成结果 → 编辑器（深链） | **已验证通过**（真实浏览器，含退出/失效链接分支） |
| 编辑 → 保存 → 重开 | **已验证通过**（字段与封面镜像一致） |
| 素材：本地上传 → 三处展示/插图 | **已验证通过**（真被浏览器画出） |
| 素材：远程导入 → 本地化 | **验证失败（已复现）**：写成远程 URL，未本地化 |
| 发布：平台草稿 / 人工发布 / 结果核验 | **外部阻塞 + 待人工验证**（未执行） |
| 发布侧封面/素材解析 | **验证失败（已复现）**：远程封面被静默丢弃（`publish.ts:29`） |
| 结果与记录关联（读路径） | **已验证通过**（3 条既有记录可读、页面 200） |
| 重启后恢复 | **未实现**（无持久化）+ 待打包验证 |

一句话：**"创作 → 编辑 → 保存 → 重开 → 图片展示"这一段是真的通的；"模型生成"与"平台发布"两段没有真实证据；"远程素材 → 发布封面"这一段已被实测证伪。**

### 9.2 有实测证据的模块（可写"已验证"）

内容 CRUD（含 `images[0]` → `image_path` 镜像）、文章编辑器深链、图片链路（上传 → 内容中心封面 → 编辑器封面 → 正文插图）、工作区概览（含根路径与统计来自真实 API）、模型管理页、白板（含导出内容库往返）、发布记录读路径、**29/29 页面 HTTP 可达**、静态质量（`tsc` exit 0；`eslint` 0 error / 1 warning〔既有〕；`vitest` **90 文件 / 591 用例通过**）、Electron 运行时契约。

### 9.3 仍处"已实现、未验证"

其余页面内交互（指标/数据中台、日历排程、知识库、视频创作、产品、聊天室、自动化节点、应用商店等本轮只做了可达性扫描）；账号健康扫描与失效账号拦截；Agent 执行链（会话、审批、恢复）；真实模型调用；平台草稿与发布；打包产物行为。

### 9.4 下一项建议：**卡 2（A03 + A05）→ 卡 3（A04 + P0-07 B6）**

理由（按证据，不按印象）：

1. 本轮唯一**已复现且位于核心闭环内**的失败就是 8.1；它的两个半边正好落在卡 2 / 卡 3 的范围。
2. 排卡依赖要求先卡 2 后卡 3（`docs/p0-acceptance-and-p1-sequencing.md` §5.1）：本地化的结果必须落进**统一的写入形态**，否则会写出第二种格式；卡 2 只需**方案 + 写入形态统一**（改 JSON 值形态，**不改表结构**，**不迁移历史数据**）。
3. 卡 3 的 B6（`src/lib/publish.ts:24-41` 与卡 1 解析对齐、远程输入不再静默空串）直接消除"发布丢封面"，但它触碰发布解析语义 → **需单独批准**，不适合顺手做。
4. **不建议**现在做：F2 / F4（未阻塞核心闭环）、F5（属 API 契约决策，建议先定方案 A/B 再动手）、P1 卡 1 重开、卡 9 端到端（前置未满足）、打包验证（可排在卡 2/卡 3 之后）。

若你的目标更偏"今天就消除用户可见缺陷"，可以先做**卡 3 的 B6 半边**（发布侧可解释失败 / 本地等价回退 + 回归测试），再回头做卡 2；两种情况都不改表结构。

### 9.5 要让"生产可用"可判定，还缺这些证据

1. 一次**真实模型生成**的端到端记录（生成 → 编辑器 → 保存）；
2. 一次**真实平台**草稿准备 + 人工发布 + 核验（或隔离演练）记录；
3. **打包产物**上的启动、数据根一致性、重启后状态（`electron:pack`）；
4. 备份 / 恢复演练（P0-07 A3～A6）；
5. 账号健康扫描后的失效账号拦截实测。

## 十、停止边界与本轮未做的事

- **未修改任何业务代码**、未改 schema / 迁移 / 配置、未 `git add` / 未提交（HEAD 仍 `3b48126`）。
- **未启动** P1 卡 2 / 卡 3；**未重开** P0、P1 卡 1、D1 的任何关闭结论。
- 未触发真实平台发布、未执行真实备份/恢复、**未调用真实模型**（不消耗用户额度）。
- 临时数据自建自删；跑前 / 跑后指纹一致（§三）；未清空开发库。
- 本地 dev server 已在取证结束后停止；本轮全部日志位于 `%TEMP%\coolpilot-e2e\`（`dev.out.log`、`dev2.out.log`、`smokes.txt`、`fingerprint-*.txt`）。

### 复核命令（可独立重跑）

```powershell
# 0) 起服务：务必先确认没有 SOCIAL_AUTO_POST_DATA_DIR 残留（否则 artifacts 根会跑偏，见 §8.2）
cmd /c 'set "SOCIAL_AUTO_POST_DATA_DIR=" && node_modules\.bin\next.cmd dev --hostname 127.0.0.1'
# 1) 核心闭环 smoke（逐个跑，不要并发）
node_modules\.bin\tsx.cmd scripts\creator-editor-link-smoke.ts  http://127.0.0.1:3000 zh-cn
node_modules\.bin\tsx.cmd scripts\artifact-image-url-smoke.ts   http://127.0.0.1:3000 zh-cn
node_modules\.bin\tsx.cmd scripts\workspace-overview-smoke.ts   http://127.0.0.1:3000 zh-cn
node_modules\.bin\tsx.cmd scripts\model-management-smoke.ts     http://127.0.0.1:3000 zh-cn
node_modules\.bin\tsx.cmd scripts\whiteboard-smoke.ts           http://127.0.0.1:3000 zh-cn
node_modules\.bin\tsx.cmd scripts\ai-runtime-smoke.ts           # 隔离临时库，不触碰开发数据
node_modules\.bin\tsx.cmd scripts\electron-dry-run.ts
# 2) 静态与全量（一次只跑一个 vitest 进程，并发会因 hook 超时假失败）
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\eslint.cmd .
node_modules\.bin\vitest.cmd run
# 3) 数据指纹（应与本记录一致：17 / 3 / 37）
(Invoke-RestMethod http://127.0.0.1:3000/api/content).data.total
(Invoke-RestMethod http://127.0.0.1:3000/api/publish-records).data.Count
(Get-ChildItem web-data\artifacts -File).Count
```



