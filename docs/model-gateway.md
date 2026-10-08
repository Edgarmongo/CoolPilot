# 模型管理层设计笔记：Model Gateway / Registry / Capability

> **文档性质**：内部设计稿（design notes），不是用户文档。用户文档见 `README.md` / `README.zh-TW.md`。
> **事实来源**：当前仓库代码（`src/features/ai-settings/`、`src/lib/ai/`、`src/lib/agent/`、`src/components/system/`、`src/db/repositories/settings.ts`）。
> **数字来源**：2026-10-08 导入的网关模型快照（`src/features/ai-settings/model-gateway-snapshot.ts`）。
> **用法**：先读 §2 确认「现在到底有什么」，再用 §3 差距与 §8 路线图决定「下一步做什么」。

---

## 0. 一句话定位

CoolPilot 不做模型，也不做模型供应商；它做的是**本机的 AI 能力编排层**：

```
用户 key / endpoint / 模型目录
        ↓
   Model Registry（本机 SQLite + OS 凭据库）
        ↓
   能力选择器（capability + 需求 → 具体模型）
        ↓
   Adapter（协议适配：openai-compatible / gemini-native / …）
        ↓
   Unified API（text / image / video / audio / embedding）
        ↓
   Agent / Workflow / 编辑器 / 内容库
```

产品卖点**不是**「我们支持 420 个模型」——这个数字很容易被别人超过；
真正的价值是 **「用户可以自由选择 AI 能力，而 CoolPilot 帮他统一管理」**。

由此得出一个战略判断：**模型厂商越多，对 CoolPilot 越有利**。OpenAI、Qwen、Gemini 出新模型，本地模型变强，对 CoolPilot 都是「目录多一行」，不是竞争压力。CoolPilot 站在模型之上，而不是和模型竞争。

> 配套的**实施篇**是 `docs/model-gateway-plan.md`：它把这一层的目标逐层对照代码做了可行性判定（能不能做 / 改哪些文件 / 加哪些表），并在 §9 把「产品 → 分析目标用户 → 找潜在用户 → 分析用户内容 → 判断需求 → 选题 → 文章 → 图片 → 视频 → 发布 → 统计 → 效果分析 → 下一轮优化」这条 13 步商业闭环映射到具体模型能力上（哪一步现在可调、哪一步卡在 vision / video / embedding），并据此调整了优先级。
>
> 逐层规格（八层各自的职责与「不负责」、数据结构、接口、失败模式、错误码、测试矩阵）见 `docs/model-layer-spec.md`。

---

## 1. 概念模型：先把三个词分开

最容易出错的地方，是把「模型」「供应商」「接口」混为一谈：

| 概念 | 回答的问题 | 例子 |
| --- | --- | --- |
| **Provider**（供应商/厂牌） | 这些模型属于谁 | OpenAI、通义千问、Gemini |
| **Protocol**（协议） | 用什么格式说话 | `openai-compatible`、`gemini-native` |
| **Endpoint**（接入点） | 往哪个 URL 说话 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **Credential**（凭据） | 以谁的身份说话 | 用户 API key（可多把）、账户会话 cookie |
| **Model**（模型） | 用哪个模型 | `qwen-plus`、`gpt-5.3-codex` |
| **Capability**（能力） | 这个模型**能干什么** | chat / reasoning / code / image / video / audio / embedding |
| **Adapter**（适配器） | 怎么把统一请求翻译成该协议 | `callOpenAICompatible`、`callGemini` |

### 三条推论（后面所有设计都从这三条长出来）

1. **provider ≠ protocol ≠ endpoint**：同一厂牌可能既有原生端点也有兼容端点；同一协议端点也可能被多个厂牌共用（DeepSeek、智谱、百炼、火山方舟都提供 `openai-compatible`）。所以不能「一个厂牌写一套调用逻辑」。
2. **「OpenAI 兼容」是当前最重要的统一层**：只要 `protocol = openai-compatible`，换 `baseUrl + apiKey + model` 就能接上绝大多数国内外模型。仓库现状已经吃到这个红利（§2 的 Endpoint 与 Protocol 两行）。
3. **能力必须是一等数据，而不是从名字猜出来的**：`gpt-5.6-luna` 支不支持视觉、能不能工具调用、上下文多大，必须可查询；Agent 才能做「我需要视觉 → 查 Registry → 选模型 → 执行」。

---

## 2. 现状盘点（代码实测，不是设想）

| 层次 | 现在怎么实现的 | 关键代码 | 边界在哪里 |
| --- | --- | --- | --- |
| **Provider registry** | 四个本地 provider：`gemini` / `groq` / `openai` / `openrouter`，每个带 `displayNameKey`、`keyField`、`defaultBaseUrl`、`baseUrlEnv`、`modelEnv`、`supportsCustomBaseUrl` | `src/features/ai-settings/provider-registry.ts` → `aiProviderRegistry` | 只有 4 个**写死**的 provider；新增厂牌要改类型 + 改 UI + 改解析函数（`resolveProviderBaseUrl` / `resolveProviderModel` 都是 if-else） |
| **Protocol** | 只有两种实现：`gemini-native`（`callGemini`）与 `openai-compatible`（`callOpenAICompatible`），由 `callProvider()` 分发 | `src/lib/ai/providers.ts` | 没有 Anthropic 原生协议；**没有 image / video / audio / embedding 的协议层** |
| **Endpoint** | 三级优先：settings 自定义 → 环境变量 → 默认值；厂牌侧的「OpenAI 兼容地址」另有表单 | `provider-registry.ts`、`mainstream-model-catalog.ts` → `MainstreamVendorMetadata.compatibleBaseUrl`（14 条厂牌记录中 10 条有兼容地址） | endpoint 是**字符串字段**，不是对象；没有按 provider 存多个 endpoint |
| **Credential** | 多 key 读取 + 去重 + 脱敏（`readProviderKeys` / `maskKey`），优先尝试 `keytar`，失败则回退到 `process.env` 与 `.env.local` 明文写入；内容库网关 cookie 也走 `.env.local`（`MODEL_GATEWAY_COOKIE`），不入库、不入日志 | `src/lib/secrets.ts` | **`keytar` 不在 `package.json` 依赖里**，`loadKeytar()` 运行时必然失败 → 实际上 key 明文落在 `.env.local`；没有 per-key 对象（label / 创建时间 / 最近使用 / 状态） |
| **Model 目录（Registry 雏形）** | 两套来源：① **网关目录**＝快照（420 个 id，`scripts/import-gateway-models.ts` 生成）或用户手动同步结果（`model-gateway-sync.ts` 存 SQLite）② **供应商实时目录**＝调各家 `/models`（Gemini `v1beta/models`、OpenRouter `/models`、OpenAI 兼容 `/models`），1 小时内存缓存，可用 `resolveFirstAvailableModel` 兜底「第一个可用模型」 | `model-gateway-snapshot.ts`、`model-gateway-sync.ts`、`model-catalog.ts` | 目录里**只有 id**（外加少量 created/owned_by）；没有 contextWindow、价格、模态、是否可工具调用 |
| **Capability** | ① 网关目录：7 类能力（chat / reasoning / code / image / video / audio / embedding），用**模型 id 正则**推断；② 实时目录：只有粗糙的 `text` / `image` 两类 | `model-gateway-catalog.ts` → `classifyGatewayCapability()`、`mainstream-model-catalog.ts` → `mainstreamModelCapabilities`、`model-catalog.ts` → `ModelCapability` | 能力是**展示用标签**，不是可查询的注册表数据；新模型命名一变就要改正则 |
| **选择与兜底** | `orderedProviders()` 决定 provider 尝试顺序，`generate.ts` 再洗牌多把 key 逐个重试，成功即返回 | `src/lib/ai/generate.ts` → `runWithProviders()` | 只有「文本」走这条路；**按能力选择**、按视觉/工具调用等**需求选择**都还没有 |
| **UI / API** | 系统 → 模型管理：**可用模型** tab（厂牌分组 + 能力分组 + 状态 + 网关同步卡片）与 **模型配置** tab（key、endpoint、模型选择、云 provider 状态） | `src/components/system/model-management-client.tsx`、`model-config-panel.tsx`、`model-gateway-sync-panel.tsx`；`/api/models/catalog`、`/api/models/gateway`、`/api/settings/ai/models` | 页面展示能力齐了，但**启停、优先级、别名、覆盖能力**这些「管理动作」还没有落点 |
| **持久化** | 全部走 SQLite 的 key-value 表 `app_settings`（JSON 字符串），键名 `local-agent`、`model-gateway` 等；`LocalAgentSettings` 是**扁平字段**（`geminiModel` / `groqModel` / `openAIBaseUrl` / `openAIModel` / `openRouterBaseUrl` / `openRouterModel` / `geminiImageModel` / `openAIImageModel`） | `src/db/repositories/settings.ts`、`src/lib/types.ts` | 每加一个模型字段就要动类型、schema、UI；**不是 provider/model 表结构** |

### 实测数字（跑 `npx tsx` 调 `buildGatewayVendorGroups()` 得到）

- 模型总数 **420**，厂牌分组 **22**：`openai=121` · `qwen=73` · `google=32` · `doubao=29` · `kling=16` · `midjourney=16` · `anthropic=15` · `xai=14` · `minimax=13` · `zhipu=12` · `deepseek=12` · `llama=12` · `pixverse=11` · `other=9` · `suno=8` · `moonshot=6` · `vidu=6` · `mimo=4` · `xinghuo=4` · `flux=3` · `rerank=3` · `hunyuan=1`
- 能力分布：`chat=221` · `image=55` · `video=53` · `audio=37` · `reasoning=31` · `code=13` · `embedding=10`

**一句话结论**：目录层（420 个 id、厂牌/能力分组）已经有了，但**「Registry 的对象化」「能力可查询」「凭据安全存储」「统一调用出口」四件事都还没做**——这正是下一阶段要补的，也是把 CoolPilot 从「功能集合」变成 AI Runtime 的关键一段。

---

## 3. 差距分析：现状 → 目标

| # | 目标能力 | 现状 | 差距（要做的事） | 不做会怎样 |
| --- | --- | --- | --- | --- |
| G1 | 模型带**元数据**（上下文长度、模态、是否支持工具调用/结构化输出、价格） | 目录里只有 `id`（少量 `created` / `owned_by`） | 建立 `ModelRecord`，先容错（字段可空），来源优先级：供应商结构化字段 > 手工覆盖 > 正则推断 | 无法按「上下文够不够」「贵不贵」选模型，Agent 只能盲选 |
| G2 | Registry 是**对象集合**，支持启停 / 优先级 / 别名 / 能力覆盖 | 只有 id 字符串数组 + 快照/同步两态 | `providers` / `models` 表 + `capabilityOverrides`，UI 提供启用开关与排序 | 用户没法「只用我买得起的 8 个模型」，列表越长越难用 |
| G3 | 凭据进入 **OS 安全存储**，SQLite 只留引用 | key 明文落在 `.env.local`（`keytar` 未安装，动态 import 必然失败） | `credentialRef` 模型 + Electron `safeStorage`（Windows 走 DPAPI，macOS 走 Keychain）；无 Electron 时降级为「权限收紧的文件 + 明确提示」 | 用户把 `workspace.db` 或整个目录复制走 = 所有 API key 一起泄露，直接击穿「本地优先 / 数字主权」承诺 |
| G4 | 每个**能力**都有 Adapter：text / image / video / audio / embedding | 只有 text 有两条协议；image 由 `src/lib/agent/image-generation.ts` **旁路直连** fetch；video / audio / embedding 完全没有调用层 | `Adapter` 接口 + 按能力注册；把 `generate.ts`、`image-generation.ts` 收编为 adapter 实现 | 目录里 53 个视频模型、37 个音频模型、10 个 embedding 模型**可见不可用**，用户会认为列表是装饰 |
| G5 | 业务代码只经**统一出口**调用模型 | 调用方各自 `import { generateText } from "@/lib/ai/generate"` 或直接 fetch | `run({ capability, input })` 单入口，业务代码不得直接 fetch 供应商 | 每接一种能力就要改多处调用点，能力越多样越乱 |
| G6 | 按**需求**选择模型（我要 vision / 我要 tool calling / 我要便宜） | `orderedProviders()` 只按 provider 顺序 + 多 key 洗牌重试 | `selectModel({ capability, requires, prefer, exclude })` + 「无匹配时给出可读原因」 | Agent 无法做能力驱动的编排（截图理解、函数调用、结构化输出各自需要不同模型） |
| G7 | 新增厂牌是**配置动作**，不是改代码 | `LocalAgentSettings` 扁平字段 + `resolveProviderModel` 的 if-else | provider/model 表驱动；旧字段保留为「兼容视图」读写反向映射 | 每加一个厂牌要动 `types.ts` / `validation.ts` / UI / 解析函数四处 |
| G8 | 能力判定**可人工纠正** | 纯正则（`classifyGatewayCapability()`） | 结构化字段优先 + `capabilityOverrides` + 「覆盖数据可导入导出」 | 新模型命名一变能力标签就错（例如把带 `audio` 字样的通用模型判成音频），且无法在 UI 上修正 |

---

## 4. 六条硬性原则（Design Rules）

写下来是为了以后每次「顺手加个功能」时能对照检查：

- **R1 凭据永不进入 SQLite、日志、导出包。** 数据库只存 `credentialRef`（例如 `os:provider/openai/key-1`）；真实值只在 OS 安全存储里。UI 只显示 `maskKey()` 结果（`****1234`）。
- **R2「目录同步」与「登录会话」严格分离。** 会话 cookie（`MODEL_GATEWAY_COOKIE`）只在本机、只发给目标域名、绝不经过 CoolPilot 服务器或第三方中转；同步是**可选功能**，不是运行依赖（关掉开关就用内置快照，这条现状已经做到了）。
- **R3 模型 ≠ 能力。** 能力是独立一层数据，且必须**可查询**：给定 capability → 候选模型列表。
- **R4 任何「按名字猜」的规则都是临时手段。** 必须允许人工覆盖，覆盖数据要能导入/导出，且优先于正则。
- **R5 单一出口。** 所有模型调用经 Adapter / 统一 API，业务代码禁止自带 fetch 供应商。
- **R6 本地优先。** 无网络、无 key 时 UI 与目录仍然可用（只是标记 `missing-key` / `external`）；本地模型（Ollama / LM Studio / LocalAI）与云模型**同构**，只是 endpoint 不同——因为它们大多也讲 `openai-compatible`。

> 合规红线（对应 R2）：基于第三方平台 cookie 的自动化访问必须遵守该平台的服务条款，**不得设计成绕过访问限制的机制**；UI 需要明确写出「cookie 只存在本机、只发往该域名、随时可清除」。这条与 README 的 *Safety and Platform Disclaimer* 一致，不要弱化它。

---

## 5. 目标数据结构（草案）

落点建议：类型放 `src/lib/types.ts`（与现有 settings 类型同处）或新开 `src/features/model-gateway/types.ts`；持久化仍走 SQLite，但**从扁平的 `app_settings` KV 升级为对象表**（`providers` / `models` / `capability_overrides`），`app_settings` 保留给别的设置。

```ts
/** 说话的方式；决定了用哪个 Adapter。 */
export type ModelProtocol = "openai-compatible" | "gemini-native" | "anthropic-native";

/** 能力既描述“产品形态”（chat/image/video…）也描述“能力开关”（vision/tool-calling…）。 */
export type ModelCapability =
  | "chat" | "reasoning" | "code" | "embedding"
  | "image" | "video" | "audio" | "vision" | "tool-calling" | "structured-output";

export interface ProviderRecord {
  id: string;                 // "openai" | "dashscope" | "ollama"
  vendorId: string;           // 厂牌 id，与 classifyGatewayVendor() 的 id 对齐
  name: string;
  region: "global" | "cn" | "local";
  protocol: ModelProtocol;
  baseUrl: string;
  /** 只存引用，明文只在 OS 安全存储里（R1）。 */
  credentialRef: string | null;
  enabled: boolean;
  priority: number;           // 越小越优先，替代写死的 orderedProviders()
  docsUrl?: string;
  apiKeyUrl?: string;
}

export interface ModelRecord {
  providerId: string;
  modelId: string;
  label: string;
  capabilities: ModelCapability[];
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities?: Array<"text" | "image" | "audio" | "video">;
  outputModalities?: Array<"text" | "image" | "audio" | "video">;
  pricing?: { inputPerMTokens?: number; outputPerMTokens?: number; currency?: string };
  /** 这条记录的可信来源；UI 用它解释“为什么这个模型被标成视频”（R4）。 */
  source: "provider-api" | "gateway-catalog" | "curated" | "override";
  enabled: boolean;
  lastSeenAt: number | null;  // 目录里消失的模型据此标记为 stale，而不是直接删
}

/** 人工纠正：优先于正则与目录推断。 */
export interface CapabilityOverride {
  providerId: string;
  modelId: string;
  add?: ModelCapability[];
  remove?: ModelCapability[];
  label?: string;
  note?: string;
}
```

### 能力数据的来源优先级（G1 / G8）

```
1. provider-api   ← 供应商结构化字段（已存在的例子：Gemini supportedGenerationMethods、
                              OpenRouter architecture.modalities）
2. override       ← 用户在 UI 上手工纠正（可导入/导出）
3. curated        ← 仓库内人工维护的小表（新模型上市当天的兜底）
4. gateway-catalog ← 现有正则分类（classifyGatewayCapability），降级为“最后的猜测”
```

一个 provider + 一条模型记录的实际形状：

```json
{
  "provider": {
    "id": "dashscope",
    "vendorId": "qwen",
    "name": "通义千问 (百炼)",
    "region": "cn",
    "protocol": "openai-compatible",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "credentialRef": "os:provider/dashscope/key-1",
    "enabled": true,
    "priority": 10
  },
  "model": {
    "providerId": "dashscope",
    "modelId": "qwen-vl-max",
    "label": "Qwen VL Max",
    "capabilities": ["chat", "vision", "structured-output", "tool-calling"],
    "contextWindow": 131072,
    "inputModalities": ["text", "image"],
    "outputModalities": ["text"],
    "source": "override",
    "enabled": true,
    "lastSeenAt": 1760000000000
  }
}
```

### 迁移策略（不破坏现有契约）

- `LocalAgentSettings` 的扁平字段（`geminiModel` / `openAIBaseUrl` / …）**保留为兼容视图**：读时映射成 provider/model，写时反向映射；现有 `/api/settings/ai`、`/api/models/catalog`、模型配置 UI 都不用改。
- 首次启动时做一次**一次性迁移**：按 `aiProviderRegistry` 生成 4 条内置 provider 记录，把 `.env.local` 里的 key 搬进 OS 安全存储（失败则保留原文件并提示）。
- 网关目录（快照 420 id / 同步结果）继续作为「**未配置 key 的候选目录**」存在；只有配好 endpoint + 凭据的 provider 才会进入「可调用」状态。

---

## 6. 选择器与统一调用 API（Adapter 层）

### 6.1 选择器：从「能干什么」出发选模型

```ts
export type ModelRequirement = {
  capability: ModelCapability;          // 必须是哪类能力
  requires?: ModelCapability[];         // 附加要求，例如 ["vision", "tool-calling"]
  minContextWindow?: number;
  prefer?: { cheap?: boolean; local?: boolean; providerId?: string };
  exclude?: { providerId?: string[]; modelId?: string[] };
};

/** 返回一组按优先级排好的候选，而不是单个模型：上层可以逐个降级重试。 */
export function selectModelCandidates(requirement: ModelRequirement): Array<{
  provider: ProviderRecord;
  model: ModelRecord;
  credentialRef: string;
}>;
```

决策过程（顺序即优先级）：`enabled` provider → 能力匹配 → `requires` 全部满足 → 上下文/成本约束 → `prefer` 加权 → `exclude` 过滤 → 按 provider `priority` 排序。
**无匹配时必须给出可读原因**（例如「没有启用任何支持 vision 的 provider」「gemini 已启用但缺少凭据」），而不是像现在这样只留下一串 provider 报错。

### 6.2 Adapter：把统一请求翻译成协议请求

```ts
export type ModelRequest = {
  capability: ModelCapability;
  prompt?: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  images?: string[];              // data URL 或本地路径（vision / image-to-video）
  json?: boolean;                 // 需要结构化输出
  signal?: AbortSignal;
};

export type ModelResult = {
  capability: ModelCapability;
  providerId: string;
  modelId: string;
  keyLabel: string;               // maskKey() 结果，永不返回明文
  usage?: TokenUsage;
  text?: string;
  files?: Array<{ path: string; mimeType: string }>;
  raw?: unknown;                  // 调试用，需脱敏
};

export interface ModelAdapter {
  protocol: ModelProtocol;
  capabilities: ModelCapability[];
  supports(model: ModelRecord): boolean;
  run(input: {
    provider: ProviderRecord;
    model: ModelRecord;
    credential: string;           // 仅本次调用持有（R1）
    request: ModelRequest;
  }): Promise<ModelResult>;
}
```

### 6.3 一次调用的完整链路

```
业务代码（Agent / 编辑器 / 内容库）
   ↓  run({ capability, request })
统一出口            ：参数校验、能力合法性、用量与错误归一化
   ↓
能力选择器          ：selectModelCandidates() → 候选队列（provider + model + credentialRef）
   ↓
凭据解析            ：credentialRef → OS 安全存储取明文（仅本次调用，不写日志）
   ↓
Adapter            ：openai-compatible / gemini-native / anthropic-native …
   ↓
结果归一化          ：text / files / usage → 写入 usage-records（已有表）
   ↓
失败降级            ：换同一 provider 的下一把 key → 换下一个候选模型
```

**与现状的衔接（尽量小步）**

- `src/lib/ai/generate.ts` 的 `runWithProviders()` 变成「选择器 + Adapter」的组合，对外仍是 `generateText` / `generateStructured`，调用方零改动。
- `src/lib/agent/image-generation.ts` 的直连 fetch 收编为 `image` capability 的 adapter 实现（`openai-compatible` 的 `/images/generations` 与 `gemini-native` 的 `generateContent` 各一个分支）。
- `resolveFirstAvailableModel()` 降级为 adapter 内部兜底：没有明确偏好时取目录里的第一条。
- 新增能力（video / audio / embedding）只在 Adapter 层加实现，UI 与 Agent 通过 `capability` 自动可见。

---

## 7. 首次启动向导（BYOK 体验）

这是「数字主权」承诺真正被用户感知到的地方，建议做成一个可跳过的向导：

```
1. 选择供应商（勾选，可多选）
   ☑ OpenAI 兼容（OpenAI / DeepSeek / 百炼 / 智谱 / 火山方舟 / Ollama…）
   ☐ Gemini（原生协议）   ☐ Groq   ☐ OpenRouter   ☐ 本地模型（Ollama / LM Studio / LocalAI）
2. 为每个 provider 填凭据（可命名、可多把轮询、可标注用途）
3. 测试连接：GET {baseUrl}/models → 展示成功模型数，或 HTTP 状态 + 截断后的响应
4. 拉取目录：写入 ModelRecord（source: provider-api），与内置 420 条目录合并
5. 能力识别 + 人工确认：默认折叠，只提示「N 个模型的能力是推断的，建议确认」
6. 设定默认映射：文本 / 图片 / 视频 / 音频 各选一个，或「自动（按优先级）」
7. 完成：凭据写入 OS 安全存储，SQLite 只写 credentialRef
```

文案要点（与 R1 / R2 对齐，不要写成营销话术）：

- key 只存在这台机器上，CoolPilot 服务器永远收不到；
- 「账户会话 cookie」（若启用目录同步）只发给那一个域名，可随时清除；
- 数据目录可整包导出/备份，但**导出包里只有引用，没有 key**。

---

## 8. 路线图（P0 → P4，每阶段带验收标准）

每个阶段的通用门禁：`node_modules\.bin\tsc.cmd --noEmit`、`node_modules\.bin\vitest.cmd run`、`node_modules\.bin\eslint.cmd .` 全绿，并跑一次相关 smoke（`scripts/model-management-smoke.ts`、必要时新增脚本）。

### P0 · 凭据加固（先做，它决定品牌承诺是否成立）— 对应 G3 / R1

- **目标**：API key 不再明文落盘。
- **做法**：Electron 主进程用 `safeStorage`（Windows → DPAPI，macOS → Keychain，Linux → libsecret）加密后写入用户数据目录；`src/lib/secrets.ts` 继续作为唯一读取入口（安全存储 → 环境变量 → 文件的顺序，并暴露 `credentialStoreStatus` 给 UI）；打包与非打包（`next dev`）两种运行时都要有明确行为。
- **验收标准**：
  1. 写入 key 后 `.env.local` 里**不再出现**明文 key；
  2. `maskKey()` 输出格式不变（UI 无感知）；
  3. 迁移逻辑幂等：重复启动不会丢 key、不会重复写入；
  4. 非 Electron 运行时给出「凭据存储不可用」的可见提示，而不是静默降级回明文。
- **测试**：`readProviderKeys` 新增单测覆盖「安全存储有值 → 不读 env」「安全存储读取失败 → 回退但不落盘」。

### P1 · Registry 对象化 + 一次性迁移 — 对应 G2 / G7

- **目标**：`providers` / `models` / `capability_overrides` 三张表（或等价 JSON 文档），旧的扁平 settings 变成兼容视图。
- **验收标准**：
  1. 系统 → 模型管理页的分组、计数、状态与现在**完全一致**（420 条目录不回归）；
  2. 新增一个 OpenAI 兼容 provider（例如 Ollama `http://127.0.0.1:11434/v1`）**只改配置不改代码**；
  3. 停用某个 provider 后，选择器不再返回它的模型；
  4. `/api/settings/ai` 的请求/响应形状不变（旧 UI 无需改动）。

### P2 · 能力层可查询 — 对应 G1 / G6 / G8

- **目标**：`capabilityReport()` 返回每类能力的 `ready / total`；能力来源按 §5 的优先级合并。
- **验收标准**：
  1. 至少三个真实断言：Gemini 走 `supportedGenerationMethods`、OpenRouter 走 `architecture.modalities`、网关 id 走正则；
  2. UI 能修改单个模型的能力并持久化、可一键导出/导入覆盖数据；
  3. `selectModelCandidates({ capability: "vision", requires: ["structured-output"] })` 返回**可解释**的候选/空结果原因。

### P3 · Adapter + 统一 API — 对应 G4 / G5

- **目标**：所有调用经 `run({ capability, request })`；`image` 直连收编；`video` / `audio` / `embedding` 各至少一个 adapter 实现。
- **验收标准**：
  1. 业务代码不再直接 `fetch` 供应商端点（加一条 grep / eslint 门禁防回归）；
  2. `generateText` / `generateStructured` 对外行为不变，既有测试全绿；
  3. 新能力有单测，且覆盖「首选失败 → 降级到下一个候选」路径。

### P4 · Agent 消费能力 — 对应 G6

- **目标**：Agent 的工具声明所需能力，模型由选择器决定而不是写死 provider。
- **验收标准**：
  1. 截图理解类任务走 `vision` 模型；结构化输出任务走 `structured-output` 模型；
  2. 无可用模型时给用户可读原因（哪个能力缺、为什么缺：未启用 / 无凭据 / 不在目录）；
  3. 新接一个厂牌后，Agent 无需改代码即可用上它。

> 如果只能做一件事：**先做 P0**（安全问题一旦被用户发现就不可挽回），紧接着 **P2 的前半段**（能力可查询），因为 Agent 的所有编排都依赖它；P1 是 P2 的前置，建议并到同一个迭代里。

---

## 9. 风险与开放问题

| 风险 / 问题 | 说明 | 倾向的处理方式 |
| --- | --- | --- |
| **第三方平台条款** | 用账户会话 cookie 拉取账户内模型目录，可能与平台自动化条款冲突 | 只做「账户内目录读取」，不做批量操作；UI 明示、可一键清除；**绝不**设计成绕过访问限制的机制（与 README 免责声明一致） |
| **能力判定的准确性** | 现有实现是正则 + 模型 id 命名；新模型改名就会误判（`chat=221` 里可能混着多模态模型） | 结构化字段优先（Gemini / OpenRouter 已有），正则降级为兜底，并提供人工覆盖 + 导出 |
| **缺少价格元数据** | 目录里没有 pricing，无法做成本预估与「选便宜的」 | 先支持人工维护 + 厂商目录补全；`prefer.cheap` 在没有价格时退化为「按优先级」 |
| **多 key 轮询与成本** | `generate.ts` 现在会**洗牌**多把 key，等于随机花不同的额度 | 改成显式策略：首选 key → 失败才降级；把额度/限流状态做成可选元数据 |
| **工具调用（tool calling）缺失** | 现在的 Agent 工具是本地函数，没有走模型原生 tool calling | 单独设计「能力声明 + 工具协议」；`tool-calling` 能力标签先只做标记，不实现协议 |
| **结构化输出不通用** | `generateStructured` 靠 prompt + JSON 重试（已实现 2 次尝试） | 有 `structured-output` 能力的模型优先走原生 `response_format`；无能力时保留 prompt 兜底 |
| **本地模型能力差异** | Ollama / LM Studio / LocalAI 讲 `openai-compatible`，但视觉/嵌入/视频支持不一 | 与云厂商同构处理，凭 `capabilities` 与实测结果标注，不靠名字假设 |
| **打包后只读** | 打包版 Electron 的源码树不可写（现有同步已把结果写 SQLite） | 新表与覆盖数据也一律写 SQLite / 用户数据目录，禁止回写源码树 |
| **i18n 成本** | 每加一个能力或状态枚举，5 个语言包都要跟（现有 `modelCapability*` / `modelStatus*` 即为先例） | 新增枚举时同步 `src/locales/*.json`，并让 `i18n-coverage.test.ts` 兜底 |

---

## 10. 非目标（明确不做）

- 不做模型训练、微调、模型托管——CoolPilot 站在模型之上，不与模型竞争。
- 不做模型转售/中转，不成为模型供应商（BYOK 是产品前提，不是过渡方案）。
- 不让 CoolPilot 服务器变成 AI 代理：云模式（SMEPost）是可选的加速层，不是本地模式的依赖。
- 不在本层写 Agent 编排逻辑：本层只负责「提供可查询的能力 + 统一调用出口」，编排属于 Agent Runtime。
- 不把「支持 420 个模型」做成卖点——数字会被超过，能用起来的能力才是护城河。

---

## 附录 A · 现状文件索引（改这一层时先看这几处）

| 文件 | 所属层 | 职责 |
| --- | --- | --- |
| `src/features/ai-settings/provider-registry.ts` | Provider | 4 个内置 provider 元数据；`resolveProviderBaseUrl` / `resolveProviderModel` / `orderedProviders` |
| `src/features/ai-settings/model-catalog.ts` | Model 目录（实时） | 调各家 `/models`；`text` / `image` 过滤；1 小时缓存；`resolveFirstAvailableModel` |
| `src/features/ai-settings/mainstream-model-catalog.ts` | 厂牌元数据 | 7 类能力枚举 + 状态枚举；14 条厂牌（docs / key 控制台 / 兼容 endpoint / 本地 provider） |
| `src/features/ai-settings/model-gateway-catalog.ts` | Capability / 分组 | 22 条厂牌正则 + 7 条能力正则 + 分组与计数 |
| `src/features/ai-settings/model-gateway-snapshot.ts` | Model 目录（内置） | 420 个 id，由导入脚本生成，勿手改 |
| `src/features/ai-settings/model-gateway-sync.ts` | 目录同步 | 功能开关、endpoint、cookie 存取、同步状态、失败回退快照 |
| `src/features/ai-settings/model-gateway-payload.ts` | 纯函数 | 解析 `{"data":[…]}` / 裸数组、endpoint 标签、同步日期 |
| `src/lib/ai/providers.ts` | Protocol / Adapter | `callGemini` / `callOpenAICompatible` / `callProvider` + usage 归一化 |
| `src/lib/ai/generate.ts` | 调用编排 | 多 provider + 多 key 重试；`generateText` / `generateStructured` |
| `src/lib/agent/image-generation.ts` | image 能力（旁路） | 直连 `/images/generations` 与 Gemini `generateContent` |
| `src/lib/secrets.ts` | Credential | 多 key 读取/去重/脱敏；`.env.local` 读写；网关 cookie |
| `src/db/repositories/settings.ts` | 持久化 | `app_settings` KV（`local-agent` / `model-gateway` …） |
| `src/lib/types.ts` | 类型 | `LocalAgentSettings` / `ModelGatewaySettings` / provider 联合类型 |
| `src/components/system/model-management-client.tsx`、`model-config-panel.tsx`、`model-gateway-sync-panel.tsx` | UI | 模型管理（可用模型 / 模型配置）、配置面板、网关同步卡片 |
| `src/app/api/models/catalog/route.ts`、`src/app/api/models/gateway/route.ts`、`src/app/api/settings/ai/models/route.ts` | API | 目录聚合、同步 save/sync/reset、实时模型列表 |
| `scripts/import-gateway-models.ts`、`scripts/model-management-smoke.ts` | 工具 / 校验 | 快照导入；模型管理页浏览器冒烟 |

## 附录 B · 数字快照与复现

```bash
# 目录统计（本文 §2 的数字来源）
npx tsx -e "import { modelGatewayModels } from './src/features/ai-settings/model-gateway-snapshot'; \
import { buildGatewayVendorGroups, countGatewayModelsByCapability } from './src/features/ai-settings/model-gateway-catalog'; \
console.log(modelGatewayModels.length, buildGatewayVendorGroups().map(g => g.id + '=' + g.total)); \
console.log(countGatewayModelsByCapability());"
```

- 快照来源 `quanzil.com/api/user/models`，捕获日期 2026-10-08，共 420 个 id。
- 手动同步（用户自己的账户）见 README 的 *Syncing your own gateway account*；参数与失败语义由 `model-gateway-sync.ts` 定义。
- 本文是设计稿，不含实现承诺；实施按 §8 分阶段推进，每阶段结束回填本节的实测数字。






