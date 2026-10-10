# CoolPilot 阶段 2（E2E-01 ~ E2E-04）执行记录

> **执行角色**：本地代码执行代理（CoolPilot 工作区）。
> **授权边界**（用户给定的最终执行口径，逐条遵守，未扩大范围）：
> ①E2E-01 先检查模型配置，满足条件后**只进行 1 次**真实文本模型调用；配置不完整则停止真实调用并记录问题，不自动改配置。
> ②E2E-02 **不重复调用**已知不可用的图片生成能力，只验证可达的媒体读取与编辑器引用链路。
> ③E2E-03 验证任务、产物读取、Range 与失败路径，并**明确标注当前为 pass-through**。
> ④E2E-04 **只测不存在的 `accountId` 的受控失败分支**，不进行真实平台发布。
> ⑤Worker **不启动**（保护现有 `queued` 任务）。
> ⑥每条用例执行前后跑只读指纹脚本（数据库 / 文件 / Git HEAD）。
> ⑦**不执行 `git add` / `git commit`，不覆盖现有改动**。
>
> 本文件只**新增**，未修改任何既有文档与源码。

## 0. 环境与方法

| 项目 | 值 |
| --- | --- |
| 时间 | 2026-10-09 03:31:10Z ~ 03:40:04Z（UTC） |
| App | 已运行的 dev server `http://127.0.0.1:3000`（本会话**未重启、未改配置**） |
| Node | v22.14.0 |
| Git HEAD | `3b48126`（阶段 2 全程未变） |
| 数据库 | `web-data/social-auto-post.db`（只读探测 + 用例自身的受控写入） |
| 指纹脚本 | `tmp-e2e-baseline.cjs <label>`（只读：全表行数、关注表、内容/发布/运行分组、artifacts/videos/uploads 文件数与字节、DB 字节与 mtime、Git HEAD 与改动条目数） |
| 用例脚本 | `tmp-p1-05-e2e01.cjs` / `tmp-p1-05-e2e02.cjs`(+`-cleanup`) / `tmp-p1-05-e2e03.cjs` / `tmp-p1-05-e2e04.cjs` |
| 证据日志 | `tmp-p1-05-e2e0{1,2,3,4}.log.json`、`tmp-p1-05-e2e02-cleanup.log.json`、`tmp-e2e-baseline-e2e0{1,2,3,4}-{before,after}.json` |

**判定口径**：接口返回成功**不**等于闭环通过；每条用例区分 **通过 / 失败 / 受阻 / 未执行**，并给出变化归因（产品缺陷 / 配置问题 / 外部依赖缺失 / 测试环境限制 / 验收未满足 / 用例自身缺陷）。

## 1. 结论摘要

| 用例 | 结论 | 一句话依据 |
| --- | --- | --- |
| **E2E-01** 文章生成与持久化 | **通过（1 次真实调用）** | 配置检查通过（chat 可调用 2 个、端点 key 可用 1 个）→ `POST /api/content/generate` **201** + 真实正文 111 字；重开、编辑、保存、删除 404 全链路一致；`content_items` 回到 17 |
| **E2E-02** 图片与媒体 | **通过（不调用图片生成）** | 媒体列表 45 条（artifacts 37 + videos 8）可读；自建 PNG 上传 **201** → 产物读取 **200 + 字节 SHA 一致** → 编辑器引用（封面 = `images[0]`）读回一致；非法输入 400、缺失/穿越 404；清理后 artifacts 回到 37 |
| **E2E-03** 视频 | **通过（只读，标注为 pass-through）** | 6 个 `video_render` 任务状态与原始列一一对应；产物 **200 + Range 206(`0-99/30389`) + 越界 416**、字节与磁盘一致；**渲染产物与源素材 SHA 完全相同**（`encoded:false`，字节副本，非重新编码）；失败/取消分支无产物 |
| **E2E-04** 发布受控失败 | **通过（受控失败 + 状态不变）** | 不存在的 `accountId` → 写出 `failed` 记录（`Site not found`、`url=''`、`published_at=null`），内容项仍为 `ready`，`runs`/`accounts` 零变化；**未触碰任何真实平台** |
| E2E-04 成功分支（真实发布） | **未执行（授权禁止）** | 按授权"不进行真实平台发布"；阶段 1 已判定为外部阻塞/待人工验证，本阶段不改变该结论 |

**阶段 2 净变化（`tmp-e2e-baseline-stage1-final.json` → `tmp-e2e-baseline-e2e04-after.json`）**

| 维度 | 结果 |
| --- | --- |
| `content_items` | 17（`draft` 7 / `ready` 10）**不变** |
| `runs` | 7（`topic_article_generator` queued 1；`video_render` cancelled 2 / failed 2 / success 2）**不变** |
| `publish_records` | 3（`drafted` 2 / `published` 1）**不变** |
| `accounts` / `schedules` | 3 / 0 **不变** |
| Web 目录文件 | `artifacts` 37 个 / `videos` 8 个 / `uploads` 0 个 **不变** |
| DB 文件 | 字节数 921600 **不变**（mtime 变化，属用例受控写入） |
| `web-data` 顶层 | **不变** |
| Git HEAD | `3b48126` **不变**；阶段 2 未执行 `git add` / `git commit` |
| **唯一持久业务变化** | `usage_records` **14 → 15**（E2E-01 授权的那 1 次真实文本调用，成本台账；跨表差异逐表列出确认无其它变化） |

**闭环复核（全部用例跑完、全部清理完成后）**：再次运行 `node tmp-e2e-baseline.cjs check`，与 `e2e04-after` 对比 → `tables` / `contentByStatus` / `runsByPlaybook` / `publishByStatus` / `publishByPlatform` / `files.*` / `db.bytes` / **`db.mtime`（未再发生写入）** / Git HEAD 全部 **SAME**；`git.changedEntries` 仅 109 → 111，增量正好等于本阶段新增的 2 个**未跟踪**文件（本记录文档 + `tmp-e2e-baseline-check.json`）。**无残留业务数据、无未清理副作用。**

## 2. E2E-01 文章生成与持久化 —— 通过（1 次真实调用）

### 2.1 配置检查（调用前，授权第 ① 条）

`POST /api/content/generate` 之前，先读 `GET /api/ai/models` 与设置：证据 `tmp-p1-05-e2e01.log.json` → `1-config-check`。

| 检查项 | 实测值 | 判定 |
| --- | --- | --- |
| 默认模型 `defaults` | `{}`（**未配置默认模型**） | 观察项 |
| 模型偏好 `preferences` | `[]`（**未设置偏好**） | 观察项 |
| 凭据 | `credentialKeyCount = 1`；端点 `openai/default` `status=ok`、`usableKeyCount=1` | **可用** |
| `chat` 能力 | 265 个模型行中 **2 个可调用**：`openai/deepseek-flash`、`openai/deepseek-v4-pro`（均 `model_type=chat`，`enabled=1`） | **可用** |
| `structured_output` 能力 | 195 个模型行中 **0 个可调用** | 观察项（见 F2-7） |
| 设置 | `textProvider=openai`、`openAIModel=""`、`openAIBaseUrl=https://api.deepseek.com` | 可用 |

**判断与执行**：文章生成实际需要的是**文本对话**能力，`chat` 有 2 个可调用模型且端点有 1 个可用 key → 判定"条件满足"，按授权执行**恰好 1 次**真实调用。`structured_output` 严格模式不可用属**能力元数据缺失**（模型只标注了 `chat`），运行时以 chat 路径 + zod 校验兜底；此判断依据在此明示，供审查方复核。

### 2.2 执行与证据

| 步骤 | 请求 | 响应 | 关键数据库记录 |
| --- | --- | --- | --- |
| 生成 | `POST /api/content/generate`（`topic=E2E05-文章生成-1791516674973`、`prompt=受控端到端测试样本：写一段 120 字以内的中文短文。`、`maxWords=120`、英语系默认值） | **201** `{ok:true}`，`id=nOUvzx1LaT6m-ORP_Hp_j`，`title=文案总卡壳？试试这个帮手`，`body` 长度 111，`images=[]`，`provider=openai`，`model=deepseek-flash` | `content_items` 17 → **18**；`usage_records` 14 → **15** |
| 用量行 | — | — | `provider=openai, model=deepseek-flash, kind=article, status=success, input_tokens=353, output_tokens=1157, total_tokens=1510, word_count=108, content_item_id=nOUvzx1LaT6m-ORP_Hp_j` |
| 重新打开 | `GET /api/content/nOUvzx1LaT6m-ORP_Hp_j` | **200**；`titleMatches/bodyMatches/metadataMatches/postReadyMatches = true/true/true/true` | 行内 `body`、`post_ready_text`（标题+空行+正文）、`metadata_json`（`type/prompt/topic/generationType/agentId/agentName/aiWriting{…}/images[]/positioningId/provider/model`）、`status=ready` 一致 |
| 编辑并保存 | `PATCH /api/content/nOUvzx1LaT6m-ORP_Hp_j`（`title/body/postReadyText` 全量改写） | **200**；`titlePersisted/bodyPersisted/postReadyPersisted = true` 且数据库行逐字段一致 | 三列同步更新，`image_path=''`、`status='ready'` 未被误改 |
| 失败路径 | `GET /api/content/e2e05-missing-id` | **404** `{ok:false,error:"Not found",code:"NOT_FOUND"}` | — |
| 清理 | `DELETE /api/content/nOUvzx1LaT6m-ORP_Hp_j` → 再 `GET` | **200** `{deleted:true}` → **404** | `content_items` 18 → **17**（回到基线），`leftoverE2E05=0` |

### 2.3 前后基线与归因

- 前（`e2e01-before`）：`content_items 17`、`usage_records 14`、`runs 7`；后（`e2e01-after`）：表行数分组、文件数、Git HEAD 全部 **SAME**，仅 `usage_records 15`（+1）。
- `db.bytes` 不变、`db.mtime` 变化（受控写入）；`artifacts/videos/uploads` 文件数与字节 **SAME**（未生成图片）。
- **归因**：全部变化由本次授权的真实调用产生；无缺陷、无配置阻断、无外部依赖缺失。

## 3. E2E-02 图片与媒体 —— 通过（不调用图片生成能力，授权第 ② 条）

### 3.1 媒体读取可达性

| 步骤 | 请求 | 响应 |
| --- | --- | --- |
| 统一媒体列表 | `GET /api/media/assets` | **200**，`total = 45` = `artifacts 37` + `videos 8`（`product-images`/`brand-logos` 无文件） |
| 单个引用解析 | `GET /api/media/assets?ref=<某 artifact>` | **200**，返回该引用对象 |
| 未知 root | `GET /api/media/assets?ref=x&root=bogus` | **400**（`allowed` 列出四个合法 root） |
| root 无 ref | `GET /api/media/assets?root=videos` | **200 且仍返回 45 条**（`root` 在无 `ref` 时被忽略；列表无筛选/分页）→ F2-4 |

### 3.2 上传 → 产物读取（字节一致）→ 编辑器引用

自建 1×1 PNG（70 字节，夹具在系统临时目录，跑完删除）：

| 步骤 | 请求 | 响应/断言 |
| --- | --- | --- |
| 上传 | `POST /api/images/upload`（multipart，文件 `e2e05-fixture.png`） | **201**，`fileName=upload-1791516886199-qFDVPhOu.png`、`url=/api/agent/artifacts?file=…`；`artifacts` 37 → **38**；落盘字节 SHA 与上传字节**完全相同** |
| 产物读取 | `GET /api/agent/artifacts?file=upload-…png` | **200** `image/png` 70 字节，SHA 与上传字节**一致**（真读盘、无二次加工） |
| 编辑器引用 | `POST /api/content`（`images:[fileName]`，正文含编辑器写入的 `![](<url>)`） | **201**；`imagePath === fileName`（封面 = `images[0]`）、`metadata.images === [fileName]`；`GET` 读回一致；正文保留编辑器 URL |
| 清空引用 | `PATCH /api/content/<id>` `{images: []}` | **200**；`metadata.images = []`、DB 列 `image_path = ''`；响应**省略** `imagePath` 键（`toContent`：`row.imagePath \|\| undefined`） |

### 3.3 失败分支（区分三类失败）

| 类别 | 请求 | 结果 | 归因 |
| --- | --- | --- | --- |
| 模型不可用 | 图片生成能力 | **本阶段未重跑**（授权明令不重复调用） | 已知不可用；阶段 1 已取证 |
| 媒体读取失败 | `?file=e2e05-does-not-exist.png` / `?file=..%2Fsocial-auto-post.db` / `?file=e2e05.txt` | **404 / 404 / 404** | 行为正确（含路径穿越防护、非图片扩展名拒绝） |
| 上传非法输入 | `.txt` 文件 / 0 字节 PNG / 无 file 字段 | **400 `UNSUPPORTED_IMAGE` / 400 `EMPTY_UPLOAD` / 400 `EMPTY_UPLOAD`**；`artifacts` 仍 38（未落盘） | 行为正确 |
| 引用解析（新发现） | `?ref=e2e05-does-not-exist.png` | **200** 且合成引用（`source:"unknown"`、`mimeType` 由扩展名猜测、`url` 指向会 404 的地址） | **无法区分引用是否存在** → F2-3 |

### 3.4 前后基线与归因

- 清理：`DELETE /api/content/<id>` → **200**；删除自建 artifact（仅当文件名以 `upload-` 开头且等于本次记录的文件名）；删除临时夹具目录。
- 后（`e2e02-after`）：`files.artifacts === files(videos) === files(uploads)` 与行分组 **与 before 完全相同**（artifacts 回到 37）、`content_items 17`、`leftoverE2E05Content = 0`、`leftoverE2E05Files = 0`、Git HEAD **SAME**、DB 字节数 **SAME**。
- **归因**：无产品缺陷导致的数据残留；`changedEntries` 增长来自本阶段新增的临时取证文件（未跟踪，未提交）。

## 4. E2E-03 视频 —— 通过（**只读**，且**明确标注当前为 pass-through**）

本用例**全程只读**：不新建任务、不启动 Worker、不写入 `tasks/videos`（授权第 ③、⑤ 条）。

### 4.1 任务事实（`GET /api/tasks` + `GET /api/tasks/<id>`）

`totalTasks = 7`，其中 `video_render` **6** 个，视图状态与数据库原始列**一一对应**：

| 任务 id | 数据库原始状态 | 视图状态 | 产物地址 / 错误 |
| --- | --- | --- | --- |
| `ZP3MM2nYrCilrybXYHUD3` | `success` | `succeeded` | `/api/videos?file=render-1791513479877-4NlCpwFB.mp4`，`progress=100` |
| `88WbAGoxROTo-BVRBERSu` | `success` | `succeeded` | `/api/videos?file=render-1791513567794-C1rKt71H.mp4`，`progress=100` |
| `kfxmHkeOiowlf-rLKPr9i` | `failed` | `failed` | `RUN_FAILED / MATERIAL_NOT_FOUND: there is no file "no-such-clip.mp4" in the videos section`（`retryable=false`），`artifact_path=''` |
| `9WUI2DQ7BIF705zwbva4Y` | `failed` | `failed` | 同上（同源材料缺失） |
| `ePdp6NV9ai_WBs4RZKjZ_` | `cancelled` | `cancelled` | `Cancelled before it started.`（`cancelledFrom=queued`），`artifact_path=''` |
| `Ky5FL8bZtt5OBwugn4wMx` | `cancelled` | `cancelled` | 同上 |

- 成功任务：`resultUrl` 是**服务地址**而非文件路径（`/api/videos?file=…`），因此文件名必须从 `file=` 查询参数取，**不能**取 basename（见 F2-8）；`resultFileExists=true`、`resultFileSha=ea4dbec7d21f62ac`。
- 失败/取消任务：`resultUrl=''`、磁盘上**无**对应产物文件（`resultFileExists=false`）→ 失败分支不产出假产物。
- 任务日志尾部与状态一致（`done` / `error`+`code:MATERIAL_NOT_FOUND` / `warn`+`cancelled:true`）。

### 4.2 产物读取与 Range（`GET /api/videos`）

| 请求 | 结果 |
| --- | --- |
| `GET /api/videos`（无参数） | **200**，列出 **4** 个 `.mp4`（`.srt`/`.json` 不在此列表） |
| `GET /api/videos?file=render-…mp4` | **200** `video/mp4`、30389 字节、`Accept-Ranges: bytes`，`sha256=ea4dbec7d21f62ac`，与磁盘字节**一致**（4 个文件逐一验证 `bytesMatchDisk=true`） |
| `Range: bytes=0-99` | **206**，`Content-Range: bytes 0-99/30389`、`Content-Length: 100`，返回的首 100 字节与完整文件前缀**一致** |
| `Range: bytes=<超长范围>` | **416**，`Content-Range: bytes */30389`，正文 0 字节 |
| `?file=missing.mp4` | **404** `Not found` |
| `?file=..\web-data\social-auto-post.db`（路径穿越） | **404** `Not found` |
| `?file=render-…json`（伴随文件、非视频扩展名） | **404** `Not found`（`.srt`/`.json` 只能从媒体列表/磁盘取，不能从视频路由取） |

### 4.3 pass-through（字节副本）证据

`tmp-p1-05-e2e03.log.json` → `5-byte-copy-evidence`：

- `allMp4Identical = true`：`render-…4NlCpwFB.mp4`、`render-…C1rKt71H.mp4`、`video-…AzOtayxQ.mp4`、`video-…TMyEVPXp.mp4` **共享同一 sha256（`ea4dbec7d21f62ac`）与同一字节数 30389**。
- 渲染清单（`render-*.json`）：`renderer = { name: "existing-video-package", encoded: false }`，两条清单均记录 `outputIsByteCopyOfSource: true`（`outputSha256 == sourceSha256`）。
- 任务 `result_message` 自述：`Video render succeeded: "…mp4" (30389 bytes, renderer existing-video-package, encoded: false)`。
- 字幕（`.srt`，86 字节，两条同 sha）确实由参数 `captions` 生成，是本次渲染**唯一**的内容加工；**视频本体未重新编码、未加字幕烧入、未加封面**（`cover: null`，清单 `notes: "no cover material was given…"`）。

> **结论口径**：视频"渲染"链路当前是 **pass-through 打包器**（拷贝源视频 + 生成字幕侧车 + 写清单），**不是**真正的编码/合成渲染。验收时应按此口径判定（阶段 1 已标注为 pass-through，本阶段用字节证据**确认**该口径）。

### 4.4 前后基线与归因

`e2e03-before` → `e2e03-after`：表行数分组、`artifacts/videos/uploads` 文件数与字节、`content_items`/`publish_records`、Git HEAD **全部 SAME**（`runs` 的 3 个 `queued` 任务**未被启动**，Worker 全程未运行）。
**归因**：无缺陷、无数据变化；`bytesMatchDisk` 与 Range 语义均按 HTTP 规范实现。

## 5. E2E-04 发布受控失败 —— 通过（**未进行任何真实平台发布**）

授权第 ④ 条：只测**不存在的 `accountId`** 的受控失败分支。使用的伪装账号 id：`e2e05-nonexistent-account-1791516938`（数据库中不存在，事后无残留）。

### 5.1 执行与证据

| 步骤 | 请求 | 响应/断言 |
| --- | --- | --- |
| 建内容 | `POST /api/content`（`title=E2E05-发布失败-<ts>`） | **201**，`id=nXlMhEqKTzQ5CAeq_v0aV`、`status=ready` |
| 受控失败发布 | `POST /api/publish` `{contentItemId, accountIds:[<伪装 id>], mode:"now"}` | **HTTP 200**；`data.results[0].status === "failed"`、`error="Site not found"`；**未发生任何真实平台请求** |
| 发布记录（DB） | `select … from publish_records where account_id='<伪装 id>'` | 1 行：`status='failed'`、`message='Site not found'`、**`url=''`**、**`published_at=null`**、`content_item_id` 指向本次内容 → 与断言口径**完全一致** |
| 内容项未被误改 | `GET /api/content/<id>` + 全表分组 | `status='ready'`、`title` 未变；`runs` 0 变化、`accounts` 0 变化、`publish_records` +1 |
| 非法载荷边界 | `POST /api/publish` `{accountIds: []}` | **400** `Invalid payload`，`publish_records 4 → 4`（**未写任何记录**） |
| 清理 | `DELETE /api/content/<id>` + 按 id 清理失败记录 | 内容 **200** → `GET` 404；**删除内容不会级联删除 `publish_records`**（遗留 1 行），已用**显式 `delete … where id=`** 清除 → `publish_records` 回到 **3**、无伪装账号残留 |

### 5.2 前后基线与归因

`e2e04-before` → `e2e04-after`：`tables`、`contentByStatus`、`runsByPlaybook`、`publishByStatus`、`publishByPlatform`、`files.*`、`git.head`、`db.bytes` **全部 SAME**，仅 `db.mtime` 变化（受控写入）。
**归因**：受控失败分支**符合设计**（失败被如实记录且不污染内容状态）；发现 2 项语义/完整性问题 → F2-1、F2-2。**成功分支未执行**（授权禁止真实发布）。

## 6. 发现清单（含归因分类，供缺陷优先级判定）

| 编号 | 严重度 | 归因分类 | 发现 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- |
| **F2-1** | **中** | **产品缺陷（语义/契约）** | `POST /api/publish` 在**发布失败**时仍返回 **HTTP 200**：失败只体现在 `data.results[].status='failed'`。只看状态码的调用方（脚本、第三方、未来自动化）会把"失败"读成"成功" | E2E-04 step 2：`200` + `results[0].status='failed'`、`error='Site not found'`；DB 行 `failed/url=''/published_at=null` | 失败会话返回 4xx/207 或在顶层补 `ok:false` 与 `failedCount`；至少把该语义写进接口契约。注：C2 辅助发布走 `/api/publish/draft` + `/verify`，本入口风险面有限，故定为中危而非高危 |
| **F2-2** | 低 | **数据完整性 / 需产品确认语义** | 删除内容项**不级联**删除 `publish_records`（E2E-04：内容删除后失败记录仍在，`content_item_id` 成悬空引用）；同理 `usage_records`（E2E-01：内容删除后用量行保留、`content_item_id` 悬空） | E2E-04 step 5 `publishRowCascadedWithContent=false`；E2E-01 step 8 `dbAfter.usage=15`（内容已删） | 若定位为"台账/成本事实"→ 在文档与 UI 上显式承认悬空引用与容忍策略；若定位为"用户数据"→ 需要级联删除或软删除 + `deleted_at` |
| **F2-3** | 低 | **产品缺陷（信息诚实性）** | `GET /api/media/assets?ref=<不存在的名字>` 返回 **200** 并**合成**一个引用对象（`source:"unknown"`、`mimeType` 按扩展名猜测、`url` 指向一个会 404 的地址）→ 调用方无法从响应区分"引用存在/不存在" | E2E-02 step 5；实现见 `src/lib/media-artifact-ref.ts` + `src/app/api/media/assets/route.ts`（纯解析、不读盘） | 二选一：①响应增加 `exists` 字段（需要读盘，改变分层）；②在契约中明确"该接口只做引用**解析**，不保证存在"，并让消费方 UI 在 404 时降级（当前 UI 已如此？需 UI 侧确认） |
| **F2-4** | 低 | **产品缺陷（API 一致性，轻）** | `/api/media/assets` 的 `root` 参数在**没有** `ref` 时被静默忽略（`?root=videos` 仍返回全部 45 条）；列表无筛选、无分页 | E2E-02 step 4 | 要么支持筛选/分页，要么对"无 ref 却带 root"返回 400（与 `root=bogus` 的 400 行为保持一致）；阶段 1 已记录，本阶段确认 |
| **F2-5** | 低 | **观测（设计内）** | `videos/` 中的 `.srt`/`.json` 在 `/api/media/assets` 中 `url:""`（哨兵值），且 `/api/videos` **拒绝**非视频扩展名（404） | E2E-02 + E2E-03 step 4 `sidecarViaVideosRoute=404` | 属设计内；建议在契约文档写明"伴随文件不可通过视频路由取"，避免前端误用哨兵 `url` 直接渲染 |
| **F2-6** | — | **用例口径（非产品缺陷）** | E2E-02 初版断言"清空封面后 `imagePath === ''`"**失败**。复核：`toContent` 使用 `row.imagePath \|\| undefined`，**响应省略该键**，DB 列才是 `''`。属**测试口径错误**，产品行为自洽 | E2E-02 step 6 + 原始响应体 + DB 列双查（cleanup 脚本） | 断言改为 `imagePath is undefined && db image_path === ''`；并考虑 API 契约是否应统一为"永远返回字符串"以降低前端分支成本 |
| **F2-7** | 观测 | **配置问题（未阻断）+ 可观测性缺口** | ①`structured_output` 能力在 265/195 个模型行中**可调用数 = 0**（模型只声明 `chat`），`defaults={}`、`preferences=[]`，即**没有默认模型/偏好配置**；②`POST /api/content/generate` 响应**不回传**运行时路径（route/attempts/是否降级） | E2E-01 step 1；生成响应 `{ok:true,…}` 无 runtime 字段 | ①按需给模型补 `structured_output` 能力元数据或设置默认模型；②在生成响应或日志中标注"是否走 chat-only 降级"，否则外部只能靠猜（本阶段是用"能出正文 + 用量行"反推成功的） |
| **F2-8** | — | **用例脚本缺陷（已修正）** | E2E-03 初版把 `resultUrl` 当文件路径取 basename → 误报 `resultFileExists=false` | 修正前/后两次运行对比 | `resultUrl` 是**服务地址**（`/api/videos?file=…`），必须解析 `file=` 参数；已加 `fileNameFromUrl` 并对全部任务重跑，结果为 `true` |
| **F2-9** | 观测 | **成本/环境卫生** | 阶段 2 唯一持久业务变化是 `usage_records 14 → 15`（授权的那 1 次真实调用）。该行是**成本事实**，本阶段**故意保留**（删除会掩盖真实花费） | 阶段 1 终态 vs E2E-04 后快照的逐表差异 | 若后续要求"数据库零增长"，需产品方明确"用量行是否可清理"，不要由执行方自行决定 |

## 7. 未执行项、限制与复审指引

### 7.1 明确未执行（均有授权依据）

| 项 | 原因 |
| --- | --- |
| 真实平台发布（E2E-04 成功分支） | 授权禁止；阶段 1 已判定为**外部依赖/待人工验证**，本阶段不改变结论 |
| 图片生成模型能力复测 | 授权第 ② 条明确"不重复调用已知不可用的能力" |
| Worker 启动 / 任何 `queued` 任务执行 | 授权第 ⑤ 条；`runs` 中 3 个 `queued` 任务全程保持 `queued` |
| `git add` / `git commit` / 分支操作 | 授权第 ⑦ 条；Git HEAD 全程 `3b48126` |
| 修改任何源码或既有文档 | 授权第 ⑦ 条；本阶段只**新增**临时取证脚本与 1 份记录文档 |
| 真实视频编码渲染（验证 pass-through 之外的渲染） | 需要真实编码器/Worker，属测试环境限制与授权边界外 |

### 7.2 测试环境限制

- 应用以**已运行的 dev server** 验证（非打包产物）；Electron 打包态行为不在本阶段范围（参见仓库 AGENTS.md 的"打包后可验证面"提示）。
- 图片生成、真实发布依赖外部服务/凭据，本环境不可达，因此相关用例只能验证**失败分支**。

### 7.3 复审指引（如何独立复核本记录）

1. `node tmp-e2e-baseline.cjs check` → 生成 `tmp-e2e-baseline-check.json` 当前指纹；与 `tmp-e2e-baseline-e2e04-after.json` 对比，业务表/文件/DB 字节/`db.mtime` 应全部 **SAME**（本记录已如此复核）。
2. 打开 `tmp-p1-05-e2e0{1,2,3,4}.log.json` 与 `tmp-p1-05-e2e02-cleanup.log.json` 逐条核对上文的每个断言与响应体。
3. `git --no-pager status --porcelain` → 确认**没有**被本阶段修改的已跟踪文件（`M` 列表与阶段 1 完全一致），新增项只有 `tmp-p1-05-*`、`tmp-e2e-baseline-*`（未跟踪）与本记录文档。
4. `node_modules\.bin\eslint.cmd tmp-p1-05-*.cjs tmp-e2e-baseline.cjs` → 0 error（临时脚本已加 `require` 规则豁免；`eslint .` 不会因本阶段新增文件报错）。

### 7.4 阶段 2 判定汇总

| 用例 | 判定 | 归因 |
| --- | --- | --- |
| E2E-01 文章生成与持久化 | **通过** | 无缺陷（1 次授权的真实调用；配置项 F2-7 为观察项） |
| E2E-02 图片与媒体 | **通过**（图片生成能力本身仍未验证，属外部阻塞） | F2-3/F2-4 为低危缺陷；F2-6 为用例口径修正 |
| E2E-03 视频 | **通过**（明确口径：pass-through） | 无缺陷；F2-8 为脚本修正 |
| E2E-04 发布受控失败 | **通过**；成功分支**未执行** | F2-1（中危，语义）/F2-2（低危，数据完整性） |

**建议的缺陷优先级**：先定 F2-1（对外语义，影响自动化误判）→ 再与产品确认 F2-2/F2-3/F2-7 的"契约口径"（把口径写进文档往往即可降级为观察项）→ F2-4/F2-5 归入 API 一致性清理批次。



