# 模型层规格书（Model Layer Spec）

> 目标：把 Model Gateway **拆成 8 层**并逐层定死规格，让 CoolPilot 从「功能集合」变成真正的 **AI Runtime**。
>
> ```
> ① Provider → ② Endpoint → ③ Credential → ④ Model Registry
>           → ⑤ Capability → ⑥ Adapter → ⑦ Unified API → ⑧ Agent
> ```
>
> 三份文档的分工：
> - `docs/model-gateway.md`（设计篇）：为什么要有这一层、概念澄清、差距分析。
> - `docs/model-gateway-plan.md`（实施篇）：能不能做、改哪些文件、P0–P4 排期、业务闭环映射（§9）。
> - **本文（规格书）**：把每一层的边界、数据结构、接口、失败模式写死，作为实现时的唯一依据。

---

## 0. 读法：一条规则决定整份文档的写法

> **每一层都必须回答「我不负责什么」。** 层与层之间最有价值的不是它能做什么，而是它**被禁止**做什么。

本文每一层都按同一模板写：**职责 → 不负责 → 数据结构 → 接口 → 失败模式 → 落点文件 → 测试点**。

### 0.1 关于现有代码的一处关键澄清（决定数据形状）

```text
❌ 常见直觉：Provider(DeepSeek) → 协议(openai-compatible) → key
✅ 正确模型：Provider 只是「厂商身份」；协议属于 Endpoint
```

**证据**：`src/features/ai-settings/mainstream-model-catalog.ts:48-167` 里的 14 个厂商，每个都带 `compatibleBaseUrl`（OpenAI 兼容入口）与 `localProvider`（当前用哪个 provider 去调它）。也就是说**同一个厂商可以同时有「原生协议端点」和「OpenAI 兼容端点」**（Google 的 Gemini 就是典型：`generativelanguage.googleapis.com` 原生，另一个域名走 OpenAI 兼容）。

**结论**：`protocol` 必须挂在 **Endpoint** 上，不能挂在 Provider 上。否则「Gemini 走原生」和「Gemini 走兼容」永远表达不出来，而这两种路径的**请求体、错误码、能力集**都不同。

---

## 1. 八层总览

```
┌──────────────────────────────────────────────────────────────┐
│ ① Provider        厂商身份 / 文档 / 控制台 / 协议倾向（不可调用） │
├──────────────────────────────────────────────────────────────┤
│ ② Endpoint        protocol + baseUrl + authScheme（可调用的单位）│
├──────────────────────────────────────────────────────────────┤
│ ③ Credential      key/cookie 引用 + 轮询 + 状态机（正文不进库）  │
├──────────────────────────────────────────────────────────────┤
│ ④ Model Registry  endpoint×model 目录 + 能力标注 + 生命周期     │
├──────────────────────────────────────────────────────────────┤
│ ⑤ Capability      能力协商：要什么能力 → 哪些候选 + 为什么不行   │
├──────────────────────────────────────────────────────────────┤
│ ⑥ Adapter         protocol → 真实 HTTP（唯一的协议知识所在地）   │
├──────────────────────────────────────────────────────────────┤
│ ⑦ Unified API     chat / image / video / audio / embedding      │
├──────────────────────────────────────────────────────────────┤
│ ⑧ Agent           只用 capability + purpose，不认识厂商         │
└──────────────────────────────────────────────────────────────┘
```

| 层 | 一句话职责 | 明确不负责 | 当前代码里的种子 |
| --- | --- | --- | --- |
| ① Provider | 回答「这是哪家、文档在哪、怎么注册 key、倾向什么协议」 | **不可调用**；不存 key；不存模型 | `aiProviderRegistry`（4 家，`provider-registry.ts:20-57`）+ `mainstreamVendorRegistry`（14 家，`mainstream-model-catalog.ts:48-167`） |
| ② Endpoint | 回答「往哪个 URL、用哪种协议、怎么带凭据」 | 不知道具体模型；不管业务语义 | `resolveProviderBaseUrl()`（`provider-registry.ts:65-74`）、`defaultBaseUrl` / `baseUrlEnv` |
| ③ Credential | 回答「这次调用用哪把 key，它还有效吗」 | **不知道要调什么模型**；明文永不进 SQLite | `src/lib/secrets.ts`（现写 `.env.local`）、`maskKey()` |
| ④ Model Registry | 回答「这个端点有哪些模型、它们各自能做什么」 | 不做选择决策；不发请求 | `model-gateway-snapshot.ts`(420 条) + `model-catalog.ts`(探活) |
| ⑤ Capability | 回答「要 text/vision/image… → 哪些候选，以及为什么没有」 | 不持 HTTP 逻辑；不管凭据正文 | 目前**不存在**（`runWithProviders()` 只是按 provider 顺序重试） |
| ⑥ Adapter | 把统一请求翻译成协议请求，把协议响应翻译成统一结果 | **不做选择**、不读数据库、不碰 UI | `callProvider()` / `callGemini` / `callOpenAICompatible`（`providers.ts:67,94,127`）、`agent/image-generation.ts` 直连 fetch |
| ⑦ Unified API | 对外唯一入口，签名稳定、结果归一化、用量归因 | 不暴露 protocol/provider 细节给上层 | `generateText` / `generateStructured`（`generate.ts:85,115`） |
| ⑧ Agent | 用能力表达意图 | 禁止出现 provider/model 字面量 | `src/lib/agent/**`（19 个 `@/lib/ai` 引用方的一部分）、`toolPlanSchema` |

### 1.1 依赖方向（单向，禁止跳层）

```
⑧ Agent ──▶ ⑦ Unified API ──▶ ⑤ Capability ──▶ ④ Registry ──▶ ② Endpoint ──▶ ① Provider
                                      │                              │
                                      └────▶ ⑥ Adapter ◀────────────┘
                                                  ▲
                                              ③ Credential（只由 ⑥ 在调用瞬间取值）
```

三条硬规则：

1. **只允许向下依赖**，`⑥ Adapter` 可以从 `⑤` 拿候选、从 `②③` 拿连接信息，但**不能**反向调用 `⑦`。
2. **`⑦ Unified API` 不允许 import 任何协议知识**（不得出现 `generativelanguage`、`/chat/completions` 这类字面量）——协议知识只能存在于 `⑥`。
3. **`⑧ Agent` 不允许 import `④ Registry` 的写接口**（不能自己注册模型/改默认），只能通过 `⑦` 的 `capability + purpose` 表达意图。

---

## 2. 十条层间不变量（每条都要有对应测试）

| # | 不变量 | 违反的后果 | 怎么测 |
| --- | --- | --- | --- |
| I1 | 明文凭据**只**存在于 ③ 的解密结果与 ⑥ 的调用瞬间内存；不得进入 SQLite / 日志 / HTTP 响应 / 备份包 | 品牌承诺「key 只在这台机器」破产 | 写入后 grep 数据目录与所有响应体，断言无明文 |
| I2 | 任何对外展示的凭据只能是 `maskKey()` 结果（形如 `****1234`，`src/lib/secrets.ts:131`） | 截图/日志泄露 | 断言 UI/API 输出匹配 `/^\*+[A-Za-z0-9]{4}$/` |
| I3 | 每次业务调用必须可归因：endpoint / model / credential（掩码）/ 耗时 / tokens 都要落 `usage_records` | 闭环第 12–13 步无法回答「为什么好/差」 | 调用后查表断言字段齐全 |
| I4 | 能力判定失败必须返回 **reason 枚举**，不允许把原始异常栈抛给上层 | 用户体验与排障 | 无凭据场景断言 code = `AI_NO_CANDIDATE_MODEL` 且 details.reason 存在 |
| I5 | 协议知识（URL 路径、请求体字段名、鉴权头名）只允许出现在 ⑥ | 新增供应商要改 5 个文件 | ESLint 自定义规则或 grep 断言：`⑦` 层文件不含 `chat/completions` / `generativelanguage` |
| I6 | **Provider 不可调用**：任何代码路径都不得直接用 ① 发请求 | 「厂商」与「连接」再次纠缠 | grep 断言：`fetch(` 不出现在 ① 层模块 |
| I7 | 降级有顺序且有上限：credential 轮询 → endpoint 切换 → capability 降级；受统一 deadline 约束 | 无限重试、账单失控 | 用一个全部失败的假端点断言：总尝试次数 = 配置上限、总耗时 ≤ deadline |
| I8 | video 是**异步任务**，不得伪装成同步返回 | 上层误用、超时雪崩 | video 入口返回 `jobId`，类型上不存在同步 `video` 结果 |
| I9 | ③ 与 ④ 可独立重建：删库不丢 key；删 key 不毁目录 | 灾难恢复 | 删 app_settings/registry 表后重跑迁移，断言 key 仍在、目录可重建 |
| I10 | 每层对外接口的类型签名是契约：改动必须在本文更新（本文是唯一依据） | 文档与代码漂移 | `tsc` + code review；见 §13 测试矩阵 |

---

## 3. L1 · Provider（厂商身份层）

**职责**：回答「这是哪家、文档在哪、key 去哪申请、倾向什么协议」。

**不负责**：不可调用（没有 key、没有 URL 请求逻辑）、不存模型、不存凭据。

### 3.1 数据结构

```ts
export type ProviderRegion = "global" | "cn";

export type ProviderRecord = {
  id: string;                  // "openai" | "gemini" | "deepseek" | 用户自定义
  label: string;               // 展示名（内置走 TranslationKey，自定义走字面量）
  labelKey?: string;           // 内置厂商的本地化 key
  region: ProviderRegion;
  docsUrl?: string;
  apiKeyUrl?: string;
  /** 该厂商的 OpenAI 兼容入口（若存在）。注意：这是「建议值」，真源在 Endpoint。 */
  compatibleBaseUrl?: string;
  /** 原生协议入口（若存在），例如 Gemini 的 generativelanguage.googleapis.com */
  nativeBaseUrl?: string;
  builtin: boolean;            // 内置不可删，自定义可删
  createdAt: number;
  updatedAt: number;
};
```

**现有数据直接可迁移**（无需重新人工录入）：

| 现有字段 | 来源 | 迁移去向 |
| --- | --- | --- |
| 14 家厂商 `id/name/region/docsUrl/apiKeyUrl` | `mainstream-model-catalog.ts:48-167` | `ProviderRecord` 内置行 |
| `compatibleBaseUrl` | 同上 | **不写成 Provider 字段的真源**，而是迁移成一条 `EndpointRecord`（protocol = `openai-compatible`） |
| `localProvider`（如 Anthropic → `openrouter`） | 同上 | 迁移成「Endpoint 的备注」：当前这条能力是通过哪个本地 provider 可达 |
| 4 家 `aiProviderRegistry[].defaultBaseUrl` / `baseUrlEnv` | `provider-registry.ts:20-57` | 迁移成对应的 `EndpointRecord`（`ai_endpoints`），`baseUrlEnv` 降级为迁移时的兜底读值 |

### 3.2 接口

```ts
export function listProviders(): Promise<ProviderRecord[]>;       // 内置 ∪ 自定义
export function getProvider(id: string): Promise<ProviderRecord | null>;
export function upsertProvider(input: ProviderInput): Promise<ProviderRecord>;
```

### 3.3 边界判定（写进 code review 清单）

- ✅ 允许：维护「厂商 → 文档 / 控制台 / 建议入口」的元数据
- ❌ 禁止：`fetch()`、`process.env.*_API_KEY` 读取、`maskKey()` 调用（那属于 ③）
- ✅ 允许：`compatibleBaseUrl` 作为**创建 Endpoint 时的预填值**
- ❌ 禁止：在运行时把 `compatibleBaseUrl` 当作实际调用地址（实际地址只能来自 ②）

**落点**：`src/features/ai-settings/provider-registry.ts`（保留 `aiProviderRegistry` / `aiProviderOrder` 现有导出，内部改为「先读 DB，读不到退回静态定义」），新增 `src/db/repositories/model-registry.ts` 的 provider 部分。

**测试点**：内置 14 家 ∪ 自定义后 id 唯一；内置厂商 `labelKey` 在三份 locale 中都存在（`zh-hk` / `zh-cn` / `en`，key 集合必须一致——由 `src/lib/locale-resources.ts:10` 的类型约束强制）。

---

## 4. L2 · Endpoint（连接层）

**职责**：回答「往哪个 URL、用哪种协议、凭据怎么带、这个连接现在通不通」。

**不负责**：不知道任何具体模型；不做能力判定；不管业务重试语义。

### 4.1 数据结构

```ts
export type ModelProtocol = "openai-compatible" | "gemini-native" | "anthropic-native";

/** 凭据怎么放进请求。留位很重要：Gemini 用 query，Anthropic 用 x-api-key。 */
export type AuthScheme =
  | "bearer"                  // Authorization: Bearer <key>       （OpenAI / Groq / DeepSeek / OpenRouter …）
  | "header:x-api-key"        // x-api-key: <key>                  （Anthropic / 部分兼容网关）
  | "query:key"               // ?key=<key>                        （Gemini 原生）
  | "query:api-key"           // ?api-key=<key>
  | "none";                   // 本地模型（Ollama 默认无鉴权）

export type EndpointStatus = "unknown" | "ok" | "error" | "disabled";

export type EndpointRecord = {
  id: string;                 // uuid
  providerId: string;         // → ① Provider
  protocol: ModelProtocol;    // ← 协议属于 Endpoint，不属于 Provider（见 §0.1）
  baseUrl: string;            // 规范化后的根地址（无尾斜杠）
  authScheme: AuthScheme;
  label: string;              // 用户可命名：「OpenAI 官方」「XX 代理」「本机 Ollama」
  enabled: boolean;
  priority: number;           // 越小越优先，用于候选排序与默认端点
  timeoutMs: number;          // 默认 60_000；本地模型可放宽
  extraHeadersJson: string;   // 默认 "{}"；企业网关/中转需要的自定义头
  status: EndpointStatus;
  lastCheckAt: number | null;
  lastError: string;          // 截断后的可读错误（**必须脱敏**，见 I2）
  createdAt: number;
  updatedAt: number;
};
```

### 4.2 三条设计决定

1. **`(protocol, baseUrl)` 唯一**，但允许**同协议多实例**：官方 API、第三方代理、本地 Ollama 可以并存，靠 `priority` 排序、靠 `label` 区分。这是「用户自带 key」与「企业内网中转」能共存的前提。
2. **`baseUrl` 必须规范化**：复用现成的 `normalizeEndpoint()`（`mainstream-model-catalog.ts:173`，去尾斜杠 + 小写）。存储前规范化，比较时也规范化，避免 `https://api.x.com/v1/` 与 `https://api.x.com/v1` 被当成两个端点。
3. **`status` 是缓存而非真源**：每次探活或调用失败都可以更新它，但 UI 上永远显示「最近一次检查结果 + 时间」，不允许把 `status: "ok"` 当作「现在一定可用」。

### 4.3 接口

```ts
export function listEndpoints(filter?: { providerId?: string; protocol?: ModelProtocol; enabledOnly?: boolean }): Promise<EndpointRecord[]>;
export function upsertEndpoint(input: EndpointInput): Promise<EndpointRecord>;
export function setEndpointEnabled(id: string, enabled: boolean): Promise<EndpointRecord>;
export function testEndpoint(input: { endpointId: string; credentialId?: string }): Promise<EndpointProbe>;

export type EndpointProbe = {
  ok: boolean;
  httpStatus: number | null;   // null = 连接层失败（DNS/超时/拒绝）
  modelCount: number;          // 探活成功后拿到的模型数
  latencyMs: number;
  error?: { code: AppErrorCode; message: string };  // 已脱敏
};
```

**探活实现提示**：现有 `listProviderModels()`（`src/features/ai-settings/model-catalog.ts:127`）已经在做「拉模型列表 + 归一化」，探活直接复用它并**只取长度与状态**（不把 4000 行目录塞进响应）。`?capability=image` 这类查询参数也在那里处理，正好覆盖「探活时顺带验证该端点是否真有 image 模型」。

### 4.4 失败模式（这张表就是 ⑥ 的错误映射依据）

| 现象 | 语义 | 同一 key 重试？ | 需要用户操作？ | 归一化错误码（新增，见 §14） |
| --- | --- | --- | --- | --- |
| 401 | 凭据无效 | ❌ | ✅ 该 key 标记 `invalid` | `AI_CREDENTIAL_INVALID` |
| 403 | 权限 / 地区限制 | ❌ | ✅ | `AI_CREDENTIAL_FORBIDDEN` |
| 404 | 路径或模型不存在 | ❌ | 可能（模型名过期） | `AI_MODEL_NOT_FOUND` |
| 408 / 504 | 超时 | ✅ 一次 | ❌ | `AI_TIMEOUT` |
| 429 | 限流 | ❌（换 key / 换端点 / 退避） | ❌ | `AI_RATE_LIMITED` |
| 5xx | 上游故障 | ❌（换端点） | ❌ | `AI_ENDPOINT_UNAVAILABLE` |
| DNS / ECONNREFUSED | 端点不可达（本地模型没启动） | ❌ | ✅ 提示「启动 Ollama」 | `AI_ENDPOINT_UNREACHABLE` |
| 200 但空响应 | 上游怪异 | ❌（换候选） | ❌ | `AI_PROVIDER_NO_TEXT`（**复用现有码**，`app-errors.ts:12`） |

### 4.5 边界判定

- ✅ 允许：存 URL、协议、鉴权方式、超时、自定义头、探活结果
- ❌ 禁止：把「模型列表」存进这个层（那是 ④ 的职责）
- ❌ 禁止：在这里判断「这个端点能不能做图片」（那是 ⑤ 结合 ④ 的判断）
- ❌ 禁止：`lastError` 里出现明文 key —— 写库前必须过一遍脱敏（把 key 片段替换成 `***`）

**落点**：`ai_endpoints` 表（`src/db/client.ts` 的 statements 数组 + `src/db/schema.ts`），读写封装在 `src/db/repositories/model-registry.ts`。

**测试点**：规范化幂等（同一 baseUrl 不同写法只生成一行）；`(protocol, baseUrl)` 冲突时是 `update` 而不是插入两行；探活在 401 时返回 `ok:false` 且 `error.code === "AI_CREDENTIAL_INVALID"`；`lastError` 不含明文。

---

## 5. L3 · Credential（凭据层）—— 整层最难、也最值钱的一层

**职责**：回答「这次调用用哪把 key、它还有效吗、什么时候该换下一把」。

**不负责**：不知道要调什么模型；不发业务请求（只有探活）；**明文永不进 SQLite / 日志 / 响应 / 备份**。

### 5.1 数据结构（库里只有引用）

```ts
export type CredentialStatus =
  | "unknown"        // 从未验证
  | "ok"             // 最近一次验证通过
  | "invalid"        // 401：key 无效
  | "forbidden"      // 403：权限/地区
  | "rate_limited"   // 429：进入冷却
  | "disabled";      // 用户手动停用

export type CredentialRecord = {
  id: string;
  endpointId: string;            // 凭据属于**端点**，不属于厂商（见 §0.1）
  ref: string;                   // 例如 "coolpilot:credential:<uuid>"；解密入口的唯一句柄
  label: string;                 // 「主 key」「团队 key」「小号 key」
  masked: string;                // "****1234"（maskKey() 结果，I2）
  tagsJson: string;              // 默认 "[]"；用途标签，如 ["article","vision"]
  status: CredentialStatus;
  lastCheckAt: number | null;
  lastUsedAt: number | null;
  useCount: number;
  errorCount: number;
  cooldownUntil: number | null;  // 429 后的冷却截止时间
  createdAt: number;
  updatedAt: number;
};
```

### 5.2 状态机（转移必须明确，禁止隐式）

```
unknown ──test ok────▶ ok ──401──▶ invalid ──rotate(new)──▶ unknown
   │                    │ │
   │                    │ └─429─▶ rate_limited(cooldownUntil) ──到期──▶ unknown
   │                    └──403──▶ forbidden
   └──user──▶ disabled ──user──▶ unknown
```

选择规则（⑥ 每次调用前提问，③ 只回答「用哪把」）：

1. 过滤掉 `disabled`；
2. 过滤掉 `cooldownUntil > now` 的 `rate_limited`；
3. 过滤掉 `invalid` / `forbidden`（**除非**用户点了「仍然尝试」，用于排查）；
4. 在剩下的里按策略排序：`round-robin`（默认，按 `useCount` 升序）或 `least-recently-used`（按 `lastUsedAt`）；
5. 返回 `{ credentialId, ref, label, masked }` —— **注意返回的是 ref，不是明文**。明文只在 ⑥ 调用瞬间由 `getSecret(ref)` 取出，用完即弃（不缓存到模块级变量）。

### 5.3 明文存取：三个 provider，一个接口

```ts
export type SecretBackend = "os-encrypted" | "file-encrypted" | "env-only";

export function secretBackend(): SecretBackend | "unavailable";
export function getSecret(ref: string): Promise<string | null>;
export function setSecret(ref: string, value: string): Promise<void>;
export function deleteSecret(ref: string): Promise<void>;
```

| backend | 何时生效 | 保护强度（UI 必须如实显示） |
| --- | --- | --- |
| `os-encrypted` | Electron 主进程的凭据桥可用（`safeStorage` → Windows DPAPI / macOS Keychain） | 高：绑定当前操作系统用户 |
| `file-encrypted` | 纯 `pnpm dev` / `next start`（桥不存在） | 中：AES-256-GCM + 数据目录内主密钥（限制文件权限） |
| `env-only` | 老用户遗留 `.env.local` 或显式 `COOLPILOT_CREDENTIAL_MODE=env` | 低：明文，**UI 必须黄色告警** |

**两个硬约束**

- **只写一处**：`setSecret()` 只能写当前 `secretBackend()`，不允许「桥 + 文件」双写（否则解密路径不一致时会出现「有一份能读、一份读不到」的诡异状态）。
- **迁移只做一次**：老用户首次读取时，把 `.env.local` 里的 `GEMINI_API_KEYS` / `OPENAI_API_KEYS` / `GROQ_API_KEYS` / `OPENROUTER_API_KEYS` / `MODEL_GATEWAY_COOKIE`（`src/lib/secrets.ts:34-45` 的变量名）搬进 store，然后**从文件里删掉这些行**并写入 `COOLPILOT_CREDENTIALS_MIGRATED=1` 作为标记，避免反复迁移。

### 5.4 生命周期操作（都要能回滚）

| 操作 | 语义 | 关键约束 |
| --- | --- | --- |
| `create` | 新增一把 key | 先写 store，再写 `ai_credentials`（顺序不能反：库里出现 ref 时明文必须已可解） |
| `rotate` | 换新 key | **先写新、验证通过后再删旧**，避免把自己锁死；两把并存期间选择策略优先新的 |
| `disable` | 保留但不用 | 只改状态，不碰 store（用户可能只是想临时停用） |
| `delete` | 彻底移除 | 先删 `ai_credentials` 行，再 `deleteSecret(ref)`；允许 store 残留孤儿（下次 GC 清理） |
| `test` | 验证有效性 | 复用 ② 的 `testEndpoint({ credentialId })`，成功后更新 `status` / `lastCheckAt` |

### 5.5 边界判定

- ✅ 允许：状态机、多 key 轮询、冷却、掩码、迁移
- ❌ 禁止：知道模型名、判断 capability、拼 HTTP 请求（除探活）、把明文写进任何日志（含 `console.error`）
- ❌ 禁止：把明文缓存在模块级变量里「提升性能」

**落点**：`src/lib/credentials/{data-dir,store,bridge}.ts` + `electron/secret-bridge.cjs` + `ai_credentials` 表 + 改造后的 `src/lib/secrets.ts`（5 个导出签名不变，见实施篇 §3-P0）。

**测试点**：状态机 6 条转移全覆盖；轮询跳过冷却中的 key；`rotate` 期间调用不失败；写入后数据目录与响应体 grep 无明文（I1）；`masked` 匹配 `/^\*+.{4}$/`（I2）。

---

## 6. L4 · Model Registry（目录层）

**职责**：回答「这个端点有哪些模型、它们各自能做什么、现在还活着吗」。

**不负责**：不做选择决策（那是 ⑤）；不发请求；不读凭据。

### 6.1 数据结构

```sql
CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  -- '' = 仅目录知识（内置快照/公共知识），**未绑定端点 ⇒ 不可调用**
  endpoint_id TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL,                       -- 上游原始 id，如 "gpt-4o-mini"
  canonical_model_id TEXT NOT NULL DEFAULT '',  -- 跨端点同一模型的归一 id
  display_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'snapshot',      -- snapshot | provider-api | manual | imported
  capabilities_json TEXT NOT NULL DEFAULT '[]',        -- 见 §7 的 7 个 canonical 能力
  capability_sources_json TEXT NOT NULL DEFAULT '{}',  -- 每个能力的来源：declared | inferred | pinned
  features_json TEXT NOT NULL DEFAULT '{}',            -- 细粒度约束，见 §6.4
  context_window INTEGER,
  max_output_tokens INTEGER,
  price_json TEXT NOT NULL DEFAULT '{}',        -- 每 1K/1M tokens 的输入/输出价（可后补）
  status TEXT NOT NULL DEFAULT 'active',        -- active | deprecated | unavailable
  replaced_by TEXT,                             -- 指向新模型 id（下架/改名）
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_models_endpoint_model ON ai_models(endpoint_id, model_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_canonical ON ai_models(canonical_model_id);
```

**一个必须说清的 SQLite 细节**：「未绑定端点」如果用 `NULL` 表示，`UNIQUE(endpoint_id, model_id)` 就会失效——SQLite 认为多个 `NULL` 互不相同，同一个 `gpt-4o` 快照行会被插入无限多次。所以这里用 **`''` 表示未绑定**，让唯一索引真正生效。这是 P1 建表时最容易踩的坑。

### 6.2 「可调用」的判定（修掉今天最大的误导）

今天的 UI 会把 420 条目录（含 video / audio / embedding）展示得像是可调用的，但实际没有调用实现。规格上必须区分三种状态：

| 状态 | 判定条件 | UI | 选择器 |
| --- | --- | --- | --- |
| **目录知识** | `endpoint_id = ''`（内置快照 / 公共知识） | 显示为「市场上存在」，并明确标注「未配置端点，暂不可调用」 | **不允许选中** |
| **已发现** | 绑定端点 + `source = provider-api`，但该端点没有可用凭据 | 显示「缺少凭据」 | 不允许选中，`reason = no_credential` |
| **可调用** | 绑定端点 + 端点 `enabled` + `status = active` + 至少一把可用凭据 + ⑥ 有对应 protocol 的 adapter 且支持该 capability | 显示「可用」 | 允许选中 |

> 这条规则的价值：把「可见」和「可调」彻底分开。用户看到 video 模型时，界面会如实告诉他缺什么，而不是让他点了之后报 500。

### 6.3 合并规则（多来源冲突时谁赢）

一个模型可能同时来自「内置快照」「provider API 探测」「用户手工录入」，必须有一条确定的合并规则：

| 字段 | 优先级（高 → 低） | 说明 |
| --- | --- | --- |
| 真实 id / 是否可调用 | `provider-api` > `manual` > `snapshot` | 只有探测到的才是「这台机器真能调」 |
| `capabilities` | `pinned`（用户确认） > `declared`（上游声明） > `inferred`（分类器推断） | 推断永远可以被推翻 |
| `context_window` / `price` | `provider-api` > `manual` > `snapshot` | 上游返回的最准 |
| `display_name` | `manual`（用户改名） > `provider-api` > `snapshot` | 用户改名不能被同步覆盖 —— 这是同步逻辑最容易写错的地方 |
| `enabled` | `manual` 优先，同步不得擅自启用被用户关掉的模型 | 同上 |
| `status` | 只要 `last_seen_at` 在 N 次拉取内出现就 `active`；连续 N 次不见 → `deprecated` | **不删除**（删除会丢用户的能力标注与默认映射） |

### 6.4 `capability` 之外还需要 `features`（做不到这一步就没「想透」）

`capability` 只能回答「能干什么大类」，但真实路由需要更细的约束。例如「我要分析一张图片」需要 `vision_input`；「我要结构化 JSON」需要 `json_mode`；「我要生成 10 秒视频」需要 `async_job`。

```ts
export type ModelFeature =
  // 输入类
  | "text_input" | "vision_input" | "video_input" | "audio_input"
  // 文本类
  | "json_mode" | "json_schema_strict" | "tool_calling" | "streaming"
  // 图片类
  | "image_output" | "image_size_options" | "image_n_images"
  // 视频类
  | "video_output" | "video_duration_options" | "video_image_to_video"
  // 音频类
  | "audio_output" | "audio_voice_options" | "audio_transcription"
  // 向量类
  | "embedding_output" | "embedding_dimensions"
  // 任务形态
  | "async_job";
```

**能力 → 必需 features 的映射**（选择器的可行性过滤依据）：

| 请求意图 | 必需 capability | 必需 features |
| --- | --- | --- |
| 纯文本生成 / 改写 | `chat` | `text_input` |
| 长文推理、复杂规划 | `reasoning` | `text_input` |
| 结构化输出（现有 `generateStructured` 11 处调用） | `chat` | `text_input` + `json_mode` |
| 代码生成 | `code` | `text_input` |
| **看图片后回答问题**（闭环第 4–5 步） | `chat` | `text_input` + `vision_input` |
| 文生图 | `image` | `image_output` |
| 图生图 / 改图 | `image` | `image_output` + `vision_input` |
| 文生视频 | `video` | `video_output`（+ `async_job`） |
| 语音合成 | `audio` | `audio_output` |
| 语音转写 | `audio` | `audio_transcription` |
| 向量化（闭环第 3 步去重、第 12–13 步聚类） | `embedding` | `embedding_output` |

### 6.5 接口

```ts
export function listModels(filter?: { endpointId?: string; providerId?: string; capability?: AiCapability; callableOnly?: boolean }): Promise<ModelRecord[]>;
export function upsertModels(input: { endpointId: string; providerId: string; source: ModelSource; models: ModelRecordInput[] }): Promise<{ added: number; updated: number; deprecated: number }>;
export function markDeprecated(input: { endpointId: string; seenModelIds: string[] }): Promise<number>;  // 连续不见 → deprecated，不删
export function importSnapshot(): Promise<number>;   // 内置 420 条 → endpoint_id = ''
export function getModel(id: string): Promise<ModelRecord | null>;
```

### 6.6 边界判定

- ✅ 允许：目录写入、能力标注、生命周期（deprecated/replacedBy）、价格与上下文窗口
- ❌ 禁止：在这里决定「用哪个模型」（⑤ 的职责）
- ❌ 禁止：`fetch()`（探测由 ② 的 `testEndpoint` / ⑤ 的同步动作触发）
- ❌ 禁止：读凭据（目录同步需要 key，但那由调用方传入的 endpoint+credential 组合决定）

**落点**：`ai_models` 表 + `src/db/repositories/model-registry.ts`；内置快照导入复用 `model-gateway-snapshot.ts`（实测 420 条 / 22 个厂商组）。

**测试点**：同一模型在不同端点生成两行且 `canonical_model_id` 相同；未绑定端点的快照行 `callableOnly` 查询中被排除；连续两次同步之间消失的模型变成 `deprecated` 而非被删除；用户改过 `display_name` 后再次同步不被覆盖。

---

## 7. L5 · Capability（能力协商层）—— 「用能力选模型」的真正落点

**职责**：回答「要 text/vision/image/video/audio/embedding → 哪些候选可用，按什么顺序，为什么其它不行」。

**不负责**：不发 HTTP（交给 ⑥）；不读凭据正文（只拿 ③ 给的 ref）；不写数据库；**不决定业务含义**（那是 ⑧）。

### 7.1 两套能力名的关系（必须先对齐，否则会撞类型）

| 现有 | 值 | 用途 | 规格里的处理 |
| --- | --- | --- | --- |
| `ModelCapability`（`model-catalog.ts:6`） | `"text" \| "image"` | **仅**用于「按 provider 探测模型列表」的窄场景 | **保留不动**（否则 `listProviderModels` 与 `/api/settings/ai/models` 的归一化逻辑全要改） |
| `mainstreamModelCapabilities`（`mainstream-model-catalog.ts:12`） | `"chat" \| "reasoning" \| "code" \| "image" \| "video" \| "audio" \| "embedding"` | 目录分类（已有的 7 个 canonical 值） | **升级为规格的 canonical 能力集**，命名沿用这 7 个 |
| 新增 `AiCapability` | 上述 7 个 | 选择器 / Registry / Unified API | 新增类型，并给出 `text → chat` 的别名映射（`text` 视作 `chat`，兼容现有调用方语义） |

### 7.2 请求形状（意图，而不是参数）

```ts
export type AiCapability = "chat" | "reasoning" | "code" | "image" | "video" | "audio" | "embedding";

export type CapabilityRequest = {
  capability: AiCapability;
  /** 细粒度约束，来自 §6.4 的 ModelFeature */
  requires?: ModelFeature[];
  /** 用途标签：用来命中 ai_defaults 与凭据 tags（"article" / "topic" / "insight" …） */
  purpose?: string;
  prefer?: {
    endpointId?: string;
    providerId?: string;
    modelId?: string;
    /** true = 只在用户显式指定的端点上找，找不到就失败（不允许悄悄换） */
    strict?: boolean;
  };
  constraints?: {
    minContextTokens?: number;
    maxInputCostPer1M?: number;   // 价格未填时视为「无约束」
    excludeModelIds?: string[];
  };
  /** 总预算：包含所有重试与降级的总耗时上限 */
  deadlineMs?: number;
  /** false = 只返回第一个候选（旧调用方语义），true = 返回候选队列（推荐） */
  allowFallback?: boolean;
};

export type CapabilityReason =
  | "no_endpoint"          // 没有任何启用的端点
  | "no_credential"        // 有端点但没有可用凭据（或全在冷却）
  | "no_capability_model"  // 没有任何模型声明支持该能力
  | "no_feature_match"     // 有该能力但没有满足 features 的模型
  | "adapter_unsupported"  // 有模型但 ⑥ 里没有对应 protocol 的 adapter 实现
  | "filtered_by_prefer"   // strict 指定 + 不匹配
  | "excluded_by_constraint" // 被 cost / context / exclude 列表过滤掉
  | "deadline_exceeded";   // 全部候选在预算内没跑完

export type CapabilityDecision = {
  candidates: Candidate[];      // 有序：候选队列，不是单个
  reason?: CapabilityReason;    // 仅当 candidates 为空
  trace: DecisionTrace[];       // 可解释：为什么选它、为什么排除其它（见 7.4）
};

export type Candidate = {
  endpoint: EndpointRecord;
  model: ModelRecord;
  credential: { id: string; ref: string; label: string; masked: string };
  features: ModelFeature[];
  score: number;
};
```

### 7.3 协商算法（顺序即优先级，可用代码直接实现）

```
1. 取所有 enabled endpoint（②）
2. 对每个 endpoint 取可用凭据（③，跳过 disabled / 冷却中）
3. 取该端点下 callableOnly 的模型（④，`endpoint_id != ''` 且 status=active）
4. 能力过滤：模型 capabilities 含本次 capability
5. feature 过滤：model.features ⊇ request.requires
6. adapter 过滤：⑥ 的 adapterFor(endpoint.protocol) 存在且声明支持该 capability + features
7. prefer 过滤（strict 时硬过滤，非 strict 时加权）
8. ai_defaults 命中（purpose → model_ref）→ 直接提到队首
9. 排序：priority(端点) → 是否默认 → score(能力/feature 命中数) → 价格 → context 大小
10. 若候选为空 → 用最靠前失败的那一步决定 reason（而不是笼统「失败」）
```

**第 10 步是这一层最重要的设计**：错误必须是「最后一个瓶颈」，而不是「没有可用模型」。用户看到 `no_credential`（去填 key）和看到 `adapter_unsupported`（这个功能还没做）是两件完全不同的事。

### 7.4 可解释性（`trace`）

每次协商都要能输出人类可读的决策轨迹，用于 UI 提示与排障：

```ts
export type DecisionTrace = {
  step: "endpoints" | "credentials" | "models" | "capability" | "features" | "adapter" | "prefer" | "rank";
  kept: number;
  dropped: Array<{ id: string; why: string }>;   // 例：{ id: "openai-official", why: "no_credential" }
};
```

UI 上「为什么我不能生成视频」应该直接读 `trace` 回答：`③ 有 2 个端点 → ④ 有 53 个 video 模型 → ⑥ adapter 不支持 "video/async_job"`。

### 7.5 边界判定

- ✅ 允许：调用 ②③④⑥ 的**只读**接口；缓存协商结果（短 TTL，且凭据状态变化时必须失效）
- ❌ 禁止：`fetch()`；`getSecret()`（只允许拿 ref，明文在 ⑥ 内部取）；写库
- ❌ 禁止：把「用户偏好」写成 provider 字面量（偏好只能是 endpoint/model id 或 capability+purpose）

**落点**：`src/features/ai-settings/capability-registry.ts`（+ test）。

**测试点**：8 种 `reason` 逐个有测试；`prefer.strict` 时不会悄悄换端点；候选排序在「价格未填」时不崩（视为无约束）；`allowFallback: false` 时只返回 1 个候选（兼容旧语义）。

---

## 8. L6 · Adapter（协议层）—— 全系统唯一允许知道协议的地方

**职责**：把统一请求翻译成协议请求，把协议响应翻译成统一结果，并把协议错误映射成统一错误码。

**不负责**：不做选择（⑤ 给候选，⑥ 只是执行者）、不读数据库、**不自己取凭据**（明文由调用方按 ref 取出后传入，见 §5.2 第 5 条）。

### 8.1 接口

```ts
export interface ModelAdapter {
  readonly protocol: ModelProtocol;
  /** 声明这层能承载哪些能力与 features —— ⑤ 的过滤依据（不声明就等于不支持） */
  readonly capabilities: AiCapability[];
  readonly features: ModelFeature[];

  run(input: AdapterInput): Promise<AdapterResult>;
}

export type AdapterInput = {
  endpoint: EndpointRecord;
  model: Pick<ModelRecord, "model_id" | "capabilities" | "features" | "max_output_tokens">;
  credential: { id: string; label: string; masked: string; secret: string };  // secret 仅本次调用持有
  request: ModelRequest;
  signal?: AbortSignal;
};

export type ModelRequest = {
  capability: AiCapability;
  prompt?: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** 多模态输入：data URL 或本地路径（闭环第 4–5 步的关键能力） */
  images?: string[];
  json?: boolean;
  jsonSchema?: unknown;         // 结构化输出时使用（现有 generateStructured 的 schema）
  size?: string;                // image
  n?: number;                   // image
  voice?: string;               // audio
  durationSeconds?: number;     // video
  signal?: AbortSignal;
};

export type AdapterResult = {
  text?: string;
  json?: unknown;
  files?: Array<{ path: string; mimeType: string }>;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  /** 异步任务（video）：立即返回 jobId，产物由 poll/job 接口取 */
  job?: { jobId: string; statusUrl?: string; provider?: string };
  /** 调试信息，**必须脱敏**后才允许记录 */
  raw?: unknown;
  latencyMs: number;
};
```

### 8.2 协议差异对照表（这张表就是 adapter 存在的理由）

| 维度 | `openai-compatible` | `gemini-native` | 现有代码落点 |
| --- | --- | --- | --- |
| 鉴权 | `Authorization: Bearer <key>` | `?key=<key>`（或 `x-goog-api-key`） | `providers.ts:94` / `providers.ts:67` |
| 文本路径 | `POST {base}/chat/completions` | `POST {base}/v1beta/models/{model}:generateContent` | 同上 |
| 模型列表 | `GET {base}/models` | `GET {base}/v1beta/models` | `model-catalog.ts:153-159` |
| **图像输入** | `content[{type:"image_url",image_url:{url}}]` | `parts[{inlineData:{mimeType,data}}]` | **目前不存在**（`image-generation.ts:86` 只解析**响应**里的 `inlineData`） |
| 图像输出 | `POST {base}/images/generations` → `data[].b64_json` | `generateContent` + `responseModalities:["TEXT","IMAGE"]` | `agent/image-generation.ts` 的两个分支 |
| 结构化输出 | `response_format:{type:"json_schema"｜"json_object"}` | `generationConfig:{responseMimeType,responseSchema}` | `generate.ts:98 parseStructured`（现在是拿文本再 JSON.parse） |
| 用量字段 | `usage.prompt_tokens / completion_tokens` | `usageMetadata.promptTokenCount / candidatesTokenCount` | `providers.ts:10 TokenUsage` |
| 错误体 | `{error:{message,type,code}}` | `{error:{code,message,status}}` | 无（现在直接把文本塞进 Error） |
| 流式 | SSE：`data: {...}` + `[DONE]` | `?alt=sse` 或 JSON 行 | 目前全为非流式 |

### 8.3 错误映射（与 §4.4 一致，不许另起一套）

```ts
export function mapProtocolError(input: {
  httpStatus: number | null;      // null = 连接层失败
  body: unknown;                  // 原始错误体（脱敏后记录）
  protocol: ModelProtocol;
}): { code: AppErrorCode; message: string; retryable: boolean; credentialInvalid: boolean };
```

要点：

- `credentialInvalid: true` 时，⑥ 必须回报给 ③，让那把 key 转 `invalid`/`forbidden`（状态机 §5.2），**但不允许自己改库**——通过返回值让上层决定。
- `retryable: true` 仅限超时与 5xx；429 归入「可换 key / 可退避」，但不是同 key 立刻重试。
- 统一错误体的 `details` 里必须带 `{ protocol, endpointId, modelId, httpStatus }`（**不带 key**），这是排障的最小信息集。

### 8.4 重试 / 退避 / 取消

| 关注点 | 规则 |
| --- | --- |
| 超时 | 用 ② 的 `endpoint.timeoutMs`；`AbortSignal.timeout()` 或外层 deadline，取更小者 |
| 退避 | 仅对 429 / 5xx / 超时：`min(2^n * 300ms, 5s)`，且总次数 ≤ 3 |
| 换 key | 由 ⑦ 的调度层做（③ 提供下一把），⑥ 不感知「还有几把 key」 |
| 取消 | `signal` 必须从 ⑦ 贯穿到 `fetch`；取消后不得写 `usage_records` 的成功行 |
| deadline | 由 ⑦ 统一持有（`deadlineMs`），⑥ 每次调用前检查剩余预算，不足则直接抛 `AI_TIMEOUT` |

### 8.5 结果归一化（上层只认这几种）

- 文本：`text`（空 → `AI_PROVIDER_NO_TEXT`，复用现有码）
- 结构化：`json`（解析失败 → `AI_STRUCTURED_OUTPUT_INVALID`，现有码）
- 图片 / 音频产物：`files[]`（落盘由 ⑦ 负责，路径统一由 `src/lib/paths.ts` 的约定决定）
- 视频：`job`（**不允许**同步返回视频字节，见 I8）
- 用量：`usage`（两种协议命名都归一到 `inputTokens/outputTokens/totalTokens`）

### 8.6 边界判定

- ✅ 允许：URL 路径、请求体字段名、鉴权头、错误码映射、重试退避、SSE 解析
- ❌ 禁止：`import` 任何 `src/db/**`；选择模型；读取其它凭据；把 `credential.secret` 写进日志或异常消息
- ❌ 禁止：在 ⑦ 或 ⑤ 里出现协议字面量（I5）

**落点**：`src/lib/ai/adapters/{types,openai-compatible,gemini-native,index}.ts`；`src/lib/ai/providers.ts` 的 `callProvider()`（`:127`）改为查 `adapterFor()`，`ProviderCallOptions` / `ProviderResult` / `TokenUsage` 导出保持不变。

**测试点**（全部用 mock fetch，不碰网络）：4 类错误（无 key / 401 / 空响应 / 超时）各一条；**图像输入**在两种协议下生成的请求体形状正确（这是新增能力，必须单独测）；用量字段两种命名都能解析；`signal` 取消后不产生成功记录；`raw` 中不含明文。

---

## 9. L7 · Unified API（统一出口层）

**职责**：对外唯一入口：签名稳定、结果归一化、**降级调度**、用量归因、deadline 管理。

**不负责**：协议知识（⑥）、候选选择的细节（⑤）、业务语义（⑧）。

### 9.1 六个入口（不多不少）

```ts
// 1) 文本类：现有 generateText / generateStructured 都由它承载
export function chat(input: ChatInput): Promise<ChatOutput>;
// 2) 图片
export function image(input: ImageInput): Promise<ImageOutput>;
// 3) 视频：异步任务三件套（I8）
export function submitVideo(input: VideoInput): Promise<{ jobId: string; meta: CallMeta }>;
export function videoStatus(jobId: string): Promise<VideoJobStatus>;
export function fetchVideo(jobId: string): Promise<{ files: FileRef[]; usage?: Usage }>;
// 4) 音频：合成与转写
export function speak(input: SpeakInput): Promise<AudioOutput>;
export function transcribe(input: TranscribeInput): Promise<TextOutput>;
// 5) 向量
export function embed(input: EmbedInput): Promise<EmbedOutput>;
// 6) 运维：探活（UI 的「测试连接」按钮）
export function testConnection(input: { endpointId: string; credentialId?: string }): Promise<EndpointProbe>;
```

### 9.2 统一返回的 `meta`（I3 的落点）

```ts
export type CallMeta = {
  capability: AiCapability;
  purpose: string;                        // "article" / "topic" / "insight" / "generic" …
  endpointId: string;
  providerId: string;
  modelId: string;
  credentialLabel: string;                // 掩码后的 label（I2）
  latencyMs: number;
  attempts: Array<{ endpointId: string; modelId: string; credentialRef: string; error?: AppErrorCode }>;
  degradedFrom?: { modelId: string; reason: AppErrorCode };  // 发生了降级时填
  trace?: DecisionTrace[];                // 仅在诊断模式返回（避免响应体过大）
};
```

`attempts` 是「可归因」的核心：**每一次失败尝试都要留在 meta 里**，这样闭环第 12–13 步才能回答「这轮质量差是不是因为某个 provider 一直在限流」。

### 9.3 调度循环（降级顺序在代码里只有这一处）

```
deadline = now + (request.deadlineMs ?? 60_000)
decision = ⑤ 协商(capability, requires, purpose, prefer, constraints)
if decision.candidates 为空 → 抛 AI_NO_CANDIDATE_MODEL(details = { reason, trace })

for candidate of decision.candidates:                # 外层：换端点/模型
  for credential of ③ 该端点的可用序列:               # 内层：换 key 轮询
    if now > deadline → 抛 AI_TIMEOUT
    secret = ③ getSecret(credential.ref)             # 明文只在这一行存在
    try:
      result = ⑥ adapterFor(candidate.endpoint.protocol).run({ ..., credential: { ...credential, secret } })
      ③ 记录成功（useCount+1, status=ok）
      ⑦ 写 usage_records（成功）
      return { ...result, meta }
    catch e:
      ③ 记录失败（errorCount+1, 401→invalid / 403→forbidden / 429→cooldown）
      ⑦ 写 usage_records（失败，便于归因）
      if e.code == AI_CREDENTIAL_INVALID and 凭证只有一把 → 继续下一个 candidate（不要停）
      continue
```

**三条硬规则**：① 明文只存在于单次循环体内；② 成功与失败都写 `usage_records`；③ 只有这一处做降级，**其它任何层都不许再写 try/catch 重试**。

### 9.4 与现有代码的兼容（零改动上层的做法）

| 现有入口 | 处理方式 | 调用方影响 |
| --- | --- | --- |
| `generateText`（`generate.ts:85`，2 处调用） | 内部改为 `chat({ capability: "chat", purpose: "generic", ... })` | 无 |
| `generateStructured`（`generate.ts:115`，11 处调用） | 内部改为 `chat({ capability: "chat", requires: ["json_mode"], jsonSchema })` | 无 |
| `agent/image-generation.ts`（直连 fetch） | 收编为 `image({ capability: "image", ... })` | 无（同文件内替换实现） |
| `MissingAIKeyError`（`generate.ts:17`） | 保留类与 `name`，但语义升级：**只有 ⑤ 判定 `no_credential` 时才抛** | 无 |

**关键**：`generateText` / `generateStructured` 的**类型签名一行都不改**——这是 19 个 `@/lib/ai` 引用方零改动的唯一保证（实施篇 §3-P3）。

### 9.5 落点与测试点

**落点**：新增 `src/lib/ai/run.ts`（调度循环 + meta）、`src/lib/ai/unified.ts`（六个入口）；改造 `generate.ts` / `providers.ts` / `agent/image-generation.ts`。

**测试点**：全部候选失败的尝试次数 = 上限且总耗时 ≤ deadline（I7）；`usage_records` 在失败时也有行；`meta.attempts` 含每次尝试的 `error` 码；`generateText` 的降级顺序与今日一致（对比测试）。

---

## 10. L8 · Agent（消费层边界）

**职责**：用「能力 + 用途」表达意图，拿到结果。

**不负责**：完全不知道 provider / model / protocol / key 的存在。

### 10.1 允许看到什么

| ✅ 允许 | ❌ 禁止 |
| --- | --- |
| `capability`（7 个 canonical 值） | provider 字面量（`"gemini"` / `"openai"` …） |
| `purpose`（业务用途标签） | model id 字面量（`"gpt-4o"` …） |
| `requires`（features） | URL / 协议路径 |
| 结果（text / json / files / job） | 读 `src/lib/credentials/**` |
| `meta`（掩码后的信息来源） | 读 `src/db/repositories/model-registry.ts` 的**写**接口 |

### 10.2 建议的 Agent 侧最小 API

```ts
export function runForAgent(input: {
  capability: AiCapability;
  purpose: string;            // "topic" / "article" / "image" / "insight" / "user-content-analysis" …
  prompt?: string;
  messages?: ...;
  images?: string[];          // 闭环第 4–5 步
  jsonSchema?: unknown;
  deadlineMs?: number;
}): Promise<{ text?: string; json?: unknown; files?: FileRef[]; meta: CallMeta }>;
```

### 10.3 反例清单（code review 直接按这个拒）

```ts
// ❌ 禁止：agent 里判断厂商
if (settings.textProvider === "gemini") { ... }
// ✅ 正确：交给模型层
await runForAgent({ capability: "chat", purpose: "article", prompt });
```

现有代码里的 `runWithProviders()`（`generate.ts:45-56`）与 `resolveFirstAvailableModel()`（`model-catalog.ts:166`）正是这种耦合的化石——它们的逻辑在 P3 被 ⑤ 与 ⑦ 吸收，`src/lib/agent/**` 与 UI 不动。

**测试点**：grep 断言 `src/lib/agent/**` 不出现 provider 字面量与协议路径；`local-tools.ts`（现有 agent 工具层）在未配置任何凭据时返回可读的 `no_credential` 提示，而不是 `MissingAIKeyError` 原始栈。

---

## 11. 四条端到端时序（把八层串起来验证）

### 11.1 文本生成（含降级）— 覆盖闭环第 6/7/12 步

```
⑧ Agent:  runForAgent({ capability:"chat", purpose:"article", jsonSchema })
                │
⑦ run.ts:   deadline = now + 60s
                │  ⑤ 协商 → candidates: [DeepSeek/gpt-4o-mini, Gemini/gemini-2.0-flash, ...]
                │
                ├─ candidate#1  DeepSeek 端点
                │    ③ 选 key（round-robin 跳过冷却）→ ref
                │    ③ getSecret(ref) ── 明文仅在此刻存在
                │    ⑥ openai-compatible.run() → POST {base}/chat/completions → 401
                │    ↳ mapProtocolError → AI_CREDENTIAL_INVALID(credentialInvalid)
                │    ③ 该 key → invalid；⑦ 写 usage_records(失败)
                │
                ├─ candidate#1  同一端点第二把 key
                │    ⑥ 再试 → 200，但 usage 正常、text 正常 → 成功
                │    ③ useCount+1, status=ok；⑦ 写 usage_records(成功)
                │
                └─ 返回 { text, meta:{ attempts:[…], endpointId, modelId, credentialLabel:"****1234" } }
```

### 11.2 图片生成 — 覆盖闭环第 8 步（今天的直连 fetch 被收编）

```
⑧ Agent:  runForAgent({ capability:"image", purpose:"image", prompt, size:"1024x1024" })
   ⑤ 协商(requires:["image_output"]) → 只留下声明 image_output 的模型
   ⑥ gemini-native.run() 或 openai-compatible.run()
        ↳ 前者走 generateContent + responseModalities，后者走 /images/generations
   ⑦ 落盘到 src/lib/paths.ts 约定的目录 → 返回 files[]
```

**行为等价性要求**：P3a 之后，产物路径与文件命名必须和今天的 `src/lib/agent/image-generation.ts` 一致，否则历史内容里的图片会「找不到」。

### 11.3 视频生成（异步）— 覆盖闭环第 9 步（能力缺口）

```
⑦ submitVideo() → ⑤ 协商(capability:"video", requires:["video_output","async_job"])
   ↳ 今天必然返回 reason = "no_capability_model" 或 "adapter_unsupported"
      （目录里有 53 个 video 模型，但没有任何端点绑定、也没有 async adapter）
   ↳ UI 必须显示这条 reason，而不是转圈或报 500
未来：⑥ 提交任务 → 存 ai_jobs（新表）→ videoStatus() 轮询 → fetchVideo() 取产物
```

### 11.4 embedding（批处理）— 覆盖闭环第 3 步与第 12–13 步

```
⑧ 采集模块: embed({ input: ["用户 A 的帖子…", "用户 B 的帖子…"], purpose:"dedup" })
   ⑤ 协商(capability:"embedding", requires:["embedding_output"])
   ⑥ openai-compatible → POST {base}/embeddings（批 32~256 条/次）
   ⑦ 归一化 vectors: number[][] → 写入向量存储（**已定（2026-10-11）：见文末 §15-Q1 —— SQLite JSON 持久化 + 应用层内存余弦检索**）
   ⑧ 用余弦相似度做去重 / 聚类 → 决定「这批用户是不是同一类需求」
```

---

## 12. 八层 → 实施阶段映射（与实施篇 P0–P4 对齐）

| 层 | 主要落点 | 阶段 |
| --- | --- | --- |
| ① Provider | `src/features/ai-settings/provider-registry.ts`（保留导出）+ `model-registry.ts` provider 部分 | P1 |
| ② Endpoint | `ai_endpoints` 表 + `src/db/repositories/model-registry.ts` | P1 |
| ③ Credential | `src/lib/credentials/**` + `electron/secret-bridge.cjs` + `ai_credentials` 表 | **P0**（存储）→ P1（记录与轮询） |
| ④ Registry | `ai_models` 表 + 快照导入 + `capability-registry` 的只读查询 | P1 |
| ⑤ Capability | `src/features/ai-settings/capability-registry.ts` | P2 |
| ⑥ Adapter | `src/lib/ai/adapters/**` + `providers.ts` 改造 | P3a（text+image）/ P3b（audio/embedding）/ P3c（vision 输入） |
| ⑦ Unified API | `src/lib/ai/run.ts` + `unified.ts` + `generate.ts` 改造 | P3 |
| ⑧ Agent | `src/lib/agent/**`（只加 `capability`/`purpose` 参数） | P4 |

**依赖不可颠倒**：③ 的存储必须先于 ②④ 的落库（否则表里的 `ref` 是空指向）；④ 必须先于 ⑤（没有目录就没有候选）；⑤ 必须先于 ⑥（adapter 要被过滤，就必须先能声明能力）。

---

## 13. 测试矩阵（每层测什么，怎么测）

| 层 | 测什么 | 手段 | 关键断言 |
| --- | --- | --- | --- |
| ① Provider | 内置 ∪ 自定义合并 | 纯函数 + 内存 DB | id 唯一；`labelKey` 在三份 locale 里都存在 |
| ② Endpoint | 规范化、唯一性、探活、错误分类 | 临时 SQLite + mock fetch | 规范化幂等；`(protocol, baseUrl)` 冲突为 update；401 → `AI_CREDENTIAL_INVALID` |
| ③ Credential | 状态机、轮询、rotate、明文不落盘、迁移 | 临时目录 + `vi.mock` 隔离；grep 磁盘 | 6 条状态转移；跳过冷却；rotate 期间不失败；**磁盘与响应体无明文**（I1）；`masked` 形状（I2） |
| ④ Registry | 合并优先级、canonical 关联、deprecated、快照不可调 | 临时 SQLite | 用户改名不被覆盖；消失的模型 deprecated 不删除；`callableOnly` 排除 `endpoint_id=''` |
| ⑤ Capability | 8 种 reason、排序、strict prefer、默认命中 | 纯函数 + 假 registry | 每种 reason 各一条；strict 不悄悄换端点；`allowFallback:false` 只返回 1 个 |
| ⑥ Adapter | 请求体形状、错误映射、用量解析、取消 | **mock fetch** | vision 输入两种协议形状正确；4 类错误各一条；取消后无成功记录；`raw` 无明文 |
| ⑦ Unified API | 降级顺序、deadline、usage 归因、签名兼容 | mock adapter + 临时 DB | 尝试次数 = 上限且 ≤ deadline（I7）；失败也写 usage；`generateText` 行为与今日一致 |
| ⑧ Agent | 无厂商字面量、无凭据缺失时的可读报错 | 静态 grep + 单测 | `src/lib/agent/**` 不含 provider 与协议路径；无凭据时报 `no_credential` |

**跨层门禁（每个里程碑都跑）**

```powershell
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\vitest.cmd run
node_modules\.bin\eslint.cmd .
```

**静态不变量的机械化检查**（建议加进 CI，或用 eslint 的 `no-restricted-imports`）：

- I5：`src/lib/ai/run.ts`、`src/lib/ai/unified.ts`、`capability-registry.ts` 三个文件里不允许出现 `/chat/completions`、`generativelanguage`、`images/generations` 等字面量。
- I6：`provider-registry.ts` 里不允许出现 `fetch(`。
- ⑧ 边界：`src/lib/agent/**` 里不允许出现 `"gemini" | "openai" | "groq" | "openrouter"` 字面量与 `@/lib/credentials`。

---

## 14. 需要新增的错误码（三处必须同步，否则门禁挂）

现有 4 个 AI 码（`src/lib/app-errors.ts:11-14`）只覆盖「协议层」的成功/失败，缺「协商层」的语义。建议新增：

| 新码 | 触发点（层） | 语义 | 用户该做什么 |
| --- | --- | --- | --- |
| `AI_NO_CANDIDATE_MODEL` | ⑤ | 协商结果为空（`details.reason` 给出具体瓶颈） | 按 reason 行动 |
| `AI_CREDENTIAL_INVALID` | ⑥ → ③ | 401，key 无效 | 换 key |
| `AI_CREDENTIAL_FORBIDDEN` | ⑥ → ③ | 403，权限/地区 | 换 provider 或代理 |
| `AI_RATE_LIMITED` | ⑥ | 429，进入冷却 | 等或换 key |
| `AI_TIMEOUT` | ⑦ | 超时 / deadline 用尽 | 重试或放宽 deadline |
| `AI_ENDPOINT_UNAVAILABLE` | ⑥ | 5xx | 换端点 |
| `AI_ENDPOINT_UNREACHABLE` | ⑥ | DNS / 连接被拒（本地模型未启动） | 启动本地服务 |
| `AI_MODEL_NOT_FOUND` | ⑥ | 404，模型名过期 | 重新同步目录 |
| `AI_CAPABILITY_UNSUPPORTED` | ⑤/⑥ | 有模型但 adapter 不支持该 capability/feature | 等实现或换能力 |
| `AI_VIDEO_JOB_FAILED` | ⑦ | 异步任务失败 | 看 job 详情 |

**复用（不要重复造）**：`AI_PROVIDER_NO_TEXT`（空响应）、`AI_STRUCTURED_OUTPUT_INVALID`（JSON 解析失败）、`AI_PROVIDER_FAILED`（兜底）、`AI_PROVIDER_MISSING_KEY`（仅保留给旧调用方语义兼容）。

**三处同步（漏一处就红）**：

1. `src/lib/app-errors.ts` 的 `appErrorCodes` 数组 —— 追加字符串；
2. 同文件的 `fallbackMessages` —— 它是 `Record<AppErrorCode, string>`，**tsc 会强制你补全**（这正是这个设计的好处）；
3. `src/locales/{en,zh-hk,zh-cn}.json` 各加 `error_<CODE>` 键（前端用 `error_${code}` 取文案，见 `src/lib/api-client.ts:20-25`）。

> **硬门禁实测**：`src/lib/i18n-coverage.test.ts` 断言「三份 locale 的 key 集合与 en 完全一致」。也就是说**任何一个新错误码或新 UI 文案，必须三份同时加，否则 vitest 直接失败**。这不是建议，是当前仓库已经存在的规则。

---

## 15. 未决问题（需要你拍板，否则实现时会卡住）

| # | 问题 | 影响 | 可选方案 |
| --- | --- | --- | --- |
| Q1 | **向量存储放哪**（实测：仓库里**没有任何向量列或向量表**，`knowledge_base` 只有 `title/content/category/...`，见 `src/db/client.ts:196-210`） | 直接决定闭环第 3 步（用户去重）与第 12–13 步（效果聚类）能否落地 | (a) `ai_embeddings` 表 + JSON 列存向量，内存暴力检索（万级以内可用）；(b) 引入 `sqlite-vec` 类扩展（需要 libsql 支持，有构建风险）；(c) 独立本地索引文件（自研，工作量大）；**已决定（2026-10-11）：方案 (a) = SQLite JSON 持久化向量 + TypeScript 内存暴力检索**（裁定正文见文末 **§15-Q1 决策记录**） |
| Q2 | **视频生成走哪家、异步任务怎么存** | 决定 I8 的落地与是否需要 `ai_jobs` 表 | 需要新表 `ai_jobs(id, endpoint_id, model_id, external_job_id, status, result_json, created_at, updated_at)`；供应商侧需要你确认优先对接哪家 |
| Q3 | **价格（price）数据从哪来** | 决定 ⑤ 能否做「成本约束排序」 | (a) 手工维护字典；(b) 快照里带；(c) 先不做，UI 标注「价格未知」 |
| Q4 | **凭据桥形态**（A loopback HTTP 桥 / B 一次性 CLI / C server 进主进程） | 决定 P0 的实现方式与风险 | 见实施篇 §8 第 1 条，推荐 A |
| Q5 | **`localProvider` 语义是否保留** | 现有 14 家厂商里 12 家标注了「用哪个本地 provider 调它」（如 Anthropic → openrouter，`mainstream-model-catalog.ts:64`） | 迁成 Endpoint 的备注（推荐）还是彻底删掉 |

---

## 附录 · 与另外两份文档的关系

| 文档 | 回答的问题 | 本文如何引用它 |
| --- | --- | --- |
| `docs/model-gateway.md` | 为什么要有这一层、概念澄清、差距分析 G1–G8 | 本文是它的**规格落地**：概念 → 层、差距 → 每层的「不负责」 |
| `docs/model-gateway-plan.md` | 能不能做、改哪些文件、P0–P4 排期、13 步业务闭环映射（§9） | 本文 §12 给出「层 → 阶段」映射；实施篇的验收标准是本文各层测试点的子集 |

**落地检查清单（P0 开工前先过一遍）**

- [ ] 八层的「不负责」都写进了对应文件的顶部注释
- [ ] 十条不变量每条都有测试（I1–I10）
- [ ] 新错误码三处同步（`appErrorCodes` / `fallbackMessages` / 3 份 locale）
- [ ] 静态检查（I5 / I6 / ⑧ 边界）进 CI 或 eslint 规则
- [ ] §15 的 Q1–Q5 有结论（至少 Q4，它阻塞 P0）—— 现状（2026-10-11）：**Q1 已结论（方案 (a)，见文末 §15-Q1）**；**Q2–Q5 仍待结论**，故本行**保持未勾选**（不替作者勾选）








## 15-Q1 决策记录（向量存储：SQLite JSON 持久化 + TypeScript 内存暴力检索；**2026-10-11 已决定**）

> **为什么追加在文件末尾**：本节是 §15 表格里 **Q1** 的裁定正文。追加于末尾（而不是插进 §15 表格下方）→ §15 表格行（`:972`）、落地检查清单（`:987–993`）以及外部对它们的**行号引用全部不动**。
> **与 §15 表格的关系**：§15 的 **Q1 行已就地标注「已决定（2026-10-11）：方案 (a)」**并指向本节；**Q2–Q5 仍未决**，落地检查清单里那一行的**勾选框保持未勾选**（就地标注只写 Q1 已结论）。
> **配套记录**：执行拆分（阶段 0–7）见主线计划 `docs/coolpilot-capability-integration-plan.md` **§附录 S**；候选卡登记见同文件 **§附录 R**。**本记录不含任何开发卡编号**。

### 1. 决策结论

首版采用方案 A（= §15 表格里的 **(a)**）：**SQLite JSON 持久化向量 + TypeScript 内存暴力检索**。

首版知识库规模预期为几百到几千个文本切片。当前优先目标是以最少的技术依赖完成 Embedding 生成、向量存储、相似度检索与知识库召回的端到端闭环，而不是提前优化大规模向量检索性能。

### 2. 方案定义

- **持久化存储**：继续使用应用现有的 SQLite 数据存储体系，将 Embedding 向量序列化为 JSON 保存。
- **向量检索**：在 TypeScript 应用层读取候选向量，计算查询向量与候选向量之间的余弦相似度，按相似度排序并返回 Top-K 结果。
- **知识库集成**：将向量检索接入现有知识库召回流程，在现有业务约束下选择相关文本切片，供后续 AI 请求使用。
- **本地优先**：向量数据与知识库数据继续保存在用户本地，不因引入 Embedding 而新增强制远程存储服务。

### 3. 选择理由

1. 符合首版几百到几千个文本切片的规模预期。
2. 不需要引入 `sqlite-vec` 等额外 SQLite 扩展，降低 Electron 环境、原生模块兼容、构建和发行包分发方面的风险。
3. 可以复用现有 SQLite 与 TypeScript 技术栈，缩短首版端到端功能的实现路径。
4. 将存储和检索能力封装在独立接口后，可以在未来保留替换检索实现的空间。

### 4. 首版边界

- 不引入 SQLite 向量扩展。
- 不引入独立向量数据库或独立向量索引文件。
- 不建设 ANN 等近似最近邻索引。
- 不以大规模向量检索性能为首版验收目标。
- 不把 Embedding 模型调用、向量存储和知识库召回混为一个不可替换的实现。

### 5. 实现约束

- 为向量存储与相似度检索定义清晰的内部接口，避免业务代码直接依赖 JSON 序列化格式或某一种检索实现。
- 向量必须与来源文本切片、所属知识库或业务实体、Embedding 模型标识及必要的维度信息建立可追溯关联。
- 查询向量与候选向量必须来自兼容的 Embedding 模型及向量空间；模型切换后不得直接比较不兼容的历史向量。
- 对空向量、无效数值、维度不一致、零范数向量和无法解析的 JSON 进行显式处理，不能产生误导性的相似度结果。
- 检索必须遵守现有知识库启用状态、业务实体归属和其他适用的访问约束，不能因为新增向量召回而扩大原有数据范围。
- 未知的 Embedding 用量或价格应继续遵守现有预算、计量与成本记录策略，不得伪造用量或成本。

### 6. 后续升级条件

当真实知识库规模、检索延迟或内存占用表明内存暴力检索已成为可测量的瓶颈时，再评估向量扩展、专用索引或其他检索实现。

升级应基于真实数据规模和基准测试结果，并复用既有存储 / 检索接口；不能仅因预计未来可能扩容而提前引入额外依赖。

### 7. 决策影响范围

本决策确定首版向量存储与检索策略，不代表 Embedding 模型、文本切片策略、知识库召回规则、预算计量或模型切换方案已经全部确定。这些内容应分别按各自的技术要求和开发执行清单完成。

### 8. 与本文其他章节的关系（执行侧补充，便于落地时对照；不改变以上 1–7 条结论）

- **§11.4 第 ⑦ 步**（「归一化 `vectors: number[][]` → 写入向量存储」，本文原先标注为「见 §15 的未决问题」）：实现方式由本节确定 —— **首版 = 序列化为 JSON 存入现有 SQLite**，该处不再是未决问题。
- **§11.4 第 ⑧ 步**（「用余弦相似度做去重 / 聚类」）：余弦相似度在**应用层内存**计算，与本节方案定义一致。
- **落地检查清单**「§15 的 Q1–Q5 有结论（至少 Q4，它阻塞 P0）」：**Q1 已结论**（本节）；该行**整行保持未勾选**，因为 **Q2–Q5 未决**。
- **数据模型**：本节确定的是**存储与检索形态**（JSON 列 + 应用层检索），**具体表名 / 列名 / 迁移由实现阶段按 §11.4 与仓库既有建表惯例确定**（本仓库既有惯例：**无 drizzle-kit 迁移文件**）—— 本节不预先钉死表名与列名。**（2026-10-11 实现阶段已确定）**：表名 **`knowledge_embeddings`**（分块级，1 条知识记录 N 行；列 `id / knowledge_id / chunk_index / chunking_version / text / chunk_hash / source_hash / provider_id / model_id / dimensions / vector_json / created_at / updated_at`），建表走 `src/db/client.ts#ensureDatabase()` 的 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`（**不要求用户删库 / 重建**），落点见主线 `docs/coolpilot-capability-integration-plan.md` **§附录 T.10**。
- **计量与预算**：本节的「未知用量 / 未知价格如实记录」与既有账本策略一致（`unpriced` + NULL，不写 0）；本记录**不新增**任何计量或价格规则。
