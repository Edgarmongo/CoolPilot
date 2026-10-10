# P1 缺陷卡 D1（F1 + F3）：实施与验收记录

状态：**已按授权实施完毕，等待人工验收。** 本卡未执行 `git add` / 未提交、未启动 P1 卡 2、未触碰 P1 卡 1 已验收实现。
方案来源：`docs/p1-card-01-defect-f1-f3-plan.md`（D1 方案）。授权范围：**F1（GIF 读取 404）+ F3（上传路由自动化测试）**；**F2（应用内 URL 双编码）与 F4（smoke 使用开发数据库）明确排除**。
实施顺序：**先写测试 → 复现红 → 改生产代码 1 行 → 转绿 → 全量验证 → 记录并停等复核**。

## 一、授权 ↔ 实际改动对照

| 授权项 | 授权内容 | 实际结果 |
| --- | --- | --- |
| F1：GIF 读取 404 | `src/app/api/agent/artifacts/route.ts` 增加 `.gif` → `image/gif` 映射 | 已改：`contentTypes` 追加 1 行映射（+3 行注释说明），净增 **4 行、删除 0 行** |
| F1 测试 | 既有 `route.test.ts` 增加「GIF 读取成功」+「`.svg` 仍 404」边界 | 已改：**新增 1 个用例**（GIF 读成功，含 MIME 与缓存头）+ 既有「只服务直属文件」用例**追加 1 条 `.svg` 404 断言**（+18/−0） |
| F3：上传路由测试 | 新建 `src/app/api/images/upload/route.test.ts`，覆盖响应契约、URL 形状、共享函数接线、实际落盘、拒绝路径 | 已新建：**6 个用例**（方案用例 1/2/3/4/5 全覆盖；用例 4 拆为 2 个 `it`，三条拒绝路径全部执行） |
| 契约测试注释 | 仅修正 `artifact-image-url.test.ts` 中关于 GIF 的过时注释 | 已改：**2 处注释、各 2–3 行**，断言一字未动（净 +1/−1 行） |
| 验收记录 | 实施改动、测试结果、未解决问题写入文档 | 本文件；并在 `p1-card-01-defect-f1-f3-plan.md` 与本卡验收文档 §8.5 加指向 |

**明确未做**：未改 `src/lib/artifact-image-url.ts`、未改 URL 形状、未改 `IMAGE_FILE_EXTENSIONS`、未改缓存策略、未改 `vitest.config.ts`、未新增依赖、未新增 `.tsx` 组件测试、未改 `publish.ts` / 数据库结构 / locales。

## 二、变更清单

### 生产代码（1 个文件，唯一 1 行语义改动）

```diff
--- a/src/app/api/agent/artifacts/route.ts
+++ b/src/app/api/agent/artifacts/route.ts
@@ -10,6 +10,10 @@ const contentTypes: Record<string, string> = {
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
+  // F1 of `docs/p1-card-01-defect-f1-f3-plan.md`: `.gif` is in both the library's extension set and
+  // the upload whitelist, so a stored GIF is an input the app hands to this route - without the
+  // mapping it was refused as if it were not an image at all.
+  ".gif": "image/gif",
  };
```

`git diff --numstat`：`4  0  src/app/api/agent/artifacts/route.ts`。改动只扩大「服务端愿意以图片身份回包」的扩展名集合，顺序与 `src/app/api/products/image/route.ts` 既有表一致（`.gif` 同值 `image/gif`）。

### 测试代码

| 文件 | 变更 | numstat |
| --- | --- | --- |
| `src/app/api/agent/artifacts/route.test.ts` | 新增 GIF 用例 + 既有用例追加 `.svg` 404 断言 | `18  0`（纯追加） |
| `src/app/api/images/upload/route.test.ts` | **新建**：6 个用例 | 未跟踪新文件 |
| `src/lib/artifact-image-url.test.ts` | **仅注释**（GIF/N1 措辞过期；见方案 §九更正） | 文件未被跟踪，净行数不变（+1/−1） |

### 新增用例与验收项的对应

| 文件 | 用例 | 对应验收项 |
| --- | --- | --- |
| `agent/artifacts/route.test.ts` | "serves a GIF from the same section" | F1-b、F1-c、F1-d |
| `agent/artifacts/route.test.ts` | "serves only a file that sits directly in the section"（追加 `.svg`） | F1-e |
| `images/upload/route.test.ts` | "answers the stored URL shape for an uploaded image" | F3-b、F3-c、F3-d |
| `images/upload/route.test.ts` | "writes the uploaded bytes into the artifacts section of the temp root" | F3-e |
| `images/upload/route.test.ts` | "serves an uploaded GIF back with the GIF content type" | F1-a、F1-b、F1-c（端到端） |
| `images/upload/route.test.ts` | "keeps the rejection paths of an unsupported or empty upload" | F3-f（① ②） |
| `images/upload/route.test.ts` | "answers a body that carries no file" | F3-f（③，两种体形态） |
| `images/upload/route.test.ts` | "defaults an upload without an extension to .png" | 方案用例 5（可选，已纳入） |

## 三、红 → 绿证据（命令与实测输出）

统一在仓库根执行：`node_modules\.bin\vitest.cmd run src/app/api/images/upload/route.test.ts src/app/api/agent/artifacts/route.test.ts`

### 3.1 第一次运行（仅写测试，未改生产代码）— 红

```
Test Files  2 failed (2)
     Tests  4 failed | 6 passed (10)
```

| 失败 | 输出 | 性质 |
| --- | --- | --- |
| `artifacts > serves a GIF from the same section` | `AssertionError: expected 404 to be 200` | **F1 复现**：读侧缺 `.gif` 映射 |
| `upload > serves an uploaded GIF back with the GIF content type` | `AssertionError: expected 404 to be 200` | **F1 复现**：写侧 201 成功，读侧 404 |
| `upload > keeps the rejection paths...` | `expected 'UNKNOWN_ERROR' to be 'UNSUPPORTED_IMAGE'` | **实施方断言错误**（见 §五 偏差 1），非生产缺陷 |
| `upload > answers a body that carries no file...` | `expected 'UNKNOWN_ERROR' to be 'INVALID_PAYLOAD'` | 同上（该用例首个分支实际命中的是 `EMPTY_UPLOAD` 路径） |

写侧白名单本就接受 `.gif` 这一事实被同时证明：该用例的上传断言（`201`、`fileName` 以 `.gif` 结尾）**先通过**，失败点在其后的读侧请求。

### 3.2 第二次运行（仅修正实施方断言，生产代码未动）— 只剩 F1

```
Test Files  2 failed (2)
     Tests  2 failed | 8 passed (10)
FAIL  src/app/api/agent/artifacts/route.test.ts > serves a GIF from the same section
AssertionError: expected 404 to be 200
FAIL  src/app/api/images/upload/route.test.ts > serves an uploaded GIF back with the GIF content type
AssertionError: expected 404 to be 200
```

即：此刻**全部失败都指向同一个缺陷**（`.gif` 读侧 404），无其它噪声。

### 3.3 第三次运行（应用 1 行映射后）— 绿

```
Test Files  2 passed (2)
     Tests  10 passed (10)
```

## 四、验证证据（全部为本机实测输出）

### 4.1 针对性测试

| 命令 | 实测结果 |
| --- | --- |
| `vitest run src/app/api/images/upload/route.test.ts src/app/api/agent/artifacts/route.test.ts` | `Test Files 2 passed (2)`；`Tests 10 passed (10)`（upload 6 + artifacts 4） |

### 4.2 类型检查

`node_modules\.bin\tsc.cmd --noEmit` → 无输出，`TSC_EXIT=0`。

### 4.3 Lint

`node_modules\.bin\eslint.cmd .` → 实测输出：

```
D:\...\src\components\agent-chat\chat-conversation.tsx
  146:9  warning  The 'messages' logical expression could make the dependencies of useMemo Hook (at line 149) change on every render. ...  react-hooks/exhaustive-deps

✖ 1 problem (0 errors, 1 warning)
ESLINT_EXIT=0
```

唯一警示为 **P1 卡 1 已记录的既有告警**（`chat-conversation.tsx:146`），本卡未新增任何 error / warning（新文件与改动文件均未出现在输出中）。

### 4.4 全量测试

`node_modules\.bin\vitest.cmd run` → 实测输出：

```
Test Files  90 passed (90)
     Tests  591 passed (591)
VITEST_EXIT=0
```

| 对比 | 基线（P1 卡 1 记录） | 本卡实测 | 差 |
| --- | --- | --- | --- |
| 文件 | 89 | **90** | +1（新上传路由测试文件，`vitest.config.ts` 未改，靠既有 `src/**/*.test.ts` 收集） |
| 用例 | 584 | **591** | +7（upload 6 + artifacts 新增 GIF 1） |

本卡相关文件在全量输出中的实际行（证明新文件确实被收集执行）：

```
✓ src/lib/image-library.test.ts (3 tests) 47ms
✓ src/app/api/agent/artifacts/route.test.ts (4 tests) 81ms
✓ src/app/api/images/upload/route.test.ts (6 tests) 284ms
✓ src/lib/artifact-image-url.test.ts (10 tests) 5ms
```

### 4.5 数据隔离与「未写入开发目录」证据（F3-g）

同一快照函数在**全量测试前后**各执行一次（对目录内容取有序文件名 MD5）：

| 目录 | 全量测试前 | 全量测试后 | 判定 |
| --- | --- | --- | --- |
| `web-data\artifacts` | `count=37 md5=1137D74C668C301DB537CDBD40F94CC7` | `count=37 md5=1137D74C668C301DB537CDBD40F94CC7` | **完全一致**（无新增、无修改） |
| `web-data\uploads` | `count=0 md5=D41D8CD98F00B204E9800998ECF8427E` | `count=0 md5=D41D8CD98F00B204E9800998ECF8427E` | **完全一致** |

机制：F3 用例的隔离由 `src/test/route-harness.ts` 提供（在任何读取环境的模块被导入前固定临时 DB 与临时数据根）；F1 的 artifacts 用例沿用该文件自带的 `mkdtempSync` + `APP_DATA_DIR` 夹具，不碰数据库。用例自身还**显式断言**写入路径（`expect(storedPath).toBe(path.join(routeTestDataDir, "artifacts", data.fileName))` 且 `not startsWith(<cwd>\web-data)`），因此「测试是否真的隔离」由测试自己证明，而非依赖约定。

`git status --porcelain` 中新增项仅为：`?? src/app/api/images/upload/route.test.ts`、`?? docs/p1-card-01-defect-f1-f3-acceptance.md`；其余 `M`/`??` 项均为**本卡之前既有**的工作区改动（`publish.ts`、`browser-preview*`、README、locales 等），本卡未触碰。

### 4.6 最终状态复跑（实施结束后、记录撰写中的唯一后续改动为 2 行注释）

`src/app/api/images/upload/route.test.ts` 的文件头枚举在撰写记录时做了一次措辞修正（仅注释，2 行），为不使「实测结论」与最终文件状态脱节，做了最后一次复跑：

| 命令 | 实测结果 |
| --- | --- |
| `vitest run`（全量） | `Test Files 90 passed (90)`；`Tests 591 passed (591)`；`VITEST_EXIT=0` |
| `eslint src/app/api/images/upload/route.test.ts src/app/api/agent/artifacts/route.test.ts src/app/api/agent/artifacts/route.ts src/lib/artifact-image-url.test.ts` | 无输出，`ESLINT_FILES_EXIT=0` |
| `web-data\artifacts` 快照 | `count=37 md5=1137D74C668C301DB537CDBD40F94CC7`（与 §4.5 跑前基线一致） |

即：§4.4 的数字在**最终文件状态**下复现，且 `tsc --noEmit`（§4.2）与 `eslint .`（§4.3）的结论未受注释改动影响（该改动不含任何可被类型/lint 检出的内容）。

## 五、与方案的三处偏差（必须如实记录）

| # | 方案原文 | 实际实施 | 原因与影响 |
| --- | --- | --- | --- |
| 偏差 1 | 用例 4 断言三条拒绝路径的 **`code`**：`UNSUPPORTED_IMAGE` / `EMPTY_UPLOAD` / `INVALID_PAYLOAD` | 改为断言 `status 400` + `ok === false` + **`error`/`message` 等于该 token**；仅 `INVALID_PAYLOAD` 断言 `code` | 实测发现 `UNSUPPORTED_IMAGE` 与 `EMPTY_UPLOAD` **不在** `appErrorCodes`（`src/lib/app-errors.ts:1-31`），`fail()` 对非 code 的字符串降级为 `code: "UNKNOWN_ERROR"` 并把 token 写进 message（`src/lib/api.ts:18-26`）。**未改生产代码去迎合测试**（那会变更 API 契约面、超出授权），改为按真实可观测契约断言，并把 code 事实登记为 **F5（见 §七）**。→ 影响：**F3-f 的原始要求未达成**（原始要求为钉住三条 `code`）。→ **双轨判定见 §6.2.1**：轨道 A「当前真实行为已被测试覆盖」满足，轨道 B「原计划要求的错误码契约」未满足并转 F5。**不得把「测试通过」写成「原验收标准全部满足」** |
| 偏差 2 | 用例 4 为**一个**用例覆盖 ①`notes.txt` ②0 字节 PNG ③无 `file` 字段 / 非表单体 | 拆为 **2 个** `it`（拒绝路径 / 无 file 字段），三条形态全部真实执行；且发现「无 `file` 字段」命中的是 `EMPTY_UPLOAD` 分支而非 `INVALID_PAYLOAD` | 首次运行暴露：一个 `it` 内首个断言失败会跳过后续断言，覆盖不实。拆分后 ③ 的两种体形态都被执行（非表单体 → `INVALID_PAYLOAD`；非法字段 → `EMPTY_UPLOAD`）。→ 影响：用例数 6（方案 4+1），覆盖**只增不减** |
| 偏差 3 | 用例 2 断言写入路径**前缀**为 `routeTestDataDir` | 改为**精确相等** `path.join(routeTestDataDir, "artifacts", fileName)`，并追加负向断言「不以 `<cwd>\web-data` 开头」 | 仅前缀断言在 Windows 上由 `path.join` 天然成立、几乎不构成证据；精确相等 + 负向断言才是「落在临时根、不在开发目录」的真证据。→ 影响：隔离自证强度提升 |

另有一项**非偏差的执行说明**：方案用例 5（无扩展名默认 `.png`）标为「可选」，本卡已纳入（钉住 `upload/route.ts:24` 的 `|| ".png"` 分支，不涉 GIF、不扩大生产改动）。

## 六、验收标准逐项判定（F1 / F3 分开）

### 6.1 F1 项：GIF 支持修复

| # | 验收条件 | 证据 | 判定 |
| --- | --- | --- | --- |
| F1-a | `.gif` 上传成功（`201`，`fileName` 后缀 `.gif`） | `upload > serves an uploaded GIF back with the GIF content type`：`201` + `endsWith(".gif")` | **通过** |
| F1-b | `GET /api/agent/artifacts?file=<name>.gif` 返回 `200` | 同上用例（端到端）+ `artifacts > serves a GIF from the same section` | **通过** |
| F1-c | `Content-Type: image/gif` | 两处均断言 `content-type === "image/gif"` | **通过** |
| F1-d | 缓存头 `Cache-Control: private, max-age=300`（与其它图片一致） | artifacts GIF 用例断言该精确值 | **通过** |
| F1-e | 不受支持扩展名仍 `404`（`.svg`、`notes.txt`） | 既有用例追加 `.svg` 404 断言 + 原 `notes.txt` 断言保留 | **通过** |
| F1-f | `.png/.jpg/.jpeg/.webp` 行为与响应头不变 | 既有 3 个 artifacts 用例全绿（未改任何原断言） | **通过** |

**F1 判定：全部条件通过**，且生产代码改动经 diff 复核为「+4/−0，其中语义改动仅 `.gif: "image/gif"` 1 行」。

### 6.2 F3 项：上传路由自动化测试

| # | 验收条件 | 证据 | 判定 |
| --- | --- | --- | --- |
| F3-a | 新测试文件存在且在全量运行中被执行 | 全量日志：`✓ src/app/api/images/upload/route.test.ts (6 tests) 284ms` | **通过** |
| F3-b | 响应体形状 `{ ok: true, data: { fileName, url } }` | 用例 1：`ok === true`、`fileName` 匹配 `/^upload-\d+-[A-Za-z0-9_-]{8}\.png$/` | **通过** |
| F3-c | `url` 字面形状被钉住 | 用例 1：`url === \`/api/agent/artifacts?file=${encodeURIComponent(fileName)}\`` | **通过** |
| F3-d | `url === artifactImageUrl(fileName)` 接线被钉住 | 用例 1 等式断言 | **通过** |
| F3-e | 落盘真实发生且落在临时根内（隔离自证） | 用例 2：精确路径相等 + 非 `web-data` 负向断言 + 字节一致（**强于方案要求**） | **通过** |
| F3-f | 三条拒绝路径的 `code` 被钉住 | **原始要求未达成**：`INVALID_PAYLOAD` 的 `code` 已被钉住；`UNSUPPORTED_IMAGE` / `EMPTY_UPLOAD` 的 `code` 实为 `UNKNOWN_ERROR`，测试改钉 `error`/`message` token（见 §五 偏差 1） | **部分满足——双轨判定见 §6.2.1**（轨道 A 满足 / 轨道 B 未满足，转 F5） |
| F3-g | 不写开发库、不写 `web-data/` | §4.5 跑前跑后 MD5 一致 | **通过** |

**F3 判定：F3-a～F3-e、F3-g 共 6 项通过；F3-f 为部分满足——原始「三条 `code`」的要求未达成，达成的只是「三条拒绝路径的真实行为已被测试锁定」。** 无既有用例变红、无开发数据写入。**F3 能否关闭取决于对 D1 目标的解释，见 §6.2.1 与 §九。**

#### 6.2.1 F3-f 双轨判定：原始要求 / 当前真实行为 / 偏差

**（1）原始要求（逐字引用方案 §7.2）**

> \| F3-f \| 三条拒绝路径的 `code` 被钉住 \| 用例 4 \|

含义：要求把三条拒绝路径的**结构化错误码 `code`** 分别钉为 `UNSUPPORTED_IMAGE` / `EMPTY_UPLOAD` / `INVALID_PAYLOAD`。

**（2）当前真实行为（源码 + 实测）**

| 拒绝路径 | 源码位置 | 实测响应（`status 400`、`ok: false`） |
| --- | --- | --- |
| 扩展名不在白名单（`notes.txt`） | `upload/route.ts:25` `fail("UNSUPPORTED_IMAGE", 400)` | `error: "UNSUPPORTED_IMAGE"`、`message: "UNSUPPORTED_IMAGE"`、**`code: "UNKNOWN_ERROR"`** |
| 0 字节文件 | `upload/route.ts:28` | `error: "EMPTY_UPLOAD"`、**`code: "UNKNOWN_ERROR"`** |
| 表单里没有 `file` 字段（含空表单） | `upload/route.ts:22` | `error: "EMPTY_UPLOAD"`、**`code: "UNKNOWN_ERROR"`** |
| 请求体不是 FormData | `upload/route.ts:18` `fail("INVALID_PAYLOAD", 400)` | `error: "Invalid payload"`、**`code: "INVALID_PAYLOAD"`**（三条中唯一返回真 code 的路径） |

根因：`fail(input: string)` 先做 `isAppErrorCode(input)` 判定，非 code 的字符串被降级为 `code: "UNKNOWN_ERROR"`，并把该字符串放进 `message`（`src/lib/api.ts:18-26`）；而 `UNSUPPORTED_IMAGE` / `EMPTY_UPLOAD` **不在** `appErrorCodes`（`src/lib/app-errors.ts`，同文件里视频侧却有 `UNSUPPORTED_VIDEO` / `VIDEO_TOO_LARGE` 两个正式 code，形成同类语义的不对称）。
**该降级是已提交的基线行为**：`src/lib/api.ts` 与 `src/lib/app-errors.ts` 相对 HEAD 无任何改动（`git diff --stat` 为空），不是本卡或本工作区引入的。

**（3）双轨状态与结论**

| 轨道 | 内容 | 状态 |
| --- | --- | --- |
| 轨道 A：**当前真实行为已被测试覆盖** | 三条路径的 `status 400`、`error` token、`INVALID_PAYLOAD` 的 `code` 均被断言；测试**未伪造** API 行为，也**未为变绿而改动生产代码** | **满足** |
| 轨道 B：**原验收标准要求的错误码契约** | 三条路径的 `code` 未同时是稳定、可区分的业务码 → 调用方无法用 `code` 区分「不支持的图片格式」与「空上传」 | **未满足**，登记为 **F5**，不在 D1 修复 |

**结论（不得含糊）**：**「测试通过」≠「原验收标准全部满足」**。F3-f 的原始要求（三条 `code`）**未达成**；达成的是「三条拒绝路径的真实行为已被测试锁定」。F3 是否关闭取决于对 D1 目标的解释：
- 若 D1 目标 = **保护现有 API 契约**（防止后续重构悄悄改变拒绝行为）→ 轨道 A 已达成，可在记录该偏差后关闭 F3，并把错误码契约交给 F5；
- 若 D1 目标 = **稳定、可识别的错误码契约** → 必须先由 F5 处理，F3 待 F5 完成后再关闭。

## 七、未决与后续项

| 编号 | 事项 | 来源 | 状态 |
| --- | --- | --- | --- |
| F1 | `.gif` 读取 404 | P1 卡 1 §8.5 | **本卡已修复**（+映射、+读侧与端到端测试）；**复核建议关闭**，前提是 §6.1 的 F1-a～F1-f 证据齐全（复核方将独立复跑确认） |
| F3 | `api/images/upload` 无自动化测试 | P1 卡 1 §8.3 缺口 | **本卡已补齐**（6 用例）；复核**认可测试实现**，但**暂缓正式关闭**——F3-f 需按 §6.2.1 双轨状态单独裁定 |
| F2 | 应用内 `/api/agent/artifacts?file=` 作输入被双编码 | P1 卡 1 §8.5 | **本卡未触碰**（`resolveArtifactImageSrc` 输入输出未变）；独立跟踪 |
| F4 | smoke 使用开发数据库 | P1 卡 1 §8.4 | **本卡未触碰**（本卡未运行任何浏览器 smoke，不引入新隔离风险）；独立跟踪 |
| **F5（本次新登记）** | `UNSUPPORTED_IMAGE` / `EMPTY_UPLOAD` 不在 `appErrorCodes` → `fail()` 输出 `code: "UNKNOWN_ERROR"`，客户端无法按 `code` 区分这两种拒绝 | 本卡 §五 偏差 1 实测；§6.2.1（2） | **未修复**（修复=改 `app-errors.ts` + `fallbackMessages`，属 API 契约面变更，**超出 D1 授权**）。**复核裁定：独立登记、本轮不修复**；倾向**方案 A**（把两个 token 纳入 `appErrorCodes` 并补契约测试），备选**方案 B**（规定只按 `error`/`message` token 识别）。属独立 API 契约决策，不得自动并入 D1。实施侧提示：测试已钉住 token，故修复 F5 时需同步更新 `upload/route.test.ts` 的 `refusal()` 注释 |
| 观察项 | `.gif` 现在可读，但 `videos-composer` / 其它组件是否真的需要 GIF 动图语义（如自动播放）未在本卡范围内评估 | F1 的自然延伸 | 仅记录，不在 D1 范围 |

## 八、边界声明与当前状态

- **本记录性质**：由实施方撰写，证据来自本机实际运行的命令输出（§三、§四）。未表述为对工作区的独立审查、未表述为独立复跑结论。复核方可基于本文件、`git diff` 与 `git status` 独立验证。
- **未提交**：未执行 `git add`、未执行任何提交；D1 的改动位于工作区内（`M src/app/api/agent/artifacts/route.ts`、`M src/app/api/agent/artifacts/route.test.ts`、`?? src/app/api/images/upload/route.test.ts`、`?? docs/p1-card-01-defect-f1-f3-acceptance.md`，外加未跟踪文件 `src/lib/artifact-image-url.test.ts` 内的注释修正）。
- **未扩大范围**：未改 F2 / F4 / P1 卡 1 已验收实现 / `publish.ts` / 数据库结构 / locales / `vitest.config.ts` / 依赖。
- **未启动 P1 卡 2**；**未重开 P1 卡 1 的验收结论**（其 F1–F4 登记结论原样保留，仅在 §8.5 追加指向本卡的指路注记）。
- **当前状态（2026-10-09，收到复核意见后）：本轮不再进行任何代码改动。** 复核裁定：F1 **建议关闭**（以 §6.1 证据齐全、复核方独立复跑通过为前提）；F3 的**测试实现获认可**，但 **F3-f 需按 §6.2.1 单独裁定**后才能决定 F3 是否关闭；F5 **独立登记、本轮不修复**。本次仅更新文档（本记录 + 方案 §7.2 的 F3-f 标注），未触碰任何源码。 **→ 收尾裁定见 §十：F3-f 采用选项 1，F1 与 F3（测试缺口本体）均已关闭；F3-f 的原始错误码要求未达成，保留为 F5 独立未解决项；本轮仍为零代码改动、零 Git 操作。**
- **范围自查（本轮）**：`src/lib/api.ts`、`src/lib/app-errors.ts` 相对 HEAD **无改动**（`git diff --stat` 为空）——F5 的降级属已提交基线行为；`M src/app/api/images/upload/route.ts`、`M src/lib/artifact-image-url.ts` 属**本卡之前既有**的工作区改动（前者把私有 `imageUrl` 换成共享 `artifactImageUrl`，后者新增 `resolveArtifactImageSrc`），**非 D1 引入**，且 D1 的用例 1 正是钉住前者这一接线。

## 九、复核裁定记录（2026-10-09）

**性质声明**：以下为复核方给出的**初步裁定**。复核方明确说明其依据是**实施摘要**，**不等于**已独立读取完整 diff、本验收文档并重新运行测试。因此本节记录的是「复核意见」，**不是独立复验结论**；F1 的正式关闭以 §6.1 证据齐全为前提，并以复核方独立复跑为准。

| 项目 | 复核裁定 |
| --- | --- |
| F1：GIF 读取 404 | **建议关闭**（前提：F1-a～F1-f 均有实测证据） |
| F3：上传路由自动化测试 | 测试实现**认可**（尤其 URL 双断言 与 落盘隔离自证 两项）；**暂缓正式关闭**，F3-f 按 §6.2.1（3）单独裁定 |
| F5：业务错误码降级 | **独立登记，本轮不修复**。倾向**方案 A**（两个 token 纳入 `appErrorCodes` + 补契约测试），备选**方案 B**（规定只按 `error`/`message` token 识别）。属独立 API 契约决策 |
| F2：应用内 URL 双编码 | 不在本轮范围 |
| F4：浏览器 smoke 数据隔离 | 不在本轮范围 |
| P1 卡 1 | 保持关闭 |
| P1 卡 2 | 不启动 |
| Git | 不暂存、不提交 |

复核方点名保留的三项工程实践：**① 先用失败测试复现 GIF 缺陷，再以最小生产代码改动转绿；② 不为让测试变绿而擅改既有 API 错误契约；③ 加强临时目录隔离验证，并保留开发数据未变化的证据。**

**F3-f 的待裁定项（请复核方二选一，§6.2.1（3）已列同一组选项）**：

- **选项 1**：认可**轨道 A**（当前真实行为已被测试覆盖）→ 在 F5 独立登记的前提下关闭 F3；
- **选项 2**：坚持**轨道 B**（稳定、可识别的错误码契约）→ 先立 F5 处理 `appErrorCodes`，F3 待 F5 完成后再关闭。

**本轮未做的事**（与复核意见一致）：未改任何源码、未改 `appErrorCodes`、未新增用例、未 `git add` / 未提交、未启动 P1 卡 2、未触碰 F2 / F4。

## 十、D1 关闭结论（复核裁定，2026-10-09）

**裁定**：复核方选定 **F3-f 选项 1**（认可轨道 A——当前真实行为已被测试覆盖），据此收尾本卡。**本轮零代码改动、零 Git 操作。**

| 项 | 最终裁定 | 记录要点 |
| --- | --- | --- |
| F1：GIF 读取 404 | **关闭** | 以 §6.1 的 F1-a～F1-f 实测证据为前提；`contentTypes` 补 `.gif: "image/gif"` 是唯一语义改动 |
| F3：上传路由自动化测试 | **关闭（对象 = \"测试缺口\"本体）** | 复核认可 §6.2 的 F3-a～F3-e、F3-g |
| F3-f：原始错误码验收要求 | **未达成，保留为未解决项** | 见 §6.2.1；关闭 F3 **不等于**满足 F3-f |
| F5：`appErrorCodes` 降级 | **独立保留（未解决）** | 基线既有行为，非 D1 引入；倾向方案 A（两 token 入 `appErrorCodes` + 契约测试），备选方案 B |
| F2：应用内 URL 双编码 | **独立保留（不在本轮范围）** | P1 卡 1 §8.5 原登记不变 |
| F4：smoke 数据隔离 | **独立保留（不在本轮范围）** | P1 卡 1 §8.5 原登记不变 |
| P1 卡 1 | **保持关闭** | 未重开、未扩大其验收结论 |
| P1 卡 2 | **未启动** | 下一张卡的选择见 `docs/dev-exec-list.md` §五 与 `docs/p0-acceptance-and-p1-sequencing.md` §五 |
| Git | **未暂存、未提交** | D1 改动仍留在工作区 |

**必须同时保留的两条防误读说明**：

1. **F3 关闭 ≠ 满足原验收标准**：F3 关闭指向的是\"上传路由已有自动化测试覆盖真实行为\"；F3-f 要求的\"三条 `code` 稳定可识别\"**未达成**，该要求转入 F5 继续跟踪。任何状态表都不得把本卡描述为\"全部通过\"。
2. **F1 的关闭以证据与独立复跑为前提**：本节按复核方意见记录。复核方如需独立复跑，命令见本文件附录（针对性 2 个测试文件 / `tsc --noEmit` / `eslint .` / 全量 `vitest run`）。

**本轮仍未做的事**：未改任何源码、未改 `appErrorCodes`、未新增或修改用例、未 `git add` / 未提交、未重开 P1 卡 1、未启动 P1 卡 2、未触碰 F2 / F4。

---

## 附录、复核用命令

```powershell
# 1) 针对性（含 F1 复现点）
node_modules\.bin\vitest.cmd run src/app/api/images/upload/route.test.ts src/app/api/agent/artifacts/route.test.ts
# 2) 静态
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\eslint.cmd .
# 3) 全量（复核实测：90 files / 591 tests）
node_modules\.bin\vitest.cmd run
# 4) 改动复核（不应出现 artifacts/route.ts 以外的生产改动）
git --no-pager diff --stat
git --no-pager diff -- src/app/api/agent/artifacts/route.ts
# 5) 隔离复核（跑测试前后应一致）
(Get-ChildItem web-data\artifacts -File).Count
```
