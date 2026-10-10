# CI-AI-IMG-CONFIG-02 交付记录：阶段 1（字段 / 配置 / UI 分离）

> **卡片**：CI-AI-IMG-CONFIG-02（阶段 1：只改配置层与 UI，不触 AI Runtime 冻结面）。
> **设计依据**：`docs/architecture/independent-image-provider-configuration.md`（CI-AI-IMG-CONFIG-01）§7 冻结面清单、§8 阶段 1、§10 决策 Q1–Q4。
> **一句话结论**：**配置层已完成并验证；图片运行时仍未独立** —— 图片请求依旧打文本端点。独立路由属 CI-AI-IMG-CONFIG-03，触冻结面，需先批准。
> **本卡未执行** `git add` / `git commit` / `git push`。

## 0. 范围声明（最重要）

| 层面 | 本卡状态 |
| --- | --- |
| 配置字段（types / validation / 默认值） | ✅ 完成 |
| 凭据存储（图片 key 走独立 `credentialRef`） | ✅ 完成 |
| `/api/settings/ai` 读 / 写分派 | ✅ 完成 |
| 设置 UI（独立图片 URL + 独立图片 Key 输入） | ✅ 完成 |
| **图片运行时独立路由（seed `openai-image`、按能力绑端点）** | ❌ **未做**（冻结面，见 §6-B1/B2） |

因此本卡交付后：**把图片 Base URL / 图片 Key 填成与文本不同的值，不会改变图片请求的去向**。为避免造出"改了不生效的假开关"，UI 对该字段的当前状态作了如实标注（见 §5.1）。

---

## 1. 改动内容

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `src/lib/types.ts` | `:1163` | `LocalAgentSettings` 新增 `openAIImageBaseUrl: string`（图片独立端点；空 = 未配置） |
| `src/lib/validation.ts` | `:268-269` | 新增 `openAIImageKey` / `geminiImageKey`（可选字符串） |
| `src/lib/validation.ts` | `:275` | 新增 `openAIImageBaseUrl`：`z.union([z.string().trim().url(), z.literal("")]).optional()`（空串合法，非法 URL 拒绝） |
| `src/db/repositories/settings.ts` | `:49` | 默认值 `openAIImageBaseUrl: ""`（**不继承**文本 `openAIBaseUrl`） |
| `src/features/ai-settings/provider-registry.ts` | `:107-114` | 新增 `imageProviderIds`（`openai`→`openai-image`、`gemini`→`gemini-image`）与 `imageProviderIdFor()` |
| `src/app/api/settings/ai/route.ts` | `:2,19-37` | GET 经 `describeCredential(credentialRefFor(imageProviderIdFor(...)))` 读取图片凭据，返回掩码 `openAIImageKey` / `geminiImageKey` |
| `src/app/api/settings/ai/route.ts` | `:51-73` | POST 把图片 key 写入 `writeCredential(...)`；掩码占位符或空串为 no-op |
| `src/components/system/model-config-panel.tsx` | `:17-26` | `ModelConfigForm` 增加 `openAIImageKey` / `geminiImageKey` |
| `src/components/system/model-config-panel.tsx` | `:281-298` | 图片 `openai` 分支：独立 Key 输入 + 独立 Base URL 输入（+ 状态提示）+ 模型 + 尺寸 |
| `src/components/system/model-config-panel.tsx` | `:311-320` | 图片 `gemini` 分支：独立 Key 输入（**不造** Gemini 用不上的 URL 字段，Q2） |
| `src/components/settings/settings-page-client.tsx` | `:21-22` | `SettingsResponse` 同步新增两个图片 key 字段（仅类型对齐） |
| `src/locales/{en,zh-cn,zh-hk}.json` | `:846-849` | 新增 `openAIImageBaseUrl` / `openAIImageBaseUrlHint` / `openAIImageKey` / `geminiImageKey` |
| `src/lib/agent/settings-validation.test.ts` | `:43-59` | 新增 2 个校验用例（见 §4） |
| `src/app/api/settings/ai/route.test.ts` | 新文件 | 7 个分派/隔离/回读用例（见 §4） |

**未改动**：`src/features/ai-runtime/**`、`src/lib/agent/image-generation.ts`、`src/lib/credentials.ts`、`src/lib/secrets.ts`、`src/db/client.ts`、`src/db/schema.ts`。

---

## 2. 调用链路

### 2.1 读取（`GET /api/settings/ai`）

```
GET /api/settings/ai
  ├─ readProviderKeys("gemini"|"groq"|"openai"|"openrouter")   ← 文本 key：沿用 legacy 路径，未改
  ├─ describeCredential(credentialRefFor("openai-image"))       ← 图片 key：credential://openai-image/default
  ├─ describeCredential(credentialRefFor("gemini-image"))       ← 图片 key：credential://gemini-image/default
  └─ getLocalAgentSettings()                                   ← app_settings['local-agent']（含 openAIImageBaseUrl）
→ ok({ ...settings, geminiKey, groqKey, openAIKey, openRouterKey,
       openAIImageKey: <已掩码>, geminiImageKey: <已掩码> })
```

两条路径**不共享 ref、不共享值**：文本走 `secrets.ts` 的 provider 键（`OPENAI_API_KEYS` 等），图片走凭据库（`OPENAI_IMAGE_API_KEYS` / `GEMINI_IMAGE_API_KEYS`，由 `credentials.ts:113-116` 的 `credentialEnvVarNames` 自动推导）。

### 2.2 写入（`POST /api/settings/ai`）

```
POST body
  └─ localAgentSettingsSchema.safeParse
       ├─ 文本 key → writeProviderKey("openai"|…)                     ← 原有路径不变
       ├─ openAIImageKey   → writeCredential(credentialRefFor("openai-image"), key)
       ├─ geminiImageKey   → writeCredential(credentialRefFor("gemini-image"), key)
       └─ 其余字段（含 openAIImageBaseUrl / openAIImageModel）→ updateLocalAgentSettings(patch)
```

跳过规则（两处 key 一致）：`value?.trim() && !value.includes("*")`。
→ 表单回填的掩码值或空串都是 no-op，**打开并保存表单永远不会清空用户没重输的 key**。

### 2.3 UI

```
model-config-panel.tsx
  ├─ SWR GET /api/settings/ai  →  setForm(initialData)                     ← 表单无独立构造点
  ├─ 图片 provider=openai  (:281-298) → openAIImageKey / openAIImageBaseUrl(+hint) / openAIImageModel / openAIImageSize
  ├─ 图片 provider=gemini  (:311-320) → geminiImageKey / imageModel
  └─ handleSave() → apiPost("/api/settings/ai", form)                      ← 沿用既有实现
```

`ModelConfigForm`（`model-config-panel.tsx:17-26`）直接从 GET 响应构造，因此新字段**自动流经**表单，无需修改构造点。`settings-page-client.tsx:16-23` 的 `SettingsResponse` 是同一响应的另一处声明，已同步加字段以保持类型准确。

---

## 3. 验证结果

| 命令 | 结果 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | **exit 0**（无输出） |
| `node_modules\.bin\vitest.cmd run src/lib/agent/settings-validation.test.ts src/app/api/settings/ai/route.test.ts` | **exit 0**，`Test Files 2 passed (2)` / `Tests 12 passed (12)` |
| `node_modules\.bin\vitest.cmd run`（全量） | `Test Files 1 failed \| 152 passed (153)`；`Tests 2 failed \| 1254 passed (1256)` |
| `node_modules\.bin\eslint.cmd .` | `4 problems (3 errors, 1 warning)` —— **全部为既有项，与本卡无关** |

### 3.1 全量 vitest 唯一失败是既有失败（不是本卡引入）

失败文件：`src/worker/runner.test.ts`（2 例，`CI-P7-03 step gate`，断言 `expected 'paused' to be 'failed'`）。

证据：

- 单独运行 `node_modules\.bin\vitest.cmd run src/worker/runner.test.ts` 仍失败（`Tests 2 failed | 1 passed (3)`）→ 与本卡文件无顺序耦合；
- 本卡**之前**已存在的日志里就有同样 2 条失败：`tmp-vitest-out.txt`、`tmp-p5-01-full.log` 均为 `1 failed | 151 passed (152)`；
- 本卡改动后为 `1 failed | 152 passed (153)` —— 恰好 +1 个文件（本卡新增的 `route.test.ts`），失败集合不变。

### 3.2 eslint 的 4 项均为既有项

- `tmp-probe-db.cjs`、`tmp-probe-zod-json-schema.cjs`：工作区里既有的未跟踪探针脚本（3 errors，`no-require-imports`）；
- `src/components/agent-chat/chat-conversation.tsx:146`：既有 warning（本卡未改动该文件）。

本卡改动的全部文件 lint 结果为 0 报错。

---

## 4. 测试覆盖

### 4.1 `src/lib/agent/settings-validation.test.ts`（+2）

| # | 场景 | 断言 |
| --- | --- | --- |
| 1 | 独立图片 URL + 独立图片 key | `openAIImageBaseUrl` / `openAIImageKey` / `geminiImageKey` 原样通过 schema |
| 2 | 图片 URL 空 vs 非法 | `""` 合法（= 未配置）；`"not-a-url"` 抛错 |

### 4.2 `src/app/api/settings/ai/route.test.ts`（新，7）

| # | 场景 | 断言要点 |
| --- | --- | --- |
| 1 | 未配置时 | 两个图片 key 均为 `""`，`openAIImageBaseUrl` 为 `""` |
| 2 | 保存图片 URL + 图片 Key（**T2/T4 基线**） | 图片 key 落在 `credential://openai-image/default`；**文本 ref 为空**；`openAIBaseUrl` 保持 `https://api.openai.com/v1` 不变 → **无继承**（Q1/Q4） |
| 3 | 回读不外泄 | `openAIImageKey` 匹配 `/^\*+cret$/`，整个响应 JSON 不含明文 |
| 4 | 回填掩码值 | 不覆盖已存 key（仍是原明文） |
| 5 | 空串提交 | 不清空已存 key |
| 6 | 非法图片 URL | 400 + 存储值不变 |
| 7 | 图片模型持久化（Q3） | 可写入 / 覆盖，且 `openAIModel` 保持 `""` → 文本模型不受影响 |

> 说明：`beforeEach` 显式清理 `openai-image` / `gemini-image` / `openai` 三个 ref 并重置 `openAIImageBaseUrl`、`openAIImageModel` —— 因为 harness 的 `resetRuntime()` 只清理**已 seed 的** provider，而图片 provider 目前还不是 DB 行（属 CI-AI-IMG-CONFIG-03）。

### 4.3 未覆盖 / 未运行（明确标注）

- **未运行** §9.3 的真实 HTTP 冒烟：本机无可用图片模型/凭据，且会产生额度消耗，需授权。
- **未覆盖** T1/T5/T7/T8（都要求图片端点身份已分离）→ 属 CI-AI-IMG-CONFIG-03。

---

## 5. 与设计文档的差异（按规则 §1 报告，**未自行"修正"文档**）

### 5.1 §8 阶段 1 对 UI 提示的要求 vs 实际实现（需确认）

设计文档 `independent-image-provider-configuration.md:350` 原文：

> **此时运行时尚未消费新字段** → UI 明确标注"即将生效/需重启种子"？不 —— 见阶段 2 的语义修正，避免造出"改了不生效"的假开关。

本卡实际**保留了一条提示文案**（`openAIImageBaseUrlHint`，`model-config-panel.tsx:296`），但文案是**如实陈述当前状态**而非承诺即将生效：

- en：`Independent of the text service. Empty means "not configured". Routing has not been switched over yet: image requests still use the text endpoint until the image provider is seeded.`
- zh-cn / zh-hk：同义（"独立于文字服务。留空表示未配置。路由尚未切换：在图片 provider 写入种子前，图片请求仍走文字端点。"）

处理理由：若不提示，用户会默认该字段已生效 —— 那才是真正的"假开关"；规则 §7 亦禁止把未实现能力按已实现描述。**未改动设计文档**。若评审要求严格照 `:350` 字面执行，只需删除三个 locale 的 `openAIImageBaseUrlHint` 键与 `model-config-panel.tsx:296` 一行即可，无其他耦合。

### 5.2 阶段归属差异：Gemini 图片 Key 提前到阶段 1（需确认）

设计文档 §8 把 Gemini 独立图片 Key 归入**阶段 3**；本卡按**已确认决策 Q2** 在阶段 1 就落地了 `geminiImageKey`（字段 + 凭据写入 + UI 输入 + 测试），仍未做运行时消费。影响：无功能风险（只多存一个字段）；**阶段 3 的剩余范围缩小为"运行时消费 Gemini 图片 Key + 文档"**。

### 5.3 §8 阶段 1 未列出、但本卡必须改的两个文件

- `src/components/settings/settings-page-client.tsx:21-22`：同一 GET 响应的另一处类型声明（`SettingsResponse`），不加字段则类型与真实响应不符。
- `src/lib/agent/settings-validation.test.ts`（+2 用例）：即阶段 1 验收要求的"校验/保存/回读测试"。

### 5.4 §7 冻结面清单中本卡**未触碰**的项

| # | 文件 | 本卡 | 原因 |
| --- | --- | --- | --- |
| F1 | `src/features/ai-runtime/registry.ts` | ❌ 未碰 | 冻结面，待批准 → CI-AI-IMG-CONFIG-03 |
| F2 | `src/features/ai-runtime/contracts.ts` | ❌ 未碰 | 同 B1（阶段 1 未新增 runtime provider 身份常量） |
| F3 | `src/lib/agent/image-generation.ts` | ❌ 未碰 | 同 B1 |
| F4 | `src/lib/credentials.ts` / `secrets.ts` | ❌ 未碰 | **实测无需修改**：`credentialEnvVarNames("openai-image")`（`credentials.ts:113-116`）自动得出 `OPENAI_IMAGE_API_KEYS` / `OPENAI_IMAGE_API_KEY`，`writeCredential` / `describeCredential` 直接可用（已由 `route.test.ts` 覆盖） |
| F5 | `src/db/client.ts` | ❌ 未碰 | 阶段 1 新字段落在 `app_settings` 的 JSON 值内，**无 DDL 变更**；是否需要迁移取决于 CI-AI-IMG-CONFIG-03 的字段落点 |

---

## 6. 遗留问题

### 6.1 阻塞（必须由 CI-AI-IMG-CONFIG-03 解决，触冻结面）

- **B1 —— 图片 provider 身份/端点未分离**：`registry.ts` 仍把 `settings.openAIImageModel`（`geminiImageModel` 同）绑定到既有 `openai/default` / `gemini` provider（`registry.ts:562-566` 一带），端点 `baseUrl` 取自 `openAIBaseUrl`。→ `openAIImageBaseUrl` 当前**不参与任何决策**。
- **B2 —— 图片唯一调用点未消费新字段**：`src/lib/agent/image-generation.ts` 既未读取 `openAIImageBaseUrl`，也未做 `settings.imageProvider` → `imageProviderIdFor()` 的映射。
- **B3 —— 因此 UI 只能写"路由尚未切换"**：B1/B2 不解决，任何更强的文案都是不实陈述。

### 6.2 可延后

- **D1（建议优先）**：`docs/coolpilot-capability-integration-plan.md` §1 任务状态表**未登记本卡族** —— 全仓检索 `CI-AI-IMG-CONFIG` 仅命中本设计与本交付两份文档。按规则 §1 该表是"唯一进度来源"，但本卡未获授权，**未擅自改动主计划文档**，请单独授权后补登。
- **D2**：`docs/generate-migration*.md` / `docs/model-runtime.md` / README 的模型配置说明更新（设计文档 §8 阶段 4 范围）。
- **D3**：§9.3 真实 HTTP 冒烟未运行（本机无可用图片凭据，且消耗额度需授权）。
- **D4**：图片 key 目前**只写不清**（与文本 key 现有行为一致）—— 没有"删除图片 key"的入口。是否补清除语义，待产品确认后另开卡。

---

## 7. 下一步编号

**CI-AI-IMG-CONFIG-03**（设计文档 §8 阶段 2：种子与身份分离，触冻结面 F1–F3）。

冻结面改动申请已单独成文：`docs/architecture/ci-ai-img-config-03-freeze-surface-change-request.md` —— **待批准后才可实施**（规则 §4：确需改冻结面时先单独说明原因并等待批准）。

---

## 附录：本卡命令与产物留痕

| 命令 | 日志 |
| --- | --- |
| `node_modules\.bin\tsc.cmd --noEmit` | `tmp-ci-img-02-tsc.log`（空 = 无错误） |
| `node_modules\.bin\vitest.cmd run` | `tmp-ci-img-02-vitest.log` |
| `node_modules\.bin\vitest.cmd run src/worker/runner.test.ts` | `tmp-ci-img-02-runner.log`（既有失败复现） |
| `node_modules\.bin\vitest.cmd run <本卡两个测试文件>` | `tmp-ci-img-02-targeted.log` |
| `node_modules\.bin\eslint.cmd .` | `tmp-ci-img-02-eslint.log` |

> 上述 `tmp-*` 日志为本地验证产物（工作区既有同类文件，均未跟踪），不属交付内容。
