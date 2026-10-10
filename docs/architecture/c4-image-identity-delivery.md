# C4「图像身份与来源」交付记录

> **卡片**：`docs/creator-workflow-audit.md` §5 的 **C4**（One image identity）＋ §6.3 决策 3（外部素材在创建时进入工作区）。
> **状态**：代码与测试已完成；`tsc` / 定向测试 / 全量测试 / `eslint` 均已运行（见 §3）。
> **未执行 Git 操作**，工作区保持未提交（基线见 `docs/development/capability-integration-numbering-map.md` §7）。
> **一处文档与实现的键名分歧必须由作者裁决**（见 §5 L3），本卡未擅自改文档、也未改名代码。

---

## 1. 交付内容（改动内容）

### 1.1 新增：唯一的「存储引用 + 来源」层

| 文件 | 内容 |
| --- | --- |
| `src/lib/content-image-assets.ts`（新增） | `toStoredImageReference()`（本地路径 / app URL / 裸文件名 → 裸文件名；远程 URL 原样；不可解析值保留不丢）、`imageAssetFrom()`、`mergeContentImageAssets()`（历史条目对身份与来源获胜，新写入只填空白）、`readContentImageAssets()`、`storedImagePatch()`、`imageAssetLedgerKey()`（账本 join 键）、常量 `contentImageAssetsKey = "imageAssets"` 与 `contentImageFailuresKey = "imageLocalizationFailures"` |
| `src/lib/content-image-assets.test.ts`（新增） | 上表每个导出的行为钉住（含「不可解析值保留」「空值不成为图片」「pre-C4 无 imageAssets 不是错误」） |

**复用而非新建**：身份/root/kind/mime/来源词汇全部来自既有 `src/lib/media-artifact-ref.ts` 的 `toMediaAssetRef()`（`writing-*`=copied、`online-*`=remote、`agent-image-*`=generated、`upload-*`=uploaded），**未新增素材表、未加 schema 列、未做迁移**。

### 1.2 写入路径统一

| 路径 | 文件 | 改动 |
| --- | --- | --- |
| 文章生成 | `src/lib/article-images.ts` | `resolveArticleImages()` 返回 `{ images, assets, skippedRemoteImages }`；`og:image` 由**远程 URL 原样入库**改为 `fetchRemoteImageToArtifacts()` 落到 `artifacts/` 并返回 `online-*` 文件名（`remoteUrl` 记进 asset）；下载失败不再静默（进 `skippedRemoteImages`）；产品图复制返回裸文件名；AI 生成图记 provider/model（**只由执行的写入者记录，绝不从文本模型推断**） |
| 文章生成落库 | `src/lib/article-generation.ts` | 写 `metadata.images` + `metadata.imageAssets` + 失败时 `metadata.imageLocalizationFailures` |
| URL 导入 | `src/app/api/content/import-url/route.ts` | 封面本地化成功 → `imagePath` = `online-*` 文件名 + `storedImagePatch()`（含 `remoteUrl` 来源）；失败 → **仍 201**、`imagePath` 保留远程 URL、`imageLocalizationFailures` 记地址（**不再是空串**） |
| 手工创建 | `src/app/api/content/route.ts` | 用 `storedImagePatch()` 写 `images` / `imageAssets`，不再只写 `imagePath` |
| 编辑器保存 | `src/lib/content-images.ts`（`mergeContentMetadata()`） | 保存是唯一的合并点：`images` 归一为存储引用，`imageAssets` 与列表保持同步；历史条目在**下一次保存**时懒归一，无需迁移 |
| Agent 图像工具 | `src/db/repository.ts`（`updateContentItemImage()`） | 收到本地路径 → `toStoredImageReference()` 存裸文件名；同时写 `imageAssets`（provider/model 由生成方提供）；chat 历史对账 `reconcileContentImagesFromChatHistory()` 复用同一写入函数，故自动取得同一形状 |
| Agent 图像工具（工具层） | `src/lib/agent/image-generation.ts`、`src/lib/agent/local-tools.ts` | 返回值与调用点按同一身份（文件名）对齐；`generate_image_file` 的输出路径即 `imageAssets` 的身份 |
| 读取侧 | `src/components/creation/articles-workspace.tsx`、`src/components/creation/videos-composer.tsx` | 改走共享读取（`contentImageList()` / `resolveArtifactImageSrc()`），删除本地解析副本 |

**未改**：`src/lib/artifact-image-url.ts` 的 `resolveArtifactImageSrc()`（URL 形状是冻结面：`article-editor` 会把该串写进 `content_body`）、`src/lib/media-artifact-ref.ts`。

### 1.3 测试改动（同卡内完成）

`src/lib/article-images.test.ts`、`src/lib/content-images.test.ts`、`src/lib/article-generation.test.ts`、`src/lib/ai/generate.test.ts` 重写/扩展；`src/app/api/content/import-url/route.test.ts` 就地扩展（成功用例改为断言 `^online-\d+-[A-Za-z0-9_-]{8}\.png$`、`metadata.images`、`imageAssets` 来源，并从 `routeTestDataDir/artifacts` 读回字节；新增一条**下载失败**用例：201 + `imagePath` 保留远程 URL + `imageLocalizationFailures`）；`src/app/api/ai-writing/generate/route.test.ts` 的产品图断言由「绝对路径」改为「`artifacts/` 下的裸文件名 + 同字节 + `imageAssets` 来源」。

---

## 2. 调用链路

```
写入
  POST /api/ai-writing/generate ─┐
  POST /api/content/generate ────┴→ article-generation.generateArticle()
                                   → article-images.resolveArticleImages()
                                       ├ 产品图:  copyIntoArtifacts()             ⇒ writing-*.png
                                       ├ og:image: fetchRemoteImageToArtifacts()  ⇒ online-*.png (+远程地址)
                                       └ AI 图:   generateImageFile()             ⇒ agent-image-*.png (+provider/model)
                                   → repository.createContentItem({ imagePath,
                                       metadata: { images, imageAssets, imageLocalizationFailures? } })

  POST /api/content/import-url  → import-url/route.ts（封面本地化 / 失败可见）→ createContentItem()
  POST /api/content             → storedImagePatch()
  PATCH /api/content/[id]       → api/content/[id]/route.ts → mergeContentMetadata() → images + imageAssets
  agent generate_image_file     → repository.updateContentItemImage() → 同一归一 + 来源

读取
  contentImageList(item)          → 封面 = 第一项（metadata.images 优先，imagePath 兜底）
  resolveArtifactImageSrc(value)  → 裸文件名 ⇒ /api/agent/artifacts?file=…；远程 URL ⇒ 原样
  publish.resolveLocalImagePath() → 本地路径（**远程值仍返回空串，见 §5 L1**）
  账本 join：imageAssetLedgerKey(asset) = fileName || remoteUrl || reference
```

---

## 3. 验证结果（实际命令与结果）

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **通过**（exit 0，无输出） | `tmp-c4-tsc.log` |
| 定向回归（18 个图像相关测试文件） | **通过**：18 files / 172 tests | `tmp-c4-vitest-6.log` |
| 受影响两文件（`import-url/route`、`ai-writing/generate/route`） | **通过**：2 files / 16 tests | `tmp-c4-vitest-5.log` |
| 全量 `node_modules\.bin\vitest.cmd run` | **158 passed / 1 failed file；1301 passed / 2 failed tests** | `tmp-c4-vitest-full2.log` |
| 与基线逐条对比 | 失败项**完全一致** = `src/worker/runner.test.ts` 的 2 条 CI-P7-03 step-gate 用例（基线 `tmp-ci-img-02-vitest.log` 同两条）→ **C4 净新增失败 0** | 两次 `FAIL ` 行逐字比对 |
| `node_modules\.bin\eslint.cmd .` | 3 errors + 1 warning，**全部为既有问题**：`tmp-probe-db.cjs`、`tmp-probe-zod-json-schema.cjs`（工作区遗留脚本）与 `chat-conversation.tsx:146` 的 `react-hooks/exhaustive-deps` 警告；**本卡改动的文件 0 问题** | `tmp-c4-eslint.log` |

**未运行（需标注）**：打包版 Electron 手工验证、真实远程站点导入（网络依赖）。因此「真实 `og:image` 本地化」只有单测与路由测试覆盖，**没有**真实网络实测记录。

---

## 4. 行为变化与代价（作者需知晓）

1. **`og:image` 由远程 URL 变为本地副本**：这是决策 3 的直接结果；代价是导入/生成多一次图片下载（3.5s 原始超时 + 8s 回退，10MB 上限），失败时不再静默而是写入 `imageLocalizationFailures`。
2. **生成文章的产品图封面由绝对路径变为裸文件名**：`metadata.images` / `imagePath` 都是文件名，浏览器与发布侧通过既有解析器寻址（发布侧在 `artifacts/` 兜底）。
3. **无迁移、无批量重写**：pre-C4 条目照旧可读（`contentImageList()` 兜底 `imagePath`、`toStoredImageReference()` 归一），来源在**下一次写入**时补齐。
4. **`imageAssets` 只在有图时写入**：无图条目仍是 `{ type, images: [] }`，既有调用方与测试读取不变。

---

## 5. 遗留问题

### 阻塞（需作者裁决）

- **L3 键名分歧（文档 vs 实现）**：`docs/architecture/ci-p5-03-remote-cover-scope-and-freeze-impact.md`（2026-10-10 已批准策略 c）要求导入侧写 **`metadata.coverLocalization: { status, url, fileName?, reason? }`**，并在 `library/page.tsx` 合并出封面警告（该文 §2.1 I2/I3/I4、§6 T2）。C4 实现写的是 **`imageAssets` + `imageLocalizationFailures`**（无 `coverLocalization`、无 UI 提示）。不一致点：
  - 文件：`ci-p5-03-remote-cover-scope-and-freeze-impact.md:51-53,145,162` ↔ `src/lib/content-image-assets.ts:28,37`
  - 取值：文档 `coverLocalization.status ∈ {"localized","failed"}` ↔ 实现 `imageAssets[].source ∈ {"generated","uploaded","copied","remote","unknown"}` + `imageLocalizationFailures: string[]`
  - 按规则 §1 **只报告不判定**：请裁决「C4 取代 CI-P5-03 键名（则改文档）」还是「保留 CI-P5-03 键名（则改实现）」。

### 可延后（不阻塞本卡）

- **L1 发布侧远程封面仍静默丢弃**：`src/lib/publish.ts:34-40` 的 `resolveLocalImagePath()` 对 `http(s)://` 返回 `""`。C4 只让**创建侧**不再产生远程封面，未动发布侧（CI-P5-03 的发布侧部分仍是范围审查稿、尚未实施）。残留入口：worker 的 URL 导入（见 L2）与历史远程封面条目。
- **L2 `createContentItem()` 未归一（worker 路径）**：`src/db/repository.ts:425-451` 原样写入 `imagePath` 与 `metadata`，故 `src/worker/runner.ts:281`（远程 `imageUrl`）与 `:360`（`composeImage` 参数）仍写「无来源标注的原始值」，是全仓唯一未走 C4 形状的创建写入点。**本卡未改**：C4 授权范围是「文章生成 / URL 导入 / 编辑器保存 / agent 图像工具 / 账本」，且 `ci-p5-03-...md` §7 D1 已把 worker 线登记为「只登记、不改」；改动它会改变 4 个 worker 调用点的入库形状，属跨线扩范围 → 按规则 §3 报告而不擅自扩大。
- **L4 失败只入数据、无用户可见面**：`imageLocalizationFailures` 有写入者与测试钉住，但**全仓无读取者**（UI 不提示）；`readContentImageAssets()` 亦然（仅内部与测试使用，供下一张卡消费）。CI-P5-03 要求的「用户知道」只完成了一半。
- **L5 未登记进主线**：`docs/coolpilot-capability-integration-plan.md` §1 尚无 C4 行（该文仅在 `:2080` 以「属 CI-P5-03 / 审计 C4 决策项」提及）。C4 与 CI-P5-03 的编号关系（包含 / 并存）需作者给号后再登记，本卡不自行编号。

---

## 6. 下一步编号建议

1. 作者裁决 **L3**（键名）→ 一次性收敛文档或实现，避免 `coverLocalization` 与 `imageLocalizationFailures` 长期并存。
2. 若采纳 `imageAssets` 为实现口径：把 CI-P5-03 的**发布侧**部分（远程封面 → 结构化失败 + `publish_records.failed` + 恢复路径文案）作为独立卡实施，并可顺带补 **L4** 的 UI 提示。
3. **L2** 单独开一张「worker 创建写入归一」小卡（含 `runner.test.ts` 的 2 条既有 CI-P7-03 失败一并确认归属）。
