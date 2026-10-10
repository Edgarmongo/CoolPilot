# CI-AI-IMG-CONFIG-03 交付记录：阶段 2（独立图片 provider 身份 / 端点 / 凭据落地）

> **卡片**：CI-AI-IMG-CONFIG-03（阶段 2：触冻结面 AI Runtime，已按 CR 批准实施）。
> **设计依据**：`docs/architecture/independent-image-provider-configuration.md`（CI-AI-IMG-CONFIG-01）§4 ~§8 阶段 2、§9；冻结面清单见 §7。
> **改动申请**：`docs/architecture/ci-ai-img-config-03-freeze-surface-change-request.md`（F1 / F3；D-1 裁决见 §2）。
> **前置**：CI-AI-IMG-CONFIG-02 已完成配置层（字段 / 校验 / UI / 图片 Key 独立存储），见 `docs/architecture/ci-ai-img-config-02-delivery.md`。
> **一句话结论**：图片请求现在真的打到**图片自己的** provider、端点与凭据上（`openai-image` / `gemini-image`）；未配置图片 URL 时**不回退**文本端点，而是以 runtime 自身的结构化错误失败（Q4）。
> **本卡未执行** `git add` / `git commit` / `git push`。

## 0. 范围声明（最重要）

| 层面 | 本卡状态 |
| --- | --- |
| AI Runtime 种子：新增 `openai-image` / `gemini-image` provider + 端点行（F1-C1a） | ✅ 完成 |
| 旧设置导入：图片模型绑到图片 provider（F1-C1b） | ✅ 完成 |
| 图片调用点：pin 映射到图片 providerId（F3-C2） | ✅ 完成 |
| 设置保存：保存后立刻对账端点（D） | ✅ 完成 |
| 数据迁移 `src/db/client.ts`（F5） | ⛔ **未做**（设计文档 §6.2 的"另建行、不删旧行"已由 C1a/C1b 的加性写入覆盖，无需 ALTER） |
| 文本 provider 的 seed / import / 路由 | ✅ **零改动**（回归全绿） |

**可见行为变化（正确行为，按 CR §6 R3 显式声明）**：图片调用的账本 / 预算 / 用量行 `provider` 值由 `openai` / `gemini` 变为 `openai-image` / `gemini-image`。以 provider 分组的统计会把图片与文本分开——这正是本卡的目的，不是回归。

---

## 1. 改动内容

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `src/features/ai-runtime/registry.ts` | `:67-70` | `seedVersion` 2 → **3**：已存在的安装重跑一次种子即可拿到图片 provider 行 |
| `src/features/ai-runtime/registry.ts` | `:109-180` | 新增 `syncImageProviderSettings()`：按 `imageProviderOrder` 建 `openai-image` / `gemini-image` provider 行；端点行**仅在 URL 可解析或行已存在时**写入，`enabled = Boolean(baseUrl)`；把表单命名的图片模型经 `ensureLegacyModel` 导入图片 provider |
| `src/features/ai-runtime/registry.ts` | `:250-252` | `ensureModelRuntimeSeeded()` 在文本 provider 之后调用 `syncImageProviderSettings()`（同一趟，供其后的 `importLegacyAiSettings()` 绑定） |
| `src/features/ai-runtime/registry.ts` | `:650-664` | `importLegacyAiSettings()` 图片分支的 `providerId` 改为 `imageProviderIdFor(imageProvider)`（C1b） |
| `src/features/ai-runtime/registry.ts` | `:674-685` | 图片能力默认值的候选 providerId 改为 `imageProviderIdFor(settings.imageProvider)` |
| `src/features/ai-settings/provider-registry.ts` | `:107-161` | `imageProviderIds`（`openai`→`openai-image`、`gemini`→`gemini-image`）、`imageProviderIdFor()`、`imageProviderDisplayName`、`imageProviderModelEnv`、`resolveImageProviderBaseUrl()`（**只有** `openAIImageBaseUrl`，空即"未配置"，Q4）、`resolveImageProviderModel()` |
| `src/lib/agent/image-generation.ts` | `:62-65` | `const providerId = imageProviderIdFor(input.provider ?? settings?.imageProvider ?? "openai")`（C2，一处映射） |
| `src/app/api/settings/ai/route.ts` | `:3, :77-82` | POST 保存后 `syncImageProviderSettings().catch(...)`（best effort）；保存的 URL/模型立刻对账，不必等 `seedVersion` |
| `src/db/repositories/settings.ts` | `:48-49` | `openAIImageBaseUrl` 默认 `""`（Q4：不继承文本 URL） |
| `src/locales/{en,zh-cn,zh-hk}.json` | `:847` | `openAIImageBaseUrlHint` 文案改为"空 = 无图片端点、请求以自己的错误失败"，删去"路由尚未切换"（CR §6 R1） |
| `src/test/route-harness.ts` | `:12-18, :61, :76-85, :149-151` | 图片侧：`prepareImageModel()` 先对账再读目录（否则没有端点行）；导出 `syncImageProviderSettings`（`:61`）供用例自行改设置；图片 Key 变量一并中和（`:76-85`） |
| `src/test/app-env.ts` | `:30-36` | 图片 provider 的 Key 变量（`OPENAI_IMAGE_API_KEYS` / `GEMINI_IMAGE_API_KEYS`）纳入中和名单 |
| `src/app/api/images/route.test.ts` | 全文 | pin 改为 `openai-image` / `gemini-image`；fixture 增加 `openAIImageBaseUrl`；断言 wire URL = 配置的图片端点；新增 2 个 Q4 用例（见 §4） |
| `src/lib/article-images.test.ts` | `:36-40, :164-186, :355, :370, :404-406` | 同上（AI 阶段 pin + 端点 URL 断言） |
| `src/lib/ai/generate.test.ts` | `:20-23, :35-38, :69-72, :126-170, :207-234` | 同上；`resetRuntime()` 增加图片 provider 的禁用/清凭据 + 图片设置复位 + 对账 |
| `src/app/api/settings/ai/route.test.ts` | `:4-25, :53-55, :87-127` | 新增"保存即对账端点、清空即写 disabled"用例 |
| `src/features/ai-runtime/image-provider-config.test.ts` | 新文件 | 5 个 registry 级用例（见 §4） |

**未改动**：`src/features/ai-runtime/contracts.ts`（CR §3：`image_generation` / `openai-compatible` 已存在，`providerId` 是自由字符串）、`resolveRoute` 与候选排序语义、`recordPublishSuccess` 与 C2 发布语义、`src/db/client.ts`、文本 provider 的所有种子/导入/默认值路径。

---

## 2. 调用链路

### 2.1 种子 / 保存（写侧）

```
系统 → 模型管理 → 保存           或            安装启动 ensureModelRuntimeSeeded()
   └─ POST /api/settings/ai                        └─ seedVersion(3) 未达标时：
        ├─ updateLocalAgentSettings(patch)             ├─ seedLegacyProviders()        ← 文本，未改
        └─ syncImageProviderSettings()                 ├─ syncImageProviderSettings()  ← 本卡（C1a）
             ├─ upsertModelProvider("openai-image" | "gemini-image")  ← 名称/来源仅在首建取默认，用户改过的不回写
             ├─ baseUrl = resolveImageProviderBaseUrl(...)             ← openai：仅 openAIImageBaseUrl；gemini：协议默认 host（Q2）
             ├─ baseUrl || 行已存在 → upsertModelEndpoint(enabled = Boolean(baseUrl))
             └─ ensureLegacyModel({ providerId: "…-image", capability: "image_generation" })
                                                     ├─ importLegacyAiSettings()   ← 本卡改绑图片 provider（C1b）
                                                     └─ ensureColdStartCatalogs()  ← 有 Key 且端点 enabled 才请求；空 URL 不请求
```

### 2.2 图片请求（读侧 / 路由）

```
POST /api/images
   └─ lib/agent/image-generation.ts: generateImageFile()
        ├─ providerId = imageProviderIdFor(input.provider ?? settings.imageProvider ?? "openai")   ← C2，唯一映射
        ├─ beginAiBudgetCall({ providerId, capability: "image_generation" })                       ← 预算按图片 provider
        └─ aiRuntime.generateImage({ providerId, size })
             └─ resolveRoute({ capability: "image_generation", providerId })
                  ├─ 端点 enabled 且凭据可用 → 候选 = 该图片 provider 的模型（key 轮换只在此端点内）
                  └─ 否则 → 结构化失败：MODEL_NOT_CONFIGURED(503, reason=no-models-synced / endpoint-disabled)
                                           / MODEL_CREDENTIAL_MISSING(400) / MODEL_CAPABILITY_UNAVAILABLE(409)
        └─ 账本行 provider = "openai-image" | "gemini-image"（cost_source 仍为 unpriced/NULL，不写 0）
```

**没有任何一步读 `openAIBaseUrl` / `OPENAI_BASE_URL` / 内置默认 host 来拼图片请求**（Q4）：`openai-image` 的端点只来自 `openAIImageBaseUrl`；`gemini-image` 的 host 来自 Gemini 协议本身，而它的 Key 独立。

---

## 3. 验证结果（实际命令与输出）

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `node_modules\.bin\vitest.cmd run <本卡 5 个测试文件>` | 首次 **52 通过 / 4 失败**（4 条均为本次新写用例的错误预期，已修正）；修正后 `route.test.ts` + `image-provider-config.test.ts` 单独复跑 **26 通过 / 0 失败** |
| 1b | `node_modules\.bin\vitest.cmd run src/lib/i18n-coverage.test.ts <本卡 5 个测试文件> src/features/ai-runtime/cold-start.test.ts` | **7 文件 / 63 用例全部通过**（含语系 key 齐整性与冷启动回归） |
| 5 | `POST http://127.0.0.1:3000/api/images`（真实网络、真实凭据，1 次调用，用户配置后） | **HTTP 201，22s**，`provider="openai-image"`、`model="gpt-image-2.5-sunburst"`；账本 / 预算 / 产物旁证见 **§3.2** |
| 2 | `node_modules\.bin\tsc.cmd --noEmit` | **exit 0** |
| 3 | `node_modules\.bin\eslint.cmd <本卡 5 个测试文件 + src/test/route-harness.ts>` | **exit 0** |
| 4 | `node_modules\.bin\vitest.cmd run`（全量） | **154 文件 / 1264 用例：1262 通过、2 失败**；2 条失败均为**已知既有失败**（见 §3.1） |

### 3.1 已知既有失败（与本卡无关，不作为判据）

`src/worker/runner.test.ts`（`CI-P7-03 step gate`，2 例）：`expected 'paused' to be 'failed'`。属于工作区**在途的 CI-P7-03 运行预算暂停改动**：CI-AI-IMG-CONFIG-02 交付记录 §3.1 已复现（单独跑该文件同样 2 失败），本卡 CR §4 备注亦已登记；**本卡未触碰、未修该文件**。本卡改动前后失败集合完全一致（文件/用例总数的差额来自工作区其他未提交改动与本卡新增用例）。

### 3.2 真实安装上的端到端验证（2026-10-10 17:20–17:33；用户在 UI 配好图片 Key 与 URL 后执行）

用户已在本地安装里完成配置：图片 provider = `openai`、`openAIImageBaseUrl = https://quanzil.com/v1`、`openAIImageModel = gpt-image-2.5-sunburst`、图片 Key 存入加密 vault（`web-data/credential-vault.json` 的唯一条目 = `openai-image/default`）。文本 provider 仍指向 `https://api.deepseek.com` —— 正是 Q4 关心的"若兜底就会打错地方"的场景。

**实测（真实网络 + 真实凭据 + 1 次调用，经运行中的 dev server）**：

| 检查 | 手段 | 结果 |
| --- | --- | --- |
| 配置读回 | `GET /api/settings/ai` | `openAIImageBaseUrl="https://quanzil.com/v1"`、`openAIImageModel="gpt-image-2.5-sunburst"`、`openAIImageKey="***…WmkB"`（掩码）、`imageProvider="openai"` |
| 库内行（只读 SELECT） | 临时探针脚本（用后已删） | 端点 `openai-image/default` = `https://quanzil.com/v1`、`protocol=openai-compatible`、`credential://openai-image/default`、`enabled=1`；模型 `openai-image:openai-image/default:gpt-image-2.5-sunburst` `enabled=1` 且带 `image_generation`；`gemini-image/default` 独立存在；seed 标记 `{"version":3}` |
| **真实生成** | `POST /api/images {"prompt":"a red fox sitting in a green field at dawn, digital painting"}` | **HTTP 201，22s**，`{"provider":"openai-image","model":"gpt-image-2.5-sunburst","fileName":"agent-image-1791624790750-HKrUVD40.png"}` |
| 产物 | 文件 + `GET /api/agent/artifacts?file=…` | 1,668,289 字节；PNG 魔数 `89 50 4E 47 0D 0A 1A 0A`；IHDR = **1024×1024**（= 配置的 `openAIImageSize`）；HTTP 200 `image/png`、字节数一致 |
| 账本 | `ai_usage_ledger` 最新行 | `provider_id="openai-image"`、`endpoint_id="openai-image/default"`、`model_id="gpt-image-2.5-sunburst"`、`outcome="success"`、`credential_label="***…WmkB"`（无明文 Key）、`metered_kind="image"`、`quantity_json={"images":1}`、`cost_amount=null` + `cost_source="unknown"`（未把未知成本写成 0） |
| 预算口径 | `ai_budget_decisions` 最新行 | `provider_id="openai-image"`、`model_id="gpt-image-2.5-sunburst"`、`route_resolved=1`；同一库中 17:20 的旧行仍为 `provider_id="openai"`、`route_resolved=0`（`route-unresolved`）——本卡落地前图片路由解析不出来，落地后可解析 |
| 未走文本端点 | 上述 `endpoint_id` / `model_id` / 账本 provider | 文本端点 `openai/default`（`api.deepseek.com`）全程未被使用；`gpt-image-2.5-sunburst` 也不是它的模型 |

**刻意未做**：在真实安装上执行 Q4 的"清空 URL → 期望失败"破坏性验证（会打断用户正在用的配置）。该语义由 §4.1 用例 4 与 §4.2 的两个用例在隔离环境覆盖。

### 3.3 明确未验证项（**不得当作通过**）

§3.2 的成功只覆盖"用户已配好图片端点"的路径。以下各项**本轮未执行**，任何引用本卡的文档都不得把它们写作通过：

| # | 未验证项 | 现状 / 唯一依据 | 备注 |
| --- | --- | --- | --- |
| 1 | 真实安装上"清空图片 URL → 结构化失败（不回退文本端点）" | 仅**隔离环境自动化**覆盖（§4.1 用例 4、§4.2 两个用例） | 破坏性操作，会打断用户在用的配置，需单独授权 |
| 2 | **打包版 Electron** 上的图片生成与产物访问 | 仅 dev server（`127.0.0.1:3000`）实测 | **设计文档 §9.3 验收标准 3 明确要求"以打包产物验证"（`:395`）→ 该条验收标准目前未满足**，不是可选项 |
| 3 | Gemini 图片端点的真实调用 | 仅验证 `gemini-image` 端点行/凭据独立（§4.1 用例 5）与路由可解析；无真实 Gemini 图片请求 | 本机未配置可用的 Gemini 图片凭据 |
| 4 | 图片端点"禁用 → 恢复"的**UI 操作** | 自动化覆盖（§4.1 用例 4）；真实安装上只跑了启用态成功路径 | 未在真实安装上清空再填回 URL |
| 5 | 真实端点上的图片 Key 轮换 / 多 Key 池 / 冷却 | 仅既有 key-pool 单测；真实端点只有一把可用 Key | — |

> 其中第 2 项是**设计文档自定的阶段 2 验收标准**，因此它是"本卡尚未收口"的正式一条，而不是外部加码。若作者要求本卡在文档层面完全对齐设计稿 §9.3，需要单独一次打包版验证。

---


### 4.1 新文件 `src/features/ai-runtime/image-provider-config.test.ts`（5 例，registry 级）

1. `seeds a row per image provider, with an endpoint only where a URL resolves (C1a, Q4)`：两行 provider 名称 = `imageProviderDisplayName`；`openAIImageBaseUrl` 为空 → `openai-image` **无端点行**（即使 `OPENAI_BASE_URL` 与 `OPENAI_IMAGE_BASE_URL` 都被设过值）；`gemini-image` 端点 = 协议默认 host + `credential://gemini-image/default`；文本端点 baseUrl 与对账前完全相同；**全程零网络请求**（`fetch` 是 tripwire）。
2. `binds the model the image form names to the image provider, never to the text one (C1b)`：`gpt-image-1` / `gemini-2.5-flash-image` 各自挂到 `…-image/default` 且 enabled、含 `image_generation`；`openai` 下**没有**图片模型；`resolveRoute({... providerId:"openai-image"})` 命中候选，而 `providerId:"openai"` 候选为空（reason `no-models-synced`）。
3. `keeps a name, a provenance or an enable state the user changed (additive and idempotent)`：用户改过的 `name` / `source` / `enabled=false` 连跑两次对账后不变；端点行仍只有 1 行。
4. `writes the image endpoint disabled when the URL is withdrawn and enables it again when it returns (Q4)`：清空 URL → 行保留但 `baseUrl=""`、`enabled=false`，路由 `endpoint-disabled` 且候选为空；填回 → 同一端点恢复 enabled 并再次可路由。
5. `keeps gemini's key independent while its host stays the protocol default (Q2)`：`credential://gemini-image/default` 与 `credential://gemini/default` 互不覆盖；`gemini-image` 的 host 不受 `openAIImageBaseUrl` 影响。

### 4.2 `src/app/api/images/route.test.ts`（19 → 21 例）

- 既有用例：provider 断言改为 `openai-image` / `gemini-image`，Authorization 改为图片 Key，wire URL 断言 `https://images.example.test/v1/images/generations`。
- 新增 `refuses the image endpoint whose URL was withdrawn instead of falling back to the text one (Q4)`：文本 provider 在用例内**真实可调用**（目录 + Key + 模型），图片 URL 清空并保存 → `503 MODEL_NOT_CONFIGURED`、`details.reason="endpoint-disabled"`、`requirement.providerId="openai-image"`、**零请求**（含零文本调用）。
- 新增 `has no image endpoint at all for an install that never named an image URL (Q4)`：删除图片行后对账 → 无端点/无模型，`503 MODEL_NOT_CONFIGURED`、`details.reason="no-models-synced"`、`missing=["image_generation"]`、零请求。

### 4.3 其余

- `src/app/api/settings/ai/route.test.ts`（7 → 8 例）：新增"保存即对账"用例——保存 URL+模型 → 端点 `baseUrl`/`protocol`/`credentialRef`/`enabled` 正确、模型绑定该端点且 enabled、文本 provider 未获得 URL 或模型；清空 URL → 行保留但 `baseUrl=""`、`enabled=false`。
- `src/lib/article-images.test.ts`（20 例）与 `src/lib/ai/generate.test.ts`（2 例）：语义不变，仅 pin 与端点 URL 断言更新。

---

## 5. 与设计文档的冲突行号（**只列，不自改**）

`docs/architecture/independent-image-provider-configuration.md`（CI-AI-IMG-CONFIG-01）成文于 Q4 裁决之前，以下行号与本卡落地行为冲突；按 CR §2 D-1 的备注（"本申请**不自修改**该文档，请裁决后由持卡人改"），本卡**未改写该文档**：

| 文档位置 | 行号 | 冲突点 |
| --- | --- | --- |
| §4.2 目标映射规则 规则 1 | `:210-211` | 条件式映射与 `"gemini" → "gemini"`：落地为**无条件**映射（`openai`→`openai-image`、`gemini`→`gemini-image`），映射表在 `src/features/ai-settings/provider-registry.ts:107-114` |
| §4.2 目标映射规则 规则 3 | `:213` | "若 `openAIImageBaseUrl` 为空 → **回退**到文本 `openAIBaseUrl` 并显式标记"：**不予实现**（Q4）；空值 = 无图片端点 + runtime 结构化失败 |
| §5.1 新增设置字段（草案注释） | `:236-237` | 注释"为空表示与文本共用 openAIBaseUrl（见 §6.4）"：落地语义为"为空 = 未配置"（`src/db/repositories/settings.ts:48-49`） |
| §5.3 端点与模型行 表 | `:262` | `.base_url` 行"（空则回退文本，见 §6.4）"：落地为 `enabled=false` + `baseUrl=""`，不回退 |
| §6.3 无法确定真实服务来源时如何处理 | `:296-298` | "按 §6.4 回退到文本 baseUrl，并在运行时与 UI 同时标注与文本共用端点"：**不予实现**；实际为无端点行 / 端点 disabled，错误码 `MODEL_NOT_CONFIGURED` |
| §6.4 何时允许回退 | `:302-307` | 整个回退条件（1/2/3）与"回退必须可观测"：**不予实现**（不存在回退路径）；UI 文案改为"空 = 未配置且会失败"（`src/locales/{en,zh-cn,zh-hk}.json:847`） |

**一致、无需修订**：§4.2 规则 2 / 4、§4.3 Gemini 结论（不造 URL 字段、Key 独立）、§5.2 凭据引用表、§5.4 能力一致性、§6.1、§6.2、§6.5、§6.6、§7 冻结面清单（F2 确实无需改动）、§8 阶段 2、§9。

---

## 6. 遗留问题

### 6.1 可延后（不阻塞）

- **`ensureLegacyModel` 对"先存模型、后存 URL"的顺序不重绑**（`src/features/ai-runtime/registry.ts:603-637`）：模型行先以 `endpointId: ""`（knowledge-only）建出后，再保存 URL 时 `ensureLegacyModel` 命中既有行只置 `enabled=true`，**不把 `endpointId` 绑到新端点**，该行因此不可路由（`findModelsByCapabilities` 过滤 `endpointId <> ''`）。UI 表单一次性提交（URL 与模型同一次保存），正常路径不受影响；"网关同步"会另建带端点的行，用户可自愈。本卡按 CR C1c"不改该函数"处理，此处仅登记。
- **`provider` 新值的下游口径**：账本 / 预算 / 用量按 `provider` 分组的统计与筛选会出现 `openai-image` / `gemini-image`；是否需要在成本中心归类到"OpenAI / Gemini"由后续成本口径卡决定（CR §6 R3）。
- **旧图片模型行（挂 `openai/default`）保留不动**（设计文档 §6.2）：pin 后不可达，属设计预期；是否给用户清理提示属后续体验卡。

### 6.2 阻塞

- 无。真实图片端到端已在用户的本地安装上跑通一次（§3.2：HTTP 201 / `provider="openai-image"` / 1024×1024 产物 / 账本与预算行均为 `openai-image`）。

---

## 7. 下一步编号

- **CI-AI-IMG-CONFIG-04（建议编号）**：按 Q4 落地结论修订设计文档 §4.2 规则 1/3、§5.1、§5.3、§6.3、§6.4（行号见上文 §5），并**一并回填设计文档 §10 的 Q1–Q4**（`:400-409`：Q1=a 必须独立 / Q2=a 已由 `gemini-image` 落地 / Q3≈a 保存即对账 / Q4=b 明确失败）与**阶段 4 清理与文档**（`independent-image-provider-configuration.md:359-365`）；`provider` 新值在成本中心 / 统计口径中的归类也归本卡。
- **图片计量与定价（成本口径）不新造卡号**：归属已有 **`CI-P7-05-01`**（本文 §13"图片 / 视频 / 语音 / Embedding 接入同一计量"）与 §附录 H.5 第 3 条（D）。现状 `cost_amount=NULL` + `cost_source="unknown"` 是**正确的未知值处理**，缺的是价格来源 / 计价单位（按张 · 分辨率）/ 币种 / 计费规则的录入与口径。
- **CI-AI-IMG-CONFIG-05（建议编号，作者裁定为独立后续事项）**：图片端点绑定边界——`ensureLegacyModel`（`src/features/ai-runtime/registry.ts:603-637`）对"先存模型、后存 URL"不重绑端点（§6.1 第 1 条）是否修复的裁决；含旧图片模型行的清理提示。
- **文档登记**：本卡族此前只存在于 `docs/architecture/*`；已在 **`docs/coolpilot-capability-integration-plan.md` §1 状态表 + §附录 I** 补记（2026-10-10）。
- 回归基线：全量单测仅剩 `src/worker/runner.test.ts` 2 例既有失败（属在途 CI-P7-03 改动），与本卡无耦合。
- **作者指定的下一张卡不是本卡族的 -04，而是回到 `CI-P5-03` 发布业务闭环**（见总计划 §附录 I.5）；`CI-AI-IMG-CONFIG-04` 排在发布闭环之后。


