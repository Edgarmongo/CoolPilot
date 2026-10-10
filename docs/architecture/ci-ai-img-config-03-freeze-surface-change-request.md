# CI-AI-IMG-CONFIG-03 冻结面改动申请（**已批准并实施**）

> **状态**：**已批准并实施**（F1 / F3 获批；D-1 按提案裁决 = Q4：未配置图片 URL 时**明确失败、不回退**文本端点）。实施内容、实际改动行号与验证结果见 **`docs/architecture/ci-ai-img-config-03-delivery.md`**。此行是实施后追加的**事实标注**，§0~§7 的申请正文**未改写**。
> **依据**：`.clinerules/01-coolpilot.md` §4（冻结面：AI Runtime 不得旁路新建调用路径；确需改时先单独说明原因并等待批准）。
> **前置**：CI-AI-IMG-CONFIG-02 已完成配置层（见 `docs/architecture/ci-ai-img-config-02-delivery.md`）；本卡是设计文档 `independent-image-provider-configuration.md` §8 的**阶段 2**。
> **目标**：让图片请求真正打到独立端点、用独立 Key、记独立 providerId —— 即把 CI-AI-IMG-CONFIG-02 存下来的字段变成真实生效的路由。

## 0. 为什么非改冻结面不可

配置已就位，但**决策点仍然全部落在冻结面之内**：

| 事实（含证据） | 说明 |
| --- | --- |
| `registry.ts:73-93` `seedLegacyProviders` 只遍历 `aiProviderOrder`（`provider-registry.ts:59` = gemini/groq/openai/openrouter），为每个文本 provider 建 `${providerId}/default` 端点，`baseUrl: resolveProviderBaseUrl(providerId, settings)`（`:89`）、`credentialRef: credentialRefFor(providerId)`（`:90`） | **没有 `openai-image` 这个 provider/端点** → `openAIImageBaseUrl` 无处可挂 |
| `registry.ts:560-568` `importLegacyAiSettings` 把图片模型绑到**文本** providerId：`ensureLegacyModel({ providerId, … , capability: "image_generation" })`（`:566`），`providerId ∈ {gemini, openai}` | 图片模型行挂在 `openai/default` 上 → 与文本共用端点 |
| `registry.ts:526-527` `ensureLegacyModel` 只按 `${providerId}/default` 取端点 | 端点由 provider 推导，"按能力绑不同端点"当前**无法表达** |
| `registry.ts:578-587` 图片默认取 `settings.imageProvider ?? "openai"` | 默认指向文本 provider |
| `image-generation.ts:59` `const providerId = input.provider ?? settings?.imageProvider ?? "openai";`（`:83-87` 传给 `aiRuntime.generateImage`） | 图片**唯一调用点**传的是文本 providerId → 与冻结面 F3 相接 |

结论：不改 `registry.ts`（F1）与 `image-generation.ts`（F3），图片独立路由**在架构上无处落地**。故提出本申请。

---

## 1. 申请批准的改动（F1 / F3 为核心）

### 1.1 C1 —— `src/features/ai-runtime/registry.ts`（对应 F1）

**C1a. `seedLegacyProviders`（`:73-93`）增建图片 provider/端点**

在既有文本 provider 循环**之后**追加（不改动原循环）：

| 字段 | `openai-image` | `gemini-image` |
| --- | --- | --- |
| `providerId` | `imageProviderIdFor("openai")` = `openai-image` | `imageProviderIdFor("gemini")` = `gemini-image` |
| `name` | `legacyProviderNames` 新增键（如 "OpenAI (image)"） | 同（如 "Gemini (image)"） |
| `endpointId` | `openai-image/default` | `gemini-image/default` |
| `protocol` | `openai-compatible`（`contracts.ts:76` 已有，**无需扩枚举**） | `gemini`（同上） |
| `baseUrl` | `settings.openAIImageBaseUrl`（见 §2 待决 D-1） | `resolveProviderBaseUrl("gemini", settings)` —— Gemini 无独立 URL，Q2 结论 |
| `credentialRef` | `credentialRefFor("openai-image")` | `credentialRefFor("gemini-image")` |

`aiProviderOrder`（文本顺序）**不动**；图片 provider 的 sortOrder 另给（避免打乱既有分组）。

**C1b. `importLegacyAiSettings`（`:549-568`）把图片模型导到图片 provider**

- `:560` 的循环改为按 `imageProviderIdFor(providerId)` 解析目标 provider；
- `:566` 变成 `ensureLegacyModel({ providerId: imageProviderIdFor(providerId), modelId, capability: "image_generation" })`；
- `:578-587` 图片默认改为 `entry.providerId === imageProviderIdFor(settings?.imageProvider ?? "openai")`。

**C1c. `ensureLegacyModel`（`:513-547`）：提案是「不改」**
它已按 `${providerId}/default` 取端点（`:526-527`）。只要 C1a 建好了 `openai-image/default`，传 `providerId: "openai-image"` 即自然命中该端点 —— 因此**无需引入"按能力绑端点"的新概念**，冻结面改动更小。

### 1.2 C2 —— `src/lib/agent/image-generation.ts`（对应 F3）

只改一个映射（`:59`）：

```
- const providerId = input.provider ?? settings?.imageProvider ?? "openai";
+ const providerId = imageProviderIdFor(input.provider ?? settings?.imageProvider ?? "openai");
```

于是 `:75` 的预算身份与 `:83-87` 的 `aiRuntime.generateImage({ providerId })` 都拿到 `openai-image` / `gemini-image`。

**必须声明的连带影响（不能算"顺带"）**：

1. **账本可见变化**：图片调用的 `ai_usage_ledger` / `usage_records` 行的 `provider` 由 `openai` 变为 `openai-image`。这是**正确的**（规则 §5：账本记录真实执行的 provider），但属**可见数据变化**，需批准。
2. **历史行不重写**：已存在的 `provider='openai'` 图片行保持原样（与 `docs/generate-migration.md` D5 一致）。
3. **硬 pin 语义不变**：仍是一 provider 宽（D-P3-2），不新增失败转移。

### 1.3 C3 —— 数据迁移（F5，可选、按结果定）

- 若只做 C1/C2：新 provider/端点由 seed 建，**无需 DDL**（`ai_model_providers` / `ai_model_endpoints` / `ai_models` 都是既有表）。
- 旧图片模型行（挂 `openai/default`）**保留不动**（设计文档 §6.2「只增不改」）。
- 因此提案：**F5 暂不实施**；若评审要求把旧行显式标为 `disabled`，再单独申请。

---

## 2. 必须先定的决策点（阻塞实施）

### D-1 未配置 `openAIImageBaseUrl` 时的行为 —— 两处结论冲突，需裁决

| 来源 | 主张 |
| --- | --- |
| 用户已确认的 **Q4**（CI-AI-IMG-CONFIG-02） | **不继承**文本 Base URL；未配置则**明确失败** |
| 设计文档 §6.3 / §6.4（`:296-307`） | 允许**有条件回退**到用户自己的 `settings.openAIBaseUrl`，并在运行时与 UI 标注"共用端点" |

**提案：以已确认的 Q4 为准（无回退）**。理由：不继承才能保证"文本正常、图片静默调错端点"这个核心风险（§6.6）不会以"回退"为名复现。

若采纳，则 C1a 中 `openai-image` 端点的 `baseUrl` 在 `openAIImageBaseUrl` 为空时取 `""`，并由 `resolveRoute` 以真实结构化错误拒绝（`MODEL_CREDENTIAL_MISSING` 类语义）而不是打文本端点。

> ⚠️ 这意味着**设计文档 §6.3/§6.4 需要相应改版**。按规则 §1，本申请**不自行修改**该文档，请裁决后由持卡人改。

### D-2 图片 provider 的 `protocol` 与能力声明

`openai-image` 只声明 `image_generation`（设计文档 §5.4：一个 provider 只声明真实具备的能力），**不得**出现在文本候选里。

---

## 3. 不改动清单（明确承诺）

- `recordPublishSuccess` 写入顺序与 C2 发布语义（规则 §4）；
- `resolveRoute` 的候选排序语义 —— C2 在"调用方传 providerId"处完成映射，**路由零改动**；
- `contracts.ts`（对应 F2）—— 本次提案**不需要改**：`modelCapabilities` 已含 `image_generation`（`contracts.ts:17`），`modelProtocols` 已含 `openai-compatible` 与 `gemini`（`:76`），且 providerId 在契约里就是自由字符串（无 `ProviderId` 联合类型）；
- 文本 provider 的 seed/import/默认值路径；
- 已关闭的 P0 结论与 P1 Card 1 结论。

---

## 4. 实施后的验证计划

| 类别 | 项目 |
| --- | --- |
| 单测（新增） | `registry`：seed 后存在 `openai-image/default`，`baseUrl` 来自 `openAIImageBaseUrl`、`credentialRef` 为 `credential://openai-image/default`；`importLegacyAiSettings` 把 `openAIImageModel` 导到 `openai-image` 且 `image_generation` 默认指向它 |
| 单测（回归必须绿） | `src/app/api/images/route.test.ts`（图片硬 pin 语义）、`provider-registry.test.ts`、`settings-validation.test.ts`、`runtime.test.ts` |
| 端到端 | 设计文档 §9.3：文本 provider≠图片 provider、URL 与 Key 都不同时，`POST /api/images` 打到**图片**端点（真实 HTTP 需授权与额度） |
| 账本 | 图片调用行 `provider='openai-image'`、`cost_source` 仍为 `unpriced`/NULL 而非 0（规则 §5） |
| 泄漏 | 日志 / 账本 / 错误详情中无 key（复用既有断言） |
| 全量 | `node_modules\.bin\tsc.cmd --noEmit`、`vitest.cmd run`、`eslint.cmd .` |

> 已知既有失败（与本卡无关、不作为判据）：`src/worker/runner.test.ts` 2 例 `paused vs failed`（见 CI-AI-IMG-CONFIG-02 交付记录 §3.1）。

## 5. 回滚方案

C1a 是**纯增量**（新建 provider/端点行），C1b/C2 是**两处映射**。回滚 = 还原 C1b/C2 两处代码 + 清理（或禁启用）`openai-image` / `gemini-image` 两行 provider 及其端点与模型行。
因为不修改、不删除任何既有行，回滚**不会破坏文本路径**，也**不动** `app_settings` 中的已存字段（`openAIImageBaseUrl` 等保留，回到"存了但不生效"的 CI-AI-IMG-CONFIG-02 状态）。

## 6. 风险与缓解

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | UI 上多出一个 provider，用户困惑 | `listProviderViews()` 会显示 `openai-image`；UI 文案沿用 CI-AI-IMG-CONFIG-02 的"已切换"表述（本卡落地后 hint 需同步改为已生效，属本卡范围） |
| R2 | 旧图片模型行（挂 `openai/default`）与新建行并存 | 硬 pin 只解析 `openai-image`，旧行不可达；旧行保留不删（§6.2） |
| R3 | `provider` 字段值变化影响按 provider 的统计 | 属正确行为（§1.2-1），在交付记录中明示 |
| R4 | 无 `openAIImageBaseUrl` 的升级用户图片直接失败 | 这是 D-1 的**预期**结果（Q4）；UI hint 与运行时错误共同说明原因，不伪造成功 |
| R5 | seed 在请求路径上重复执行 | 既有 seed 已幂等（`upsertModelProvider`/`upsertModelEndpoint`），本提案不改变调用时机 |

## 7. 批准请求

| 项 | 内容 | 请求 |
| --- | --- | --- |
| **F1** | `src/features/ai-runtime/registry.ts`（C1a + C1b，`ensureLegacyModel` 不改） | **请批准** |
| **F2** | `src/features/ai-runtime/contracts.ts` | **无需改动**（见 §3） |
| **F3** | `src/lib/agent/image-generation.ts`（C2，一处映射 + 账本 provider 值变化） | **请批准** |
| **D-1** | 未配置图片 URL 时"明确失败 vs 有条件回退" | **请裁决**（提案：Q4，明确失败） |
| F5 | `src/db/client.ts` 迁移 | 提案**暂不实施**（§1.3） |

**未获批准前，本次不实施任何一行改动，也不会顺带修改冻结面。**

---

## 附录：本申请引用的工作区基线

- 证据行号基于当前工作区（CI-AI-IMG-CONFIG-02 交付后）。
- 引用到的既有格式：`credentialRefFor`（`src/lib/credentials.ts:94`）、`credentialEnvVarNames`（`:113-116`）、`imageProviderIds` / `imageProviderIdFor`（`src/features/ai-settings/provider-registry.ts:107-114`）。
