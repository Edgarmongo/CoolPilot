# P0-07 备份与恢复审计（只读）

> **审计对象**：CoolPilot 当前的备份与恢复能力——备份纳入范围、恢复语义、数据库中的"文件引用"字段在恢复后是否还能找到真实文件、以及与 P0-06（Agent 执行基础）的交集。
> **审计方式**：只读源码取证（读文件 + grep + 目录清单 + 跑既有测试）。**未导出、未执行任何恢复、未改数据库/配置/生产代码。**
> **基线**：工作区当前版本（含未提交的在途改动，`git status` 前后一致，见 §12）。
> **结论定位**：备份是**"数据库逻辑导出（JSON）"**，不是"工作区快照"。**表数据能往返，文件不会跟着走**；恢复后有几处会让"数据库引用"与"磁盘文件"对不上，需要人工复制数据目录才能补齐。见 §一 与 §五。

---

## 一、一句话结论

CoolPilot 的备份**只是数据库的逐表 JSON 导出**：`GET /api/backup/export` 把 schema 里声明的每一张表整表读出来写成 `coolpilot-backup-<日期>-<时间>.json`（`src/db/repositories/backup.ts:61-83`），`POST /api/backup/restore` 再把它整表写回（`:96-161`）。

**能恢复的**：所有**表行**，包括设置（`app_settings`）、知识库正文（`knowledge_base.content`）、聊天与工具调用、Agent 运行与事件（含 `paused` 的 `pending_approval_json`/`state_json`）、发布事实（`publish_records`）、指标、模型网关配置。表覆盖是**自动的**（从 `@/db/schema` 反射，`:27-33`，并有测试断言，`src/lib/backup.test.ts:125-129`）。

**不能恢复的（JSON 里根本没有）**：所有**文件**——`artifacts/`（生成图、上传图、发布截图）、`uploads/product-images/`、`uploads/brand-logos/`、`videos/`、`browser-profiles/<accountId>`（Playwright 登录态）、凭据库 `credential-vault.json` / `credential-vault.key`，以及仓库根的 `.env.local`（供应商密钥与 model-gateway cookie）。这一点**产品自己也承认**：导出卡片固定显示"浏览器设定、图片、影片与生成产物存放在资料目录中，不包含在 JSON 备份内"（`src/locales/zh-cn.json:763`、`README.md:306`）。

**三个必须先修的事实问题**（不是能力缺失，是与现有文档/UI 表述不一致）：

1. **`replace` 不等于"备份即全量"**：只清空**备份文件里出现的表**（`src/db/repositories/backup.ts:114-126`）。旧备份（例如没有 `ai_model_*` / `agent_runtime_*` 的版本）恢复后，那些表保留**当前**数据 → 工作区是"两个时间点的混合"，而 `README.md:303` 写的是"工作区成为备份文件的精确副本"。
2. **恢复报告的关键数字没有出口**：`deleted`（replace 删了多少）与 `skipped`（被丢弃的行）都算出来了（`:123-126`、`:130-146`），但 UI 只渲染 `inserted` 与 `unknownTables`（`src/components/settings/backup-settings-client.tsx:120-124`、`:212-216`）→ **丢数据时用户看不到**。
3. **导出无上限、导入有上限**：导出不限大小（`src/app/api/backup/export/route.ts:10-22`），导入在 64 MB 处直接 413（`src/lib/backup.ts:16`、`src/app/api/backup/restore/route.ts:16-18`）→ 应用自己产出的备份，可能**导不回来**。

**与 P0-06 的交集（用户明确要求覆盖）**：`agent_runtime_runs` / `agent_runtime_events` 是普通表，**随 JSON 完整往返**；恢复后暂停中的任务**仍能 resume**（恢复链路只读库，`src/app/api/agent/runs/[id]/resume/route.ts:92`）。但两类状态会被"原样复活"：备份里的 `running` 会回到卡住状态（P0-06 G4），备份里过期的 `schedules.next_run_at` 会在下一次 tick 被立即补跑（`src/worker/scheduler-service.ts:20-53`）；而 `paused` 任务一旦批准，执行浏览器工具就需要 `browser-profiles/<accountId>`（`src/lib/agent/langgraph-engine.ts:365`、`src/lib/agent/playwright-session.ts:41-69`）——**只还原 JSON 是不够的**。

---

## 二、备份与恢复的现状链路

### 2.1 入口与代码位置

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| 概览卡片 | `GET /api/backup` → `src/app/api/backup/route.ts:12-22` | 只回 `format` / `version` / `dataDir` / 每表行数；**不含文件区** |
| 页面 | `src/app/[locale]/(console)/settings/[tab]/page.tsx` → `src/components/settings/backup-settings-client.tsx` | 系统设置 → 备份 |
| 导出 | `GET /api/backup/export` → `src/app/api/backup/export/route.ts:10-22` | `Content-Disposition: attachment`；UI 用 `window.location.assign` 触发（`backup-settings-client.tsx:69-73`） |
| 恢复 | `POST /api/backup/restore` → `src/app/api/backup/restore/route.ts:14-38` | 先查 `content-length`（413）→ zod 校验 → 版本校验 → `restoreBackupSnapshot()` |
| 读写实现 | `src/db/repositories/backup.ts` | `backupTableDescriptors()` `:35-42`、`backupTableCounts()` `:45-55`、`createBackupSnapshot()` `:61-83`、`restoreBackupSnapshot()` `:96-161` |
| 格式与校验（纯函数） | `src/lib/backup.ts` | `BACKUP_FORMAT` `:13`、`BACKUP_VERSION=1` `:14`、`BACKUP_MAX_RESTORE_BYTES=64MB` `:16`、schema `:57-77`、`parseBackupDocument()` `:89-115`、`normalizeBackupCell()` `:118-129`、`quoteIdentifier()` `:132-137`、文件名 `:150-161` |
| 用户文档 | `README.md:299-308` | 已明确 `replace` / `merge` 语义与"文件不在 JSON 内" |
| 测试 | `src/lib/backup.test.ts:29-89`（格式）、`:124-173`（仓库往返） | 表覆盖断言 + replace/merge 往返 |

### 2.2 备份范围 = 数据库全部表（schema 驱动）

`collectTables()` 从 `@/db/schema` 反射**每一张** drizzle 表（`src/db/repositories/backup.ts:27-33`），`createBackupSnapshot()` 对每表执行 `SELECT *` 并把值规范化为 JSON 标量（`:66-73`）：

- `normalizeBackupCell()` 把 `undefined` / 非有限数 / 超界 `BigInt` / blob 变成 `null`（`src/lib/backup.ts:118-129`）——**blob 会被丢弃**（当前 schema 无 blob 列，属于防御性代码）。
- 列清单来自 drizzle（`:35-42`），不是 `PRAGMA table_info` → **数据库里存在但 schema 未声明的表不会被导出**（P0-02 记录的 `sites` 遗留表就是这种；`src/lib/workspace/manifest.ts:63-64` 会把它们报成 `unknownTables`）。

### 2.3 恢复语义（源码行为）

`restoreBackupSnapshot(snapshot, mode)`（`src/db/repositories/backup.ts:96-161`）：

1. 整段写在**一个 `sqlite.transaction("write")`** 内，异常回滚（`:112`、`:152-158`）→ 恢复本身**全有或全无**。
2. 文件里的表在本 build 不存在 → 记入 `report.unknownTables` 并**跳过**（`:114-119`）。
3. `mode === "replace"` → 先 `DELETE FROM <表>`（仅这一张，`:123-126`）；文件里**没有**的表**完全不动**。
4. 逐行过滤列：只保留本 build 认识的列（`:131`）；**一行所有列都不认识 → `skipped += 1` 且整行丢弃**（`:132-135`）。
5. 写行：`merge` 用 `INSERT OR IGNORE`，`replace` 用普通 `INSERT`；受影响行数为 0 记 `skipped`（`:138-146`）。
6. **没有外键、没有 JSON 复解析、没有业务一致性校验** → 手工编辑过的文件（例如 `metadata_json` 写成非法 JSON）会被原样写库。

### 2.4 版本与兼容

- `format` 必须是 `coolpilot-backup`，否则 `invalid_document`（`src/lib/backup.ts:65-71`、`:97-100`）——别的产品导出的 JSON 不会被半途导入（有测试：`src/lib/backup.test.ts:80-88`）。
- `version > BACKUP_VERSION` → 拒绝（客户端 `unsupported_version`；服务端再校验一次：`src/app/api/backup/restore/route.ts:26-32`）。
- **没有迁移机制**：跨版本只能靠"未知表跳过 + 未知列丢弃"这两条兜底。



## 三、纳入 / 不纳入清单（含本机实测）

### 3.1 备份纳入范围

| 对象 | 是否进 JSON | 证据 |
| --- | --- | --- |
| 所有 schema 声明的表行（27 张，含 Agent 运行/事件、聊天、发布事实、指标、模型网关） | ✅ | `src/db/repositories/backup.ts:27-33,66-73`；覆盖断言 `src/lib/backup.test.ts:125-129` |
| `app_settings` 的设置 JSON（`local-agent` / `brand` / `local-agent-prompt` / `metrics` / `model-gateway`） | ✅（含**其中的路径字符串**） | `src/db/repositories/settings.ts:21-24`；`brand.logoPath` 是绝对路径，见 §4.4 |
| 知识库正文（`knowledge_base.content`、`file_name`） | ✅（正文已在库内，原文件不落盘） | `src/app/api/knowledge-base/upload/route.ts:29-42` |
| 图片/视频/产物文件本身 | ❌ | `src/app/api/backup/export/route.ts:10-22`（只读表）；`src/locales/zh-cn.json:763` |
| 浏览器登录态 `browser-profiles/<accountId>` | ❌ | `src/lib/paths.ts:36-42,69-71` |
| 凭据库 `credential-vault.json` / `credential-vault.key` | ❌ | `src/lib/credentials.ts:33-42`；被 manifest 列为"已归属文件"（`src/lib/workspace/manifest.ts:295-301`），**但与备份无关** |
| 仓库根 `.env.local`（供应商密钥、model-gateway cookie） | ❌（且不在数据目录内） | `src/lib/secrets.ts:48`；`README.md:197,308` |
| 数据目录里**其它** `.db` 文件 | ❌ | 导出只经连接指向的库（`src/db/client.ts:9-28`） |
| 数据库文件本身 / `-wal` / `-shm` | ❌（备份是逻辑导出，不是文件副本） | `src/lib/workspace/manifest.ts:136-138` |

### 3.2 本机开发工作区实测（只做目录清单，未打开数据库）

命令：`Get-ChildItem web-data` + 各段 `Get-ChildItem -Recurse -File`（只读）。

| 路径 | 实测 | 备份是否覆盖 |
| --- | --- | --- |
| `web-data/social-auto-post.db` | 913,408 B（≈892 KB） | 表行 ✅ / 文件 ❌ |
| `web-data/artifacts/` | **37 个文件 / 4,636,064 B（≈4.4 MB）** | ❌ |
| `web-data/browser-profiles/` | **4,099 个文件 / 581,858,027 B（≈555 MB）** | ❌ |
| `web-data/uploads/` | 0 文件（目录存在） | ❌ |
| `web-data/videos/` | 0 文件（目录存在） | ❌ |
| `web-data/_tmp-e2e.db` | 0 B（数据根里的**第二个** `.db`） | ❌（也不在导出的表里） |

> 直接结论：本机数据目录 ≈ **556 MB**，其中数据库只有 **892 KB**。两者量级差 600 倍，"备份能否恢复工作区"的问题几乎全部落在文件上；`_tmp-e2e.db` 说明数据根可以出现**导出范围之外**的数据库文件（`unaccounted.rootFiles` 会报告它，`src/lib/workspace/manifest.ts:294-318`，但备份不会带上）。

---

## 四、数据库中的"文件引用"字段（恢复后能不能找到真实文件）

数据库里没有 `assets` 表（P0-02 §5），素材身份 = **路径字符串 + 目录约定**。恢复后这些字符串**原样回来**，但对应的文件是否还在，取决于有没有人工复制数据目录。

### 4.1 字段总表

| # | 字段 | 写入者（证据） | 存的什么格式 | 读取者（证据） | 只还原 JSON 时 | 复制了整个数据目录（同机/新机同名路径） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `content_items.metadata_json.images`（**事实来源**，第一张=封面） | 文章生成：`src/lib/article-generation.ts:147-156`（`resolveArticleImages()` 的返回值**直接入库**）；内容路由：`src/app/api/content/route.ts:23-24`（客户端提交的**裸文件名**） | **两种混用**：绝对路径（`copyIntoArtifacts()` → `src/lib/article-images.ts:13-19`；`generateImageFile().path` → `src/lib/agent/image-generation.ts:47-48`）、远程 URL（`fetchArticleText().imageUrl`）、裸文件名（编辑器/图库选择） | `src/lib/content-images.ts:10-17`；编辑器与发布面板 `src/components/creation/publish-run-panel.tsx:169-172` | 渲染可回退（图库 URL 只用 basename） | ✅ 裸文件名与远程 URL 正常；**绝对路径仅当新工作区路径与旧路径完全一致时才有效** |
| 2 | `content_items.image_path`（发布管线用的封面镜像） | `createContentItem`（`src/db/repository.ts:380`）、`updateContentItemImage`（`:408`）、聊天历史回填 `reconcileContentImagesFromChatHistory()`（`src/db/repository.ts:492-511`，值来自 `chat_tool_calls.output_json.path` → **绝对路径**，`src/lib/content-image-reconciliation.ts:29-40`） | 同上一行的列表首项 | `src/lib/content-images.ts:10-17`、`src/lib/threads.ts:60`、`src/lib/publish.ts:27-33` | 同上 | 同上 |
| 3 | `content_items.metadata_json.videoPath` | 视频发布会写入影片**裸文件名**（`src/components/creation/videos-composer.tsx:325`）；内容路由 `src/app/api/content/route.ts:24` | 裸文件名 | `src/lib/video-library.ts:74-76`；`src/lib/publish.ts:35-41`（相对名按 `videosRoot()` 解析） | ❌ 文件不存在 → 发布时报错/跳过 | ✅（前提是 `videos/` 一起复制） |
| 4 | `products.image_path` | `POST /api/products/image` 返回并入库**绝对路径**（`src/app/api/products/image/route.ts:63-67`） | 绝对路径 | `src/lib/products.ts:4-16`（只取 **basename** 拼 `/api/products/image?file=`）；`src/lib/article-images.ts:39-46`（`copyIntoArtifacts` 需要真实文件） | 图片预览 ✅（basename）、产品图入稿 ❌（源文件不存在） | ✅（`uploads/product-images/` 复制后，basename 解析不受旧绝对路径影响） |
| 5 | `app_settings` → `brand.logoPath` | `POST /api/settings/brand/logo` 写**绝对路径**（`src/app/api/settings/brand/logo/route.ts:66-71`） | 绝对路径 | `containedLogoPath()` 要求**落在当前 `brandLogosRoot()` 之内**，否则 404（`:19-23`、`:33-37`） | ❌ 404（路径不在本工作区） | ⚠️ 只有新工作区路径与旧路径一致才有效；**跨机必须重新上传 logo** |
| 6 | `accounts.profile_path` | `createAccount` 写入 `accountProfilePath(id)`（`src/db/repository.ts:286,296`） | 绝对路径（创建时那一刻的） | **没有读者**：`toAccount()` 用 `accountProfilePath(row.id)` 覆盖（`:75-78`）；`updateAccount()` 明确**不接受**该字段（`:303-310`） | ✅ 不受影响（读出来的是当前工作区的派生路径） | ✅ 不受影响（同上；登录态取决于 `browser-profiles/<accountId>` 是否被复制） |
| 7 | `runs.artifact_path`（运行截图） | 形参在 `createRun`（`src/db/repository.ts:597`、`:626,635`），但**两个调用方都没传**（`src/app/api/runs/route.ts:25`、`src/worker/scheduler-service.ts:32`）；`src/lib/threads.ts:108-113` 返回的截图路径**没有写库**（`runner.ts:195-223` 只写 `message`） | 实际恒为空字符串 | `toRun()` 映射为 `undefined`（`src/db/repository.ts:130`） | ✅ 无影响（列本身就是空的） | ✅ 无影响 |
| 8 | `knowledge_base.file_name` | `POST /api/knowledge-base/upload` 把**正文抽出来入库**，原文件不落盘（`src/app/api/knowledge-base/upload/route.ts:29-42`） | 原始文件名（仅展示） | 知识库仓库 `src/db/repositories/knowledge-base.ts:29-33` | ✅（正文在库内） | ✅ |
| 9 | `ai_model_endpoints.credential_ref` / `ai_credential_keys.fingerprint` | 模型网关同步/密钥池（`src/db/schema.ts:326`、`:363-366`） | 引用串（如 `credential://qwen/default`）+ 密钥**指纹** | `src/lib/credentials.ts:10-18`（真实密钥在 vault 文件或环境变量） | ⚠️ 引用在、密钥不在 → AI 能力不可用（需重新填密钥/复制 vault） | ✅（复制 vault + `.env.local` 后可用） |
| 10 | `dify_connections.api_key` | 连接配置表单（`src/db/schema.ts:169`） | **明文** | Dify 调用方 | ✅（库内明文，随备份往返） | ✅（安全风险见 R8） |
| 11 | `chat_tool_calls.output_json`（`path` / 截图路径） | Agent 工具（`src/lib/agent/local-tools.ts:129-134` 等） | 绝对路径 | 仅用于回填 #2（`src/db/repository.ts:492-511`） | 回填后得到失效绝对路径（见 #2） | ⚠️ 同 #2 |

### 4.2 同一个"图片路径"为什么有时能恢复、有时不能

同一列里可能并存三种形态（P0-03 已记录，本卡只补"恢复"这一视角）：

| 形态 | 例子（来自源码） | 由谁解析 | 恢复后（已复制 `artifacts/`）|
| --- | --- | --- | --- |
| **裸文件名** | `upload-1791307014616-rxzItLCR.png`（`src/app/api/images/upload/route.ts:33-35`）、编辑器和图库选择（`src/components/creation/article-editor/article-editor.tsx:173`）、`video.fileName`（`src/components/creation/videos-composer.tsx:325`） | 服务端拼当前工作区目录（`/api/agent/artifacts?file=`、`src/app/api/videos/route.ts:14-16`）| ✅ 正常 |
| **远程 URL** | `fetchArticleText(url).imageUrl`（`src/lib/article-images.ts:54`）| 直接给浏览器/发布面板 | ✅ 正常（与本地文件无关）|
| **绝对路径** | `copyIntoArtifacts()`（`src/lib/article-images.ts:16-18`）、`generateImageFile().path`（`src/lib/agent/image-generation.ts:47-48`）、`products.image_path`（`src/app/api/products/image/route.ts:63-66`）、`chat_tool_calls.output_json.path` 回填（`src/db/repository.ts:492-511`）| **发布/上传链路原样使用**：`resolveLocalImagePath()` / `resolveLocalVideoPath()` 仅在"不是绝对路径"时才落到工作区目录（`src/lib/publish.ts:27-41`），`Playwright.setInputFiles` 拿到的就是这条旧路径 | ❌ **旧机器的绝对路径仍然失败**（例如旧机 `C:\app\web-data\artifacts\x.png`，新机换目录后该文件不在那）|

> **这是本卡最重要的一条可操作结论**：跨机器恢复时，即使把 `artifacts/` 复制过去，只要库里存的是绝对路径，发布链路依旧指向旧目录（展示用的流式路由按 basename 走，所以**"能看到图"和"能发图"会不一致**——用户会看到图片正常显示、发布却失败）。修复不需要新表，也不改 C2 契约：把 `resolveLocalImagePath()` 的"绝对路径优先"改成"basename 优先、绝对路径仅作同机快路径"即可（属 P1-01 素材身份的范围，本卡只登记）。

### 4.3 `accounts.profile_path` 专项（用户点名核实）

| 事实 | 证据 |
| --- | --- |
| 只在创建账号时写入一次，值是那一刻的绝对路径 | `src/db/repository.ts:286`（`accountProfilePath(id)`）、`:296`（写列）|
| 表列存在且会随备份往返 | `src/db/schema.ts:9`；恢复按普通列处理（`src/db/repositories/backup.ts:130-146`）|
| **全仓没有读者** | `toAccount()` 用 `accountProfilePath(row.id)` 覆盖（`src/db/repository.ts:75-78`）|
| 更新接口明确拒收该字段 | `src/db/repository.ts:303-310`（`delete rest.profilePath`）|
| 所有"看起来在读它"的调用方拿到的都是派生值 | `src/worker/runner.ts:50`、`src/lib/agent/langgraph-engine.ts:365,461`、`src/lib/agent/local-tools.ts:42,72,100,129`、`src/lib/browser-preview-session.ts:295,767`、`src/app/api/browser-profiles/[accountId]/open/route.ts:31`、`src/app/api/agent/schedules/route.ts:26` —— 它们的 `site` 全部来自 `getAccount()`（`AccountRecord.profilePath`）|
| 身份 = 目录名 = account id | `src/lib/workspace/manifest.ts:333-344`（用 account id 认领 `browser-profiles/<id>`）；`src/lib/paths.ts:50-71` |

**结论**：恢复**不需要**为 `accounts.profile_path` 做任何迁移、清空或重写；它在恢复后是**无害的历史字符串**。真正决定"登录态还在不在"的是 `browser-profiles/<accountId>` 目录有没有被复制过来（本机实测 555 MB / 4,099 文件）。P0-06 与 `paths.ts:50-71` 的说法在本卡**验证成立**。

> 顺带发现（与备份无关，仅登记）：既然读出来的 `profilePath` 永远非空，`src/lib/account-risk.ts:207` 的 `missing_profile` 分支实际不可能命中。是否属预期，留给 P1/P2 判断，本卡不改。

### 4.4 品牌 logo 专项

`brand.logoPath` 是**绝对路径**（`src/app/api/settings/brand/logo/route.ts:66-71`），而读取时要求它落在**当前** `brandLogosRoot()` 之下（`:19-23`）→ 跨机恢复（数据目录换了位置）后 `GET /api/settings/brand/logo` 返回 404，设置页会显示"没有 logo"，**必须重新上传**。这也是 §五 里唯一一项"复制文件也救不回来、必须重做"的引用。

### 4.5 凭据专项（决定恢复后 AI 能不能用）

- 库内只有引用与指纹：`src/db/schema.ts:326`（`credential_ref`）、`:363-366`（`fingerprint`）。
- 真实密钥在两处，**都不在备份里**：数据目录的 `credential-vault.json` + `credential-vault.key`（`src/lib/credentials.ts:33-42`）、仓库根的 `.env.local`（`src/lib/secrets.ts:48`，`README.md:169,197`）。
- 恢复后表现：AI 调用报 `MODEL_CREDENTIAL_*`（密钥缺失），模型网关列表仍显示已同步的模型 → **"配置在、钥匙不在"**，用户容易误判为模型故障。产品这一条在 UI 上没有提示（导出卡片只提"浏览器设定、图片、影片与生成产物"）。

---

## 五、三类清单（能恢复 / 不能恢复 / 需人工复制或重做）

### 5.1 只靠 JSON 备份就能恢复 ✅

| 对象 | 内容 | 证据 |
| --- | --- | --- |
| 设置与提示词 | `app_settings` 全部 key：`brand` / `local-agent` / `local-agent-prompt` / `metrics`（前四个 key 的定义见 `src/db/repositories/settings.ts:21-24`）与 `model-gateway`（由模型运行时的仓储管理）——**含 `brand.logoPath` 这个字符串本身** | `src/db/repositories/settings.ts:21-24` |
| 知识库 | 标题、正文、分类、权重、标签、来源 URL、文件名 | `src/db/repositories/knowledge-base.ts:29-33` |
| 账号记录 | `platform` / `url` / `account` / `memo` / `status` / `preset_json`（`profile_path` 无意义但无害） | `src/db/schema.ts:3-15` |
| 内容与业务记录 | `content_items`（含 `metadata_json` 里的路径字符串）、`products`、`schedules`、`runs` / `run_events`、`publish_records`、`metric_snapshots`、`account_metric_snapshots`、`usage_records`、`positions`、`dify_connections` | 全部为 schema 声明的表 → `src/db/repositories/backup.ts:27-33` |
| 聊天 | `chat_threads` / `chat_messages` / `chat_tool_calls` | `src/db/schema.ts:71-103` |
| Agent | `agent_runtime_runs`（含 `paused` 的 `pending_approval_json` / `state_json` / `result_json`）、`agent_runtime_events` | `src/db/schema.ts:111-132`；恢复后 resume 只读库（`src/app/api/agent/runs/[id]/resume/route.ts:92`） |
| 模型网关 | 供应商 / 端点 / 模型 / 能力 / 偏好 / 同步记录 / 探测结果 / 密钥健康（只有**指纹**，没有密钥） | `src/db/schema.ts:306-376` |

### 5.2 只靠 JSON 不能恢复 ❌

| 对象 | 位置 | 本机实测 | 恢复后表现 |
| --- | --- | --- | --- |
| 生成图 / 上传图 / 发布截图 | `<data>/artifacts/` | 37 文件 / 4.4 MB | `/api/agent/artifacts?file=` 404；内容图与图库全空 |
| 浏览器登录态 | `<data>/browser-profiles/<accountId>` | 4,099 文件 / 555 MB | 每个账号都要重新登录；发布与 Agent 浏览器工具会在空 profile 里"已登出"（`src/lib/browser.ts:23-25`、`src/lib/agent/playwright-session.ts:55-61` 会 `mkdir` 后启动） |
| 产品图 / 品牌 logo | `<data>/uploads/product-images/`、`uploads/brand-logos/` | 0 文件（目录存在） | 产品图与 logo 失效（logo 见 §4.4） |
| 待发布影片 | `<data>/videos/` | 0 文件（目录存在） | 视频发布缺文件 |
| 凭据库 | `<data>/credential-vault.json`、`credential-vault.key` | 需要时才有 | AI 供应商密钥丢失（§4.5） |
| 环境密钥与 cookie | 仓库根 `.env.local` | 存在 | 同上 + model-gateway 同步 cookie 需重填 |
| 数据根里的其它数据库 | `<data>/*.db` | `_tmp-e2e.db`（0 B） | 不在导出范围内（`GET /api/backup` 也只统计连接指向的那个库） |
| 数据库物理文件 / WAL | `<data>/social-auto-post.db(-wal/-shm)` | 892 KB | **不需要**——备份是逻辑导出；但也因此不能靠"复制 JSON"还原被误删的**未导出**表（如遗留 `sites`） |

### 5.3 需人工复制或重做 ⚠️

| 动作 | 为什么 | 证据 |
| --- | --- | --- |
| 一起复制**整个数据目录** | JSON 内没有文件 | `README.md:306`；`src/locales/zh-cn.json:763` |
| 跨机后**重新上传品牌 logo** | `logoPath` 是绝对路径且被"必须落在当前工作区"校验拦下 | §4.4（`src/app/api/settings/brand/logo/route.ts:19-23`） |
| 跨机后**重填 `.env.local`（或复制 vault）** | 密钥不在备份内 | §4.5 |
| 跨机后**逐账号确认登录态** | 复制 `browser-profiles` 能否继续免登录，取决于平台对设备指纹的判断 | 待验证 V1 |
| 恢复前**先导出一份**（或手动留档） | `replace` 不可逆，且没有自动快照 | 见 R1 |
| 恢复期间**避免在跑发布/排程** | 恢复不暂停调度器，10 秒一次的 tick 会继续工作 | `electron/main.cjs:161-176`；`src/app/api/internal/scheduler/tick/route.ts:9-18` |

---

## 六、恢复路径的 9 项风险

> 全部为**只读发现**；每条给出证据、影响与建议方向。建议本身属于 P1/P2 的决策范围，**本卡不实现**。

### R1 `replace` 不可逆：没有"恢复前自动快照"

- 现象：UI 只有确认弹窗 + 行数提示（`src/components/settings/backup-settings-client.tsx:245-252`），确认后直接 `POST /api/backup/restore`；服务端在事务里先 `DELETE`（`src/db/repositories/backup.ts:123-126`）。
- 影响：选错文件（或文件本身是旧的）→ 当前数据**当场被清空**，且**没有自动留档**；唯一的补救是用户此前自己导过。
- 建议：`replace` 前由服务端先写一份 `backup-before-restore-<stamp>.json`（复用 `createBackupSnapshot()`），或在 UI 把"先导出"做成不可跳过的门禁。

### R2 导出无上限 / 导入 64 MB 上限（不对称）

- 证据：导出 `src/app/api/backup/export/route.ts:10-22`（无大小判断）；导入 `src/lib/backup.ts:16`（64 MB）+ `src/app/api/backup/restore/route.ts:16-18`（`413 too_large`）+ 客户端预检 `backup-settings-client.tsx:81-84`。
- 影响：长期使用的工作区（大量 `chat_messages` / `agent_runtime_events` / `metric_snapshots`）可能**导出成功、导入失败**——包括在自己的新机器上。
- 建议：两边同源（提高上限并按流式处理），或导出时按当前行数预估并明确提示"此备份超过导入上限"。

### R3 `replace` 只覆盖"备份文件里出现的表"

- 证据：`:114-126`（对文件里的表逐张 `DELETE`）；文件里没有的表完全不碰。
- 影响：用旧版本备份恢复后，**新表保留现状**，工作区变成两个时间点的混合；而 `README.md:303` 写的是"工作区成为备份文件的精确副本"，**文档与实现不一致**。
- 建议：二选一——①把 `replace` 定义成"仅文件内表"并改文档措辞；②让 `replace` 清空**所有 schema 声明的表**（对文件未包含的表也清空）。两者都会影响既有测试 `src/lib/backup.test.ts:157-166`，需要人工裁定。

### R4 丢数据没有出口：`deleted` / `skipped` 不进 UI

- 证据：报告里算了（`src/db/repositories/backup.ts:123-126,130-146`；类型 `src/lib/backup.ts:39-55`），UI 只渲染 `inserted` 与 `unknownTables`（`backup-settings-client.tsx:120-124`、`:212-216`）。
- 影响：一行的列全都不认识（`skipped`）或 replace 删了更多行，用户只看到"恢复完成，N 行"。
- 建议：报告卡片追加 `deleted` / `skipped` 汇总；`skipped > 0` 时用 warning 色调。

### R5 恢复不暂停调度器与 worker（并发写入窗口）

- 证据：恢复路由没有任何"暂停/排他"逻辑（`src/app/api/backup/restore/route.ts:14-38`）；调度由 Electron 主进程每 10 秒 POST 一次 tick（`electron/main.cjs:161-176`），独立 worker 进程也在轮询（`src/worker/worker.ts:5-20`）。
- 影响：恢复事务提交后的瞬间，一个正在执行的 run 可能继续写它自己的表（`runs` / `run_events` / `publish_records` / `content_items`）→ 恢复出来的确定性被破坏（"半新半旧"）。
- 建议：属于产品决策（要不要在恢复前后各停一次调度）；本卡只登记事实。

### R6 只有 JSON 时，几乎全部素材都不在

- 证据与规模：§3.2（本机 artifacts 4.4 MB + browser-profiles 555 MB vs JSON ≈0.9 MB）。
- 影响：恢复后工作区"看起来完整"（记录都在），但**素材与登录态全空**——正是用户最容易误判为"恢复成功"的场景。
- 建议：`GET /api/backup` 概览（`src/app/api/backup/route.ts:12-22`）加入文件区清单与体积（复用 `createWorkspaceManifest()`），让用户在导出前就看到"什么不会进这个文件"。

### R7 绝对路径引用：把文件复制过去也会失败

- 证据：§4.2（`src/lib/publish.ts:27-41`、`src/lib/article-images.ts:13-19`、`src/app/api/products/image/route.ts:63-66`）。
- 影响：**"能看到图"与"能发图"不一致**（展示走 basename，发布走绝对路径），用户会得到互相矛盾的反馈。
- 建议：P1-01（素材身份）范围内把解析统一成"basename 优先、工作区目录为准"；恢复场景可先单独缓解。

### R8 备份文件的敏感性：该带的没带，不该明文的明文

- 证据：`dify_connections.api_key` 是普通列、明文（`src/db/schema.ts:169`），随 JSON 一起外流；账号信息、私信/聊天内容、发布记录同理。反过来，真正需要搬走的密钥（vault / `.env.local`）**不在文件里**。
- 影响：备份文件一旦分享（工单、云盘、聊天），等于泄露已配置的 Dify 密钥与全部业务数据；而它**没有加密、没有口令选项**（`src/lib/backup.ts` 全程明文 JSON）。
- 建议：至少在产品文档里把它定义为"敏感文件"；是否加密/是否排除 `api_key` 属 P2 决策（注意：排除会让"恢复后 Dify 失效"，需一并说明）。

### R9 "工作区里的数据"≠"备份里的数据"（两处盲区）

- 未声明表：schema 未声明的表不导出（`src/db/repositories/backup.ts:27-33`），例如 P0-02 记录的 `sites` 遗留表（`src/lib/workspace/manifest.ts:63-64` 会报 `unknownTables`）→ 备份/恢复**永远看不到**这些行。
- 非当前库文件：数据根里的其它 `.db`（本机 `_tmp-e2e.db`）不在范围内。
- 影响：如果历史数据正好落在这些位置，"我做过备份"并不成立。
- 建议：`GET /api/backup` 与 Workspace 页面的 `unaccounted.rootFiles`/`unknownTables` 联动提示（两者已各自存在，缺的只是把结论摆到同一个界面上）。

---

## 七、与 P0-06 的交集：恢复之后，Agent 任务会怎样

> P0-06 明确要求本卡覆盖：Agent 运行/事件（含 `paused` 的 `stateJson`、`pendingApprovalJson`）与 `chat_messages.metadata` 是否随备份完整还原；以及**暂停中的任务恢复后还能不能 resume**。

### 7.1 结论：能还原，也还能 resume；但"能 resume"不等于"安全 resume"

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| `agent_runtime_runs` 是否完整往返？ | ✅ 是。它是普通表，列按 schema 导出/导入，`paused` 的 `pending_approval_json`、`state_json`、`result_json` 都是 JSON 文本列 | `src/db/schema.ts:111-123`；`src/db/repositories/backup.ts:61-83,130-146` |
| `agent_runtime_events` 是否完整往返？ | ✅ 是（含 `created_at` 原值） | `src/db/schema.ts:125-132` |
| `chat_messages.metadata` 是否完整往返？ | ✅ 是。`metadata_json` 是普通文本列，`localAgentStatus="paused"` 等标记一起回来，UI 的"继续/停止"按钮因此仍会出现 | `src/db/schema.ts:86`；`src/components/agent-chat/chat-conversation.tsx:87-107` |
| 暂停中的任务恢复后还能 resume 吗？ | ✅ 能：resume 只从库里读 `stateJson` / `pendingApprovalJson` 续跑，不依赖内存 | `src/app/api/agent/runs/[id]/resume/route.ts:92` |
| resume 之后 pending 工具会不会被**重复执行**？ | ⚠️ 会。P0-06 G3：`stateJson` 记录的是待处理游标，恢复后会**重新调用**那条 pending 工具 | P0-06 §九 G3（本卡复核结论：与备份无关，但备份会让它更容易发生） |
| 若 pending 工具是浏览器/发布类？ | ❌ 需要 `browser-profiles/<accountId>`（登录态）**和** 账号记录同时存在；只还原 JSON 必然失败 | `src/lib/agent/langgraph-engine.ts:365,461`；`src/lib/agent/local-tools.ts:42,72,100,129`；`src/lib/agent/playwright-session.ts:41-69` |

### 7.2 恢复会"复活"的两类坏状态

| 复活对象 | 恢复后行为 | 证据 |
| --- | --- | --- |
| 备份里 `status = running` 的 Agent 任务 | 永远停在 `running`（P0-06 G4：进程中断无恢复机制，恢复也不修） | P0-06 G4；`src/db/repositories/agent-runtime.ts`（仅按传入状态更新） |
| 备份里 `schedules.next_run_at` 已过期 | 下一次 tick 立刻补跑：一次性且超过 5 分钟 → 记 `missed`；否则创建 run 并**同步执行**（浏览器发布会真的发生） | `src/worker/scheduler-service.ts:20-53`（`:26-29` 宽限、`:30-31` 去重只看最近 200 条 run、`:47` `processRun`） |

### 7.3 去重守卫在恢复面前的强度

`duplicate` 判断是 `listRuns(200)` 里找同 `scheduleId` + 同 `params._scheduledFor`（`src/worker/scheduler-service.ts:30`）。恢复一份旧备份后：`runs` 表回到旧时间点，而 `schedules.next_run_at` 也是旧的 → 只要超过窗口（或 200 条记录被后来的运行挤出），**同一次排程可能被重新补跑一遍**。这与 P0-06 G3（无幂等键）是同一个根因在"恢复"场景下的表现。

---

## 八、与 P0-04 / P0-05 的交集

| 交集 | 结论 | 证据 |
| --- | --- | --- |
| 内容草稿（P0-04） | 状态列（`draft` / `ready` / `posted`）随备份往返；但 `posted` 是**发布事实**带来的，恢复到更早的时间点会**回退成 `ready`**——界面看起来"内容还没发"，而平台上其实已经发过 | `src/db/schema.ts:25`；`src/lib/publish-facts.ts`（状态由事实驱动） |
| 发布事实（P0-05） | `publish_records` 与 `metric_snapshots` 随备份往返；恢复旧备份后，新增的发布事实消失 → 同一内容**可能被再次发布**（去重依赖记录，记录没了） | `src/db/schema.ts:181-208`；`src/db/repositories/publish-records.ts` |
| 证据类数据（`PublishDraftReceipt` / 核验证据） | 都在表/JSON 内，随备份往返；但"一次性消费"语义（读取即取走，`src/app/api/publish/verify/route.ts`）意味着恢复操作本身无法重建已消费的 receipt | C2 冻结面（`docs/dev-exec-list.md:28`） |
| 素材身份（P1-01） | 本卡与 P1-01 是**同一根因**（素材靠路径字符串），区别是 P1-01 解决"是谁的图"，本卡只需解决"恢复后还能不能找到图"（§4.2 的 basename 化建议） | `docs/data-model-inventory.md:151-172` |

---

## 九、可验证的恢复验收场景（设计，本卡不执行）

> 全部场景都**不接触现有工作区数据**：要么跑既有测试（临时目录），要么把数据目录**复制**到临时位置后再操作。工具全部已存在（`GET /api/workspace/manifest`、`/api/backup/*`、现有测试），不需要新增代码即可验收。

| # | 目的 | 前置 | 步骤 | 期望结果 | 现状 |
| --- | --- | --- | --- | --- | --- |
| A1 | 表数据往返（自动化） | 无 | `vitest run src/lib/backup.test.ts` | 表覆盖断言 + `replace`/`merge` 往返通过（本卡实测 43 项通过，见 §12） | ✅ 已具备 |
| A2 | **文件引用对账**（只读） | 运行中的实例 | 记录 `GET /api/workspace/manifest` 的 `artifacts.{fileCount,linked,unlinked}`、`browserProfiles.{total,linked,unlinked}`、`videos.fileCount`、`uploads.*` | 三处数字可用作"引用 vs 实际文件"的基线；恢复后再取一次即可判断哪些引用悬空 | ✅ 工具已存在（`src/lib/workspace/manifest.ts:325-406`） |
| A3 | 跨目录恢复（隔离演练） | 一份导出 JSON + 数据目录副本 | ① 复制 `web-data` 到临时目录；② 以 `SOCIAL_AUTO_POST_DATA_DIR=<副本>` 启动；③ 在副本上 `replace` 导入；④ 比对 A2 的数字；⑤ 查 `content_items` 里 `image_path` / `metadata_json.images` 含盘符或绝对路径的行 | 复制完整 → 文件类数字与恢复前一致；**但绝对路径引用仍指向旧目录**（§4.2），这就是必须修的缺口 | ⚠️ 需人工按此步骤演练 |
| A4 | Agent 暂停态往返（隔离） | 含 `paused` run 的库 + 登录态 profile | 导出 → 恢复到副本 → 打开聊天页（应恢复"继续/停止"）→ 点继续 | 状态机可达 `resume`；若 pending 工具是浏览器类，则需要 `browser-profiles` 才可能成功（§7.1） | ⚠️ 待人工演练（P0-06 记为未覆盖） |
| A5 | 排程补跑（隔离 + token） | 含过期 `next_run_at` 的 `schedules` | 恢复后 `POST /api/internal/scheduler/tick`（Bearer token） | 一次性超 5 分钟 → `missed`；否则补跑一条 run（§7.2）。**只应在隔离副本上做**，因为会真的发布 | ⚠️ 待人工演练 |
| A6 | 坏文件容错 | 无 | 构造 `tables`: 未知表 / 全未知列的行 / 非法 JSON 的 `metadata_json` | 未知表进 `unknownTables`；全未知列的行进 `skipped`；**非法 JSON 被原样写库**（§2.3-6） | ⚠️ 需人工演练，用于确认 R4 |

---

## 十、最小补齐建议（供 P1/P2 排卡，本卡不执行）

> 排序按"恢复安全的性价比"。**没有一条需要新建表或改状态枚举**，与 P0-06 的"不新建表、不改状态枚举"约束一致。

| # | 建议 | 对应风险 | 最小改动面（预估） |
| --- | --- | --- | --- |
| B1 | `replace` 前自动写一份 `backup-before-restore-<stamp>.json`（复用 `createBackupSnapshot()`），并在恢复报告里回该文件名 | R1 | 服务端 `restore` 路由 + `backup` 仓储；考虑写到哪里（数据根或 `artifacts/`） |
| B2 | 导入上限与导出一致：把 64 MB 常量提到服务端可流式处理的量级，或导出时按行数预估并提示 | R2 | `src/lib/backup.ts:16` + 两个路由 |
| B3 | 恢复报告卡片展示 `deleted` / `skipped` 汇总（现在只显示 `inserted`） | R4 | 仅 UI（`backup-settings-client.tsx`），报告结构已经具备 |
| B4 | 明确 `replace` 语义并对齐文档：要么改 `README.md:303` 的措辞，要么让 `replace` 清空所有 schema 声明的表 | R3 | 决策 + 文档，或仓储层一处循环 |
| B5 | `GET /api/backup` 概览加入"文件区清单与体积"（复用 `createWorkspaceManifest()`），把"不会进 JSON 的东西"摆在导出按钮旁边 | R6、R9 | 一个路由的返回结构 + 卡片多一行 |
| B6 | 素材路径解析统一（basename 优先、工作区目录为准），至少覆盖 `resolveLocalImagePath()` / `resolveLocalVideoPath()` | R7 | `src/lib/publish.ts:27-41`；属 P1-01 范围，需与 P0-03 结论一起排卡 |
| B7 | 备份文件标注为敏感文件（文档 + UI 提示），并登记"是否加密 / 是否排除明文 `api_key`"这一决策项 | R8 | 文档 + UI 文案；加密属 P2 决策 |

---

## 十一、待验证清单（无法只靠源码定论）

| # | 事项 | 为什么无法只靠源码定论 | 建议验证方式 |
| --- | --- | --- | --- |
| V1 | 跨机复制 `browser-profiles/` 后，平台登录态是否仍有效 | 免登录取决于平台对设备指纹/环境的判断，源码看不到 | 隔离副本 + 一个测试账号，观察是否被要求重新登录 |
| V2 | 真实大工作区是否会撞上 64 MB 导入上限 | 需要构造大表（`chat_messages` / `agent_runtime_events` / `metric_snapshots`）才能测出 | 生成 10 万行事件后导出，测量 JSON 体积并尝试导入 |
| V3 | 恢复与正在运行的 run/worker 并发时，是否真的产生"半新半旧" | 崩溃/并发时序无法穷举 | 隔离副本 + 恢复期间故意跑一条发布，观察表内容 |
| V4 | `web-data/_tmp-e2e.db` 是否为 e2e 遗留、可否清理 | 文件名像测试产物（0 字节），但没有代码引用 | 人工确认（本卡未删、未动） |
| V5 | 打包版的数据目录最终落在哪（userData 还是便携 `web-data`） | `electron/main.cjs:113-115` 给 `APP_DATA_DIR=userData` 且 `SOCIAL_AUTO_POST_DATA_DIR=resolveDataDir()`；`src/electron/server-runtime.ts:12-27` 又有便携回退规则——**打包后的真实取值**需在打包产物上确认 | 在打包产物里查看 `GET /api/backup` 的 `dataDir` 与 `GET /api/workspace/manifest` 的 `root` |
| V6 | 恢复后 `brand.logoPath` 是否一定 404 | 源码判定是"路径是否在当前 `brandLogosRoot()` 内"，若用户把数据目录放回同一绝对路径则仍然可用 | 隔离副本演练（A3 附项） |
| V7 | 备份 JSON 是否需要加密（产品决策） | 涉及密钥排除后的可用性取舍，不是技术事实 | 人工决策（对应 B7） |

---

## 十二、只读声明与验证记录

### 12.1 未改动清单

- **未修改**生产代码、数据库（schema / 迁移 / 数据）、配置（`next.config.ts`、`package.json`、`.gitignore` 等）与其他架构文档。
- **未导出备份、未执行任何恢复**；未启动打包产物；未调用 `/api/backup/export` 或 `/api/backup/restore`。
- **未打开现有数据库文件**：数据目录里的 `social-auto-post.db` 只做了文件大小统计（`Get-ChildItem`），没有连接、没有写 `-wal`/`-shm`，`web-data/_tmp-e2e.db` 未删未动。
- `docs/dev-exec-list.md` 仅回填 **P0-07 的状态与报告链接**（§四 表头行、§四 卡片、§十 队列第 1 行）；**§六 P2 状态列仍未改**（等 P0-06 报告复核通过后再回填）。
- 既有工作区改动（`README*.md`、`docs/creator-workflow-audit.md`、`next.config.ts`、`publish/*`、`browser-preview-session*`、locales、test fixtures 等在途修改与新文档）**保持原样**：未 stash、未提交、未回滚。`git status` 前后唯一新增是本次的 `docs/backup-restore-audit.md`。

### 12.2 验证命令与结果（本次审计执行）

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0** |
| `node_modules\.bin\eslint.cmd .` | **exit 0**（1 个既有 warning：`src/components/agent-chat/chat-conversation.tsx:146` `react-hooks/exhaustive-deps`；非本次引入、未修改该文件） |
| `node_modules\.bin\vitest.cmd run` | **88 个测试文件 / 574 个测试全部通过**（18.00s，2026-10-09 07:08 本机） |
| `vitest run src/lib/backup.test.ts src/lib/workspace/manifest.test.ts src/lib/paths.test.ts src/app/api/workspace/manifest/route.test.ts` | **4 文件 / 43 测试通过**（1.51s）——本卡的核心取证测试面 |
| `Get-ChildItem web-data`（目录清单，只读） | 见 §3.2（artifacts 37/4.4 MB、browser-profiles 4,099/555 MB、`_tmp-e2e.db`） |

> 与本卡直接相关的既有测试：`src/lib/backup.test.ts`（格式与表覆盖断言 `:125-129`、`replace`/`merge` 往返 `:131-172`）、`src/lib/workspace/manifest.test.ts`（引用识别、`profile_path` 不得进入报告 `:29,:244-248`）、`src/lib/paths.test.ts`（边界与"读不建目录"）、`src/app/api/workspace/manifest/route.test.ts`（只读语义）。
> **未覆盖**（本卡 §九 A3～A6 的落点）：跨目录恢复、文件引用对账、Agent 暂停态恢复后 resume、排程补跑、坏文件容错——这五处正是"恢复验收"缺的东西，也是后续补测试的天然位置。

### 12.3 本卡结论摘要（供复核）

1. 备份 = **数据库逻辑导出**；文件（artifacts / browser-profiles / uploads / videos）、凭据库、`.env.local` **都不在其中**（产品已在 UI 与 README 声明）。
2. **`accounts.profile_path` 对恢复没有影响**：它随备份往返，但全仓没有读者（`toAccount()` 用 account id 派生），不需要迁移或清空。
3. **最高风险是绝对路径引用（§4.2 / R7）**：把文件复制过去也可能发不出去；展示正常、发布失败的不一致体验最能误导用户。
4. **次高风险是 `replace` 的语义与可逆性（R1、R3、R4）**：没有恢复前快照、"精确副本"的说法与实现不符、丢行不进 UI。
5. **与 P0-06 / P0-04 / P0-05 的交集都是"恢复会复活旧状态"**：卡住的 `running`、被补跑的排程、回退成 `ready` 的内容、消失的发布事实 → 恢复之后需要人工复核这三处，不能只看"恢复完成"。
6. 本卡给出的 7 条最小补齐（B1～B7）**全部不需要新建表、不需要改状态枚举**，与 P0-06 的约束一致。

### 12.4 停止边界

本报告完成后**停止**；不执行 §九 的任何验收场景（除已跑的既有测试），不执行 §十 的任何建议实现，不开始 P0-08 / P1 / P2，等待人工复核。
