# P1 卡 1 只读基线核查报告（A02 统一素材 URL 解析 + A01 规则声明）

状态：**只读核查完成，未修改任何源码 / 测试 / 数据库 / 配置 / 既有文档**；本报告是唯一新增文件。
基线提交：`3b48126`（`main`，2026-10-09）。
本轮执行的命令全部为只读（`git status` / `git log` / `Get-Content` / `Select-String`）；**未**运行 tsc / vitest / eslint / 格式化 / 迁移，未暂存、未提交、未还原任何既有改动。

## 〇、结论摘要（对应人工复核的 4 条验收标准）

| 复核项 | 结论 | 证据位置 |
| --- | --- | --- |
| ① 是否找全实际调用方 | 卡片写的"四处客户端重复"**实际是 5 处客户端 + 1 处服务端字面重复**，另有 2 处"同形不同根"的实现（`videos-composer.coverUrl`、`products.ts`）/ 1 处视频孪生（`video-library.videoUrl`）。清单见 §三 | §3.1～§3.4 |
| ② 是否准确描述解析器接口与兼容行为 | `artifact-image-url.ts` 只有 1 个导出函数 + 1 个扩展名集合，**不做任何输入规整**；真正的兼容规则分散在调用方的正则与 basename 分支里。见 §二 | §2.1～§2.3 |
| ③ 是否用现有测试区分已验证 / 推测 | 逐行标注「代码已支持 / 已有测试证明 / 尚未确认」三态；**5 处客户端解析器 0 测试覆盖**（全仓 `.test.tsx` 数量为 0），`publish.ts` 的解析函数也**无测试文件**。见 §四 | §4.1～§4.4 |
| ④ 是否给出真正最小改动并守住边界 | 建议 = 「抽 1 个纯前端函数 + 6 个调用点替换 + 1 个契约测试文件」，**URL 形状保持字节一致**（因为旧形状已被写进 `content_items.body` HTML，见 §3.5）；`publish.ts` 语义、素材写入格式、Asset 表、C2 契约全部排除。见 §六 | §6.1～§6.2 |

本轮另发现 **3 个此前审计未记录的既有不一致**（均已定位到行号，均不擅自修复）：

- **N1（.gif 不可服务）**：`IMAGE_FILE_EXTENSIONS` 与 `/api/images/upload`、`remote-image.ts` 都接受 `.gif`，但服务路由 `api/agent/artifacts/route.ts:8-13` 的 `contentTypes` **没有 `.gif`** → 图库列出并返回的 gif URL 必然 404（§4.1 矩阵 `x.gif` 行、§4.2）。
- **N2（应用内 URL 作为输入值会被解析坏）**：把 `/api/agent/artifacts?file=x.png` 当作"素材引用"传给客户端解析器，basename 分支会产出 `...?file=artifacts%3Ffile%3Dx.png`（§4.1 矩阵第 9 行、§4.2）。
- **N3（卡片清单漏项）**：`src/app/[locale]/(console)/content/library/page.tsx:16-21` 是第 5 处客户端解析器（内容中心列表/详情/封面的唯一渲染入口），不在卡片列举的四处之内。

## 一、工作区基线及变更保护记录

`git --no-pager log -1 --oneline` → `3b48126 (HEAD -> main) docs(p5-c3): name both commits in the freeze status line`
`git ls-files docs/p1-card-01-baseline.md` → 空（本报告为新增，未跟踪；核查前不存在）。

`git --no-pager status --short`（核查前，原样记录，本轮未做任何改变）：

```
 M README.md
 M README.zh-TW.md
 M docs/creator-workflow-audit.md
 M next.config.ts
 M src/app/api/publish/draft/route.test.ts
 M src/app/api/publish/draft/route.ts
 M src/app/api/publish/verify/route.test.ts
 M src/app/api/publish/verify/route.ts
 M src/components/creation/content-publish-dialog.tsx
 M src/components/creation/publish-run-panel.tsx
 M src/lib/browser-preview-session.ts
 M src/lib/browser-preview-shared.ts
 M src/lib/browser-preview.ts
 M src/lib/publish.ts
 M src/locales/en.json
 M src/locales/zh-cn.json
 M src/locales/zh-hk.json
 M src/test/browser-session-fixture.ts
?? docs/agent-execution-audit.md
?? docs/assisted-publishing-engine.md
?? docs/backup-restore-audit.md
?? docs/data-model-inventory.md
?? docs/dev-exec-list.md
?? docs/dev-list.md
?? docs/menu-inventory.md
?? docs/open-source-capability-map.md
?? docs/p0-acceptance-and-p1-sequencing.md
?? src/lib/browser-preview-session.test.ts
?? src/lib/browser-preview-shared.test.ts
?? src/lib/publish-run-teardown.test.ts
?? src/lib/publish-run-teardown.ts
```

保护记录：

1. 上述 21 项改动 **未被覆盖、还原、暂存、提交**；本报告不修改其中任何文件（含 `src/lib/publish.ts`——它属于既有未提交改动，卡 1 的停止边界也明确不改其语义）。
2. `src/lib/artifact-image-url.ts`、`src/lib/paths.ts`、`src/lib/remote-image.ts`、`src/lib/content-images.ts`、`src/app/api/agent/artifacts/route.ts` 等本卡相关文件 **均无未提交改动**（不在上面列表内），因此本报告对它们的引用即当前工作区事实。
3. 行尾/编码：本仓 `core.autocrlf=true`，无 `.gitattributes`；三份已交付文档实测 `crlf == lf`（无孤儿 LF）、无 BOM。本报告沿用 CRLF + 无 BOM。

## 二、解析器当前接口与行为

### 2.1 `src/lib/artifact-image-url.ts`（16 行，唯一"服务端已有解析器"）

| 导出 | 行 | 签名 | 行为 |
| --- | --- | --- | --- |
| `IMAGE_FILE_EXTENSIONS` | 9 | `Set<string>` = `{".png",".jpg",".jpeg",".webp",".gif"}` | 仅被 `src/lib/image-library.ts:3,9,24` 用于列出/删除 artifacts 图片 |
| `artifactImageUrl` | 14-16 | `(fileName: string) => string` | 返回 `` `/api/agent/artifacts?file=${encodeURIComponent(fileName)}` `` |

- `ARTIFACT_PATH = "/api/agent/artifacts"`（11）是模块私有常量。
- **不做**任何输入规整：不 `trim`、不取 basename、不判空、不区分远程 URL / 绝对路径 / 裸文件名；传路径或 URL 就整串编码。即"解析规则"目前 **不在** 这个模块里，而在每个调用方。
- 文件头注释（1-6）自称 "Kept free of Node imports so both server routes and client components can use it"，**但事实上今天没有任何客户端组件导入它**：全部 3 个导入点都是服务端模块——`src/app/api/images/route.ts:4`、`src/app/api/images/from-url/route.ts:2`、`src/lib/image-library.ts:3`；另有测试 `src/app/api/images/route.test.ts:58`。也就是说"客户端可复用"是设计意图，尚未落地。

### 2.2 该 URL 的服务端服务契约 `src/app/api/agent/artifacts/route.ts`

`GET`（15-38）实际接受的输入比 URL 构造器严格得多：

| 规则 | 行 | 事实 |
| --- | --- | --- |
| 只认 `?file=` 的**裸文件名** | 17-24 | `path.basename(requested)` 后要求 `fileName === requested`，否则 404 |
| 扩展名白名单只有 4 个 | 8-13, 24 | `.jpg/.jpeg/.png/.webp`；**`.gif` 缺失 → 404**（见 §4.2 N1） |
| 空串 / 未知扩展名 → 404 | 24 | `!requestedFile` 或 `!contentTypes[ext]` 为真即 404 |
| 目录穿越 / 带目录的引用 → 404 | 20-24 | `../credential-vault.json`、`publish-logs/shot.png` 均 404（`route.test.ts:70-78` 已固定） |
| 读取失败 → 404（不初始化目录） | 28-38, 18-19 | 用 `artifactsRoot()` 解析，`P5-B0-2.5` 语义 |

### 2.3 服务端文件系统解析 `src/lib/publish.ts`（**本卡不改**，只登记）

| 函数 | 行 | 输入 → 输出 |
| --- | --- | --- |
| `resolveLocalImagePath` | 27-33 | `""` → `""`；`/^https?:\/\//i` → `""`；`path.isAbsolute` → **原样**；否则取 `split(/[\\/]/).pop()` 拼 `artifactsRoot()`；basename 为空 → `""` |
| `resolveLocalVideoPath` | 35-41 | 同上，根为 `videosRoot()` |

调用方只有两处，都是发布链路：`publishToSite`（48）与 `preparePublishDraft`（107）（分别服务 `/api/publish`、`/api/publish/draft`）。它的输出最终交给 Playwright `setInputFiles`（`src/lib/browser-preview-session.ts:1482`，视频 `:892`/`:952`/`:1085`），即"必须是一个真实存在的本地文件路径"。

### 2.4 其他易被误当"同一件事"的实现（**明确排除，不在 A02 范围**）

| 位置 | 行 | 根/用途 | 为什么不是 A02 对象 |
| --- | --- | --- | --- |
| `src/lib/products.ts` `productImageFileName` / `productImageUrl` | 4-16 | `uploads/product-images` → `/api/products/image?file=` | 不同目录、不同服务端路由、不同缓存策略（`&v=`）；`products.test.ts:24-33` 已固定 |
| `src/lib/video-library.ts` `videoUrl` | 41-43 | `videos/` → `/api/videos?file=` | 视频流（含 Range），`video-library.test.ts:37` 已固定 |
| `src/lib/paths.ts` `normalizeFileUrl` | 117-126 | DB 的 `file:` URL（`db/client.ts:14,24,27`、`workspace/manifest.ts:201`） | 与素材 URL 无关 |
| `src/lib/content-images.ts` `contentImageList` | 10-17 | 不是 URL 解析，是"取哪张图"的**唯一权威**（列表优先，空则回退 `imagePath`） | A02 应与它串联，而不是取代它 |

## 三、重复实现和调用方清单

### 3.1 客户端解析器：**5 处**（卡片只列了 4 处）

5 处函数体 **逐字相同**，仅函数名/参数名不同：

```ts
function <name>(path: string) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const fileName = path.split(/[\\/]/).pop() ?? "";
  return fileName ? `/api/agent/artifacts?file=${encodeURIComponent(fileName)}` : "";
}
```

| # | 文件:函数:行 | 调用点（全部） | 卡片是否列出 |
| --- | --- | --- | --- |
| C1 | `src/components/creation/articles-workspace.tsx` `imageUrl` :57-62 | `:276` 文章卡片封面 `<img src={imageUrl(images[0])}>` | ✅ |
| C2 | `src/components/creation/ai-writing/ai-writing-step-output.tsx` `imageUrl` :29-34 | `:171` 生成结果缩略图 | ✅ |
| C3 | `src/components/creation/article-editor/article-editor.tsx` `resolveImageUrl` :42-47 | `:177` 插入正文（结果写进 body HTML，见 §3.5）、`:537` 封面预览 | ✅ |
| C4 | `src/components/creation/posts-composer.tsx` `resolveImageUrl` :17-22 | `:172` 已选图片缩略图 | ✅ |
| C5 | `src/app/[locale]/(console)/content/library/page.tsx` `imageUrl` :16-21 | `:125` 详情封面、`:221` 网格封面、`:265` 列表封面 | ❌ **漏项（N3）** |

C1/C2 的取图来源是 `metadata.images`/`imagePath` 的**本地副本**（`articles-workspace.tsx:51-55` 自己又写了一份 `articleImages()`，与 `content-images.ts:contentImageList` 同语义但**是第二份拷贝**：它不过滤空串）；C3/C4/C5 只拿到单个路径。

### 3.2 同形但只处理"裸文件名"的孪生：2 处

| 位置 | 行 | 调用点 | 差异 |
| --- | --- | --- | --- |
| `src/components/creation/videos-composer.tsx` `coverUrl` | 76-78 | `:786`、`:909`（选图对话框缩略图） | 无 `http(s)` 与绝对路径分支；值来自 `setCover(entry.fileName)`（`:899`），实际只会是裸文件名 |
| `src/app/api/images/upload/route.ts` `imageUrl` | 11-13 | `:35` 返回 `{ fileName, url }` | **服务端**字面重复；此文件已 `import { ensureArtifactsRoot } from "@/lib/paths"`，引入 `artifactImageUrl` 零风险 |

### 3.3 服务端解析/消费点（发布链路与读取链路的全部入口）

| 位置 | 行 | 角色 |
| --- | --- | --- |
| `src/app/api/publish/route.ts` | 23, 73 | 把客户端传来的 `imagePath` 原样交给 `publishToSite`（不核验） |
| `src/app/api/publish/draft/route.ts` | 23, 28 | 同上，交给 `preparePublishDraft` |
| `src/lib/browser-preview-session.ts` | 904, 949-952, 1017-1019, 1407, 1474-1482, 1495 | 真正落盘的消费者：`setInputFiles(imagePath)`；C2-1a 的 `evidence.media` 由 `imagePath` 是否存在决定（`not_offered`） |
| `src/lib/threads.ts`（旧 worker） | 60-64, 99-102 | 只读 `item.imagePath`，无图即跳过；**不做任何解析**（等于要求库里存的是服务端能直接用的路径） |
| `src/components/creation/publish-run-panel.tsx` | 171 | `imagePath: item.imagePath ?? ""` ——**发布只发封面镜像，不遍历 `metadata.images`** |
| `src/lib/workspace/manifest.ts` | 252-264 | 用 `contentImageList` 收集引用，并**按 basename 计数**（注释明确：路由对"路径"答 404，所以引用按文件名算） |
| `src/db/repository.ts` | 380-406、408-419、492-511 | 写入方：`createContentItem` / `updateContentItemImage` / 聊天历史回填 |

### 3.4 写入方：`metadata.images` / `image_path` 今天实际会存进哪些形态

| 形态 | 写入证据（file:line） |
| --- | --- |
| **裸文件名** | 编辑器选图 `article-editor.tsx:172-174`（存 `image.fileName`）；动态发布勾选 `posts-composer.tsx:75-77`；视频封面 `videos-composer.tsx:899`；上游 `/api/images/upload`（`route.ts:33-35`）、`/api/images/from-url` 返回 `fileName` |
| **绝对本地路径** | `article-images.ts:13-19`（`copyIntoArtifacts` → `path.join(artifactsRoot(), "writing-…")`）；`agent/image-generation.ts:44-51`（`agent-image-…`）；`article-generation.ts:153`（`imagePath: images[0]`，可能来自上面两者）；`repository.ts:492-511` 回填（值来自 `chat_tool_calls.output_json.path`）；`products.image_path`（`api/products/image/route.ts:66`，另一根） |
| **远程 URL** | `api/content/import-url/route.ts:49`（`article.imageUrl` ← `scraper.ts:34` 的 `og:image`）；`article-images.ts:54`（web/mixed 策略）；worker `src/worker/runner.ts:114` |
| **应用内 URL `/api/agent/artifacts?file=…`** | `article-editor.tsx:196` 通过 `execCommand("insertHTML", …, `<img src="${url}" />`)` **把 URL 写进 `content_items.body`**（见 §3.5） |
| **空值** | `createContentItem` 默认 `imagePath: ""`（`repository.ts:398`）；`import-url` 无 og:image 时 `imageUrl === ""`（`scraper.ts:34`） |

### 3.5 关键兼容约束：URL 形状已被持久化进正文

`article-editor.tsx:196` 把 `resolveImageUrl()` 的**完整输出字符串**写进了 `content_items.body`（富文本 HTML）。正文里的 `<img src>` 不会在渲染时二次解析；因此：

- **任何对 `/api/agent/artifacts?file=` 形状的改动（前缀、参数名、加 `&v=`）都会让"旧正文"与"新插入"分成两代形状**，前者仍指向旧字符串——只要服务路由的契约不变，旧正文仍可渲染，但一旦改契约就会同时打断历史数据。→ 本报告据此把"保持 URL 形状字节一致"列为硬约束（§6.1）。
- 反过来说，`body` 里的应用内 URL 是**今天唯一真实存在的"应用内图片访问路径"形态**；把它作为解析器输入（§4.2 N2）目前**没有任何代码路径**，属于理论候选项而非现有契约。

## 四、输入类型与现有测试覆盖矩阵

### 4.1 行为矩阵（本轮实测）

用 `node -e` 逐条计算"客户端 5 处解析器"与"`publish.ts` `resolveLocalImagePath`"的输出（脚本见附录 A；`ARTIFACTS` 代表 `artifactsRoot()` 的绝对路径）。**这些是运行结果，不是推测。**

| 输入 | 为何可能是这个输入（写者证据） | 客户端 5 处输出 | `publish.ts` 输出 | 服务路由 `/api/agent/artifacts` |
| --- | --- | --- | --- | --- |
| `""` | `repository.ts:398` 默认值 | `""`（不渲染） | `""` → 不交给 `setInputFiles` | `?file=` → 404 |
| `a.png`（裸名，文件存在） | 编辑器/图库/动态发布选图 | `/api/agent/artifacts?file=a.png` | `ARTIFACTS\a.png` | **200**，正确 MIME |
| `missing.png`（裸名，文件不存在） | 选图后文件被删/删库 | 同上 URL（图裂） | `ARTIFACTS\missing.png` → `setInputFiles` 抛错 | 404 |
| `C:/app/artifacts/x.png`（**本机**绝对路径） | `article-images.ts:16`、`image-generation.ts:48` | `?file=x.png`（按当前工作区找） | **原样** `C:/app/artifacts/x.png` | 404（basename ≠ 请求值） |
| Windows 绝对路径（**旧机器**路径） | `repository.ts:492-511` 回填 | `?file=x.png`（能显示，只要同名文件在当前工作区） | **原样**旧路径 → 文件不存在 → 发布失败 | 404 |
| `/img/a.png`（POSIX 绝对 / 页面相对 URL） | `scraper.ts:34` 的 `og:image` 若为相对地址 | `?file=a.png`（图裂或串图） | win32 下 `isAbsolute('/img/a.png') === true` → **原样**交给 Playwright | 404 |
| `b/c.png`（带目录的相对路径） | 无写者证据（见 §4.3） | `?file=c.png` | `ARTIFACTS\c.png` | 404 |
| `http(s)://…` 远程 URL | `import-url/route.ts:49`、`article-images.ts:54` | **原样返回**（浏览器直连第三方主机） | **`""`** → 完全不传图（C2-1a `evidence.media = "not_offered"`） | 404 |
| `/api/agent/artifacts?file=x.png`（应用内 URL） | `article-editor.tsx:196` 写入 `body`（**不在** `metadata.images`） | `/api/agent/artifacts?file=artifacts%3Ffile%3Dx.png`（**N2：解析坏**） | win32 `isAbsolute` 为 true → 原样（不存在的文件） | 404 |
| `file:///c:/x/a.png` | 无写者证据（`normalizeFileUrl` 只用于 DB URL） | `?file=a.png`（**偶然**正确） | `ARTIFACTS\a.png` | 404 |
| `../credential-vault.json` | 恶意/损坏数据 | `?file=credential-vault.json`（被路由的 basename 规则挡住） | `ARTIFACTS\credential-vault.json` | 404 |
| `a.png?x=1` | 无写者证据 | `?file=a.png%3Fx%3D1`（图裂） | `ARTIFACTS\a.png?x=1` | 404 |
| `x.gif` | `images/upload`（`route.ts:9`）与 `remote-image.ts:29,37` 都允许 `.gif` | `?file=x.gif` | `ARTIFACTS\x.gif` | **404（N1）** |

### 4.2 三个既有不一致（新发现，均已定位）

- **N1 `.gif` 三段不一致**：`artifact-image-url.ts:9` 与 `api/images/upload/route.ts:9` 收录 `.gif`，`remote-image.ts:29,37` 可生成 `.gif` 本地文件；但 `api/agent/artifacts/route.ts:8-13` 的 `contentTypes` 没有 `.gif` → 图库列表里出现的 gif 永远 404。对照：产品图路由 `api/products/image/route.ts:19-24` **有** `.gif`。
- **N2 应用内 URL 不是合法输入**：`?file=` 的整串会被当作文件名再编码一次（实测输出见上表）。当前无代码路径会把它喂给解析器，但**人工编辑 DB / 未来回填**会踩到；且注意 `article-editor` 只把它写进 `body`，不写进列表。
- **N3 客户端解析器是 5 处不是 4 处**（`content/library/page.tsx:16-21`）。

### 4.3 三态标注

| 输入形态 | 状态 | 依据 |
| --- | --- | --- |
| 空字符串 → `""` | **代码已支持**（客户端）；**已有测试证明**（服务端列表层） | `posts-composer.tsx:18` 等；`content-images.test.ts:13`（空列表 + 空 `imagePath` → `[]`） |
| 裸文件名 → `/api/agent/artifacts?file=` | **已有测试证明**（服务端 URL 构造 + 服务路由），客户端无测试 | `images/route.test.ts:179,567-569`（`url === artifactImageUrl(fileName)`）；`agent/artifacts/route.test.ts:53-62`（200 + MIME） |
| 裸文件名不存在 → 404 | **已有测试证明** | `agent/artifacts/route.test.ts:64-68` |
| 绝对本地路径 → 客户端取 basename，服务端原样 | **代码已支持，零测试** | 客户端 5 处 `split(/[\\/]/).pop()`；`publish.ts:30`；全仓无 `publish.test.ts`、无 `.test.tsx` |
| 远程 URL → 客户端原样、发布侧丢图 | **代码已支持（且是刻意行为被记录）**，无端到端测试 | `publish.ts:29`；`creator-workflow-audit.md` F-C0-5（148-157）；`backup-restore-audit.md` §4.2（122-132） |
| 带目录的相对路径 | **尚未确认**：无任何写者会产出该形态（`og:image` 为相对 URL 时会，但这依赖第三方页面，属"可能"而非"契约"） | 与 §3.4 各行对照后无对应写者 |
| `file://`、`a.png?x=1`、应用内 URL | **尚未确认**（理论合理，无写者证据） | 同上；`normalizeFileUrl` 仅服务 DB URL（`db/client.ts:14,24,27`） |
| `.gif` | **代码已支持生成/入库，服务端必然 404（N1）** | 见 §4.2 |

### 4.4 现有测试清单（与解析器相关）

| 测试文件 | 固定了什么 | 与 A02 的关系 |
| --- | --- | --- |
| `src/app/api/images/route.test.ts:179,567-569` | `GET /api/images` 返回的 `url` **等于** `artifactImageUrl(fileName)` | 唯一的"URL 形状"断言，通过真函数比对而非硬编码 |
| `src/app/api/agent/artifacts/route.test.ts:53-78` | 裸名 200；`publish-logs/shot.png`、`../credential-vault.json`、`""`、`notes.txt` → 404；404 不初始化工作区 | **服务端契约**：什么输入最终可用 |
| `src/lib/workspace/manifest.test.ts:190-231` | artifacts 被分为 linked/unlinked；`a.png`+`b.jpg` 计 linked、`orphan.png` unlinked、被引用但不存在的 `ghost.png` 不链接任何文件、嵌套文件只计 size 不计 split | 第二处"引用 = 文件名"的事实来源（与路由 404 规则一致） |
| `src/lib/products.test.ts:24-33` | `C:\…\a.png` / `/…/b.jpg` / `""` 的 basename 规则 | **同形不同根**，A02 不得改动 |
| `src/lib/video-library.test.ts:37` | `videoUrl("video-1 clip.mp4")` 的编码 | 同上 |
| `src/lib/content-images.test.ts` | 列表优先 / 回退 `imagePath` / 合并 metadata | A02 的上游取值契约（保持通过） |
| `src/lib/article-images.test.ts:179-193` | 产品图副本落在 `artifacts/`（`path.dirname(copy) === artifactsDir`）、命名为 `writing-*`、**返回值即绝对路径** | 证明"绝对路径入库"是已被测试固定的现状 |
| **缺** | `artifact-image-url.ts` 无专属测试；`publish.ts` 解析函数无测试；**5 处客户端解析器 0 测试**（全仓 88 个 `.test.ts`、**0 个 `.test.tsx`**）；`.gif` 不对称无测试；import-url 远程封面 → 发布丢封面链路无端到端测试 | 即 A01「以测试固定契约」需要新建的最小集合 |

## 五、客户端与服务端行为差异

| 关注点 | 客户端 5 处（`/api/agent/artifacts`） | 服务端发布链路（`publish.ts` → `setInputFiles`） | 可观察后果 |
| --- | --- | --- | --- |
| 远程 URL | **原样**返回给 `<img>` | **`""`**，等于"没有封面" | 用户看到封面正常显示，发布到平台却没有图；C2-1a 的 `evidence.media` 记为 `not_offered`（`browser-preview-session.ts:1495`）→ 运行显示"已草拟"但页面没接住封面 |
| 绝对路径 | 取 basename，**按当前工作区的 `artifacts/` 找** | **原样**（`path.isAbsolute` 优先） | 跨机器/改目录后"看得见、发不出"（`backup-restore-audit.md` §4.2 已记录） |
| 带目录的相对路径 | 取 basename | 取 basename → `artifactsRoot()` | 两侧一致（但都没验证过该形态真存在） |
| 空值 | `""`，不渲染 `<img>` | `""`，不调用 `setInputFiles` | 一致 |
| 应用内 URL | 二次编码 → **坏 URL** | 原样 → 不存在的文件 | 两侧都不可用，但方式不同（N2） |
| `.gif` | 生成可用 URL | 生成可用路径 | 服务路由 404（N1）→ 显示为图裂、发布失败 |
| Windows 分隔符 | `split(/[\\/]/)` 手工取末段 | `path.isAbsolute` + `split(/[\\/]/)` | 规则不同源：客户端不认 UNC/盘符语义，服务端认（`\\srv\share\x.png` 客户端 → 裸名、服务端 → 原样） |
| 平台差异 | 纯 JS，跨平台一致 | `path` 是 win32 语义：`isAbsolute("/img/a.png") === true` | **同一份数据在 Windows 与 POSIX 上发布行为不同**（POSIX 下 `/img/a.png` 也是绝对，一致；但 `C:/x.png` 在 POSIX 下**不是**绝对 → 会被当作裸名去 `artifactsRoot()` 找） |

> 结论：A02 只能统一"浏览器可访问地址"的推导。**"文件系统路径"的推导是另一件事（`publish.ts`），本卡不动**；两者相同的输入会得到**故意不同**的结果（前者要 URL、后者要真实文件），这一点必须写进 A01 的规则声明，否则未来会有人把两者当成同一个函数合并。

## 六、最小改动建议与明确排除项

> 以下是**建议**，本轮未实施。等人工复核通过后再单独授权实现与测试。

### 6.1 建议的改动集（1 个模块 + 3 个非解析器调用点 + 1 个测试文件 + 6 个调用点替换）

| 步骤 | 内容 | 为什么是最小 |
| --- | --- | --- |
| S1 | 在**既有** `src/lib/artifact-image-url.ts` 中新增一个导出函数（建议名 `resolveArtifactImageSrc(value?: string): string`），语义= 5 处客户端解析器的**逐字合并体**：空值 → `""`；`/^https?:\/\//i` → 原样；否则 basename → `artifactImageUrl(basename)`，basename 为空 → `""`。该文件已无 Node 依赖（1-6 行注释即为此设计），无需新增文件 | 不引入新概念、不改现有导出签名 |
| S2 | 替换 C1～C5 **五处** 客户端解析器（含卡片漏掉的 `content/library/page.tsx`），删除本地函数，改为导入 | 行为逐字等价（同 5 行逻辑），diff 是纯删除 |
| S3 | `videos-composer.tsx:76-78` `coverUrl(fileName)` → 直接用 `artifactImageUrl(fileName)`（等价替换） | 纯去重，无行为变化 |
| S4 | `api/images/upload/route.ts:11-13` 本地 `imageUrl` → 导入 `artifactImageUrl` | 服务端字面重复，纯去重 |
| S5 | 新增 `src/lib/artifact-image-url.test.ts`：按 §4.1 矩阵固定契约（空值 / 裸名 / 不存在的裸名 / Windows 绝对 / POSIX 绝对 / UNC / 带目录相对 / 远程 http+https / 应用内 URL / `file://` / 带 query / `.gif` / 含空格与中文文件名 → 编码正确），并断言 `artifactImageUrl` **逐字节不变**（硬约束见 §3.5） | A01 要求"以测试固定契约"，且这是当前唯一 0 覆盖的核心解析逻辑 |
| S6 | 文档：在 `dev-exec-list.md` §五 A02 行补"实际 5 处 + 2 孪生 + 1 服务端重复"的结论（**待授权后再改既有文档**） | 仅状态回填，不属源码 |

**硬约束（必须在实现与测试中体现）**：

1. `/api/agent/artifacts?file=<encodeURIComponent(name)>` 的字符串形状**完全不变**（理由见 §3.5：旧正文 HTML 已固化该形状）。
2. 客户端解析器保持"**任何**非 http(s) 值都退化为 basename"的现有容错，不得新增对绝对路径的"原样使用"分支（那会把浏览器的 C:\ 路径当 URL 用；服务端才需要原样）。
3. 不 trim、不改大小写、不改扩展名判断——`resolveArtifactImageSrc` 只回答"浏览器该请求什么地址"，不回答"这个文件是否合法/存在"（存在性由服务路由 404 决定，见 §2.2）。

### 6.2 明确排除项（本轮不碰，需要时单独立卡）

| 排除项 | 依据 |
| --- | --- |
| **不改 `src/lib/publish.ts`**（远程 URL → `""` 的语义、"绝对路径优先"） | 卡片停止边界"不改 `src/lib/publish.ts` 语义"；该问题属 A04/B6 范围，且它是既有未提交改动文件 |
| 不改素材写入格式（A03）：`metadata.images` / `image_path` / `videoPath` 的写入规则 | 卡片范围外 |
| 不做远程图片本地化（A04）：`import-url` 仍把 `og:image` 原样存库 | 卡片范围外 |
| 不新增 Asset 表 / 不新增列 / 不做数据迁移 / 不重写历史数据 | 卡片验收明确"不新增素材表" |
| 不做引用追踪与删除保护（A07/A08） | 卡片范围外 |
| 不改 C2 发布契约（`/api/publish`、`/api/publish/draft`、`/api/publish/verify` 的入参与状态判定） | 卡片禁止事项 |
| 不改 `products.ts` / `video-library.ts` 的 URL 构造（不同根、不同路由、各有测试） | §2.4 |
| 不修 N1（`.gif`）——除非人工授权，因为它要改**服务路由的 MIME 白名单**（HTTP 契约而非解析器） | §4.2 |
| 不修 N2（应用内 URL 透传）——它会新增一条解析分支，与"不在业务页面新增解析分支"的精神冲突；建议先按 §七 Q3 决策 | §4.2 |
| 不动 `content-publish-dialog.tsx`（它只调 `/api/publish/discard`，与解析无关） | §3.3 已核对 |

## 七、尚待确认的问题（需人工裁决，任一未决我都会停在只读状态）

| # | 问题 | 我的建议 | 影响面 |
| --- | --- | --- | --- |
| Q1 | C1～C4 之外的 **C5**（`content/library/page.tsx`）、`videos-composer.coverUrl`、`api/images/upload` 三处是否纳入卡 1？ | **纳入**（三处都是纯去重/等价替换，且 C5 与卡片四处在同一语义下）。若按卡片字面只改四处，等于留下两处重复，A02 无法宣称"统一" | 改动点从 4 → 8 |
| Q2 | N1（`.gif` 服务 404）修不修？ | **不在卡 1 修**。它要改服务路由 MIME 白名单 = 改 HTTP 契约，应与 A03/A04 或独立小卡一起评估（且需决定是补 `.gif` 还是从 `IMAGE_FILE_EXTENSIONS` 里去掉 `.gif`，两者都会动既有行为） | 会触及 `api/agent/artifacts/route.ts`、`artifact-image-url.ts`、`images/upload` |
| Q3 | N2（把 `/api/agent/artifacts?file=…` 当输入值）怎么办？ | **默认不修**，只把它作为"A01 已声明的不支持输入"写进测试（`?file=` 二次编码是现状事实）。若要支持（例如把旧正文里的 URL 重新喂回解析器），需要一个同源前缀判断分支——这是新增行为，必须单独授权 | 决定测试断言方向 |
| Q4 | A01 的"身份规范"是否包含**文件名校验/规整**（trim、拒绝 `..`、扩展名白名单）？ | 建议**只声明、不实施**：解析器不 trim（与服务端 `publish.ts` 一致）、不做安全校验（路由/`image-library.ts:18-32` 已用 basename + 扩展名白名单兜底）。若要求 trim，会改变客户端渲染的键值匹配（如 `metadata.images` 里带空格的项），需要单独决定 | 可能引入第 4 个行为变化点 |
| Q5 | 是否允许在卡 1 中**只加测试**去固定 `publish.ts` 的两个解析函数（`resolveLocalImagePath`/`resolveLocalVideoPath`，不改语义）？ | 建议**允许**（可为后续 A04/B6 提供回归网），但需人工明确"加测试"不算越界——毕竟它是既有未提交改动文件 | 触点：新增 1 个测试文件（或加入既有测试文件），`publish.ts` 本体不动 |
| Q6 | 是否把 §4.3 里标"尚未确认"的三类输入（`file://`、`a.png?x=1`、带目录相对路径）纳入**正式契约**？ | 建议**不纳入**，只在测试里标注为"当前实现的偶然行为，不是契约"；正式契约只承认：空值、裸文件名、绝对本地路径、远程 URL 四类（与卡片 176 行"兼容四类现有输入"一致） | 决定 A01 声明的兼容集合宽度 |
| Q7 | 是否需要为本卡补一次**真浏览器 smoke**（`scripts/` 既有形态）验证"编辑器插图 → 正文渲染"不回归？ | 建议补一个只读 smoke（沿用 `creator-editor-link-smoke.ts` 形态，不触发真实平台发布）；但按纪律它属于实现阶段的验收动作，不是本阶段 | 验收证据强度 |

## 附录 A、复现方式（全部只读）

```powershell
# 基线
git --no-pager log -1 --oneline
git --no-pager status --short

# 解析器与调用点
Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx |
  Select-String -Pattern 'api/agent/artifacts' -Encoding UTF8
Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx |
  Select-String -Pattern 'artifact-image-url' -Encoding UTF8
Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx |
  Select-String -Pattern 'split\(/' -Encoding UTF8
```

§4.1 的行为矩阵不是手推的，而是逐条求值得到的。把下面这段存成临时文件（例如 `%TEMP%\resolve-matrix.cjs`）后 `node %TEMP%\resolve-matrix.cjs` 即可复现（只读、不写任何项目文件）：

```js
// resolve-matrix.cjs —— 客户端解析器与 publish.ts 解析器的逐条对比
const path = require("path");

const cases = [
  "",
  "a.png",
  "missing.png",
  "C:/app/artifacts/x.png",
  String.raw`\\srv\share\x.png`,
  "/img/a.png",
  "b/c.png",
  "http://h/a.png",
  "https://h/a.png?q=1",
  "/api/agent/artifacts?file=x.png",
  "file:///c:/x/a.png",
  "../credential-vault.json",
  "a.png?x=1",
  "x.gif",
];

for (const v of cases) {
  const isAbs = path.isAbsolute(v);
  const base = v.split(/[\\/]/).pop() || "";
  const client = !v
    ? ""
    : /^https?:\/\//i.test(v)
      ? v
      : base
        ? "/api/agent/artifacts?file=" + encodeURIComponent(base)
        : "";
  const server = !v
    ? ""
    : /^https?:\/\//i.test(v)
      ? ""
      : isAbs
        ? v
        : path.join("ARTIFACTS", base);
  console.log(JSON.stringify({ v, isAbs, base, client, server }));
}
```

## 附录 B、本阶段边界声明

- 本阶段**只新增**本报告；**未**修改任何源码、测试、数据库、配置或既有文档；**未**运行 tsc / vitest / eslint / 格式化 / 迁移；**未**暂存或提交。
- 本报告不宣称"已修复"任何问题：N1 / N2 / N3 与 §6.1 的改动集全部处于**建议**状态。
- §四 的"代码已支持 / 已有测试证明 / 尚未确认"标注依据是实际读码与实测（`node -e`）；凡未读到写者证据的输入一律标"尚未确认"，不因"理论上合理"而升级为契约。
- **下一步**：等待人工复核本报告（重点：Q1～Q7 与 §6.1 的改动集是否就是授权范围）。复核通过前不进入实现阶段。

