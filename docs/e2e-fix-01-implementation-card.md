# E2E-FIX-01 实施卡：`POST /api/publish` 结果契约（F2-1 / 已选**方案 A**）

> **前置决策（已签字）**：F2-1 = **方案 A**（保留 HTTP 200 兼容语义 + 增加顶层业务汇总 + 定义异常响应契约）；DS-1 = A；DS-2 = B；DS-3 = C。见 `docs/f2-contract-decision-sheets.md`。
> **依据**：`docs/e2e-fix-01-publish-contract-review.md`（调用方清单、五类结果语义、兼容风险、回归范围）。
> **边界**：不改 C2 冻结面（`publish/draft`、`publish/verify`、`publish-facts.ts`）；不改数据库 schema；不做任何自动重试；不清理成本台账；不执行 `git add` / `git commit`。
> **顺序原则（本卡的核心）**：**先固定契约与测试预期，再修改实现**；UI 提示修正先行（不依赖新契约字段）。

## 0. 卡定义

| 项 | 内容 |
| --- | --- |
| 卡号 | **E2E-FIX-01** 发布结果不再可能被误判（方案 A 实施） |
| 目标 | ① 用户与调用方都能分辨"全部成功 / 部分成功 / 全部失败"；② 中途异常有结构化响应，且**不谎报**已发生的平台动作；③ 多分组发布不再因一组失败而跳过其余分组 |
| 执行范围 | 新增纯函数汇总模块 + 前端提示修正 + 多分组循环不中断 + 路由顶层汇总与 5b 错误体 + 定向测试 |
| 验收 | 见 §5（功能 / 兼容 / 测试 / 文档 / 边界五项，缺一不可） |
| 停止边界 | HTTP 200 保留；现有 5 类 `status` 语义与 `results` 数组形状不变；不改 `recordStatusByResult` 映射；不改 `publishInputSchema`；不改 `draft`/`verify`；**任何路径都不得自动重试** |
| 交付物 | 代码 + 测试 + 本卡"实施记录"小节（逐阶段勾选与命令输出） |
| 不在本卡 | 真实平台发布成功分支（等凭据与授权）；方案 B 的状态码矩阵；`publishToSites()` 死导出的去留；DS-3 的降级字段（另卡） |

## 1. 契约定稿（实施前冻结，评审通过后不再改）

### 1.1 新模块（客户端安全，**只有 type-only import**）

新增 `src/lib/publish-results.ts`：

```ts
import type { PublishSiteResult } from "./publish";

/** 一次发布批次的整体结果（F2-1 方案 A：HTTP 200 不变，业务结果放这里）。 */
export type PublishRunOutcome = "succeeded" | "partial" | "failed";

export type PublishRunSummary = {
  /** 请求点名的账号数（= `results.length`，与 `results` 顺序一一对应）。 */
  requested: number;
  published: number;
  drafted: number;
  loginRequired: number;
  unsupported: number;
  failed: number;
  /** `failed` 中由路由自身异常产生的条数（F2-1 5b）；恒 ≤ `failed`。 */
  unexpected: number;
  /** 计数哨兵：`status` 不在已知五类内的条数（当前恒为 0）。它存在的唯一目的是让 `requested` **恒等于**各桶之和，见 I8。 */
  other: number;
  /** 平台已接收内容的账号数：`published + drafted`。 */
  delivered: number;
  /** `succeeded` = 全部 delivered；`failed` = delivered 为 0；其余为 `partial`。 */
  outcome: PublishRunOutcome;
};

export function summarizePublishResults(results: PublishSiteResult[]): PublishRunSummary;
```

> **评审期增补（2026-10-09，验收要求）**：类型新增 `other` 哨兵字段。依据是验收要求"计数规则必须互斥，且 `requested`、各状态计数与 `delivered` 不得因遗漏或重复而互相矛盾"。单趟 `switch` 使每条结果**恰好**落入一个桶，`other` 把这个不变式变成可断言的事实（I8 / P9），而**不用**把不认识的 `status` 伪装成 `failed`。若评审否决，退路是"未知状态计入 `failed`、不新增字段"，并在 §9 记录该决定。
>
> **裁决（2026-10-09）：通过，保留 `other`，不采用退路。** 附加约束（随裁决生效）：`other` 是**兼容性与可观测性计数桶**，不是新的发布结果状态，不得被自动推导为成功或失败；`other > 0` 时整体 `outcome` 不得为 `succeeded`。该约束由 I9 自动保证——`other > 0` ⇒ `delivered < requested` ⇒ `outcome ≠ "succeeded"`，因此本卡**不新增**对 `other` 的专门判定逻辑。

**硬性约束**：该文件**不得**出现 `node:*`、Playwright、DB 或 `@/lib/publish` 的**值**导入（只能 `import type`）。它是客户端与服务端共用的纯函数，先例是 `src/lib/browser-preview-shared.ts`。违反此约束时 `tsc --noEmit` **不会**报错，只能在阶段 D 由"组件仍可编译/运行"确认（见 §7 风险 R4）。

### 1.2 判定与不变式

| 不变式 | 说明 |
| --- | --- |
| I1 | `results` 数组仍**原样**返回（顺序与 `accountIds` 一致、长度 = `accountIds.length`），旧调用方 `data.results` 无需改动即可工作 |
| I2 | 五类 `status`（`published` / `drafted` / `login_required` / `unsupported` / `failed`）的**产生条件不变**；`recordStatusByResult` 映射（`route.ts:11-17`）不变 |
| I3 | "账号不存在"仍是 `200` + `status:"failed"` + 记录 `failed`（与 `tmp-p1-05-e2e04.log.json:40-71` 一致）；**方案 A 不改它** |
| I4 | 响应体为 `ok({ results, summary })`：`results` 放在 `summary` **之前**，读取顺序不影响兼容 |
| I5 | `outcome` 只由 `delivered` 与 `requested` 决定，不猜测平台语义：`drafted` 也算"平台已接收" |
| I6 | 重复 `accountId` 会重复发布（现状如此），本卡**不修**，仅在 §8 记录 |
| I7 | 任何路径**不得自动重试**；失败后是否重试是人的决定 |
| I8 | **计数互斥且完备**：`published + drafted + loginRequired + unsupported + failed + other === requested`，且 `delivered === published + drafted`；每条结果只被计数一次（单趟 `switch`）。`other` 恒为 0（见 §1.1 评审期增补） |
| I9 | **`succeeded` ⇔ `requested > 0 && delivered === requested`；`failed` ⇔ `delivered === 0`**；其余为 `partial`。三个取值互斥且完备 |

### 1.3 5b 结构化错误契约（"半执行"）

新增错误码 `PUBLISH_RUN_FAILED`，并给 `PublishSiteResult` 增加**可选**字段 `errorKind?: "unexpected"`（`src/lib/publish.ts:18-25`；现有 5 处构造不传该字段，属向后兼容的纯增字段）。

路由循环内每个账号**独立** try/catch（覆盖今天的 `getAccount` `:27`、`findAccountLoginBlock` `:46`、`createPublishRecord` `:30`/`:57`/`:76` 三处无保护调用）：

- 异常 → 该账号推入 `{ accountId, accountName: site?.name ?? "", platform: site?.platform ?? "", status: "failed", error: 消息, errorKind: "unexpected" }`，**继续下一个账号**（不中断整批）。
- 结果记录（`createPublishRecord`）本身就是可能抛错的那一步：写不进去就只在响应里如实反映，**不得**让"记录没写成"变成"发布没发生"。

批次结束后按一条规则二选一：

| Case | 触发条件 | 响应 | 语义 |
| --- | --- | --- | --- |
| **A. 有话可说** | `summary.unexpected > 0 && summary.delivered > 0` | **200** + `ok({ results, summary })` | 已经有平台动作真实发生（`delivered>0`），因此必须如实汇报每条结果；`summary.unexpected` 标记异常条数 |
| **B. 无从报告** | `summary.unexpected > 0 && summary.delivered === 0` | **500** + `fail("PUBLISH_RUN_FAILED", 500, { results, summary, retrySafe: false })` | 整批没有任何"平台已接收"的证据，但批次并未被正常评估；结构化错误告诉调用方"不要以为没发生" |

**必须写在错误体里的那句话**（`details` 字段）：

```ts
{
  results,            // 已评估到的逐账号结果（可能为空数组）
  summary,            // 同一份汇总
  retrySafe: false,   // 没有幂等键：平台动作可能已发生，禁止自动重试
}
```

`fail()`（`src/lib/api.ts:16-26`）会输出 `{ ok:false, error, code, message, details }`，因此 Case B 的调用方拿到 `code === "PUBLISH_RUN_FAILED"`、`details.results`、`details.summary`、`details.retrySafe`。前端据此**合并 `details.results` 进结果面板**（见 §3 前端行），不丢真相。

新增错误码所要求的同步改动（一处都不能少）：
1. `src/lib/app-errors.ts:1-31` 追加 `"PUBLISH_RUN_FAILED"`；
2. `src/lib/app-errors.ts:41-71` 追加 `PUBLISH_RUN_FAILED: "The publish batch ended with unhandled account failures"`；
3. `src/locales/en.json` / `zh-cn.json` / `zh-hk.json` 各加 `error_PUBLISH_RUN_FAILED`（`TranslationKey` 由 `en.json` 派生、且三个语言文件互相同构约束，缺一即编译失败）。

### 1.4 明确**不变**的东西（防越界）

- `400 INVALID_PAYLOAD`（`route.ts:21`）与"无效载荷 0 行写入"（回归 E2E-04 step 3）不变；
- `publishToSite` 内部 try/catch（`publish.ts:44-81`）不变，它抛错仍应表现为 `status:"failed"` 的 **200**（5a 口径）——本卡不得把 5a 也改成非 2xx；
- `publish/draft`（404 / 400 / 500）、`publish/verify`（200 + outcome）、`publish-facts.ts` 一概不碰；
- `src/lib/publish.ts:129` `publishToSites()` 死导出**不动**（另卡）。

## 2. 实施阶段（A → D，逐阶段可独立验收）

### 阶段 A（P0，不依赖新契约字段）：把"完成即成功"改掉

| 步骤 | 动作 |
| --- | --- |
| A0 | **由 C1 提前**：`src/lib/publish.ts:18-31` 给 `PublishSiteResult` 增加**可选**字段 `errorKind?: "unexpected"`。原因：A1 要按它计数、A4 要合成带它的条目，没有它阶段 A 过不了类型检查；该字段是纯增且当前**没有任何写入方**，提前一个阶段不产生任何运行时代码路径 |
| A1 | 新增 `src/lib/publish-results.ts`（§1.1），`unexpected` 由 `results` 中 `errorKind === "unexpected"` 的条数得出；同步新增 `src/lib/publish-results.test.ts`（§4.1） |
| A2 | `posts-composer.tsx:100-101`：先用 `summarizePublishResults(data.results)` 得出汇总，再 `setResults`，并按 `outcome` 选择提示（`succeeded` → `pcPublished`；`partial` → `pcPublishPartial`；`failed` → `pcPublishAllFailed`） |
| A3 | `posts-composer.tsx:102-105`（**建议项 P0b，可评审否决**）：仅当 `outcome === "succeeded"` 才清空表单；非成功时**保留**用户文案，提示中明确"部分/全部未成功，重试前请到发布记录确认"，避免用户重打一遍内容 |
| A4 | `videos-composer.tsx:315-332`：把 `for (const group of groups.values())` 的**每次** `apiPost` 放进**各自** try/catch；某组失败时按该组 `accountIds` 合成 `failed` + `errorKind:"unexpected"` 结果并入 `collected`，然后**继续下一组**（决策："不能因一个分组失败而无意跳过其余分组"） |
| A5 | `videos-composer.tsx:331-333`：用 `summarizePublishResults(collected)` 决定提示与是否 `resetComposer()`（同 A3 口径） |
| A6 | `src/locales/{en,zh-cn,zh-hk}.json` 新增 `pcPublishPartial` / `pcPublishAllFailed` / `vcPublishPartial` / `vcPublishAllFailed`；参数占位符是**单花括号** `{count}`（插值实现见 `src/lib/i18n.tsx:15-21`，先例 `en.json:234` `"{count} platform(s)"`），调用形式沿用 `t(key, { count })`（`posts-composer.tsx:216`） |

**阶段 A 的验收**：不依赖任何服务端新字段即可工作（老服务器 + 新前端 = 行为正确）；`node_modules\.bin\vitest.cmd run src/lib/publish-results.test.ts` 绿。

| 步骤 | 动作 |
| --- | --- |
| A7 | `src/components/ui/console-surface.tsx:43-62`：`ConsoleNotice` 的 `tone` 增加 `"warning"`（琥珀色），供"部分成功"使用。纯增可选值，其余调用方不受影响；`posts-composer` 的提示条不是 `ConsoleNotice`（组件内联），因此同档位色值写在组件顶部常量 `noticeToneClass` |

> **A2/A3 的实现口径（已落地）**：`posts-composer` 用 `data.summary ?? summarizePublishResults(data.results)` 取判定——服务端给了就以服务端为准，没给（老服务器）就本地按同一规则算，两种情况**都不需要后端配合**。
> **A4/A5 的实现口径（已落地）**：`videos-composer` 的多组请求走 `publishGroups()`，批次判定来自 `collected`（它**恰好**包含每个账号一次）。多组场景因此**永不**需要合并服务端 `summary`，也就没有重复计数的余地——阶段 C 只需给 `posts-composer` 接上服务端 `summary`。

### 阶段 B（先固定预期）：新增路由测试并**锁定现状**

| 步骤 | 动作 |
| --- | --- |
| B1 | 新增 `src/app/api/publish/route.test.ts`（写法对齐 `publish/draft/route.test.ts:28-60`：**先**钉临时 `SOCIAL_AUTO_POST_DB_URL` / `SOCIAL_AUTO_POST_DATA_DIR`，**再** `await import("./route")`） |
| B2 | mock `@/lib/publish` 的 `publishToSite`（`vi.hoisted` 可变结果，同 draft 测试 :33-44 的写法），使"成功 / drafted / failed / 抛错"可控且**不启动浏览器** |
| B3 | 写 §4.2 的 T1–T6：此时 T1–T5 必须**绿**（现状行为）；T6（中途异常）按**现状**断言 `500`，并附注释"阶段 C 将改为结构化错误体"——这就是"先固定测试预期" |
| B4 | 同时补一条 `login_required` 用例：用**真实**路径 `saveAccountHealthSnapshot`（`src/db/repositories/account-health.ts:24`）写入 `{status:"signed_out", reason:"login_url"}` 的检查项（`findLoginBlock` 的命中条件见 `src/lib/account-risk.ts:281-283`），断言**不调用** `publishToSite`、结果 `status:"login_required"` |

**阶段 B 的验收**：`node_modules\.bin\vitest.cmd run src/app/api/publish` 全绿（T6 以现状口径绿）。

### 阶段 C（改实现）：顶层汇总 + 5b 结构化错误

| 步骤 | 动作 |
| --- | --- |
| C1 | `src/lib/publish.ts:18-25`：`PublishSiteResult` 增加可选 `errorKind?: "unexpected"` |
| C2 | `src/app/api/publish/route.ts:26-90`：循环体逐账号 try/catch（§1.3）；异常账号推入 `errorKind:"unexpected"` 的 `failed` 结果并 `continue` |
| C3 | `route.ts:92`：改为 `const summary = summarizePublishResults(results);`，再按 §1.3 的 Case A/B 规则返回 `ok({ results, summary })` 或 `fail("PUBLISH_RUN_FAILED", 500, { results, summary, retrySafe: false })` |
| C4 | `src/lib/app-errors.ts`：加错误码与文案（§1.3 的 1、2 两条）；三个语言文件加 `error_PUBLISH_RUN_FAILED` |
| C5 | 前端两处改为**优先**读服务端 `summary`、缺失时回退本地 `summarizePublishResults`（阶段 A 的 helper 直接复用）：`posts-composer.tsx:100`、`videos-composer.tsx:331` |
| C6 | 前端 `catch`：若 `err` 是 `ApiClientError` 且 `details.results` 存在，合并进结果面板（`api-client.ts:8-18` 已带 `code`/`details`）；提示文案走 `error_${code}` 回退（`api-client.ts:20-25`） |
| C7 | 阶段 B 的 T6 期望值更新为目标契约（500 + `code:"PUBLISH_RUN_FAILED"` + `details.retrySafe=false` + `details.summary`），并补 T7（Case A：部分已发布 + 中途异常 → 200 + `summary.unexpected>0` + `delivered>0`） |

**阶段 C 的验收**：`route.test.ts` T1–T7 全绿，且 **T1–T5、B4 的期望值在本阶段未被改动**（证明兼容性）。

### 阶段 D（集中回归，见 §5 与 §4.3）

## 3. 逐文件改动表（目标行号以当前工作区为准）

| 文件 | 位置 | 动作 | 类型 |
| --- | --- | --- | --- |
| `src/lib/publish-results.ts` | 新增 | `PublishRunOutcome` / `PublishRunSummary` / `summarizePublishResults`（纯函数，仅 `import type`） | 新增 |
| `src/lib/publish-results.test.ts` | 新增 | 纯函数边界用例（§4.1） | 新增 |
| `src/lib/publish.ts` | `:18-25` | `PublishSiteResult` 加可选 `errorKind?: "unexpected"` | 兼容增字段 |
| `src/app/api/publish/route.ts` | `:26-90` | 逐账号 try/catch（5b），异常不中断整批 | 行为 |
| `src/app/api/publish/route.ts` | `:92` | `ok({ results, summary })`；Case B 走 `fail("PUBLISH_RUN_FAILED", 500, …)` | 契约 |
| `src/app/api/publish/route.test.ts` | 新增 | T1–T7 + login_required 用例（§4.2） | 新增 |
| `src/app/api/publish/route.ts` | `:11-17`, `:20-23` | **不动**（I2、§1.4） | —— |
| `src/components/creation/posts-composer.tsx` | `:98-129`, `:137-141` | 汇总驱动的提示（三档色：成功/部分/失败）；非成功不清空表单（P0b） | 行为 |
| `src/components/creation/posts-composer.tsx` | `:229-246` | 结果面板不变（已逐条显示 `status` + `error`），仅在非成功时补汇总行 | 可选 |
| `src/components/creation/videos-composer.tsx` | `:315-332` | 每组独立 try/catch + 汇总驱动提示 | 行为 |
| `src/components/creation/videos-composer.tsx` | `:366` | `ConsoleNotice` 复用（已存在，不新增组件）+ 传入 `tone={noticeTone}` | 行为（A5） |
| `src/components/ui/console-surface.tsx` | `:43-62` | `ConsoleNotice` 的 `tone` 增 `"warning"`（A7） | 兼容增项 |
| `src/lib/publish.ts` | `:18-31` | 增加可选 `errorKind?: "unexpected"`（C1 提前为 A0） | 兼容增项 |
| `src/lib/app-errors.ts` | `:1-31`, `:41-71` | 新增 `PUBLISH_RUN_FAILED` 码与文案 | 兼容增项 |
| `src/locales/en.json` / `zh-cn.json` / `zh-hk.json` | `error_*` 段 + `pc*`/`vc*` 段 | 新增 5 个键 | 必须三处同步 |
| `src/lib/publish.ts` | `:129-135` | **不动**（死导出另卡） | —— |
| `src/app/api/publish/{draft,verify}/route.ts`、`src/lib/publish-facts.ts` | 全部 | **不动**（C2 冻结面） | —— |

阶段 A 为可测性新增的两处（见 §4.3）：

| 文件 | 位置 | 动作 | 类型 |
| --- | --- | --- | --- |
| `src/lib/publish-groups.ts` | 新增 | `PublishGroup` + `publishGroups(groups, publish)`：按组顺序调用、每组独立 try/catch、异常不中断其余组 | 新增（纯逻辑） |
| `src/lib/publish-groups.test.ts` | 新增 | G1–G4（§4.3） | 新增 |

## 4. 测试清单（"不能仅以类型检查通过代替业务契约验收"）

### 4.1 `src/lib/publish-results.test.ts`（纯函数，node 环境，无 mock）

| # | 输入 | 断言 |
| --- | --- | --- |
| P1 | `[]` | `requested=0`、`delivered=0`、`outcome="failed"`（路由的 `min(1)` 使其不可达，但函数必须是全函数，此边界要钉住） |
| P2 | 全部 `published` | `outcome="succeeded"`、`delivered=requested` |
| P3 | 1 `published` + 1 `failed` | `outcome="partial"` |
| P4 | 全部 `failed` | `outcome="failed"`、`delivered=0` |
| P5 | 全部 `drafted` | `delivered=requested` → `outcome="succeeded"`（I5：`drafted` 也算平台已接收） |
| P6 | `login_required` + `unsupported` | 分别计数，`delivered=0` → `outcome="failed"` |
| P7 | `failed` 中只有部分带 `errorKind:"unexpected"` | `unexpected` 只数带标记的，且恒 ≤ `failed` |
| P8 | 传入数组本身 | 断言**未**被修改（纯函数，就地改写会让调用方看到脏数据） |
| P9 | 混合批次（含重复状态，外加一个**本 build 不认识**的 `status`） | 各桶之和 `=== requested`（互斥且完备）、`delivered === published + drafted`、不认识的 `status` 只落在 `other` 而不消失；`outcome` 与 I9 一致（依据 2026-10-09 验收要求新增） |

### 4.2 `src/app/api/publish/route.test.ts`（新增，按阶段 B/C 分两次落地）

**夹具（对齐 `publish/draft/route.test.ts:28-60`）**
- 先 `mkdtempSync` 钉 `SOCIAL_AUTO_POST_DB_URL` / `SOCIAL_AUTO_POST_DATA_DIR`，再 `await import("./route")`；
- `vi.mock("@/lib/publish")` 提供可变 `publishToSite`（`vi.hoisted` 写法同 draft 测试 :33-44），**因此任何用例都不会启动浏览器**；
- 需要注入异常的两处用 `@/db/repository` 的**部分 mock**（`importOriginal` 展开放回真实实现 + 一个默认关闭的开关）。原因：路由在模块加载时按名导入，`spyOn` 无法可靠替换该绑定；开关默认关闭使其余用例仍在真实仓储上跑；
- `login_required` 用例走**真实**健康检查路径：用 `saveAccountHealthSnapshot`（`src/db/repositories/account-health.ts:24-30`）写入 `{ status:"signed_out", reason:"login_url" }`（命中条件 `src/lib/account-risk.ts:281-283`）；
- 记录断言用真实 `listPublishRecords`（`src/db/repository.ts:1011-1015`）。

| # | 场景 | 阶段 B（现状基线） | 阶段 C（目标契约） |
| --- | --- | --- | --- |
| T1 | 单账号成功 | `200`；`results[0].status="published"`、`url` 透传；`publish_records` 1 行 `published` 且 `publishedAt` 非空 | 追加 `summary`：`published=1`、`delivered=1`、`outcome="succeeded"` |
| T2 | 账号不存在 | `200`；`status="failed"`、`error="Site not found"`；记录 1 行 `failed` / `url=""` / `publishedAt=null`（I3，不得改） | 追加 `summary`：`failed=1`、`outcome="failed"` |
| T3 | 混合（成功 + `login_required` + 不存在） | `200`；`results` 顺序与 `accountIds` 一致；3 行记录；**`publishToSite` 只被调用 1 次**（`login_required` 不启动浏览器） | 追加 `summary`：`published=1`/`loginRequired=1`/`failed=1`、`outcome="partial"` |
| T4 | 无效载荷 `accountIds: []` | `400` + `code="INVALID_PAYLOAD"`；`publish_records` **0 行**（回归 E2E-04 step 3） | 不变（§1.4） |
| T5 | `publishToSite` reject | `200` + `status="failed"` + `error` 为异常消息；记录 `failed`（5a 口径） | **不变**（方案 A 不得把 5a 改成非 2xx） |
| T6 | `createPublishRecord` 抛错、且无任何已交付账号 | `500`（裸 500 快照；注释标明"阶段 C 改为结构化错误体"） | `500` + `code="PUBLISH_RUN_FAILED"` + `details.retrySafe === false` + `details.summary.unexpected === 1` + `details.summary.delivered === 0` + `details.results` 可读到该账号条目 |
| T7 | Case A：账号 1 已 `published`（记录已写）、账号 2 在 `getAccount` 抛错 | ——（阶段 C 新增） | `200`；`results[1].status="failed"` 且 `errorKind="unexpected"`；`summary.delivered=1`、`unexpected=1`、`outcome="partial"`；账号 1 的记录**仍在**（不可回滚的真相被如实汇报） |
| T8 | `login_required` 阻断 | `200`；`status="login_required"`、`error` 含 `Login required`；记录 `failed` + `url` = 阻断页 | 追加 `summary.loginRequired=1` |

> **阶段 C 的兼容性证明**：T1–T5、T8 的**既有断言一个字符都不改**，只增 `summary` 相关断言；唯一被改写的是 T6——这正是"先固定预期、再改实现"的对象。

> **阶段 B 落地的两处口径（2026-10-09，实施记录）**
> - **T5**：上表的 "`publishToSite` reject" 在现实现下**不可达**——`publishToSite` 自带 try/catch（`src/lib/publish.ts:80-88`），平台侧失败是**返回** `status:"failed"`，从不抛出。因此 T5 按 5a 的真实证据形状断言：**返回** `failed` + `error` 透传 ⇒ `200`；用例注释写明这一层，而"真正抛出"的情形由 T6 承担（抛出发生在**路由自身**的记录写入上）。
> - **T6**：测试直接调用 `POST`，没有 HTTP 层，因此本卡的"裸 `500`"只能表现为**异常离开 handler**（`rejects.toThrow`）——这与 `src/app/api/content/import-url/route.test.ts:181-183` 记录的前置状态同源（客户端只看到 `Request failed with 500`，拿不到信封）。阶段 C 把它改成 `500 + code:"PUBLISH_RUN_FAILED"`，**T6 是唯一预期被改写的用例**。

> **阶段 C 落地的口径（2026-10-09，实施记录）**
> - **标记而非替换**：写记录（`createPublishRecord`）是每个分支的**最后一步**，所以异常抛出时该账号的条目可能**已经**在 `results` 里。此时保留原条目（`status` / `url` / `error` 一律不动），只补 `errorKind:"unexpected"`——因此 T6 的 `details.results[0].error` 是平台给的 `platform said no`，而不是 `publish log is down`。理由：§1.3 明确要求"不得让'记录没写成'变成'发布没发生'"，把条目整条替换成 `failed` 恰好会犯这个错。条目**尚未**推入时（`getAccount` / `findAccountLoginBlock` 抛错）仍按 §1.3 合成 `failed` + 异常消息，T7 断言的正是这一支。
> - **Case A/B 的界线**严格按 §1.3 原文，只由 `summary.unexpected > 0 && summary.delivered === 0` 决定，**不新增**判定。由此带来一条**已知上限**：若某账号**已交付**（`published` / `drafted`）而写记录抛错，条目会被标记 `unexpected`，但按冻结的计数口径（"`unexpected` 只数 `failed` 中的条目"，P7）它不进入计数，响应中也没有专门字段承载它。此行记录为后续卡的候选，**本卡不扩字段**。
> - **前端口径（C6）**：`publish-groups.ts` 中原本私有的 `details.results` 解包提为导出函数 `reportedPublishResults`，由 `publishGroups`（G3 已覆盖）与 `posts-composer` 的 `catch` 共用——理由是仓库没有任何组件测试（`src/**/*.test.tsx` 为零），纯函数是唯一能自动验证的位置（新增 G5/G6）。`posts-composer` 的提示选择提为 `showNotice(summary)`，成功 / 部分 / 失败与 5b 回退共用同一实现，避免两处判定漂移；错误行文案经 `apiErrorTranslationKey` 走 `error_<CODE>`，非 `ApiClientError` 仍显示原始消息。`videos-composer` **无需改动**：多分组场景的 `details.results` 已在 `publishGroups` 内合并，其批次判定来自 `collected`（见阶段 A 的注记）。


### 4.3 `src/lib/publish-groups.test.ts`（让"多分组不中断"真的可被测试）

**做法**：把 `videos-composer.tsx:315-330` 的循环抽成纯逻辑 + 依赖注入，组件只负责把 `apiPost` 绑进去：

```ts
// src/lib/publish-groups.ts —— 无 React、无 fetch、无 node:*
export type PublishGroup = { title: string; text: string; accountIds: string[] };

export async function publishGroups(
  groups: PublishGroup[],
  publish: (group: PublishGroup) => Promise<PublishSiteResult[]>,
): Promise<PublishSiteResult[]>;
```

| # | 场景 | 断言 |
| --- | --- | --- |
| G1 | 两组都成功 | 结果按组顺序拼接；`publish` 被调用 2 次 |
| G2 | 第 1 组 reject、第 2 组成功 | **第 2 组仍被调用**（共 2 次）；第 1 组按 `accountIds` 合成 `failed` + `errorKind:"unexpected"`，条数与账号数一致 |
| G3 | reject 携带 `details.results`（Case B 的服务端结果） | 采用**服务端结果**而非合成，不丢"已发生"的真相 |
| G4 | `groups = []` | 返回 `[]`，`publish` 一次都没被调用 |

### 4.4 前端手工核对（不替代上述断言）

| # | 操作 | 期望 |
| --- | --- | --- |
| M1 | 动态发布：只选 1 个**不存在**的账号（或先从界面删掉该账号再勾选其残留 id） | **不出现**"已提交"；出现全失败提示；结果面板显示"失败" + `Site not found` |
| M2 | 视频发布：两个分组，其中一组账号在发布前被删除 | 该组显示失败，**另一组仍被发布**；结果计数 = 账号总数；提示为"部分成功" |
| M3 | 视频发布：全部成功 | 出现"已提交"且表单被清空（`resetComposer`） |
| M4 | 非成功时表单留存（P0b 若采纳） | 文案仍在输入框，用户可手工重试 |

> M1/M2 用"不存在的账号"制造真实失败：`route.ts:28-41` 会写 `failed` 记录而**不启动浏览器**，是当前唯一不产生平台副作用的失败注入方式。

## 5. 验收标准（DoD）

| 维度 | 通过条件 |
| --- | --- |
| 功能 | T1–T8、P1–P8、G1–G4 全绿；M1–M3 手工通过 |
| 兼容 | `results` 形状/顺序/五类 `status` 语义不变；`400 INVALID_PAYLOAD` 与 5a 口径不变；**旧调用方零改动仍能工作**（阶段 C 时 T1–T5/T8 断言未改） |
| 测试 | 定向：`vitest run src/app/api/publish`、`... src/lib/publish-results.test.ts`、`... src/lib/publish-groups.test.ts`；阶段 D 再跑**全量** `vitest run` |
| 类型/规范 | `tsc --noEmit` 与 `eslint .` 不因本卡新增错误（`tmp-probe-*.cjs` 属既有问题，见验收结论文档 §6） |
| 文档 | 本卡 §9 回填"实施记录"；决策单标记为已实施；`README.md` / `README.zh-TW.md` 无需改（只增字段，不改变已公开说明） |
| 边界 | 未改 C2 冻结面、未改 schema、未自动重试、未 `git add` / `git commit`、未执行真实发布 |

## 6. 回滚与停止条件

| 情形 | 动作 |
| --- | --- |
| 阶段 A 上线后提示被反馈为混乱 | 只回滚两个组件的提示判定；`publish-results.ts` / `publish-groups.ts` 保留（纯函数，无副作用） |
| 阶段 C 的 `summary` 与调用方冲突 | `summary` 是**新增**字段，可整段移除回到阶段 B 状态；`results` 全程未被改动 |
| 5b 的 Case A/B 界线被质疑 | 停在 C3 之前的测试态（T6 仍按现状绿），先改 §1.3 规则再改实现 |
| 发现需要改 C2 冻结面或数据库 schema | **停止**，另立卡（本卡不允许） |
| 需要真实发布才能继续 | **停止**，转为等待凭据与授权并单独记录（不算本卡未完成） |

## 7. 风险与缓解

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | 非成功时保留表单（P0b）导致用户重复发布到已成功账号 | 提示写明"已发布 X / 未成功 Y，重试前请到发布记录确认"；`retrySafe:false` 语义同步到 UI；**绝不自动重试** |
| R2 | 5b 的逐账号 try/catch 把"整批故障"降级成"逐条业务失败"而掩盖系统问题 | `summary.unexpected` 显式暴露；`delivered === 0` 时仍走结构化 500（Case B），不把系统故障说成业务失败 |
| R3 | `error` 文案泄出内部异常消息 | 沿用现状（`publish.ts:73-81` 一直如此）；只在 `details` 补 `retrySafe`，不新增敏感信息 |
| R4 | `publish-results.ts` / `publish-groups.ts` 误引入服务端依赖，客户端打包被污染 | 硬性约束写在 §1.1 / §4.3；`tsc` **发现不了**此类错误，阶段 D 必须以"两个 composer 在开发服务器/打包产物中仍可用"确认 |
| R5 | 三份语言文件不同步 | A6/C4 明确三处同步；`localeResources` 的 `satisfies Record<Locale, typeof en>` 会直接编译失败（快速失败，不会静默） |
| R6 | `requested` 与 `accountIds.length` 在重复 id 下被误解 | I6：重复 id 会重复发布，本卡不修；定义固定为 `requested = results.length`，写入文档 |

## 8. 本卡不做（留给后续卡）

1. **方案 B**（状态码矩阵）与"部分成功"的状态码约定——已选 A；仅当出现仓库外正式调用方时重启；
2. `publishToSites()` 死导出（`src/lib/publish.ts:129-135`）的去留；
3. 重复 `accountId` 的去重与发布幂等键（需要平台侧幂等或台账去重设计）；
4. DS-1（F2-2）保留策略的**文档化**、DS-2（F2-3）引用解析契约的**文档化**——按已确认执行顺序的第 2 步单独推进；
5. DS-3（F2-7）降级字段的设计与实施——按已确认执行顺序的第 3 步单独推进；
6. 真实平台发布成功分支的验证（等凭据与授权）；
7. `tmp-probe-*.cjs` 的 lint 问题（与本卡无关）。

## 9. 实施记录（逐阶段回填）

| 阶段 | 状态 | 命令 | 结果 |
| --- | --- | --- | --- |
| A 前端提示 + 多分组不中断 | **完成**（2026-10-09） | `node_modules\.bin\vitest.cmd run src/lib/publish-results.test.ts src/lib/publish-groups.test.ts src/lib/dictionaries.test.ts src/lib/i18n-coverage.test.ts` | 4 文件 / 18 用例全绿（`publish-results` 9、`publish-groups` 4、`dictionaries` 2、`i18n-coverage` 3）；`node_modules\.bin\tsc.cmd --noEmit` 无输出；`node_modules\.bin\eslint.cmd` 对 8 个改动/新增文件无输出 |
| A 变更清单 | 完成 | `git --no-pager diff -- src/components src/lib/publish.ts` | 本阶段**新增改动**：`posts-composer.tsx`（提示三档色 + `data.summary ?? 本地汇总` + 仅成功才清空表单）、`videos-composer.tsx`（`publishGroups` 扇出 + 汇总驱动提示）、`console-surface.tsx`（`tone` 增 `warning`）、`publish.ts`（可选 `errorKind`）、3 个语言文件各 +2 键；新增 4 文件（`publish-results.ts` / `.test.ts` / `publish-groups.ts` / `.test.ts`）。**未** `git add`、**未** `git commit`、未执行真实发布（各文件 numstat 含此前轮次的既有改动，故不在此行引用行数） |
| A 回归（扩展） | 完成 | `node_modules\.bin\vitest.cmd run src/lib src/app/api/publish` | 64 文件 / 473 用例全绿（含既有 `publish/draft`、`publish/verify` 路由测试与全部 `src/lib`），exit 0；`tsc --noEmit` exit 0；`git status` 未新增任何 `tmp-*` 或数据文件（本阶段无持久化路径） |
| B 路由测试锁定现状 | **完成**（2026-10-09） | `node_modules\.bin\vitest.cmd run src/app/api/publish` | **3 文件 / 29 用例全绿**（新增 `src/app/api/publish/route.test.ts` 7 用例：T1 / T2 / T3 混合 / T4 / T5 / T6 / T8=B4；既有两个文件 22 用例未改）；`node_modules\.bin\tsc.cmd --noEmit` exit 0；`node_modules\.bin\eslint.cmd src/app/api/publish/route.test.ts` exit 0 |
| B 数据隔离核验 | 完成 | 临时目录在任何读取者被 import **之前**钉死（`route.test.ts:33-35`，写法对齐 `draft/route.test.ts:28-30`）；跑完比对工作区 36 个 `*.db`；对被运行中进程占用的真实开发库 `web-data\social-auto-post.db` 改用元数据比对 | 36 个库 MD5 与 mtime 全部未变；`social-auto-post.db` 跑前跑后 `LastWriteTimeUtc` 与 `Length` 完全一致（921600 字节）；`web-data` 顶层文件无变化；本阶段测试数据全部落在 `%TEMP%\coolpilot-publish-run-*` |
| B 边界核验 | 完成 | `git --no-pager status --porcelain`（**未** `git add` / **未** `git commit`） | `src/app/api/publish/route.ts` **未出现在改动列表中**（`POST /api/publish` 全程未改）；本阶段新增只有 `?? src/app/api/publish/route.test.ts`；本阶段未编辑任何生产代码；未执行真实发布 |
| C 汇总 + 5b 结构化错误 | **完成**（2026-10-09） | `node_modules\.bin\vitest.cmd run src/app/api/publish src/lib/publish-results.test.ts src/lib/publish-groups.test.ts` | **5 文件 / 45 用例全绿**，exit 0（`route.test.ts` 8 = T1–T5 + T6 改写 + T7 新增 + T8；`publish-results` 9；`publish-groups` 6 = G1–G4 + G5/G6；`publish/draft` 6；`publish/verify` 16）；`node_modules\.bin\tsc.cmd --noEmit` exit 0；改动文件 `node_modules\.bin\eslint.cmd <6 files>` exit 0（全仓 `eslint .` 只剩既有问题：`tmp-probe-*.cjs` 3 error + `chat-conversation.tsx` 1 warning） |
| C 变更清单 | 完成 | `git --no-pager status --short` + 逐文件 diff | 生产代码：`route.ts`（逐账号 try/catch + `ok({results, summary})` + Case B `fail("PUBLISH_RUN_FAILED", 500, { results, summary, retrySafe: false })`）、`app-errors.ts`（+错误码 +回退文案）、3 个语言文件各 +`error_PUBLISH_RUN_FAILED`、`posts-composer.tsx`（`catch` 合并 `details.results` + `error_<CODE>` 文案 + 提示选择提为 `showNotice`）、`publish-groups.ts`（`reportedPublishResults` 由私有函数提为导出，行为不变）；测试：`route.test.ts`（T6 改写 / T7 新增 / T1–T5·T8 仅追加 `summary` 断言）、`publish-groups.test.ts`（G5/G6）。**未** `git add`、**未** `git commit`；未执行真实发布 |
| C 兼容性证明 | 完成 | 逐行比对 T1–T5、T8 用例 | 这 6 个用例的既有断言**一字未改**（`results` 的精确 `toEqual`、记录行数、`platform.calls`、`400 INVALID_PAYLOAD` 零行写入全部保留），阶段 C 只**追加** `summary` 断言；唯一被改写的是 T6，与 §4.2 结语（"T1–T5、T8 的既有断言一个字符都不改，只增 `summary` 相关断言；唯一被改写的是 T6"）一致 |
| C 回归（扩展） | 完成 | `node_modules\.bin\vitest.cmd run src/lib src/app/api/publish` | **65 文件 / 483 用例全绿**，exit 0（= 阶段 B 基线 480 + 本阶段净增 3：T7、G5、G6；无任何其他用例受影响） |
| C 数据隔离核验 | 完成 | 跑前跑后比对工作区 `*.db`（排除 `node_modules` / `.next`） | 29 个库的 `Length` + `LastWriteTimeUtc` + MD5 **全部一致**（`web-data\social-auto-post.db` 由运行中的进程持有，仅元数据可比，同样一致）；本阶段新增测试数据全部落在 `%TEMP%\coolpilot-publish-*` |
| D 集中回归 | 未开始 | `node_modules\.bin\vitest.cmd run`、`node_modules\.bin\eslint.cmd .`、`git --no-pager status --porcelain` | —— |


### 9.1 裁决与口径记录（2026-10-09）

**四项评审裁决：全部通过。**

| # | 事项 | 裁决 | 落地情况 |
| --- | --- | --- | --- |
| 1 | `summary.other` | 通过，**保留**；**不采用**"未知状态计入 `failed`"的退路 | 附加约束写入 §1.1（`other` 是计数桶，不得被推导为成功或失败）；`other > 0 ⇒ outcome ≠ "succeeded"` 由 I9 自动保证，**不新增**判定逻辑 |
| 2 | `errorKind` 提前到 A0 | 通过（阶段 A 无写入方，不改变任何运行时路径） | 阶段 A 已落地（`src/lib/publish.ts:31`）；**阶段 C 必须验证实际写入与计数语义** |
| 3 | 非成功时保留表单（P0b） | 通过 | 阶段 A 已落地（两个 composer 仅 `succeeded` 时清空表单）（`posts-composer` / `videos-composer`） |
| 4 | `ConsoleNotice` 增 `warning` | 通过 | 阶段 A 已落地（`src/components/ui/console-surface.tsx`） |

**阶段 B 的两处落地口径**（详见 §4.2 之后的注记）：T5 以 5a 的"**返回** `failed`"形状断言（`publishToSite` 自带 try/catch，从不抛出）；T6 的"裸 `500`"以"异常离开 handler"断言（测试直调 `POST`，没有 HTTP 层；与 `content/import-url/route.test.ts:181-183` 记录的前置状态同源）。**T6 是本卡唯一预期被阶段 C 改写的用例。** 阶段 B 未发现与实施卡描述不一致的真实行为，因此未触发 §6 的暂停条件；T7 已按约定在阶段 C 新增（见 §9.2）。

### 9.2 阶段 C 落地与验证记录（2026-10-09）

**实现**（与 §1.3 / §3 一致，无越界）：

| 文件 | 动作 |
| --- | --- |
| `src/app/api/publish/route.ts` | 循环体逐账号 `try/catch`（覆盖 `getAccount` / `findAccountLoginBlock` / 三处 `createPublishRecord`）；异常账号按"标记而非替换"处理并 `continue`（整批不中断）；循环后 `const summary = summarizePublishResults(results)`，Case B 走 `fail("PUBLISH_RUN_FAILED", 500, { results, summary, retrySafe: false })`，否则 `ok({ results, summary })`（`results` 在 `summary` 之前） |
| `src/lib/app-errors.ts` | `appErrorCodes` 追加 `PUBLISH_RUN_FAILED`；`fallbackMessages` 追加回退文案 |
| `src/locales/{en,zh-cn,zh-hk}.json` | 各追加 `error_PUBLISH_RUN_FAILED`（三份 key 集合仍完全一致，`i18n-coverage` 用例通过） |
| `src/components/creation/posts-composer.tsx` | `catch` 用 `reportedPublishResults(err)` 把 `details.results` 合入结果面板、并按同一规则出提示；错误行文案走 `error_<CODE>`（`apiErrorTranslationKey`），非 `ApiClientError` 仍显示原始消息；提示选择提为 `showNotice(summary)` |
| `src/lib/publish-groups.ts` | `reportedPublishResults` 由私有函数提为导出（行为不变），供组件与 `publishGroups` 共用 |
| `src/app/api/publish/route.test.ts` | T6 改写为目标契约；T7 新增（Case A）；T1–T5、T8 仅**追加** `summary` 断言；夹具新增第二个默认关闭开关（`getAccount` 抛错 `account store is down`） |
| `src/lib/publish-groups.test.ts` | G5/G6 覆盖 `reportedPublishResults`（有 / 无 `details.results`） |

**验证**：定向 5 文件 / 45 用例全绿；扩展回归 65 文件 / 483 用例全绿（基线 480 + T7/G5/G6）；`tsc --noEmit` exit 0；改动文件 `eslint` exit 0；`*.db` 跑前跑后完全一致。命令与输出见 §9 的 C 行。

**边界**：`recordStatusByResult` 映射、`publishInputSchema`、5a（`publishToSite` 自带 try/catch ⇒ 返回 `failed` 的 `200`）、`400 INVALID_PAYLOAD`、"无效载荷 0 行写入"、`publish/draft` / `publish/verify` / `publish-facts.ts` 全部未改；未改数据库 schema；无任何自动重试；未 `git add` / `git commit`；未执行真实发布。

**待办（不阻塞本卡）**：M1–M4 手工核对与阶段 D 的"开发态 / 打包态冒烟"（R4）需要真实运行的应用；真实平台发布成功分支仍需凭据与授权（§6 的停止条件之一，不计入本卡未完成）。

