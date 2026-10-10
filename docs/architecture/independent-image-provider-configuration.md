# CI-AI-IMG-CONFIG-01 文本与图片模型独立配置 —— 审计与设计

> **文档性质**：内部设计稿（design notes），不是用户文档。用户文档见 `README.md` / `README.zh-TW.md`。
>
> **卡片**：CI-AI-IMG-CONFIG-01（只读审计与设计）。
>
> **基线**：`main` @ `3b48126b34ec4472f8b1ee904f651d35b30b3072`（工作区含大量未提交改动；本文所有结论**只以该工作区实际代码为准**，不以文档声称的功能为准）。
>
> **本卡边界**：本文档**不修改业务代码、不修改数据库、不执行迁移、不触碰 `src/features/ai-runtime` 冻结面**。凡涉及冻结面的改动都在 §7 单独列出，等待批准。

---

## 0. 结论摘要（TL;DR）

1. **问题确认**：截图现象成立。文本与图片（"相容 OpenAI" 路径）**共用同一份 Base URL 与同一把 API Key**；图片侧只有"模型 id"和"尺寸"是独立的。用户把文本 provider 指向纯文本服务（如 `https://api.deepseek.com`）后，图片段会显示并**实际使用**同一个 URL，图片请求最终打到 `https://api.deepseek.com/images/generations`，必然失败。标注所说"模型和 url 应可独立配置"中，**url 与 key 确实没有独立**。
2. **根因是数据模型，不是 UI**：`LocalAgentSettings`（`src/lib/types.ts:1144-1158`）只有一组 `openAIBaseUrl`；`providerId` 也只有 `openai` 一个。文本与图片在**身份层（providerId）、凭据层（credentialRef）、端点层（`openai/default` 的 baseUrl）**三处完全重合，UI 只是如实反映了这一点。
3. **Gemini 侧不共用 Base URL**：`gemini` 的 `supportsCustomBaseUrl=false`（`provider-registry.ts:28`），Base URL 只能来自 `GEMINI_BASE_URL` 或默认 `https://generativelanguage.googleapis.com`，文本与图片本来就同源（Google 同一 API host 同时提供文本与图片）。**但 Gemini 文本与图片共用 `geminiKey`**；且 Gemini 图片模型无法通过 UI 独立配置 URL。方案 C 因此要回答"Gemini 是否真的需要 URL 字段"，而不是照搬 OpenAI 兼容的字段。
4. **另有一处既有事实必须写清**：`settings.openAIImageModel` / `geminiImageModel` 只在**首次种子**（`ensureModelRuntimeSeeded`，`seedVersion` 标记，每安装一次）经 `importLegacyAiSettings()` 变成模型行与能力默认；此后在表单里改这两个字段**不会改变路由**（`/api/settings/ai` POST 只写设置，不重跑导入）。即当前表单里的"图片模型"实际上是**一次性种子输入**，不是实时路由开关。设计若只加字段而不改这条链路，"独立配置模型"在运行时依旧不生效。
5. **推荐方案：B（分层方案）+ C 的 Gemini 结论** —— 为图片引入独立 **Provider 身份**（`providerId`）、独立 **端点**（baseUrl）与独立 **凭据引用**；Gemini 图片复用同一 provider 但显式声明"URL 不可配、Key 可独立"，避免造一个 Gemini 用不上的 URL 字段。完整理由见 §3/§4。
6. **需要批准的冻结面**：`src/features/ai-runtime/registry.ts`（种子/导入/路由）、以及与其耦合的 `src/features/ai-runtime/contracts.ts`、`src/lib/agent/image-generation.ts`。清单见 §7。

---

## 1. 现状证据及文件位置

以"UI 字段 → 设置持久化 → 种子 → 路由 → 适配器 → HTTP"为序，逐层给出实际代码位置。

### 1.1 设置数据类型与默认值

| 证据 | 文件:行 | 事实 |
| --- | --- | --- |
| 文本 provider 枚举 | `src/lib/types.ts:1132` | `LocalAIProvider = "gemini" \| "groq" \| "openai" \| "openrouter"` |
| 图片 provider 枚举 | `src/lib/types.ts:1133` | `LocalImageProvider = "gemini" \| "openai"` |
| 设置结构 | `src/lib/types.ts:1144-1158` | 一组 `openAIBaseUrl`、一组 `openAIModel`；图片侧只有 `openAIImageModel` + `openAIImageSize`；**无** `openAIImageBaseUrl`，**无**图片专用 key 字段 |
| 默认值 | `src/db/repositories/settings.ts:35-55` | `openAIBaseUrl:"https://api.openai.com/v1"`、`openAIImageModel:""`、`openAIImageSize:"1024x1024"`；同样只有一组 openai 配置 |
| 读取/合并 | `src/db/repositories/settings.ts:87-119` | `parseLocalAgentSettings` 浅合并默认值；`updateLocalAgentSettings` 逐字段 patch，无按能力拆分的逻辑 |

### 1.2 校验与保存

| 证据 | 文件:行 | 事实 |
| --- | --- | --- |
| 校验 schema | `src/lib/validation.ts:258-282` | 只允许 `openAIBaseUrl`（单个）、`openAIImageModel`、`openAIImageSize`；不存在图片 base URL / 图片 key 字段，超出字段会被 zod 丢弃 |
| GET 返回 | `src/app/api/settings/ai/route.ts:10-25` | 返回设置 + 四个 provider 的**掩码** key（`geminiKey/groqKey/openAIKey/openRouterKey`） |
| POST 保存 | `src/app/api/settings/ai/route.ts:36-50` | `openAIKey` 一律写入 provider **`"openai"`**（`writeProviderKey("openai", …)`），随后 `updateLocalAgentSettings(settingsPatch)`；**不触发** `importLegacyAiSettings` |

### 1.3 UI（截图对应组件）

| 证据 | 文件:行 | 事实 |
| --- | --- | --- |
| 文本 provider 选择 | `src/components/system/model-config-panel.tsx:178-186` | `SelectField<LocalAIProvider>`，写 `form.textProvider` |
| 文本 openai 分支 | `src/components/system/model-config-panel.tsx:217-238` | 渲染 `form.openAIKey` + `form.openAIBaseUrl` + 文本模型 |
| 图片 provider 选择 | `src/components/system/model-config-panel.tsx:264-273` | `SelectField<LocalImageProvider>`，写 `form.imageProvider` |
| 图片 openai 分支 | `src/components/system/model-config-panel.tsx:274-303` | **复用** `form.openAIKey`（`:280`）与 `form.openAIBaseUrl`（`:288`），只额外提供 `openAIImageModel` 与 `openAIImageSize` |
| 图片 gemini 分支 | `src/components/system/model-config-panel.tsx:304-317` | 复用 `form.geminiKey` + `geminiImageModel`；**没有** URL 字段 |
| 图片模型取值 | `src/components/system/model-config-panel.tsx:154-163` | `imageProvider==="gemini" ? geminiImageModel : openAIImageModel` |

> 这一层就是截图：同一屏里"文字 provider"与"图片 provider"都显示 `openAIBaseUrl` 的值，因为它们是同一个 state 字段。



### 1.4 端点解析与运行时种子

| 证据 | 文件:行 | 事实 |
| --- | --- | --- |
| provider 元数据 | `src/features/ai-settings/provider-registry.ts:20-57` | `gemini.supportsCustomBaseUrl=false`；`openai/openrouter=true` |
| Base URL 解析 | `src/features/ai-settings/provider-registry.ts:65-74` | `resolveProviderBaseUrl("openai")` → `settings.openAIBaseUrl`（唯一来源）；`gemini` 只读 `GEMINI_BASE_URL` |
| 模型解析 | `src/features/ai-settings/provider-registry.ts:76-91` | 只有文本模型；**不存在** `resolveImageProviderModel` |
| 种子 provider + 端点 | `src/features/ai-runtime/registry.ts:73-93` | 每个 `LocalAIProvider` 建**一个** `${providerId}/default` 端点，`baseUrl=resolveProviderBaseUrl(...)`、`credentialRef=credentialRefFor(providerId)`。openai 文本与图片命中同一行 |
| 种子标记 | `src/features/ai-runtime/registry.ts:159-174` | `seedVersion=2`；仅当标记版本落后时执行 `seedLegacyProviders` + `importLegacyAiSettings`，**每次安装只跑一次** |
| 旧设置导入 | `src/features/ai-runtime/registry.ts:549-604` | 文本模型来自 `resolveProviderModel`；图片模型来自 `settings.geminiImageModel` / `settings.openAIImageModel`（`:560-568`）；图片默认能力的 `providerId = settings.imageProvider`（`:578-587`） |
| 旧模型行绑定端点 | `src/features/ai-runtime/registry.ts:513-547` | `ensureLegacyModel` 把模型行绑到 `${input.providerId}/default`（`:526-528`），即 openai 图片模型也挂在 `openai/default` 上 |

### 1.5 路由与适配器（HTTP 真正发生的地方）

| 证据 | 文件:行 | 事实 |
| --- | --- | --- |
| 图片调用点 | `src/lib/agent/image-generation.ts:54-93` | `providerId = input.provider ?? settings.imageProvider ?? "openai"`（硬 pin，`:59`）；`size = settings.openAIImageSize`（`:86`）；**不传 model**，模型由路由解析 |
| 路由 | `src/features/ai-runtime/registry.ts:326-448` | 按能力筛选模型 → 绑定 provider/endpoint → 校验 `endpoint.credentialRef` 有 key → 排序返回候选 |
| 图片链收窄 | `src/features/ai-runtime/runtime.ts:133-141` | `candidateChain`：有 pin 时 `candidates.slice(0,1)`，故图片**不跨 provider 故障转移** |
| 图片执行 | `src/features/ai-runtime/runtime.ts:292-345` | resolve → 取 adapter → `adapter.generateImage({ model, prompt, size })`，credential 由 key pool 注入 |
| 适配器上下文 | `src/features/ai-runtime/adapters.ts:27-32,118-127` | adapter 只拿到 `context.endpoint.baseUrl` 与 `context.credential`；**不读数据库、不读环境** |
| OpenAI 兼容图片 | `src/features/ai-runtime/adapters.ts:370-412` | POST `${baseUrl}/images/generations`，`Authorization: Bearer <credential>` |
| Gemini 图片 | `src/features/ai-runtime/adapters.ts:597-602` | POST `${geminiApiRoot(baseUrl)}/models/{model}:generateContent?key=<credential>` |

### 1.6 凭据与存储

| 证据 | 文件:行 | 事实 |
| --- | --- | --- |
| 凭据引用 | `src/lib/credentials.ts:94-98` | `credentialRefFor(providerId) = credential://<slug>/default`；slug 由 providerId 规范化 |
| 环境变量名 | `src/lib/credentials.ts:112-116` | `<SLUG>_API_KEYS` / `<SLUG>_API_KEY`（slug 大写、`-`→`_`） |
| 读取顺序 | `src/lib/credentials.ts:139-156` | 先加密 vault，再环境变量；**一个 credential 可含多把 key**（轮换单位） |
| .env 写入 | `src/lib/secrets.ts:34-39,139-141` | `writeProviderKey` 写 `<PROVIDER>_API_KEYS` |
| 表结构 | `src/db/schema.ts:313-357` | `ai_model_providers` / `ai_model_endpoints`（含 `base_url`、`credential_ref`、`unique(endpoint_id)`）/ `ai_models`（含 `endpoint_id`）/ `ai_model_capabilities` / `ai_model_preferences` |

### 1.7 已有测试锚点（现状被冻结的部分）

| 证据 | 文件 | 事实 |
| --- | --- | --- |
| 图片路由契约 | `src/app/api/images/route.test.ts`（头注 `:18-24`，用例 `:156`/`:228`/`:304`） | 明确冻结"图片 provider 是硬 pin，不是偏好"；断言 201 信封、落盘文件、尺寸随请求传递 |
| 设置校验 | `src/lib/agent/settings-validation.test.ts:9-30` | 断言 `imageProvider:"gemini"`、`openAIImageModel`、`openAIImageSize` 可解析 |
| provider 元数据 | `src/features/ai-settings/provider-registry.test.ts` | 断言 `openrouter.supportsCustomBaseUrl===true`、`gemini.modelEnv`、`openAIBaseUrl` 覆盖 |
| 文章配图 facade | `src/lib/article-images.test.ts:168` | 用 `updateLocalAgentSettings({ imageProvider:"openai", openAIImageSize:"1024x1024" })` 固定图片路径 |
| 测试夹具 | `src/test/route-harness.ts:104-121` | `prepareChatModel` / `prepareImageModel`（后者建图片凭据 + `image_generation` 默认能力） |

---


## 2. 真实调用链

以实际代码为序，列出两条链路上"谁读了什么"。这是判断"独立配置"到底要改哪一层的事实依据。

### 2.1 文本（chat）链

```
UI(model-config-panel)  form.textProvider / openAIBaseUrl / openAIModel / <provider>Key
  → POST /api/settings/ai          (validation.localAgentSettingsSchema; writeProviderKey; updateLocalAgentSettings)
  → app_settings['local-agent']    (单份 LocalAgentSettings)
  → ensureModelRuntimeSeeded()     (首次) seedLegacyProviders → 端点 <providerId>/default.baseUrl = resolveProviderBaseUrl(providerId, settings)
                                   (首次) importLegacyAiSettings → 文本模型行 + chat 默认能力
  → resolveRoute({ capability:"chat" })  → 端点候选
  → runWithCredentialKey(endpoint.credentialRef)  → key pool 选一把 key
  → adapter(context{endpoint.baseUrl, credential}) → POST {baseUrl}/chat/completions
```

关键事实：文本与图片**唯一的分叉点是 capability 与默认模型**，端点是同一个（openai 时）。

### 2.2 图片（image_generation）链（现状）

```
UI(model-config-panel)  form.imageProvider / openAIImageModel / openAIImageSize / openAIBaseUrl(与文本共用) / openAIKey(与文本共用)
  → POST /api/settings/ai          (只写设置；**不重跑导入**)
  → app_settings['local-agent']
  → ensureModelRuntimeSeeded()     (首次) 图片模型行挂在 <imageProvider>/default 端点
  → lib/agent/image-generation.ts  providerId = settings.imageProvider（硬 pin），size = settings.openAIImageSize
  → aiRuntime.generateImage({ prompt, providerId, size })
  → resolveRoute({ capability:"image_generation", providerId })  → 候选链收窄为 1
  → adapter(context{endpoint.baseUrl, credential}) → POST {baseUrl}/images/generations（OpenAI 兼容）
```

**缺陷点**：`endpoint.baseUrl` 来自 `openai/default`，而那一行由 `resolveProviderBaseUrl("openai") = settings.openAIBaseUrl` 写入。**文本与图片共用同一 baseUrl 与同一 credentialRef**，即 §0.1 的现象。图片"独立"的部分只有"模型 id"（且只影响首次种子）与"尺寸"。

### 2.3 Gemini 链（对比）

Gemini 无 `settings.geminiBaseUrl`；端点 baseUrl = `GEMINI_BASE_URL` 或默认 host，故**文本与图片 URL 天然相同且不可配**，共用 `credential://gemini/default`。差异仅在 `:generateContent` 的 body（`responseModalities`）。方案 C 的正确落点是"**Gemini 图片是否需要可配 URL**"这一产品问题，而不是实现问题。

---

## 3. 方案 A / B / C 比较

### 方案 A：独立图片 Base URL，共用 API Key

- **做法**：新增 `openAIImageBaseUrl`；为图片建一个独立端点（baseUrl=该字段），`credentialRef` 仍指向 `credential://openai/default`。
- **改动面**：`types.ts` / `validation.ts` / `settings.ts` 默认值 / `model-config-panel.tsx` / `registry.ts`（种子 + 导入）/ 可能 `image-generation.ts`（providerId 映射）。
- **优点**：最小，解决"DeepSeek 文本 + 独立图片服务"这一主诉；文本用户配置零迁移。
- **残留耦合**：Key 仍共用。文本 key 与图片 key 若不是同一把（如 DeepSeek key 与 OpenAI key 不同），**仍然不可行** —— 而这恰是截图场景（文本 key 属于 DeepSeek，图片需要另一把 key）。
- **结论**：**不足以覆盖真实场景**。用户在 DeepSeek 场景下几乎没有理由用 DeepSeek 的 key 去调 OpenAI 图片接口。

### 方案 B：OpenAI 兼容图片的 URL + Key + 模型全独立

- **做法**：引入独立 **Provider 身份** `openai-image`（或等价"图片专用 provider"），拥有：
  - 独立 `providerId` → 独立端点 `openai-image/default`；
  - 独立凭据引用 `credential://openai-image/default`（vault / `OPENAI_IMAGE_API_KEYS`）；
  - 独立 baseUrl（`openAIImageBaseUrl`）；
  - 图片模型行挂在该 provider 下。
- **改动面**：类型/校验/默认值/UI、`registry.ts` 的种子与导入、`image-generation.ts` 的 providerId 映射、凭据写入口、`/api/settings/ai`、测试与迁移。
- **优点**：身份、凭据、路由、故障隔离四处一致（满足 §4 约束 4）；文本 key 与图片 key 真正解耦；与 Local-first / 数字主权方向一致（用户自带两套凭据）；可扩展到社区 provider。
- **代价**：触及冻结面；需要旧数据迁移；`ensureLegacyModel` 目前把模型硬绑 `${providerId}/default`，需要按能力选择端点（或为图片 provider 单独建默认端点）。
- **结论**：**推荐**（见 §4）。

### 方案 C：OpenAI 兼容 + Gemini 统一纳入独立配置体系

- **做法**：在 B 之上，为 Gemini 图片也定义"独立 provider 身份 + 独立 key"。**但不照搬 URL 字段**，因为 Gemini 的 URL 由 SDK/host 决定。
- **需要先回答的产品问题**（见 §10）：Gemini 文本与图片是否允许使用**不同**的 API Key？若允许，需 `credential://gemini-image/default`；若不允许，则 Gemini 图片的"独立"仅体现在模型选择，UI 应显式说明"共用 Key"而不是给一个假的独立感。
- **结论**：**作为 B 的延伸采纳其结论**；URL 字段仅对 `openai-compatible` 协议存在，Gemini 用"Key 是否独立"表达，避免造无效字段。

### 3.1 对照表

| 维度 | A | B | C（B + Gemini 结论） |
| --- | --- | --- | --- |
| 独立 Base URL | ✅ | ✅ | ✅（仅 openai-compatible） |
| 独立 API Key | ❌ | ✅ | ✅（可选，Gemini 待定） |
| 独立 Provider 身份 | ❌ | ✅ | ✅ |
| 解决截图场景（DeepSeek 文本 + 独立图片） | ⚠️ 部分（Key 仍不通） | ✅ | ✅ |
| 故障隔离（文本 key 失效不牵连图片） | ❌ | ✅ | ✅ |
| 旧数据迁移风险 | 低 | 中 | 中 |
| 触及冻结面 | 是 | 是 | 是 |
| 测试成本 | 低 | 中高 | 高 |
| 扩展性（社区 Provider / Marketplace） | 弱 | 强 | 强 |

---


## 4. 推荐目标架构

**原则**：文本与图片是两种**能力**，可以由同一个或不同的**provider 端点**承担；"独立配置"指**端点与凭据可独立**，而不是强制拆成两家厂商。

### 4.1 概念分层（与现有运行时一致）

| 层 | 文本 | 图片（目标） |
| --- | --- | --- |
| capability | `chat` 等 | `image_generation` |
| provider 身份 | `gemini` / `groq` / `openai` / `openrouter` | `openai-image`（新）/ 或复用 `gemini` |
| endpoint | `<providerId>/default` | `<providerId>/default`（baseUrl 独立） |
| credentialRef | `credential://<providerId>/default` | `credential://<providerId>/default`（独立 slug） |
| 模型行 | `ai_models.providerId` + `endpoint_id` | 同左（挂到图片 provider） |

### 4.2 目标映射规则

1. `settings.imageProvider` 从"直接当 `providerId`"改为**经映射表**得到 `providerId`：
   - `"openai"` → `"openai-image"`（当 `openAIImageBaseUrl` 与文本 `openAIBaseUrl` 不同或图片 key 独立时）；
   - `"gemini"` → `"gemini"`（若确认共用 key）。
2. 映射表是**显式且可测**的（放在 `provider-registry.ts` 或 runtime 的合规层），不得散落在 UI。
3. 若 `openAIImageBaseUrl` 为空 → 回退到文本 `openAIBaseUrl` 且**显式标记"与文本共用"**（回退条件见 §6.4），不得静默拼接一个未知端点。
4. `image-generation.ts` 只负责"capability + 用户选的图片 provider → providerId"，不再自己读 baseUrl（保持冻结面 §4：所有模型调用经 runtime）。

### 4.3 Gemini 的结论

- URL：Gemini 不提供自定义 URL（`supportsCustomBaseUrl=false` 已固化）。
- Key：是否独立是**产品决策**（§10）。若"独立"，新增 `gemini-image` provider + `credential://gemini-image/default`；若"共用"，UI 明确标注"与 Gemini 文本共用密钥"。
- 无论哪种，**不得**为 Gemini 造一个无效的 Base URL 输入框。

---

## 5. 配置数据结构与凭据引用设计

> 以下为**设计提案**，本卡不实现。

### 5.1 新增设置字段（草案）

```ts
// src/lib/types.ts（草案，待批准后才改冻结面之外的文件）
export type LocalImageProvider = "gemini" | "openai"; // 保持不变（用户选择不变，映射在运行时）

export interface LocalAgentSettings {
  // ...现有字段...
  /** 图片专用 OpenAI 兼容端点；为空表示与文本共用 openAIBaseUrl（见 §6.4）。 */
  openAIImageBaseUrl: string;   // 新增
  /** 图片专用文本模型；语义从"一次性种子输入"改为"实时路由默认"（见 §8 阶段 2）。 */
  openAIImageModel: string;     // 已存在，语义调整
  openAIImageSize: string;      // 已存在
}
```

### 5.2 凭据引用（草案）

| provider 身份 | credentialRef | vault key | 环境变量（回退） |
| --- | --- | --- | --- |
| `openai`（文本） | `credential://openai/default` | `openai/default` | `OPENAI_API_KEYS` / `OPENAI_API_KEY` |
| `openai-image`（图片） | `credential://openai-image/default` | `openai-image/default` | `OPENAI_IMAGE_API_KEYS` / `OPENAI_IMAGE_API_KEY` |
| `gemini`（文本/图片，待定） | `credential://gemini/default` | `gemini/default` | `GEMINI_API_KEYS` |

- 环境变量名由现有 `credentialEnvVarNames(slug)` 规则自动推导，**无需新增映射表**（`openai-image` → `OPENAI_IMAGE_API_KEYS`）。
- 密钥写入：`/api/settings/ai` 的 POST 需按 provider 分派（`openAIKey` → `openai`，新增 `openAIImageKey` → `openai-image`）。**掩码占位符（含 `*`）永不落库**（沿用 `writeProviderKey` / `writeCredential` 现有规则）。
- 安全：key 仅出现在请求内存与加密 vault；账本/日志/错误详情不得出现（沿用 §4 规则 5、§6 隐私默认值）。

### 5.3 端点与模型行

| 记录 | 文本 | 图片 |
| --- | --- | --- |
| `ai_model_providers.provider_id` | `openai` | `openai-image` |
| `ai_model_endpoints.endpoint_id` | `openai/default` | `openai-image/default` |
| `.base_url` | `settings.openAIBaseUrl` | `settings.openAIImageBaseUrl`（空则回退文本，§6.4） |
| `.credential_ref` | `credential://openai/default` | `credential://openai-image/default` |
| `.protocol` | `openai-compatible` | `openai-compatible` |
| `ai_models.provider_id` / `endpoint_id` | `openai` / `openai/default` | `openai-image` / `openai-image/default` |
| `ai_model_capabilities` | `chat`… | `image_generation` |

### 5.4 身份与能力一致性（约束 4）

- 一个 provider 身份**只声明它真实具备的能力**：`openai-image` 的能力目录来自其 endpoint 协议与模型清单，不得复用文本 provider 的能力投票。
- 图片模型行**只能**挂到图片 provider；文本模型行不得挂到 `openai-image`（否则"文本失败转移回落到图片端点"会变成新的静默错误）。

---


## 6. 旧数据迁移与兼容策略

> 只描述方案，本卡不执行。迁移的实现必须走 `src/db/client.ts` 的既有 `ALTER TABLE ... catch` 模式（如 `:656-701` 及价格目录迁移 `:926+`），**不新增重型迁移框架**。

### 6.1 旧文本 Base URL 与 Key 如何保留

- `settings.openAIBaseUrl` / `openAIKey` **原值不动**，继续服务文本。
- `ai_model_endpoints['openai/default']` **不修改**（保持既有 baseUrl 与 credentialRef）。
- 迁移**只增不改**：新增 `openai-image/default` 端点与 `openai-image` provider 行。

### 6.2 旧图片模型如何映射

| 旧状态 | 迁移决策 |
| --- | --- |
| 已有 openai 图片模型行（挂 `openai/default`） | 保留原行不动（只读兼容）；**另建** `openai-image` 下的模型行，仅在用户填入 `openAIImageBaseUrl` 后启用 |
| `settings.openAIImageModel` 非空 | 复制为 `openai-image` provider 下的模型行候选；**不删除**旧行 |
| `settings.imageProvider==="gemini"` | 不受影响（Gemini 路径不变） |

### 6.3 无法确定真实服务来源时如何处理

- 若用户从未配置 `openAIImageBaseUrl`（升级用户），**禁止**猜测其图片服务地址。
- 处理方式：`openAIImageBaseUrl` 为空 → 按 §6.4 回退到文本 baseUrl，但在**运行时与 UI 同时标注**"图片与文本共用端点"；若该端点不支持 `/images/generations`，图片调用以运行时真实错误（适配器 502/`MODEL_UPSTREAM_NO_CONTENT` 或路由 `MODEL_CAPABILITY_UNAVAILABLE`）失败，**不伪造成功**。
- **禁止**静默把旧图片模型指向某个"假设是 OpenAI 官方"的地址。

### 6.4 何时允许回退

回退仅在下述**全部**成立时：
1. `openAIImageBaseUrl` 为空字符串；且
2. 图片 provider 映射结果为 `openai-image` 但其端点无独立 baseUrl；且
3. 回退目标是**用户自己已配置的** `settings.openAIBaseUrl`（不是硬编码默认值）。

回退必须**可观测**：`resolveRoute` 的候选/视图层报告"图片端点为文本端点"这一事实，UI 显示提示。**不得**在用户显式配置了图片 URL 后仍回退。

### 6.5 凭据引用与模型注册的一致性

- 新端点创建时同步创建/保持 `describeCredential` 可解析的 credentialRef；`forgetCredentialKeys` 仅在凭据被清空时调用。
- 能力声明：迁移后 `openai-image` 只以 `image_generation` 能力出现在候选里；`ai_model_preferences['image_generation']` 若原指向旧行，迁移后**重指向**新 provider 的等价模型（存在则重指，不存在则保持旧行，避免悬空默认）。

### 6.6 避免"文本正常、图片仍静默调错端点"

- 这是本卡的核心风险。防线有三：
  1. **端点身份分离**：图片模型行挂在 `openai-image`，其 baseUrl 只来自 `openAIImageBaseUrl`；
  2. **可见性**：`listProviderViews()` 会把 `openai-image` 作为独立 provider 展示，用户能看到它的 URL 与实际状态；
  3. **失败显式**：共用/回退状态在 UI 提示，失败走运行时真实结构化错误，不落到"看起来成功的空图"。

---

## 7. 冻结面批准清单

依据 `.clinerules/01-coolpilot.md` §4 / `AGENTS.md`：

| # | 文件 | 冻结面 | 需要的改动（提案） | 理由 |
| --- | --- | --- | --- | --- |
| F1 | `src/features/ai-runtime/registry.ts` | AI Runtime | `seedLegacyProviders` 增建 `openai-image` provider/端点；`importLegacyAiSettings` 把图片模型导入到该 provider；`ensureLegacyModel` 支持按能力绑定端点 | 模型调用必须经 runtime；端点身份分离只能在种子层落地 |
| F2 | `src/features/ai-runtime/contracts.ts` | AI Runtime | 若新增 provider 身份常量/类型（如 `ProviderId` 扩展说明） | 契约与注册保持一致 |
| F3 | `src/lib/agent/image-generation.ts` | AI Runtime 邻接（图片唯一调用点） | `settings.imageProvider` → providerId 映射；解析 `openAIImageBaseUrl` 交给 runtime 而非自持 | 保持"调用方只说能力"的分层 |
| F4 | `src/lib/credentials.ts` / `src/lib/secrets.ts` | 凭据层（非冻结，但与冻结面耦合） | 新增 `openai-image` slug 的写入路径 | 由 `credentialEnvVarNames` 自动推导，改动应最小 |
| F5 | `src/db/client.ts` | 迁移 | 新增 `ALTER TABLE` 兼容逻辑（若字段落在 DB 而非 app_settings）| 沿用既有迁移模式 |

> **不改动**：`recordPublishSuccess` / C2 发布语义、P0/P1 已关闭结论（规则 §4）。`registry.ts` 的 `resolveRoute` 排序语义如无必要不动 —— 若映射在"调用方传 providerId"处完成，路由本身可零改动。

**批准请求**：请先批准 F1–F3（核心），F4/F5 视字段落地位置批准。

---


## 8. 分阶段实施计划

> 每阶段一张卡、测试先行（落在同一提交），与既有"一次一张卡"纪律一致。阶段之间不阻塞，但每阶段必须可独立验证。

### 阶段 1：字段与 UI 分离（不触 runtime）
- 新增 `openAIImageBaseUrl`（types/validation/defaults）；
- 图片 openai 分支渲染独立 URL 输入 + 独立 Key 输入（`openAIImageKey`）；
- `/api/settings/ai` 分派 key 写入；
- **此时运行时尚未消费新字段** → UI 明确标注"即将生效/需重启种子"？不 —— 见阶段 2 的语义修正，避免造出"改了不生效"的假开关。
- 验收：校验/保存/回读测试；无 runtime 改动；`tsc`/`eslint`/`vitest` 通过。

### 阶段 2：种子与身份分离（触冻结面 F1–F3）
- `registry.ts` 建 `openai-image` provider/端点；图片模型导入到该 provider；
- `image-generation.ts` 的 providerId 映射 + 实时读取图片模型（修正 §0.4 的"一次性种子"问题，或明确改为实时路由默认）；
- 迁移（F5）。
- 验收：§9 的矩阵全绿；真实 HTTP 冒烟（见 §9.3）。

### 阶段 3：Gemini 结论落地
- 依据 §10 的产品决策实现 Gemini 图片的 Key 独立性或"共用"标注。
- 验收：新增 Gemini 相关用例。

### 阶段 4：清理与文档
- 更新 `docs/generate-migration*.md` / `docs/model-runtime.md` / README 的模型配置说明；
- 若旧行确认无引用，评估是否标记废弃（**不删除**，遵循"不得未经论证重写旧数据"）。

---

## 9. 测试矩阵与验收标准

### 9.1 单元 / 集成矩阵

| # | 场景 | 断言要点 | 落点（建议） |
| --- | --- | --- | --- |
| T1 | 文本用 DeepSeek，图片用独立 OpenAI 兼容服务 | 文本请求打 `openAIBaseUrl`；图片请求打 `openAIImageBaseUrl`；两 URL 不同 | `registry`/`adapters`/`image-generation` 测试 + `api/images/route.test.ts` |
| T2 | 文本与图片使用不同 API Key | 文本请求 `Authorization` 为文本 key；图片为图片 key；两 credentialRef 不同 | 适配器存根捕获 header |
| T3 | Gemini 文本 + Gemini 图片独立配置 | 依据 §10 决策：Key 独立则两 credentialRef 不同；共用则 UI/API 明示共用 | `images/route.test.ts`（`:304` 扩展）、`settings-validation.test.ts` |
| T4 | 图片 URL / Key / 模型缺失 | 分别给出明确运行时错误（`MODEL_CREDENTIAL_MISSING` / 端点无效），**不**静默回退到文本端点（除非 §6.4 全条件成立） | `image-generation` + route 测试 |
| T5 | provider 不支持图片生成时拒绝路由 | `MODEL_CAPABILITY_UNAVAILABLE`，`details.requirement.capability==="image_generation"`（沿用 `route.test.ts:260/290/373`） | 已有用例回归 |
| T6 | 旧配置升级后文本仍可用 | 迁移后 `openai/default` baseUrl/credential 值不变；文本路由结果与迁移前一致 | `db/client.test.ts` 迁移用例 |
| T7 | 旧配置升级后图片行为明确 | 未配 `openAIImageBaseUrl` → 回退文本端点且**可见**；配了 → 使用新端点 | 迁移 + runtime 测试 |
| T8 | 凭据轮换 / 冷却 / 故障回退 / 实际 provider 身份 | 图片 key 轮换走 `openai-image` 的 key pool；`attempts`/`route` 记录真实 providerId | `key-pool`/`runtime` 测试 |
| T9 | API Key 不泄漏 | 日志、`ai_usage_ledger`、错误详情、非敏感导出中均无 key | 复用现有账本/隐私断言 |

### 9.2 回归护栏（必须保持绿）

- `src/app/api/images/route.test.ts`：图片硬 pin 语义（若 §4.2 改变"pin 到谁"，需**显式**更新该冻结断言并记录理由，不得机械翻转）。
- `src/lib/agent/settings-validation.test.ts`、`provider-registry.test.ts`、`article-images.test.ts`。
- `node_modules\.bin\tsc.cmd --noEmit` / `vitest.cmd run` / `eslint.cmd .` 全绿。

### 9.3 验收标准（阶段 2 完成时）

1. 截图场景可复现解决：文本 provider=DeepSeek、图片 provider=独立 OpenAI 兼容服务（不同 URL + 不同 Key），`POST /api/images` 打到**图片**端点并返回 201（真实或存根传输，注明）。
2. `listProviderViews()` 中文本与图片是**两个 provider**，各自 baseUrl/credentialRef 正确。
3. 打包版 Electron 行为以打包产物验证（规则 §7）。
4. 所有未运行项显式标注"未运行"，不得写作通过。

---

## 10. 未决问题及需产品负责人确认的决策

| # | 问题 | 备选 | 影响 |
| --- | --- | --- | --- |
| Q1 | 图片 Key 是否必须与文本 Key 独立？ | (a) 必须独立（方案 B） / (b) 可共用（方案 A 够用） | 决定是否引入 `openai-image` 身份 |
| Q2 | Gemini 图片是否需要独立 Key？ | (a) 需要 / (b) 共用并明示 | 决定是否建 `gemini-image` |
| Q3 | `openAIImageModel` 语义：一次性种子 vs 实时路由默认？ | (a) 改为实时（推荐，符合用户预期） / (b) 保持种子并修 UI 文案 | 决定是否改 `image-generation.ts` |
| Q4 | 未配图片 URL 时的默认行为 | (a) 回退文本并显式提示 / (b) 直接判"图片未配置"并报错 | 影响升级用户体验 |
| Q5 | 是否需要为"同一个 baseUrl、不同 key"提供 UI 捷径（减少重复输入）？ | 是 / 否 | UI 复杂度 |
| Q6 | 社区 Provider 扩展（Marketplace 长期方向）是否要求用户可自定义任意图片 provider？ | 是 / 否 | 是否把映射表做成数据驱动而非硬编码 |

---

## 附录 A：审计未触碰的边界（诚实声明）

- 本卡**未运行**真实图片生成（本机无可用图片模型/凭据，见 `docs/e2e-baseline-inventory.md`）；§2 的链路为**静态代码追踪**结论，不是实跑证据。
- 本卡**未修改**任何业务代码、数据库或迁移；`docs/architecture/` 目录为本卡新建。
- 本次会话**未执行** `git add/commit/push`。
- 本卡的"现状证据"行号基于基线 `3b48126` 的工作区副本；若上游继续改动，引用前请复核行号。

