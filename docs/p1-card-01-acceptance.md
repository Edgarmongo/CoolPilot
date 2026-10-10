# P1 卡 1 实施与验收记录：A02 统一素材 URL 解析 + A01 契约测试

状态：**实施完成、自测通过、真浏览器 smoke 通过；未 `git add`、未提交、未改动既有其它工作区改动。**
验收：**已验收通过，P1 卡 1 关闭**（结论与边界见 §八；N1 / N2 分别登记为 F1 / F2，未修复）。
基线提交：`3b48126`（`main`，2026-10-09）；授权依据：`docs/p1-card-01-baseline.md`（Q1～Q7 裁定 + S1～S6 范围）。
本文档为本次实施阶段**新增的唯一文档**；源码改动清单见 §二，验证证据见 §四，验收结论与后续登记见 §八。

## 一、授权范围 ↔ 实际改动对照

| 授权项 | 要求 | 本轮落实 | 证据 |
| --- | --- | --- | --- |
| S1 | 抽 1 个共享客户端解析函数，**不改 URL 形状** | 在既有 `src/lib/artifact-image-url.ts` 中新增导出 `resolveArtifactImageSrc(value?: string)`；`artifactImageUrl` 原样保留 | §二 A02-0；`git diff` |
| S2 | 5 处客户端调用点统一改为引用共享函数 | `articles-workspace`、`ai-writing-step-output`、`article-editor`、`posts-composer`、`content/library/page` 全部改为 import 共享函数，本地实现删除 | §二 A02-1～A02-5 |
| S3 | 2 个孪生实现按 Q1 处理（可并则并，不可并只声明） | `videos-composer.coverUrl`（字节等价，**已并入**）；`products.ts`（同形不同责，**未动**，见 §六 R5） | §二 A02-6；§六 R5 |
| S4 | 新增契约测试，覆盖支持集与边界记录 | 新增 `src/lib/artifact-image-url.test.ts`（10 用例） | §三；§四 4.1 |
| S5 | URL 形状字节级锁定 | 单测首例断言 `artifactImageUrl` 与 `resolveArtifactImageSrc` 输出一致；smoke 反向校验上传路由回包的 `url` 等于期望串 | §三；§四 4.5 |
| S6 | 真浏览器 smoke：图片展示 + 编辑器行为，不做完整发布 e2e | 新增 dev-only 脚本 `scripts/artifact-image-url-smoke.ts`，覆盖内容中心封面 / 编辑器封面 / 编辑器插入图片，全部以 `naturalWidth > 0` 判定"真被浏览器画出" | §四 4.5 |
| Q2 | **不**修 `.gif` 404（N1） | `.gif` 行为未改；仅在测试中记录 | §三；§六 R2 |
| Q3 | 应用内 URL 作输入：声明不支持，仅在测试边界声明 | 测试用例记录双编码结果，未改行为 | §三；§六 R3 |
| Q4 | 文件名规范化：只声明、不做 | 未加 trim / 小写 / 扩展名检查；测试记录不 trim | §三；§六 R4 |
| Q5 | 本卡**不**新增 `publish.ts` 测试 | 未触碰 `src/lib/publish.ts`（`git status` 中的 ` M src/lib/publish.ts` 属基线前既有改动，非本轮） | §七 |
| Q6 | 不为未确认输入授契 | 未确认输入集中放在"记录而非承诺"用例中，并在注释中标注 | §三 |
| Q7 | 浏览器 smoke 归实施阶段验收 | 已执行并留证；使用隔离开销最小的夹具（见 §四 4.6） | §四 4.5～4.6 |

## 二、变更清单

### 源码（8 个既有文件，`git diff --stat`）

| 编号 | 文件 | 改动 | 删除的本地重复 | 引用点 |
| --- | --- | --- | --- | --- |
| A02-0 | `src/lib/artifact-image-url.ts` | +22 行：新增 `resolveArtifactImageSrc`（含契约注释，明确"不要改 URL 形状"） | — | 定义处 |
| A02-1 | `src/components/creation/articles-workspace.tsx` | 删本地 `imageUrl`，改 import | 1 处 | 270 |
| A02-2 | `src/components/creation/ai-writing/ai-writing-step-output.tsx` | 删本地 `imageUrl`，改 import | 1 处 | 165 |
| A02-3 | `src/components/creation/article-editor/article-editor.tsx` | 删本地 `resolveImageUrl`，改 import | 1 处 | 171（插入正文）、531（封面） |
| A02-4 | `src/components/creation/posts-composer.tsx` | 删本地 `resolveImageUrl`，改 import | 1 处 | 166 |
| A02-5 | `src/app/[locale]/(console)/content/library/page.tsx` | 删本地 `imageUrl`，改 import（含基线 N3 的漏项） | 1 处 | 119（详情）、215/218（网格）、259/262（列表） |
| A02-6 | `src/components/creation/videos-composer.tsx` | 删本地 `coverUrl`（孪生，字节等价），改 import | 1 处 | 783（网格封面）、906（列表兜底） |
| A02-7 | `src/app/api/images/upload/route.ts` | 删本地 `imageUrl`（服务端字面重复），改 import | 1 处 | 32 |

合计：**删除 7 处重复实现，13 个引用点统一到共享函数**（客户端 11 处 / 服务端 2 处）。

未被本轮改动、仍使用 `artifactImageUrl` 的文件（本轮前即是共享函数，可作"共享是既有约定"的证据）：
`src/app/api/images/route.ts:14,42`、`src/app/api/images/from-url/route.ts:28`。

### 新增文件（2 个，均为未跟踪）

| 编号 | 文件 | 说明 |
| --- | --- | --- |
| A01 | `src/lib/artifact-image-url.test.ts` | 契约测试，10 用例；`.test.ts` 而非 `.test.tsx`，因为 `vitest.config.ts` 只收集 `src/**/*.test.ts` |
| S6 | `scripts/artifact-image-url-smoke.ts` | dev-only 真浏览器检查，用法 `tsx scripts/artifact-image-url-smoke.ts [baseUrl] [locale]`；自建夹具、自清理 |


## 三、共享解析器契约与测试用例

`resolveArtifactImageSrc(value?: string)` 的行为（`value` 为空 → 返回 `""`）：

| 输入类别 | 输入 | 输出 | 定位 |
| --- | --- | --- | --- |
| 空 | `undefined` / `""` | `""` | **支持** |
| 裸文件名 | `cover.png` | `/api/agent/artifacts?file=cover.png` | **支持** |
| 绝对本地路径 | `C:\app\data\artifacts\cover.png`、`C:/.../cover.png`、`\\srv\share\cover.png`、`/var/data/artifacts/cover.png` | `/api/agent/artifacts?file=cover.png` | **支持** |
| 远程 URL | `https://cdn.example.com/a.png?w=1`（scheme 大小写不敏感，值本身不改写） | 原样返回 | **支持** |
| 编码 | `my cover 图.png` → `my%20cover%20%E5%9B%BE.png`；`C:\dir\a&b#c.png` → `a%26b%23c.png` | 只编码 basename | **支持** |
| 扩展名 | `anim.gif`、`notes.txt` | 照常拼 URL（**不**检查扩展名） | 支持（不含 .gif 可服务性，见 R2） |
| 空白 | `" cover.png "` | `%20cover.png%20`（**不** trim） | 记录（Q4） |
| 目录相对 | `b/c.png` | `/api/agent/artifacts?file=c.png` | 记录（Q6） |
| `file://` | `file:///c:/x/a.png` | `/api/agent/artifacts?file=a.png` | 记录（Q6） |
| 查询串 | `a.png?x=1` | `/api/agent/artifacts?file=a.png%3Fx%3D1` | 记录（Q6） |
| 路径穿越 | `..\..\credential-vault.json` | `/api/agent/artifacts?file=credential-vault.json`（basename 后无路径逃逸） | 记录（Q6） |
| 应用自身 URL | `/api/agent/artifacts?file=x.png` | `/api/agent/artifacts?file=artifacts%3Ffile%3Dx.png`（双编码） | **声明不支持**（Q3） |

测试文件 `src/lib/artifact-image-url.test.ts` 的 10 个用例：

| 用例 | 钉住什么 |
| --- | --- |
| keeps the stored URL shape, byte for byte | `artifactImageUrl` 精确串 + 两个导出输出一致（S5） |
| answers an empty reference with an empty src | 空值 → `""`（`selectedItem?.imagePath` 为 undefined 时不会拼出 `file=undefined`） |
| turns a bare file name into the artifacts URL | 支持集① |
| reduces an absolute local path to its base name | 支持集②，Windows / POSIX / UNC 三形态 |
| passes a remote URL through untouched | 支持集③，含查询串与大小写 scheme |
| encodes the base name, never the directory | 编码只作用于 basename；空格与 CJK |
| does not inspect the extension and does not trim | Q2 + Q4 的可观察后果 |
| records, without promising, the inputs outside the supported set | Q6：`b/c.png`、`file://`、`?query`、`..` 穿越 |
| records the app's own URL as an unsupported input | Q3 / N2 边界 |
| freezes the served extension set as the baseline it is today | `IMAGE_FILE_EXTENSIONS` = `.gif/.jpeg/.jpg/.png/.webp`（N1 决策前不改） |

关于"哪些不是承诺"：后 5 个用例断言的是**今天的实际行为**，不是理想行为。任何后续变化都会因此变成一次显式修改而非静默漂移；同时用例名与注释都写明它们不属于支持集，避免下一轮把"记录"误读成"契约"。

## 四、验证证据（全部在本机实际运行）

### 4.1 针对性测试

```
$ node_modules\.bin\vitest.cmd run src/lib/artifact-image-url.test.ts
 ✓ src/lib/artifact-image-url.test.ts (10 tests) 5ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
 vitest exit: 0
```

### 4.2 类型检查

```
$ node_modules\.bin\tsc.cmd --noEmit
（无输出）
 tsc exit: 0
```

### 4.3 Lint

```
$ node_modules\.bin\eslint.cmd .
D:\...\src\components\agent-chat\chat-conversation.tsx
  146:9  warning  The 'messages' logical expression could make the dependencies of useMemo Hook ...
✖ 1 problem (0 errors, 1 warning)
```

0 error；唯一 warning 在 `chat-conversation.tsx`，该文件不在本轮改动清单内（基线即存在，`git status` 中未修改）。本轮改动文件单独 lint 后退出码为 0，新增的 `scripts/artifact-image-url-smoke.ts` 亦为 0。

### 4.4 全量测试

```
$ node_modules\.bin\vitest.cmd run
 ✓ src/lib/artifact-image-url.test.ts (10 tests) 9ms
 Test Files  89 passed (89)
      Tests  584 passed (584)
 Duration  17.58s
 vitest full exit: 0
```

其中本卡新增文件贡献 10 用例，其余 88 文件 574 用例保持不变（无回归）。

### 4.5 真浏览器 smoke（S6 / Q7）

启动（隔离 artifacts 根，见 4.6）：

```
$env:SOCIAL_AUTO_POST_DATA_DIR = "%TEMP%\coolpilot-a02-smoke"
node_modules\.bin\next.cmd dev --hostname 127.0.0.1 --port 3210
 ✓ Ready in 510ms

$ node_modules\.bin\tsx.cmd scripts/artifact-image-url-smoke.ts http://127.0.0.1:3210 zh-cn
 smoke exit: 0
```

脚本输出：

```json
{
  "ok": true,
  "locale": "zh-cn",
  "baseUrl": "http://127.0.0.1:3210",
  "imageUrl": "/api/agent/artifacts?file=upload-1791503142636-qKgeSuht.png",
  "uploadAnsweredTheStoredShape": true,
  "contentLibraryPaintedTheCover": true,
  "editorCoverPaintedTheSameFile": true,
  "insertImagePutItInTheBody": true,
  "pageErrors": []
}
```

实际覆盖的页面与操作（每一步都要求 `naturalWidth > 0`，即浏览器真的拿到了字节）：

| 步骤 | 页面 / 操作 | 断言 |
| --- | --- | --- |
| 夹具 | `POST /api/images/upload`（multipart，1×1 PNG） | 返回的 `url` 等于 `/api/agent/artifacts?file=<encodeURIComponent(fileName)>`（即 URL 形状字节级校验） |
| 夹具 | `POST /api/content`，`images: [fileName]` | `imagePath` 落到该文件 |
| 1 | `/{locale}/content/library`（内容中心，网格卡片） | 卡片封面 `<img src>` 精确等于该 URL 且已画出 |
| 2 | `/{locale}/creation/articles?edit=<id>`（编辑器深链） | 深链打开编辑器；封面预览 `<img src>` 精确等于该 URL 且已画出 |
| 3 | 编辑器工具栏 `Insert image` → 图片对话框 `从图库选择` → 点选该图 | 正文 `contenteditable` 内出现 `src` 精确等于该 URL 的 `<img>`，且已画出（即"插入正文的字符串"与持久化形状一致，但本轮**未保存**，不写正文） |

服务端日志佐证（dev log 摘录）：

```
 GET /api/content?page=1&pageSize=20 200
 GET /api/agent/artifacts?file=upload-1791503142636-qKgeSuht.png 200 in 41ms
 GET /zh-cn/creation/articles?edit=NDwaySEVQc-yAYV-XcVzY 200
 GET /api/images 200
 DELETE /api/content/NDwaySEVQc-yAYV-XcVzY 200
 DELETE /api/images 200
```

不在 smoke 范围内（刻意）：发布链路（本卡范围外）、视频创作台与 AI 写作缩略图（同一 import、同一函数，由 §四 4.1 的契约测试覆盖）。

### 4.6 数据隔离与清理证据

- `.env.local` 固定了 `SOCIAL_AUTO_POST_DB_URL=file:./web-data/social-auto-post.db`，因此数据库仍指向本机 `web-data/` 的开发库；`SOCIAL_AUTO_POST_DATA_DIR` 只把 **artifacts 根**指向 `%TEMP%\coolpilot-a02-smoke`（smoke 上传的 PNG 落在临时目录，不污染 `web-data/artifacts`）。
- smoke 只新建 1 行 content（标题 `P1-C1 A02 smoke <timestamp>`）与 1 个 PNG，并在 `finally` 中删除；实测已清空：

```
GET /api/content?q=P1-C1%20A02%20smoke  → {"items":[],"total":0}
GET /api/images                         → image count: 0
%TEMP%\coolpilot-a02-smoke 下文件数     → 0
```

- dev server 已在验证结束后停止（`port 3210 closed`）。


## 五、兼容性风险（验收必读）

| 编号 | 风险 | 影响面 | 本轮判断与依据 |
| --- | --- | --- | --- |
| R1 | **URL 形状被持久化**：`article-editor.insertImage` 把 `/api/agent/artifacts?file=<encodeURIComponent(name)>` 写进 `content_items.body` | 已保存的历史文章 HTML | 共享函数与 5 处原实现逐字节等价，smoke 又对上传路由回包做了精确串校验；形状**未变**，历史正文可继续渲染 |
| R2 | **`.gif` 仍会 404**（N1，Q2 明确不修） | 图库中 `.gif` 列表项/封面 | `.gif` 在 `IMAGE_FILE_EXTENSIONS` 与上传白名单内，但 `api/agent/artifacts/route.ts` 的 content-type 表没有 `.gif`。本卡只把该集合写进测试基线，未改行为 |
| R3 | **应用内 URL 作输入会双编码**（N2，Q3 声明不支持） | 未来把 `?file=` URL 回灌解析器的新代码 | 现有调用点全部传"文件名/路径"，不传 URL；风险落入 §六 未决项 |
| R4 | **文件名不做规范化**（Q4 只声明） | 带前后空格/大小写差异的素材名 | 不做 trim/小写，行为与改前一致，无新风险 |
| R5 | `products.ts` 的商品图 URL 与素材 URL **同形不同责**，未并入 | 商品图片 | 其目标路由是商品图片接口，语义不同；按 Q1 不强并。见 §六 |
| R6 | smoke 在真实开发库中新增 1 行夹具后删除 | 本机 `web-data/social-auto-post.db` | `.env.local` 已固定 DB 路径，无法在不动它的前提下换库；实测删除后 `total: 0`，既有行未被读写 |
| R7 | 客户端渲染依赖 basename 规则接受"绝对路径" | Electron/packaged 场景 | 与改前 5 处实现一致；服务端 `artifactImageUrl` 仍只接文件名（职责未混） |

## 六、未决项（本卡刻意不做，交后续裁定）

| 编号 | 事项 | 状态 |
| --- | --- | --- |
| N1 | `.gif` 在 artifacts 路由缺失 content-type → 404 | 未修（Q2）；已写入测试基线，改则必须改测试。**验收后登记为 F1**（§八） |
| N2 | 应用内 `/api/agent/artifacts?file=` 作输入被双编码 | 声明不支持（Q3）；测试仅记录边界。**验收后登记为 F2**（§八） |
| N3 | 基线报告发现的第 5 处客户端重复（内容中心） | **本卡已随 A02-5 一并统一** |
| Q4 | 文件名规范化（trim / 小写 / 扩展名校验） | 不做，仅测试记录 |
| Q5 | `publish.ts` 解析器的测试 | 本卡不新增（该文件在 `git status` 中属基线前既有改动） |
| — | `products.ts` 商品图 URL 是否统一 | 未动，待后续卡片裁定（R5） |
| — | 视频缩略图 `video-library.videoUrl` | 基线判定为"另一条路由"，不属于素材图 URL 契约，未动 |

## 七、边界声明

- 本轮**只**改 §二 列出的 8 个既有源文件 + 2 个新增文件（1 测试 + 1 smoke 脚本）与本记录文档；**未** `git add`、**未**提交、**未**回滚或覆盖工作区中既有的 18 个 ` M` 文件与既有未跟踪文件。
- **未**触碰：`src/lib/publish.ts`、`src/lib/products.ts`（商品图片）、`src/lib/video-library.ts`、`src/locales/*`、`README*`、`next.config.ts`、数据库 schema/迁移、`web-data/` 内既有数据。
- **未**引入任何新依赖、新环境变量或新路由。
- 验证动作：4.1 针对性测试、4.2 `tsc --noEmit`、4.3 `eslint .`、4.4 全量 vitest、4.5 真浏览器 smoke；4.6 已确认夹具与 dev server 清理完毕（端口 3210 已关闭）。
- 本记录**不宣称**任何未决项已修复（§五 / §六）。
- **下一步**：等待人工验收本记录（重点：§二 改动清单是否为授权范围、§五 风险判断是否接受）。**未验收前不进入 P1 卡 2。**

## 附录 A、复现命令

```powershell
# 1) 针对性契约测试
node_modules\.bin\vitest.cmd run src/lib/artifact-image-url.test.ts

# 2) 类型 / lint / 全量测试
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\eslint.cmd .
node_modules\.bin\vitest.cmd run

# 3) 真浏览器 smoke（隔离 artifacts 根；先起 dev，再跑脚本，最后停服务）
$env:SOCIAL_AUTO_POST_DATA_DIR = "$env:TEMP\coolpilot-a02-smoke"
node_modules\.bin\next.cmd dev --hostname 127.0.0.1 --port 3210
node_modules\.bin\tsx.cmd scripts/artifact-image-url-smoke.ts http://127.0.0.1:3210 zh-cn
# 需要 Playwright Chromium（本机已安装 playwright@^1.60.0 与 chromium-1243）
```

## 附录 B、变更统计

```
 src/app/[locale]/(console)/content/library/page.tsx    | 18 ++++++------------
 src/app/api/images/upload/route.ts                     |  7 ++-----
 src/components/creation/ai-writing/ai-writing-step-output.tsx | 10 ++--------
 src/components/creation/article-editor/article-editor.tsx     | 12 +++---------
 src/components/creation/articles-workspace.tsx         | 10 ++--------
 src/components/creation/posts-composer.tsx             | 10 ++--------
 src/components/creation/videos-composer.tsx            |  9 +++------
 src/lib/artifact-image-url.ts                          | 22 ++++++++++++++++++++++
 8 files changed, 42 insertions(+), 56 deletions(-)

新增（未跟踪）：
 scripts/artifact-image-url-smoke.ts
 src/lib/artifact-image-url.test.ts
 docs/p1-card-01-acceptance.md
```


## 八、验收结论与后续登记（2026-10-09）

### 8.1 验收结论

| 项 | 结论 |
| --- | --- |
| P1 卡 1 | **按实施记录验收通过，可以关闭** |
| A02 调用点统一 | 符合 S1～S3 授权范围 |
| A01 契约测试 | 10 用例，且明确记录"不承诺支持"的输入边界 |
| S6 验证 | 类型检查、Lint、全量测试、真浏览器 smoke 均通过 |
| 兼容性与范围控制 | 历史 URL 形状未变；既有工作区改动未被触碰；未提前进入 P1 卡 2 |
| N1（`.gif` 404） | **单独记录（F1）**，不在本卡修复；不视为已修复 |
| N2（应用内 URL 双编码） | **单独记录（F2）**，不扩大当前输入契约；不视为已修复 |
| 视频创作台用 `artifactImageUrl` | **接受**（依据见 8.3）；不要求为形式统一而改函数 |
| 额外代码修改 | 不要求；本轮**未改任何代码** |
| Git | 不要求提交；本轮**未 `git add` / 未提交** |
| P1 卡 2 | **不自动启动** |

**验收边界声明（重要）**：以上结论是验收方**基于本实施记录**（`docs/p1-card-01-baseline.md` + 本文档）与技术决策作出的，**不表述为**对工作区源代码的独立读取、独立复跑测试后的审查结论；实施方也未据此宣称"已独立验证"。后续如需更高强度的确认，可基于本文档与 `git diff` 做独立审查。

### 8.2 F1：缺陷登记 — `.gif` 素材访问返回 404

| 项 | 内容 |
| --- | --- |
| 现象 | 图库中的 `.gif` 项，其封面/缩略图请求 `/api/agent/artifacts?file=<name>.gif` 返回 404，图片不显示 |
| 复现条件 | ① 上传 `.gif`（`src/app/api/images/upload/route.ts:10` 白名单含 `.gif`，写入成功）② 在 `/{locale}/content/library` 或 `/{locale}/creation/articles?edit=<id>` 中让它成为封面 ③ 该 `<img>` 的 `src` 命中 artifacts 路由 → 404 |
| 根因 | `src/app/api/agent/artifacts/route.ts:8-13` 的 `contentTypes` 只有 `.jpg/.jpeg/.png/.webp`；`IMAGE_FILE_EXTENSIONS`（`src/lib/artifact-image-url.ts:9`）与上传白名单都含 `.gif`。L24 的 `!contentTypes[ext]` 命中即 404 |
| 预期结果 | `200` + `Content-Type: image/gif` + `Cache-Control: private, max-age=300`（与其余图片类型一致） |
| 实际结果 | `404`，响应体 `Not found`；`readFile` 从未被触达（文件在磁盘上其实存在且完整） |
| 影响面 | 仅该路由的 content-type 表缺一项；不影响 URL 形状、不影响已持久化数据 |
| 后续修复要求 | ① 在 `contentTypes` 补 `.gif: "image/gif"` ② **同时**补 GIF 上传 + 读取测试（上传 `.gif` → `GET /api/agent/artifacts?file=` 断言 200 与 MIME）③ `src/lib/artifact-image-url.test.ts:98-102` **只需改注释**（断言不变——集合本来就含 `.gif`；此处更正 §8.2 原"必须同步修改基线用例"的表述，详见 D1 卡 §九） |
| 本卡不做 | 解析器**不**因此增加扩展名过滤——那会改变已持久化 URL 的可达性判断；`src/lib/artifact-image-url.test.ts:69-77` 已注释说明 |

### 8.3 视频创作台使用 `artifactImageUrl`：接受，两点确认结果

职责划分（验收方口径）：

| 函数 | 职责 | 适用场景 |
| --- | --- | --- |
| `artifactImageUrl(fileName)` | 由文件名构造 artifact URL | 上传路由、已知是文件名的调用方 |
| `resolveArtifactImageSrc(value?)` | 解析可能为路径 / 远程 URL / 其它引用的输入 | 内容编辑器、图库、文章工作区等 |

**确认点 1 — `artifactImageUrl` 不会被误用于远程 URL 或完整路径：已确认（当前代码不可能发生）**

| 证据 | 位置 | 说明 |
| --- | --- | --- |
| `cover` 的唯一来源 | `videos-composer.tsx:896` `setCover(entry.fileName)` | `entry` 是 `/api/images` 的 `ImageLibraryEntry { fileName, url }`（L29），`fileName` 由 `listArtifactImageFiles()` 列出，恒为裸文件名；另有 `setCover("")` 清空（L258、L772） |
| 列表兜底 | `videos-composer.tsx:906` `entry.url \|\| artifactImageUrl(entry.fileName)` | 同一裸文件名来源 |
| 上传路由入参 | `src/app/api/images/upload/route.ts:30-32` | `fileName` 是该路由自行构造的 `upload-<ts>-<nanoid><ext>`（`ext` 已过白名单），直接回传 |
| 结构性保险 | `artifactImageUrl(fileName: string)` 的签名与文档注释（`src/lib/artifact-image-url.ts:13-16`） | 语义被限定为"构造"；若将来要传"可能为路径/远程 URL 的引用"，契约要求走 `resolveArtifactImageSrc` |

→ 结论：两个入口**当前都不具备**传入远程 URL / 完整路径的代码路径，且不存在为兼容而必须容忍的情形。

**确认点 2 — 未来 URL 构造规则变化时，是否有测试防止两个入口与共享解析器不一致：部分满足，并登记一个缺口（F3）**

- 已满足（形状层面）：两个入口**不再各自构造 URL**，都 import 同一个 `artifactImageUrl`，因此不存在两份规则。`src/lib/artifact-image-url.test.ts:26-33` 同时钉住 ①`artifactImageUrl` 的精确串（形状一变立刻失败）②`resolveArtifactImageSrc("cover.png") === artifactImageUrl("cover.png")`（解析器与构造器在"裸文件名"这条路径上不得分叉）。任何规则变化都必须以修改测试的方式显式落地，无法静默漂移。
- **缺口（必须如实记录）**：`src/app/api/images/upload/` 下只有 `route.ts`，**该路由没有 route 测试**；`videos-composer` 也没有组件测试（`vitest.config.ts` 只收集 `src/**/*.test.ts`）。也就是说"**这两个调用点仍然使用共享函数并返回该形状**"这件事，目前只由手动的 `scripts/artifact-image-url-smoke.ts`（`uploadAnsweredTheStoredShape`，第 74-78 行断言）看守，**不在 `vitest run` 内**。
- 结论：**规则/形状有自动测试守住；接线（是否仍调用共享函数）只有手动 smoke + 类型与静态审查。** 验收意见不要求本卡补代码，故登记为后续项 **F3**（见 8.5）。

### 8.4 F4：测试环境改进建议（不阻塞本卡）

本卡 smoke 使用本机开发数据库（`.env.local` 固定 `SOCIAL_AUTO_POST_DB_URL=file:./web-data/social-auto-post.db`），仅 artifacts 根被隔离到 `%TEMP%\coolpilot-a02-smoke`（§四 4.6）。本轮只新增并删除了自己创建的 1 行 content 与 1 个 PNG，但**后续自动化 smoke 应优先使用独立测试数据库**（例如为脚本引入单独的 DB 路径开关），避免未来脚本误操作开发数据。已登记为 **F4**。

### 8.5 后续项清单（均不在本卡实施）

| 编号 | 事项 | 来源 | 备注 |
| --- | --- | --- | --- |
| F1 | 补 `contentTypes` 的 `.gif` + GIF 上传/读取测试 | N1（Q2） | 修复时须同步改 `artifact-image-url.test.ts:98-102` 基线 |
| F2 | 若支持应用内 artifact URL 作输入：定义规范化规则 + 兼容性测试 | N2（Q3） | 需评估对历史 `content_items.body` 的影响面 |
| F3 | 为 `api/images/upload` 补 route 测试（断言 `url === artifactImageUrl(fileName)`），并考虑组件级接线测试 | §八 8.3 缺口 | 可参考 `src/app/api/images/route.test.ts` 的 harness；最小补齐约 1 个用例 |
| F4 | smoke 改用独立测试数据库 | §八 8.4 | 测试环境改进，非功能缺陷 |

> **F1 + F3 已合并为同一张独立缺陷卡（D1）**，其实施方案、测试用例、回归范围、数据隔离方式与两项分开的验收标准见 `docs/p1-card-01-defect-f1-f3-plan.md`（**仅方案，未授权实施**）。F2、F4 继续独立跟踪，不并入 D1。
>
> **更新（2026-10-09）：D1 已获授权并实施完毕，停等人工验收。** 实际改动：① F1 —— `src/app/api/agent/artifacts/route.ts` 的 `contentTypes` 补 `.gif: "image/gif"`（唯一 1 行语义改动）；② F3 —— 新建 `src/app/api/images/upload/route.test.ts`（6 用例）+ 既有 artifacts 用例追加 GIF 读成功与 `.svg` 404 断言；③ `src/lib/artifact-image-url.test.ts` 仅注释（断言未动）。实测：针对性 10/10、`tsc --noEmit` 退出 0、`eslint .` 0 error / 1 warning（既有告警）、全量 **90 文件 / 591 用例通过**；`web-data/artifacts` 跑前跑后 `count=37 / md5` 完全一致（未写开发数据）；未 `git add` / 未提交。证据、逐项判定、三处偏差与**新登记项 F5**（`UNSUPPORTED_IMAGE` / `EMPTY_UPLOAD` 不在 `appErrorCodes`，`fail()` 降级为 `code: "UNKNOWN_ERROR"`）见 `docs/p1-card-01-defect-f1-f3-acceptance.md`。**D1 不改变本卡（P1 卡 1）的任何结论**；F2、F4 仍未被触碰。
>
> **D1 关闭结论（2026-10-09 追加）**：复核方选定 F3-f **选项 1** —— **F1 关闭**；**F3 作为\"上传路由自动化测试覆盖\"任务关闭**；**F3-f 的原始错误码要求未达成，保留为 F5 独立未解决项**（**关闭 F3 ≠ 满足 F3-f**）；F2 / F4 仍独立跟踪；**P1 卡 1 保持关闭**；**P1 卡 2 未启动**；D1 全程**未改生产行为**、未 `git add` / 未提交。裁定表、防误读说明与复核命令见 `docs/p1-card-01-defect-f1-f3-acceptance.md` §九 / §十。

### 8.6 本轮验收后未改动清单（复核用）

- **未改任何源代码**：`git diff --stat` 仍为 §附录 B 的 8 files / 42 insertions / 56 deletions，未跟踪文件仍为 `scripts/artifact-image-url-smoke.ts`、`src/lib/artifact-image-url.test.ts`、`docs/p1-card-01-acceptance.md`（外加本卡之前既有的未跟踪文档）。
- **未 `git add` / 未提交**；`publish.ts`、locales、README、`web-data/` 数据均未被本卡触碰。
- 验收期间为取证而**只读**了：`src/lib/artifact-image-url.ts`、`src/lib/artifact-image-url.test.ts`、`src/app/api/agent/artifacts/route.ts`、`src/app/api/images/upload/route.ts`、`src/components/creation/videos-composer.tsx`、`src/app/api/images/route.test.ts`。
- **未启动 P1 卡 2。**

