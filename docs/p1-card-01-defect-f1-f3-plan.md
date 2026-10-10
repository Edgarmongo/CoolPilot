# P1 缺陷卡 D1（F1 + F3）：实施方案与验收标准

状态：**已关闭（2026-10-09 复核裁定：F3-f 采用选项 1）。** 裁定结果：**F1 关闭**；**F3 作为\"上传路由自动化测试覆盖\"任务关闭**；**F3-f 的原始错误码要求未达成，保留为 F5 独立未解决项**（关闭 F3 ≠ 满足 F3-f）；F2 / F4 仍不在本卡范围。**本卡未 `git add` / 未提交、未启动 P1 卡 2。** 实施证据、逐项判定与三处偏差见 `docs/p1-card-01-defect-f1-f3-acceptance.md`（其中 §6.2.1 为本方案 §7.2 F3-f 的双轨判定、§九 为复核裁定记录）；本卡未 `git add` / 未提交、未启动 P1 卡 2。
来源：P1 卡 1 验收结论（`docs/p1-card-01-acceptance.md` §八）。范围：**F1（GIF 读取 404，功能缺陷）+ F3（上传路由缺自动化测试，测试缺口）**。
**F2（应用内 URL 双编码）与 F4（smoke 使用开发数据库）不在本卡范围**，继续独立跟踪——不得借修复 GIF 之机改变 URL 输入语义，也不得把测试环境改造并入本卡。

## 一、授权与边界

| 项 | 本卡允许 | 本卡禁止 |
| --- | --- | --- |
| 生产代码 | `src/app/api/agent/artifacts/route.ts` 增加 1 个 content-type 映射 | 改 URL 形状、改解析器、改 `IMAGE_FILE_EXTENSIONS`、改缓存策略、加扩展名过滤 |
| 测试代码 | 在既有 artifacts 路由测试追加用例；新建上传路由测试 | 改动既有断言的语义、新增组件（`.tsx`）测试、放开 vitest 收集范围 |
| 记录 | 本方案文档 + 验收记录更新 | 重开 P1 卡 1、扩大其验收结论 |
| 流程 | — | `git add` / 提交 / 启动 P1 卡 2 |

## 二、事实基础（本轮取证结论，供独立复核）

| # | 事实 | 位置 |
| --- | --- | --- |
| B1 | artifacts 路由的 `contentTypes` 只有 `.jpg/.jpeg/.png/.webp`；L24 的 `!contentTypes[ext]` 直接 404 | `src/app/api/agent/artifacts/route.ts:8-13,24` |
| B2 | 该路由**已有**测试文件与 3 个用例（PNG 正常服务 / 缺失文件不初始化目录 / 只服务直属文件且 `notes.txt` 404） | `src/app/api/agent/artifacts/route.test.ts:36-78` |
| B3 | 该测试用 `mkdtempSync` + `APP_DATA_DIR` 模拟打包布局并删除 `SOCIAL_AUTO_POST_DATA_DIR`，`afterEach` 递归清理 → 自带隔离，无数据库依赖 | `route.test.ts:23-27,39-41` |
| B4 | 上传路由**已接受** `.gif`，但**没有**任何测试文件（`src/app/api/images/upload/` 下只有 `route.ts`） | `src/app/api/images/upload/route.ts:10`；目录列表 |
| B5 | `products` 图片路由的 content-type 表**已含** `.gif: "image/gif"`，且 `.gif` 与 `.jpg/.jpeg/.png/.webp` 同序 | `src/app/api/products/image/route.ts:12-25` |
| B6 | 远端图片下载也会把 `image/gif` 存成 `.gif` 进 artifacts（`online-<ts>-<nanoid>.gif`）→ 同样落入今天的 404 | `src/lib/remote-image.ts:24-29,37,113` |
| B7 | 除 F1 涉及的两处外，全仓**没有**任何按 `.gif` 分支的逻辑（客户端不依赖该 404） | 全仓 grep `.gif`（src，排除 locales/tests） |
| B8 | 图库白名单与列表含 `.gif`；编辑器选图控件的 `accept="image/*"` 允许选到 GIF | `src/lib/artifact-image-url.ts:9`、`src/lib/image-library.ts`、`src/components/creation/image-source-picker.tsx:267` |
| B9 | 测试基础设施：`route-harness` 在任何读环境的模块被导入前把 `SOCIAL_AUTO_POST_DB_URL` 与 `SOCIAL_AUTO_POST_DATA_DIR` 固定到 `mkdtempSync` 临时目录，并导出 `routeTestDataDir` | `src/test/route-harness.ts:30-35` |
| B10 | 数据根优先级：`SOCIAL_AUTO_POST_DATA_DIR` > `APP_DATA_DIR/<brand>` > `cwd/web-data` → 使用 harness 的测试里，artifacts 路由会读写**同一个临时目录**，故"上传→读取"可在同一测试文件内串联 | `src/lib/runtime-config.ts:15-23` |
| B11 | 响应信封：成功 `{ ok: true, data }`；失败 `{ ok: false, error, code, message, details }` | `src/lib/api.ts:12-26` |
| B12 | `src/lib/image-library.test.ts` 已存在（回归范围需含它） | 文件列表 |

**结论**：F1 是"表缺一项"的功能缺陷（B1+B4+B5+B6），修复面极小；F3 是"写侧路由无自动化测试"的缺口（B4），而读侧路由**已有**测试（B2），因此 F3 补齐后，F1 的"上传成功 + 读取 200"可以在自动化测试里端到端断言（B9+B10 保证隔离）。

## 三、F1 实施方案（GIF 支持修复）

### 3.1 生产代码改动：1 行

`src/app/api/agent/artifacts/route.ts` 的 `contentTypes`（现 L8-13）追加一行，与 `api/products/image/route.ts:19-25`（B5）保持同序同值：

```ts
const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",   // ← 唯一新增行
};
```

改动**只**扩大"服务端愿意以图片身份回包"的扩展名集合，因此：
- 404 → 200 只发生在今天本来就坏掉的输入上（B6/B8 的 `.gif` 素材），其它扩展名一律不变；
- URL 形状、查询参数、缓存头、`Content-Length` 行为、路径校验（`path.basename` 相等）全部不动；
- 无持久化数据影响（不写库、不写文件）。

### 3.2 F1 的测试：在**既有**文件里追加（不新建文件）

文件 `src/app/api/agent/artifacts/route.test.ts`（B2/B3 已提供夹具）：

| 用例 | 输入 | 断言 | 保护什么 |
| --- | --- | --- | --- |
| **新增** "serves a GIF from the same section" | 写入 `anim.gif` 后 `GET ?file=anim.gif` | `200`；`content-type === "image/gif"`；`cache-control === "private, max-age=300"`（B1 的 L32-33 既定值）；响应体字节等于写入字节 | F1 的验收项全部：上传物可读、200、MIME、缓存头 |
| **追加**到既有 "serves only a file that sits directly in the section" | 追加一个**图片类但不受支持**的扩展名（`.svg`） | `404` | 防止"补 GIF"被误解为"放开所有图片类型"；与既有 `notes.txt` 404 一起把负向边界钉住 |

写法约定：沿用该文件既有风格——`request(file)` 辅助函数（L32-34）、`fs.writeFileSync` 直写 workspace 的 `artifacts` 目录、不引入新依赖。测试夹具字节沿用仓库既有约定（`images/route.test.ts:108-109` 用可识别假字节 `"png-bytes"` 之类）；若要更拟真，可用 35 字节最小 GIF89a，但**不是**契约要求——该路由只按扩展名判定 MIME，从不嗅探字节内容。

### 3.3 F1 明确不做

- **不加**扩展名过滤/嗅探到解析器或图库（`src/lib/artifact-image-url.ts` 保持"只回答地址"的职责，`artifact-image-url.test.ts:69-77` 的注释继续成立）；
- **不改** `IMAGE_FILE_EXTENSIONS`（B8，`.gif` 本就在集合内）；
- **不加**新图片类型（`.svg`/`.bmp`/`.avif` 等仍 404）；
- **不改** `Cache-Control`、不改流式/range 行为；
- 不借机处理 F2（URL 输入语义）或 F4（测试环境）。

## 四、F3 实施方案（上传路由自动化测试）

### 4.1 新文件

`src/app/api/images/upload/route.test.ts`（**新增**，仓库里 `src/app` 下的路由测试已是既有约定：B2、`src/app/api/images/route.test.ts`）。

骨架（隔离设施的顺序是硬约束，照抄 `images/route.test.ts:40-58` 的写法）：

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 第一件事：harness 在任何读取环境的模块被导入前固定临时 DB 与临时数据根（B9）。
const { routeTestDataDir } = await import("@/test/route-harness");
const { POST } = await import("./route");
const { GET } = await import("@/app/api/agent/artifacts/route");
const { artifactImageUrl } = await import("@/lib/artifact-image-url");

const artifactsDir = path.join(routeTestDataDir, "artifacts");
```

- `routeTestDataDir` 使 `ensureArtifactsRoot()` 写入 `%TEMP%\coolpilot-route-*\artifacts`（B9+B10），**不触达 `web-data/`**；
- `afterEach` 清理本用例创建的文件（照 `images/route.test.ts:96-100` 的 `clearArtifacts()` 写法）；
- 上传请求用 `FormData` + `new Request(url, { method: "POST", body: form })`，无需任何 AI/凭证环境（该路由不调用模型）。

### 4.2 用例清单

| # | 用例 | 输入 | 断言 | 保护什么 |
| --- | --- | --- | --- | --- |
| 1 | "answers the stored URL shape for a PNG upload" | `file=shot.png`(PNG 字节) | `201`；`ok === true`；`fileName` 匹配 `^upload-\d+-[A-Za-z0-9_-]{8}\.png$`；**同时**断言 `url` 等于**字面**模板 `/api/agent/artifacts?file=${encodeURIComponent(fileName)}`，且等于 `artifactImageUrl(fileName)` | **F3 的核心**：字面断言钉住 URL **形状**（形状变了立刻红），等式断言钉住**接线**（还在用共享函数）。两者缺一，就分别漏掉"形状漂移"和"各自实现" |
| 2 | "writes the uploaded bytes into the artifacts section" | 同上 | 文件存在于 `path.join(routeTestDataDir, "artifacts", fileName)`，字节完全一致；且断言路径以 `routeTestDataDir` 开头 | 落盘真实发生 + **隔离自证**（写入的一定是临时根，不是开发目录） |
| 3 | "serves an uploaded GIF back with its own content type" | `file=anim.gif` | 上传 `201` 且 `fileName` 以 `.gif` 结尾 → `GET /api/agent/artifacts?file=<fileName>` 得 `200` + `image/gif` + 字节一致 | **F1 的验收项 1+2 在同一用例里端到端**（B9+B10 使两路由共处同一临时根）；同时证明写侧白名单与读侧 MIME 表已一致 |
| 4 | "keeps the rejection paths" | ① `notes.txt` ② 0 字节 PNG ③ 无 `file` 字段 / 非表单体 | ① `400` + `code === "UNSUPPORTED_IMAGE"` ② `400` + `EMPTY_UPLOAD` ③ `400` + `INVALID_PAYLOAD`（信封按 B11 断言 `ok === false`） | 补 GIF 不等于放宽校验；三条拒绝路径是既有行为，别在重构中丢掉 |
| 5 | "defaults an extension-less upload to .png"（可选） | `file=shot`（PNG 字节） | `201` 且 `fileName` 以 `.png` 结尾 | 钉住 `upload/route.ts:24` 的 `|| ".png"` 分支；该分支真实存在且从未被测过 |

用例 3 是合并 F1+F3 的关键收益：**不引入外部测试机制**，就能在 `vitest run` 内覆盖"上传成功 + 读取 200 + MIME"，不需要起 dev server。


## 五、数据隔离方式

| 层次 | 机制 | 本卡是否使用 |
| --- | --- | --- |
| 单元/路由测试（F1+F3 的全部用例） | `src/test/route-harness.ts:30-35`：导入任何读环境的模块**之前**把 `SOCIAL_AUTO_POST_DB_URL` 指向 `%TEMP%\coolpilot-route-*\routes.db`、`SOCIAL_AUTO_POST_DATA_DIR` 指向同一临时目录；`resolveAppDataDir()` 优先读它（`runtime-config.ts:16-18`） | **使用**（F3）；F1 的用例沿用 artifacts 测试自己的 `mkdtempSync` + `APP_DATA_DIR` 夹具（`route.test.ts:23-27`），该文件**完全不碰数据库** |
| 写入清理 | 测试自己清理：artifacts 测试 `afterEach` 递归 `rmSync`；F3 的 `afterEach` 删除它写入的 artifacts 文件 | **使用** |
| 浏览器 smoke | 需要 dev server；`.env.local` 把开发库固定为 `file:./web-data/social-auto-post.db`，只有 artifacts 根可被 `SOCIAL_AUTO_POST_DATA_DIR` 隔离 | **本卡不使用**（F1 的验收项 1+2 已由用例 3 覆盖）。若将来仍要浏览器级 GIF 证据，应在 **F4** 先解决"独立测试数据库"后再做，避免再次写开发库 |

**自查要求**：F3 用例 2 必须显式断言写入路径的前缀为 `routeTestDataDir`——这样"测试是否真的隔离"由测试自己证明，而不是靠约定。

## 六、回归范围与命令

改动文件（预计 4 个，其中生产代码 1 行）：

| 文件 | 变更 | 规模 |
| --- | --- | --- |
| `src/app/api/agent/artifacts/route.ts` | `contentTypes` +1 行 | 1 行生产代码 |
| `src/app/api/agent/artifacts/route.test.ts` | +1 用例，1 个既有用例追加 1 条断言 | 追加 |
| `src/app/api/images/upload/route.test.ts` | **新建**（用例 1-4，用例 5 可选） | 新文件 |
| `src/lib/artifact-image-url.test.ts` | **仅注释**（见 §九更正；断言的扩展名集合不变） | 2 行注释 |

必须全绿的验证（顺序照 P1 卡 1）：

```powershell
# 1) 针对性
node_modules\.bin\vitest.cmd run src/app/api/agent/artifacts/route.test.ts src/app/api/images/upload/route.test.ts src/lib/artifact-image-url.test.ts src/lib/image-library.test.ts
# 2) 静态
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\eslint.cmd .
# 3) 全量（预期 ≥90 文件 / ≥586 用例，无既有用例变红；以实际数字为准）
node_modules\.bin\vitest.cmd run
```

回归边界（**不允许变红或漂移**）：
- 既有 3 个 artifacts 用例的**原断言**（只允许追加，不允许放松）；
- `src/lib/image-library.test.ts`（列出/删除 `.gif` 的行为不变）；
- `src/lib/artifact-image-url.test.ts` 的 10 个用例（含 `IMAGE_FILE_EXTENSIONS` 集合基线）；
- 上传路由的既有响应字段名与状态码（`201` / `400` + `INVALID_PAYLOAD` / `EMPTY_UPLOAD` / `UNSUPPORTED_IMAGE`）；
- P1 卡 1 的 8 个改动文件不得被本卡再改（除上表第 4 项的 2 行注释）。

## 七、验收标准（两项分开判定）

### 7.1 F1 项：GIF 支持修复

| # | 验收条件 | 判定方式 |
| --- | --- | --- |
| F1-a | `.gif` 上传成功（`201`，`fileName` 后缀 `.gif`） | 用例 3 或手工 `POST /api/images/upload` |
| F1-b | `GET /api/agent/artifacts?file=<name>.gif` 返回 `200` | 用例 3 |
| F1-c | `Content-Type: image/gif` | 用例 3 + new artifacts 用例 |
| F1-d | 缓存头为 `Cache-Control: private, max-age=300`（与其它图片一致） | new artifacts 用例 |
| F1-e | 不受支持的扩展名仍 `404`（`.svg`、`notes.txt`） | new artifacts 用例追加断言 |
| F1-f | `.png/.jpg/.jpeg/.webp` 行为与响应头不变 | 既有 artifacts 用例保持绿 |

**判定**：以上全绿，且生产代码改动为空 +1 行映射（diff 复核）。

### 7.2 F3 项：上传路由自动化测试

| # | 验收条件 | 判定方式 |
| --- | --- | --- |
| F3-a | `src/app/api/images/upload/route.test.ts` 存在，且在 `vitest run` 内被执行 | 全量输出中出现该文件名 |
| F3-b | 上传响应体形状被钉住：`{ ok: true, data: { fileName, url } }` | 用例 1 |
| F3-c | `url` 的**字面形状**被钉住（不依赖共享函数自身） | 用例 1 的字面模板断言 |
| F3-d | `url === artifactImageUrl(fileName)`（共享函数**接线**被钉住） | 用例 1 的等式断言 |
| F3-e | 上传确实落盘，且落在临时数据根内（隔离自证） | 用例 2 |
| F3-f | 三条拒绝路径的 `code` 被钉住 | 用例 4 —— ⚠️ **实测未达成**：`UNSUPPORTED_IMAGE` / `EMPTY_UPLOAD` 不在 `appErrorCodes`，`fail()` 把它们降级为 `code: "UNKNOWN_ERROR"`（token 落在 `error`/`message`）。实施记录 §6.2.1 给出「原始要求 / 当前真实行为 / 双轨状态」，§九 为复核裁定；实施按真实行为断言，未改生产代码 |
| F3-g | 全套用例不写开发库、不写 `web-data/`（复核：跑完后 `git status` 无新文件、`web-data/artifacts` 数量不变） | 全量测试后检查 |

**判定（据实修订）**：F3-a～F3-e、F3-g 全绿 + F3-g 复核通过；**F3-f 的原始要求（三条 `code`）未达成**，仅为「真实行为已被测试覆盖」，需按实施记录 §6.2.1 单独裁定后再决定 F3 是否关闭。 **→ 裁定（2026-10-09）：采用选项 1（认可轨道 A）——F3 关闭（关闭对象是\"上传路由缺少自动化测试\"这一缺口），F3-f 的原始错误码要求保留为 F5 独立未解决项；裁定表与防误读说明见实施记录 §十。**

### 7.3 显式不在本卡判定范围

- F2（应用内 URL 双编码）：本卡**不得**改变 `resolveArtifactImageSrc` 的任何输入输出；
- F4（smoke 用开发库）：本卡**不**运行浏览器 smoke，因此不产生新的隔离风险，也不解决该风险。

## 八、风险、假设与实施顺序

| # | 风险 / 假设 | 缓解 |
| --- | --- | --- |
| 1 | 修改既有 artifacts 用例（追加 `.svg` 404 断言）触碰一个语义敏感的冻结用例 | 只**追加**断言，不改/不删原断言；若复核者反对，可把 `.svg` 单独建成新用例 |
| 2 | 用例 3 把两个路由处理器放进同一测试文件 | 依赖 `resolveAppDataDir()` 的优先级（B10）与"两个路由都在**请求时**解析路径"这一事实（已读源码确认），实施时以跑绿为准 |
| 3 | 断言缓存头会把"路由头策略"变成契约 | 这是 F1 验收明确要求的（"检查预期的缓存头"），且该值自 P5 起未变；若未来要改缓存策略，改测试即可，属显式修改 |
| 4 | 假定 `.gif` 是唯一缺失项 | 已核对（B1 vs B5 vs B8）：`.svg`/`.bmp`/`.avif` 等既不在图库集合也不在上传白名单，故不因"补齐"而被误纳入 |
| 5 | 用例 5（无扩展名默认 `.png`）可能被认为越界 | 标为**可选**；它钉住的是上传路由既有分支，不涉 GIF |

**建议实施顺序**（同一张卡、两个验收项，F3 先行）：
1. 先写 F3 的用例 1、2、4（此时用例 3 会**红**——这正是 F1 的缺陷复现，红→绿的证据最强）；
2. 再写 F1 的 1 行修复 + artifacts 用例（新增 GIF 用例、追加 `.svg` 断言），用例 3 转绿；
3. 跑 §六 的命令，收集 §七 的判定证据；
4. 记录实施结果（新增或追加到验收记录），停等人工验收；**不启动 P1 卡 2**。

## 九、对既有记录的更正（1 处）

`docs/p1-card-01-acceptance.md` §8.2 曾写"修复时必须同步修改 `src/lib/artifact-image-url.test.ts:98-102` 的基线用例"。复核后更正为：

- **断言不需要改**：该用例钉住的是 `IMAGE_FILE_EXTENSIONS`（B8，含 `.gif`），F1 只增加路由的 content-type 映射，集合不变，用例照旧绿；
- **只有注释需要更新**：该用例的注释写着"`.gif` 留在集合里直到 N1 决策"（`artifact-image-url.test.ts:99-100`），F1 决策后这句话过期，应改为说明"集合含 `.gif`，服务端由 artifacts 路由提供对应 MIME"。

即：本卡对 `src/lib/artifact-image-url.test.ts` 的改动是**注释 2 行**，不是断言。

## 十、本卡不做什么

- 不改 `src/lib/artifact-image-url.ts`、不改 URL 形状、不改 `IMAGE_FILE_EXTENSIONS`；
- 不改 P1 卡 1 的 8 个改动文件（注释除外）；
- 不做 F2（输入语义）、不做 F4（测试环境/独立数据库）、不新增浏览器 smoke；
- 不新增依赖、不改 `vitest.config.ts` 收集范围、不加 `.tsx` 组件测试；
- 不 `git add` / 不提交 / 不启动 P1 卡 2。

