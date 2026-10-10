# CI-P5-03「远程封面」改动范围与冻结面影响说明（范围审查稿）

> **状态**：作者 2026-10-10 已批准策略 **(c)**（导入侧本地化 + 失败显式可见 + 发布侧对残留远程引用返回结构化错误）。
> **本文件是范围审查稿：尚未写任何业务代码。** 范围审查通过后才实施。
> **依据**：主线 §附录 I.5；`docs/p0-acceptance-and-p1-sequencing.md:196-210`（旧「卡 3 / A04」验收②③）；缺陷 #3 `docs/e2e-baseline-inventory.md:276-277`；代码事实见 §1。
> **验收底线（作者原话）**：任何路径都不能再把远程封面静默转换成空字符串；封面不可用必须让系统和用户知道。

---

## 0. 结论摘要

| 维度 | 规模 |
| --- | --- |
| 导入侧 | **1 个路由 + 1 处加性响应字段 + 1 处 UI 提示（3 语言 × 1 key）** |
| 发布侧 | **2 条路径必须改**（`src/lib/publish.ts:55`、`:114`）+ **1 条路径登记不改**（`src/lib/threads.ts:60`，本来就不静默） |
| 数据模型 / 迁移 | **零**（只往既有 `metadata` JSON 里加键；无 `ALTER`、无新表、无 seed 改动） |
| 冻结面 | 不触碰 `recordPublishSuccess` 写入顺序、verify 消费 receipt、五态 `status`、`summarizePublishResults` 不变式；**唯一触碰点**是 `src/lib/publish.ts` 在 C2 链条上对「远程封面」的行为语义（静默 → 可见失败）→ 建议按 -03 先例留一份 CR（见 §3） |
| 测试 | 新增 `src/lib/remote-image.test.ts`（A04 原本就要求、当前**缺失**）+ 扩展 3 个既有路由测试文件 + 1 个新单测 |
| 明确不做 | 不新增 `status` 值、不复用 `errorKind`、不动视频路径语义、不动 `remote-image.ts` 下载语义、不动数据库 schema、不执行 Git |

---

## 1. 现状事实（全部带 `文件:行` 证据）

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | **静默点**：远程 URL → `""` | `src/lib/publish.ts:34-40`（`resolveLocalImagePath`：`if (/^https?:\/\//i.test(imagePath)) return "";`）；视频同形 `:42-48` |
| 2 | 消费点 A（自动/直接发布） | `src/app/api/publish/route.ts:80` → `publishToSite()`；失败写 `publish_records`（`:85-99`） |
| 3 | 消费点 B（辅助预填，C2-1a） | `src/app/api/publish/draft/route.ts:28` → `preparePublishDraft()`；`rememberPublishDraft()` `:36-45` |
| 4 | 消费点 C（旧 worker） | `src/lib/threads.ts:60-64`（`allowNoImage` 判定）、`:99-105`（`setInputFiles(imagePath)` 直接吃原始值）→ 远程 URL 会**抛错**，不是静默；被 `src/worker/runner.ts:24` 使用 |
| 5 | **既有正确先例** | `src/app/api/images/from-url/route.ts:19-31`：前置 `isFetchableImageUrl` → 400；`fetchRemoteImageToArtifacts` → 201 `{fileName,url}`；失败 → 502 + 消息 |
| 6 | 下载器契约 | `src/lib/remote-image.ts:17-19`（10MB / 3.5s 原始 + 8s 回退）、`:57-74`（UA、content-type 白名单、空 body 拒绝）、`:98-123`（落 `artifacts`，返回文件名） |
| 7 | **SSRF 既有缺口** | `remote-image.ts:77-91` 只校验**首个** URL（localhost/127/10/169.254/192.168/172.16-31、仅 http/https）；`:61` 用 `redirect: "follow"` → **重定向可落到内网**；DNS rebinding 未处理 |
| 8 | UI 侧入参形状（重要） | `posts-composer.tsx:129` `images[0]`（图库 basename）、`videos-composer.tsx:323` `cover`（`entry.fileName` `:913`）、`publish-run-panel.tsx:171` `imagePath: item.imagePath ?? ""`（**内容项里存的值**）、`library/page.tsx:140-146`（导入 UI） |
| 9 | 五态是**封闭**联合 | `src/lib/publish.ts:16`；`posts-composer.tsx:20` 用 `Record<PublishSiteResult["status"], TranslationKey>` → **新增 status 会编译失败**，故只能加性字段 |
| 10 | 结构化错误已有的位置 | `PublishSiteResult.error`（`publish.ts:24`）、`errorKind?: "unexpected"`（`:31`，语义 = 路由自己抛了，`publish-results.ts:81` 计 `unexpected`）；UI 已渲染 `result.error` 原文（`posts-composer.tsx:288`） |
| 11 | 封面数据的真实来源 | `src/app/api/content/import-url/route.ts:49` `imagePath: article.imageUrl`（**远程 URL 由此入库**）；历史行由此产生 |
| 12 | 恢复路径所需 API **已存在** | `contentPatchSchema.images`（`validation.ts:142,146`）→ `src/app/api/content/[id]/route.ts:20-26` 把 `images[0]` 同步进 `imagePath`；本地化用 `POST /api/images/from-url`（事实 5）。**无需新路由** |
| 13 | 测试现状 | `src/app/api/content/import-url/route.test.ts` **存在**；`src/lib/remote-image.test.ts` **不存在**；`src/app/api/images/from-url/**` **无测试** |
| 14 | 内容项封面展示 | `metadata.images` 优先、`imagePath` 兜底（`src/lib/content-images.ts:10-17`）；`resolveArtifactImageSrc` 对远程值放行（所以远程封面今天在库里**能显示**、只在发布时消失） |

**方法纠错记录（避免误导后续）**：本轮初次检索用 `Select-String -Path 'src/**/*.ts'`，PowerShell 该写法只匹配 `src/<dir>/<file>`（两层），漏掉 `src/app/api/**`、`src/components/**`，一度得出「`fetchRemoteImageToArtifacts` 无调用方」的错误结论。改用 `Get-ChildItem -Recurse | Select-String` 后更正为事实 5。

## 2. 改动范围（精确到文件与函数）

### 2.1 导入侧（要求 ①）

| 序号 | 文件 / 位置 | 改动 |
| --- | --- | --- |
| I1 | `src/app/api/content/import-url/route.ts:44-57` | 封面先本地化：`article.imageUrl` 非空时 `await fetchRemoteImageToArtifacts({ url })`（复用事实 5 的既有函数与前置 `isFetchableImageUrl`）。**成功** → `imagePath = <返回的 basename>`；**失败** → `imagePath` **保留远程 URL**（不丢封面、不阻塞导入，A04 验收②） |
| I2 | 同上 `metadata`（`:50-55`） | 加键 `coverLocalization: { status: "localized" \| "failed"; url: string; fileName?: string; reason?: string }`。仅加键：`mergeContentMetadata` 展开语义不受影响（`content-images.ts:24-32`），`contentImageList` 只读 `metadata.images`（不受影响） |
| I3 | 响应体（`:71`） | 加性字段 `coverLocalization?`（与 `metadata` 里同一份），**保留** `{ item }` 形状；`library/page.tsx:140` 的 `apiPost<{ item: ContentItem }>` 不因加性字段改变类型安全 |
| I4 | `src/app/[locale]/(console)/content/library/page.tsx:63,138-147,153` | `handleImportUrl` 读到 `coverLocalization.status === "failed"` 时，把成功提示与封面警告**合并成一条 `warning` 文案**（含恢复指引）。现状核实：该页只有**一个** notice 槽位且未传 `tone`（`:63` `useState("")`、`:153` `<ConsoleNotice message={notice} onDismiss …/>`，`tone` 默认 `success`）→ 最小改法是把 `notice` 升为 `{ message, tone }`（`console-surface.tsx:43-52` 已支持 `warning`），**不新增槽位、不改组件** |
| I5 | i18n × 3 | 新 key `contentCoverLocalizeFailed`（en / zh-cn / zh-hk 各 1 条，共 +3） |

> 不改：`fetchArticleText`/`rewriteArticle`、`createContentItem`、`createUsageRecord`、`importUrlSchema`、以及导入的**成功/失败语义**（导入仍先 201/失败仍走 `failFromError`）。

### 2.2 发布侧（要求 ②）

| 序号 | 文件 / 位置 | 改动 |
| --- | --- | --- |
| P1 | `src/lib/publish.ts:34-48` | 用**一个具名判定**替换两个静默 `""` 分支（建议 `export function resolveCoverPath(imagePath: string): { kind: "none" } \| { kind: "local"; path: string } \| { kind: "remote"; url: string }`）。判定规则与今天**逐字相同**（空 → none；`^https?://` → remote；绝对路径 → local；否则 join `artifactsRoot()`），唯一差别是 `remote` **不再塌成 `""`**，而是把事实交给调用方。`resolveLocalVideoPath` **保持原样**（视频不在本卡范围，作者要求⑥） |
| P2 | `src/lib/publish.ts:50-89` `publishToSite` | `kind === "remote"` 时在 `runSiteBrowserTool` **之前**短路返回：`{ accountId, accountName, platform, status: "failed", errorCode: "remote_cover_unresolved", error: <人类可读原因，含远程 URL> }`。**不再启动浏览器**（可测：mock 断言零调用） |
| P3 | `src/lib/publish.ts:18-32` `PublishSiteResult` | **加性**可选字段 `errorCode?: "remote_cover_unresolved"`。**不复用** `errorKind`（它的语义是「路由自己抛了」，被 `publish-results.ts:81` 计入 `unexpected`）；**不新增** `status`（事实 9：会编译失败） |
| P4 | `src/lib/publish.ts:110-134` `preparePublishDraft` | `kind === "remote"` 时不启动浏览器，返回**加性** `blockedReason?: { code: "remote_cover_unresolved"; message: string }`，并把既有字段填成「什么都没交接」：`url: ""`、`drafted: false`、`evidence: NO_DRAFT_HANDED_OVER`、`loginRequired: false` |
| P5 | `src/app/api/publish/draft/route.ts:28-52` | 若 `result.blockedReason` 为真：**不调用 `rememberPublishDraft`**（关键：不落 receipt，verify 无从消费，也就不可能产生「成功」记录），响应 200 + `blockedReason`（单账号模型；替代方案见 §7 D4） |
| P6 | `src/components/creation/publish-run-panel.tsx:185-196` | 与既有 `publishDraftLoginRequired` / `publishDraftEmpty` **同形**：`blockedReason` → `patchTab(index, { status: "failed", error: t("publishDraftCoverUnresolved") })` |
| P7 | `src/components/creation/posts-composer.tsx:281-289` | `result.errorCode === "remote_cover_unresolved"` 时渲染 `t("publishCoverUnresolved")`，否则保持渲染 `result.error` 原文（向后兼容） |
| P8 | i18n × 3 | 新 key `publishCoverUnresolved`、`publishDraftCoverUnresolved`（共 +6） |
| P9 | `src/app/api/publish/route.ts` | **零改动**。顺序保持「账号存在性 → 登录风控（`:53`）→ `publishToSite`（`:80`）→ `createPublishRecord`（`:86-99`）」；远程封面失败将作为 `failed` 自动写一条 `publish_records`（**可见 + 可审计**），与既有 `recordStatusByResult.failed` 一致 |

> **恢复路径（要求⑦，全部复用既有 API，无新路由）**：① `POST /api/images/from-url { url }` → 得到 `fileName`；② `PATCH /api/content/[id] { images: [fileName] }` → `[id]/route.ts:20-26` 同步 `imagePath`。UI 入口建议放在发布失败行的错误文案旁（本卡先保证文案里写明这两个动作；按钮化可延后）。

### 2.3 明确不改（本卡红线）

`recordPublishSuccess` 及其调用序（`src/lib/publish-facts.ts:42-63`）｜`POST /api/publish/verify` 全链路｜`summarizePublishResults` 与五态语义｜`errorKind: "unexpected"` 语义与计数｜`src/lib/threads.ts`（消费点 C）｜`src/lib/remote-image.ts` 下载语义（含 `redirect: "follow"`）｜`resolveLocalVideoPath` 与视频链路｜数据库 schema / 迁移 / seed｜`POST /api/images/from-url` 既有行为｜`publishInputSchema`。

## 3. 冻结面影响（要求：先说明再实施）

### 3.1 不受影响（逐条核对）

| 冻结项 | 本卡是否触碰 | 依据 |
| --- | --- | --- |
| C2 写入顺序（先 `publish_records` 再 `content_items.status`） | **不触碰** | 本卡不调用 `recordPublishSuccess`（`publish-facts.ts:42-63`）；远程封面路径**根本不会**走到 verify/成功分支 |
| verify 消费 receipt 语义 | **不触碰** | `/api/publish/verify` 零改动；P5 保证远程封面路径**不写 receipt**（`rememberPublishDraft` 不被调用），因此 verify 不可能据此产生成功 |
| 五态 `PublishAccountStatus` | **不新增、不改语义** | 复用既有 `failed`；新增值会让 `posts-composer.tsx:20` 的 `Record` 编译失败（事实 9） |
| `summarizePublishResults` 不变式 | **不触碰** | 不用 `errorKind` 承载新语义 → `unexpected` 计数不变；`failed` 桶 +1 属既有语义 |
| `POST /api/publish` 的 HTTP 契约 | **不触碰** | 仍 200 + `{results, summary}`；`retrySafe` 分支不涉及 |
| AI Runtime | **不触碰** | 无模型调用 |

### 3.2 唯一触碰点（需要作者书面确认）

| 项 | 内容 |
| --- | --- |
| 触碰位置 | `src/lib/publish.ts`（`resolveLocalImagePath` → `resolveCoverPath`、`publishToSite`、`preparePublishDraft`），即 C2 发布链条上的「预填/发布」入口 |
| 行为语义变化 | **仅对 `imagePath` 是 `http(s)://` 的内容**：<br>**今天**：远程封面 → `""` → 平台只收到文字，`publishToSite` 可能返回 `published`/`drafted` → 面板/`publish_records` 报告一次「成功」，封面**静默丢失**（这正是缺陷 #3）。<br>**本卡后**：不启动浏览器 → `status: "failed"` + `errorCode: "remote_cover_unresolved"` → 写一条 `failed` 记录 → 面板显示可读原因 → 用户先补/清封面再发。 |
| 为什么必须改 | 作者定下的验收底线：「任何路径都不能再把远程封面静默转换成空字符串」。不改这一点，策略 (c) 不成立 |
| 是否属于规则 §4 的冻结面 | 规则只冻结「`recordPublishSuccess` 写入顺序」与「verify 消费 receipt 语义」——本卡**均未触碰**。但 A04 停止边界写过「不改发布成功判定契约」，而本卡**改变了这类内容是否会被尝试发布**（成功判定规则本身未变：仍以 receipt 为准） |
| 建议 | 按 -03 先例，**本 §3 可直接作为 CR 正文**（`docs/architecture/ci-p5-03-freeze-surface-change-request.md`，状态 `待批准`），作者批准后实施。理由：语义确实变了，书面留痕比口头批准更符合「冻结面先说明再改」 |
| 可回滚性 | 高：改动集中在 `src/lib/publish.ts` 一个文件 + 2 个组件文案；回滚即恢复 `resolveLocalImagePath` 的 `""` 分支 |

### 3.3 与既有「可见失败」词汇的关系（避免语义混淆）

| 既有概念 | 语义 | 本卡新增是否与它冲突 |
| --- | --- | --- |
| `status: "login_required"` | 账号健康检查判定登录失效，**未**尝试发布 | 否。远程封面检查在**登录风控之后**执行（顺序见 P9），登录问题优先报 |
| `status: "failed"` + `errorKind: "unexpected"` | **路由自己抛了**，`unexpected` 计数 | 否。本卡**不复用** `errorKind`，故 `unexpected` 计数不因本卡变化 |
| `status: "unsupported"` | 平台不支持该内容形态 | 否。本卡不引入该判定 |
| `drafted: false` / `publishDraftEmpty`（C2-1a） | 预填执行了，但页面没接受内容 | 否。本卡新增 `blockedReason` 与之并列但更早（**根本没预填**） |

---

## 4. 兼容性矩阵（要求 ③）

| # | 内容形态 | 今天的行为 | 本卡规定的行为 | 是否回归风险 |
| --- | --- | --- | --- | --- |
| 1 | 无封面（`imagePath === ""`） | 正常发布（无图） | **同今天**（`kind: "none"` 分支逐字不变） | 无 |
| 2 | 本地 basename（如 `agent-image-….png`） | join `artifactsRoot()` → 上传 | **同今天** | 无（`publish` 不回归的第一优先级） |
| 3 | 本地绝对路径 | 原样使用 | **同今天** | 无 |
| 4 | 本地 basename 但文件**不存在** | `setInputFiles` 抛错 → `failed` + Playwright 原文 | **同今天**（本卡不顺手改文案） | 无 |
| 5 | **历史远程 URL**（导入产生） | 静默丢封面，可能报「成功」 | **`failed` + `errorCode`，不启动浏览器**；写 failed 记录；UI 可读原因 + 恢复路径 | **有意的行为变化**（§3.2） |
| 6 | 远程 URL 但已死链 | 同 5（`resolveLocalImagePath` 不联网） | 同 5（本卡**不**在发布时联网取封面） | 有意变化 |
| 7 | `metadata.images[0]` 本地而 `imagePath` 远程 | 发布走 `imagePath` → 静默丢 | `failed` + `errorCode`（**不猜**用户想用哪张） | 有意变化 |
| 8 | 视频（`videoPath`） | 远程 → `""`（静默） | **同今天**（作者要求⑥：视频不在本卡范围，登记为后续） | 无 |
| 9 | 旧 worker（`threads.ts`） | 远程 URL 交 `setInputFiles` → 抛错（非静默） | **同今天**（不改） | 无 |
| 10 | 已被 `from-url` 本地化过的图库图 | 本地 | **同今天** | 无 |

---

## 5. 安全边界（要求 ④）

| 项 | 结论 |
| --- | --- |
| 复用范围 | 导入侧**只复用** `isFetchableImageUrl` + `fetchRemoteImageToArtifacts`（`remote-image.ts:77-123`），不新写下载、不新写 URL 校验 → 门槛不降低 |
| 前置校验 | 与 `from-url:19` 同形：调用前先过 `isFetchableImageUrl`，不合法则**不发起请求**（按现状保留远程引用并记 `failed`） |
| 大小 / 类型 / 超时 | 10MB 上限、content-type 白名单 + 扩展名兜底、3.5s/8s 双超时（既有常量，不改） |
| **已知缺口（登记，不在本卡收紧）** | `downloadImage` 用 `redirect: "follow"`（`:61`），而 `isFetchableImageUrl` 只校验**首个** URL → 重定向可落到内网（SSRF）；DNS rebinding 未处理。**该缺口在 `POST /api/images/from-url` 上今天就存在**，本卡只增加了一个同样受此影响的调用点（导入侧），不放大也不修复 → 见 §7 D2 |
| 凭据 / 隐私 | 本卡不涉及模型调用与账本；不写日志中的远程图片二进制；`reason` 只记错误消息（不含 URL 之外的用户数据） |

## 6. 测试计划（要求 ⑤）

| 序号 | 文件 | 用例（新增/扩展） |
| --- | --- | --- |
| T1 | **新建** `src/lib/remote-image.test.ts`（A04 原本就要求；当前缺失） | ① 正常 PNG → 写入 artifacts 并返回 `online-*.png`；② `image/png` 之外的类型 → `The link does not point to a supported image`；③ 空 body → `The downloaded image is empty`；④ >10MB → `The image is larger than 10MB`；⑤ `isFetchableImageUrl` 拒绝：`ftp:`、`localhost`、`127.0.0.1`、`10.x`、`192.168.x`、`172.16-31.x`、`169.254.x`、非法 URL；⑥ 原始超时 → 落到 `fallbackUrl` 并成功；⑦ 两跳皆失败 → 抛**最后一次**错误；⑧ 同一 URL 不重复尝试 |
| T2 | 扩展 `src/app/api/content/import-url/route.test.ts` | ① 图片下载成功 → 201，`item.imagePath` 为**本地 basename**、`metadata.coverLocalization.status === "localized"`；② 下载失败 → **仍 201**、`imagePath` **保留远程 URL**、`status === "failed"` 且带 `reason`（**不得**为 `""`）；③ 文章无图 → 无 `coverLocalization` 且 `imagePath` 为空；④ 既有 26 项（改写/计量/错误码）逐条不回归 |
| T3 | 扩展 `src/app/api/publish/route.test.ts` | ① 远程封面 → 该账号 `failed` + `errorCode: "remote_cover_unresolved"`，且 **`publishToSite` 的浏览器工具零调用**；② 同时写了一条 `failed` 的 `publish_records`；③ 本地封面/无封面 → 与今天逐条相同（含 5b `unexpected` 计数不变式）；④ 登录风控优先于封面检查（同一账号两者都命中时仍报 `login_required`） |
| T4 | 扩展 `src/app/api/publish/draft/route.test.ts` | ① 远程封面 → 响应带 `blockedReason`，且 **`rememberPublishDraft` 未被调用**（不落 receipt）；② 本地封面 → 与今天相同 |
| T5 | **新建** `src/lib/publish.test.ts`（判定函数单测；若与既有惯例冲突可并入现有测试） | `resolveCoverPath`：`""`→none；`a/b.png`→`artifactsRoot()/b.png`；绝对路径→原样；`http(s)://…`→remote（**断言不再是 `""`**） |
| T6 | i18n 三元组不变式（既有测试若覆盖 key 集合，跟随更新） | 3 语言同时 +3 key，`TranslationKey` 类型不缺项 |

**回归命令**（与规则 §7 一致，直连二进制）：`node_modules\.bin\tsc.cmd --noEmit`、`node_modules\.bin\vitest.cmd run`、`node_modules\.bin\eslint.cmd .`。
**真实安装验证**（作者授权后）：导入一条带远程封面的 URL → 库里看到本地封面；构造一条 `imagePath` 为远程 URL 的历史内容 → 发布得到可见失败 + `publish_records` 一条 `failed`；用恢复路径修好后发布成功（并确认封面真的上了平台）。打包版 Electron 若要求，另计。

---

## 7. 待裁决（4 条，均不阻塞本卡主线）

| # | 问题 | 我的建议 | 理由 |
| --- | --- | --- | --- |
| D1 | 旧 worker 路径（`src/lib/threads.ts:60-62`，被 `worker/runner.ts:24` 使用）是否也加前置拦截？ | **本卡只登记，不改** | 它**本来就不静默**（远程 URL 交 `setInputFiles` 会抛错，属可见失败），已满足底线；且它属工作流/worker 线，混改会扩大范围 |
| D2 | `redirect: "follow"` 的 SSRF 缺口（`remote-image.ts:61` + `:77-91`）是否本卡一并收紧？ | **不在本卡**，另立安全小卡 | 收紧会改变 `POST /api/images/from-url` 的**既有已上线行为**（部分真实站点依赖重定向），属独立风险面；本卡只增加同类调用点，门槛不降低 |
| D3 | 导入失败时是否允许**不阻塞**导入、仅 warning？ | **保持不阻塞**（A04 验收②原口径） | 导入的价值是文字内容；封面失败不应让用户丢掉已抓取的正文。但**必须**留下 `metadata.coverLocalization` + UI 警告，使其可被看见、可被修复 |
| D4 | 辅助路径（`/api/publish/draft`）以 `200 + blockedReason` 还是 `4xx` 表达？ | **200 + `blockedReason`** | 该路由是单账号且面板按 tab 呈现；`4xx` 会走客户端 catch 分支，丢失「哪个字段被阻断」的结构化原因。若作者偏好 HTTP 语义化，改成 `400 REMOTE_COVER_UNRESOLVED` 且面板改用 `apiErrorTranslationKey`（需同时改 `publish-run-panel.tsx:196` 的错误渲染） |

---

## 8. 验收标准（对齐作者底线）

1. **不静默**：全仓再无「远程封面 → `""`」路径。证明方式 = 旧 `resolveLocalImagePath` 被删除 + `kind === "remote"` 分支必然产出 `failed`/`blockedReason`，两者都有单测锁定。
2. **用户知道**：`publish_records` 有 `failed` 记录；自动发布列表与辅助面板都显示可读原因（3 语言）。
3. **系统知道**：失败原因结构化（`errorCode` / `blockedReason.code`），不靠解析文案。
4. **可恢复**：复用 `POST /api/images/from-url` + `PATCH /api/content/[id]`；文案里写明两个动作。
5. **不回归**：本地封面、无封面、视频、旧 worker 四条路径行为与今天逐条相同（T2/T3/T4 覆盖）。

**已知风险（本卡自担，需在交付记录写明）**：本卡生效后，**历史远程封面内容在用户补齐封面之前无法再发布**——这是底线的必然代价，必须靠 §2.2 的恢复路径与文案把代价讲清楚。

---

## 9. 下一步

1. **等作者对 §3.2 / §7 的裁决**（尤其 D2、D4 与「是否以 CR 形式留痕」）。
2. 批准 → 按 **T1–T6 → I1–I5 → P1–P9** 顺序实施（先测试后实现；测试与实现同一张卡内完成）。
3. 完成后写 `docs/architecture/ci-p5-03-delivery.md`（含真实验证与未验证项），并在主线 §1 + 附录登记（与本次 CI-AI-IMG 同样的闭环要求）。
4. **不执行 Git 操作**，保留工作区现状（未提交基线见编号对照表 §7 第 3 条）。

> 本文件为**范围审查稿**，不含任何已实施代码；若范围被否决/修改，直接改本文件即可，不留半成品代码。


