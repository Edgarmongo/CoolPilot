# 模型管理层实施方案：能不能做、怎么做、按什么顺序做

> 本文是 `docs/model-gateway.md`（设计笔记）的**实施篇**。设计篇回答「应该长成什么样」，本文回答三个问题：
> 1. 按那个目标改造，**这个仓库能不能做**（逐层对照代码给出判定）；
> 2. 具体**改哪些文件、加哪些表、动哪些接口**（含代码骨架与验收命令）；
> 3. **按什么顺序做**才能在每一步都不破坏现有功能（`@/lib/ai` 被 19 个文件引用：8 个 API route + 6 个 UI 组件 + `src/lib/agent/**` 4 个 + `src/lib/article-images.ts`）。
>
> 三份文档的分工：**设计篇**（`docs/model-gateway.md`）回答为什么要有这一层；**本文**回答能不能做、改哪些文件、按什么顺序做；**逐层规格**在 `docs/model-layer-spec.md`（八层各自的职责与「不负责」、数据结构、接口、失败模式、错误码、测试矩阵）。
>
> 本文所有「现状」都标注 `文件:行`，可直接跳过去核对；凡是我没在代码里验证过的，都会写成「待确认」。

---

## 0. 结论（TL;DR）

**能做，而且不需要推倒重来。** 目标架构的 6 层里，**2 层可直接复用、3 层改造、1 层新建**；真正的阻碍只有 3 个，且都是「补上一块新能力」而不是「重写既有逻辑」。

| 结论要点 | 说明 |
| --- | --- |
| 可行度 | **高**。目录数据（420 条 / 22 个厂商组）、能力快照、provider 注册表、协议分派、KV 设置存储、迁移机制**都已在仓库里**，只是没有串成一层。 |
| 真正要新建的 | ① OS 安全存储的凭据层；② 模型元数据表（Registry）；③ 按能力查询的选择器；④ video/audio/embedding 的调用路径。 |
| 最大的坑（不是工作量，是环境） | `safeStorage` **拿不到**：Next server 是被 spawn 出来的独立 Node 进程（`electron/main.cjs:110`），`require("electron")` 不可用。必须先做进程间桥（§2.1）。 |
| 破坏性改动极少 | 只有 `ModelCapability` 从 `"text" \| "image"` 扩枚举这一处（`src/features/ai-settings/model-catalog.ts:6`），且能保留旧签名不动调用方。 |
| 总量估算 | 新增 ≈ 12 个文件、修改 ≈ 10 个文件、3 份 locale 同步；单人 **11–18 人日**（P0 1–2 / P1 2–3 / P2 2–3 / P3 3–5 / P4 3–5）。 |
| 建议起点 | **P0 凭据加固**。它同时修掉一个已存在的真 bug：打包后 key 存不住（§2.3）。 |
| 业务闭环对照 | 你的 13 步商业闭环逐条核对代码的结果见 **§9**：2 步卡在 **vision**、1 步卡在 **video**、2 步需要 **embedding**；路线图优先级已据此调整（§9.2）。 |

---

## 1. 可行性判定：逐层对照目标架构

目标架构：

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

| 目标层 | 现状证据（已核对） | 判定 | 缺口 |
| --- | --- | --- | --- |
| ① 用户 key / endpoint / 模型目录 | key 写 `.env.local`（`src/lib/secrets.ts:47,105`）；provider/endpoint/模型选择在 `LocalAgentSettings`（`src/db/repositories/settings.ts:33,98`）；目录 = 420 条内置快照 + 可选 gateway 同步（`src/features/ai-settings/model-gateway-snapshot.ts`） | **改造** | 凭据无命名、无轮询语义（现在是一行 key 串）；endpoint 每个 provider 只能一个，同协议多实例做不到 |
| ② Model Registry（SQLite + OS 凭据库） | SQLite 齐备（`src/db/client.ts:43 ensureDatabase()`）；模型**只有 id 字符串**、无元数据表；OS 凭据库**完全没有**——`keytar` 不在 `package.json`/`pnpm-lock.yaml`，`loadKeytar()` 永远返回 `null`（`src/lib/secrets.ts:21-30`），`electron/*.cjs` 无任何 `safeStorage` 调用 | **新建** | 缺表、缺凭据抽象、缺 OS 存储通道 |
| ③ 能力选择器 | **不存在**。`runWithProviders()` 的行为是「按 provider 顺序依次重试」（`src/lib/ai/generate.ts:45,56`），`resolveFirstAvailableModel()` 只在目录里取第一条（`generate.ts:69`，定义于 `model-catalog.ts`） | **新建（小）** | 无 `capability → 候选模型` 查询；无「为什么没有可用模型」的可读原因 |
| ④ Adapter | **半个已在**：`callProvider()` 已按 provider 分派到 `callGemini` / `callOpenAICompatible`（`src/lib/ai/providers.ts:67,94,127`），但「协议」与「厂商」揉在同一个分派里 | **改造** | 把 `protocol`（`openai-compatible` / `gemini-native`）从 provider 名里抽出来，新增协议 = 加一个文件 |
| ⑤ Unified API | `generateText` / `generateStructured` 已是统一出口（`generate.ts:85,115`），但**只有 text**；图片走另一条路——`src/lib/agent/image-generation.ts` 直接 `fetch`，绕过调用层；`video / audio / embedding` 完全无调用路径（目录里可见、实际不可调） | **改造 + 新建** | capability 维度缺失；图片路径要收编 |
| ⑥ Agent / Workflow / 编辑器 / 内容库 | `@/lib/ai` 被 **19** 个文件引用（8 个 API route、6 个 UI 组件、`src/lib/agent/**` 4 个、`src/lib/article-images.ts`）；其中 `generateText` 2 处调用、`generateStructured` 11 处调用 | **复用（硬约束）** | **`generateText` / `generateStructured` 签名不能变**，否则这 19 个引用方全要动 |

**一句话**：这不是让你重写一个平台，而是把**已经有的零件**（目录、协议分派、KV 设置、SQLite）接成一条管线，再补上**确实缺的两块**（凭据层、能力层）。

---

## 2. 三个必须先解决的硬障碍

### 2.1 障碍 A：`safeStorage` 跨进程拿不到（最高优先级）

**证据**

- `electron/main.cjs:110` 用 `spawn(process.execPath, [findServerBootstrap(), findStandaloneServer()], { env: { …, ELECTRON_RUN_AS_NODE: "1" } })` 启动 Next standalone server —— 这是**独立 Node 进程**，不是 Electron 主进程，因此 `require("electron").safeStorage` 在那里不存在，`app.getPath()` 也不存在。
- 但仓库里**已经有跨进程鉴权的先例**，照抄即可：主进程生成 `schedulerToken = crypto.randomBytes(32)`（`main.cjs:17`），通过 env `COOLPILOT_SCHEDULER_TOKEN` 传给子进程（`main.cjs:119`），子进程侧 `/api/internal/scheduler/tick` 用 `Authorization: Bearer ${expected}` 校验（`src/app/api/internal/scheduler/tick/route.ts:10-11`）。

**对策：主进程起一个「凭据桥」，方向与调度器相反（主进程做服务端）**

```
electron/main.cjs（唯一持有 safeStorage）
  ├─ 启动时监听 127.0.0.1:0（随机端口），生成一次性 bridgeToken
  ├─ 经 env 把 (COOLPILOT_SECRET_BRIDGE_URL, COOLPILOT_SECRET_BRIDGE_TOKEN) 传给 Next server
  └─ 提供 POST /secrets/{get,set,delete,list}
        └─ safeStorage.encryptString → userData/credentials.bin
           （portable 模式跟随 resolveDataDir() 的 web-data/ 分支，main.cjs:48-58）

src/lib/credentials/bridge.ts（Next server 侧）
  └─ 只做 HTTP 调用；桥不可用时走本地 AES-256-GCM 回退
```

**四条设计约束（写进代码注释，防止后来者绕过）**

1. SQLite 里**只存 `credentialRef`**（如 `ai-credential:<uuid>`），永远不存明文（对应设计篇 R1）。
2. 桥只监听 `127.0.0.1`，且**每次启动换 token**；token 只经 env 传递，不落盘、不进日志。
3. **非 Electron 场景**（`pnpm dev` / `next start`）回退到「本地文件 + AES-256-GCM + 主密钥存数据目录并限制权限」，并在 UI 明确标注「未受 OS 级保护」。**任何情况下都不回退到明文 `.env.local`** —— 这是 P0 验收标准之一。
4. 读取顺序即回退策略：`process.env`（兼容老用户）→ 加密存储 → 桥。所以**回滚不需要删代码**。

**为什么不用 `keytar`**：它是原生模块，需要 `node-gyp` 构建，会同时踩中 AGENTS.md 记录的两个已知痛点（`pnpm` 被 ignored build scripts 挡住、`electron-builder` 分发流程），而 `safeStorage` 是 Electron 内置、零依赖。**明确排除 keytar**（设计篇 §10 已列为非目标）。

**验证方式**：`pnpm electron:pack` 后在**打包产物**里录入 key → 重启 → 仍可用；再 grep 数据目录确认无明文。AGENTS.md 要求「packaged behavior 要验证打包产物而不是只验证 dev server」，这一步不能用 `pnpm dev` 代替。

### 2.2 障碍 B：迁移机制是手写 SQL，不是 drizzle migrations

**证据**

- `src/db/migrations/` **不存在**（已确认）；`package.json` 虽保留 `db:generate` / `db:studio`，但仓库里没有迁移目录。
- 实际迁移逻辑全在 `src/db/client.ts:43 ensureDatabase()`：一个 `CREATE TABLE IF NOT EXISTS` 语句数组（`:50-308`），加一串「best-effort」的 `ALTER TABLE … RENAME/ADD COLUMN … .catch(() => undefined)`（`:313-322` 是 `sites → accounts` 改名；`:328-354` 是后加的列）。

**对策：沿用既有风格，不要引入 drizzle-kit 生成流程**（否则会形成「ensureDatabase 手写 SQL」与「drizzle 迁移文件」双轨，早晚不一致）。

- 新表 → 追加到 `statements` 数组，用 `CREATE TABLE IF NOT EXISTS`。
- 改建表 → 追加 `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT …`.catch(...)，且**必须带默认值**（SQLite 要给已有行填上）。
- 新索引 → 必须排在对应 `ALTER TABLE` **之后**（`:356-357` 的注释就是这个坑：索引建在尚未创建的列上会失败）。

**顺带发现（P4 可清理）**：`ai_providers` 表在 `src/db/schema.ts:17` 声明、`src/db/client.ts:63` 创建，但**全仓库零引用**（已做 `ai_providers|aiProviders` 全量 grep，只有这两处命中）→ 历史死表。它的列形状（`provider` + `model` + `baseUrl` + `keyCount` 混在一行）与新 Registry 的规范化设计不符，**不要复用它**；P4 里确认 `SELECT count(*)` 为 0 后，连同 schema 声明一起删。

### 2.3 障碍 C：打包后 `.env.local` 的位置不可靠（现存 bug）

**证据**

- `envFilePath()` 是 `path.join(process.cwd(), ".env.local")`（`src/lib/secrets.ts:47-49`）。
- 子进程 `spawn` 时**没有指定 `cwd`**（`main.cjs:110-125`），所以继承 Electron 进程的 cwd —— 安装版通常是安装目录（如 `C:\Program Files\…`，写入可能 `EPERM`），便携版是 exe 所在目录（**升级/换目录即丢**）。
- `writeEnvVar()` 还把值写进 `process.env`（`secrets.ts:107`），而 `process.env` 只对当前进程有效，重启即失效。

**结论**：现在的 key 持久化在打包场景里**本来就不可靠**，只是没人在打包产物里验证过。所以 P0 不是「安全优化」，而是**修一个真 bug**。

**对策**：新增 `dataDir()` 解析函数，顺序为 `APP_DATA_DIR`（`main.cjs:113` 已传入）→ `SOCIAL_AUTO_POST_DATA_DIR`（`main.cjs:114`）→ `process.cwd()`（dev 兜底）。凭据、加密文件、备份都放这里；`.env.local` 降级为**只读兼容层**（老用户迁移时读一次，之后不再写入）。

---

## 3. 分阶段方案（与设计篇 §8 的 P0→P4 对齐）

每阶段统一格式：目标 / 新增文件 / 修改文件 / 数据与接口变更 / UI / 验收 / 回滚 / 工时。通用门禁为 `node_modules\.bin\tsc.cmd --noEmit`、`node_modules\.bin\vitest.cmd run`、`node_modules\.bin\eslint.cmd .` 全绿。

### P0 · 凭据加固（1–2 人日）— 对应 G3 / R1

**目标**：key 不再明文落盘；打包后可靠；`src/lib/secrets.ts` 的**对外签名一字不改**（现有 5 个导出已被调用方依赖）。

**新增（4 个文件）**

- `electron/secret-bridge.cjs` — 主进程侧 HTTP 桥，唯一调用 `safeStorage` 的地方（与 `electron/server-bootstrap.cjs` 同目录，已被打包流程覆盖）。
- `src/lib/credentials/data-dir.ts` — `dataDir()` 解析（§2.3）。
- `src/lib/credentials/store.ts` — `getSecret(ref)` / `setSecret(ref, value)` / `deleteSecret(ref)` / `listSecretRefs()`；桥优先 → AES-256-GCM 文件回退。
- `src/lib/credentials/store.test.ts` — 单测（临时目录），断言磁盘上不出现明文。

**修改（5 个文件）**

- `electron/main.cjs`：`app.whenReady()`（`:190`）里启动桥，把端口/token 注入 spawn 的 env（`:111-122`），`before-quit`（`:203`）里关闭桥。
- `src/lib/secrets.ts`：`readProviderKeys` / `writeProviderKey` / `readModelGatewayCookie` / `writeModelGatewayCookie` / `clearModelGatewayCookie` 全部改走 store，**导出名与返回类型不变**；首次读取时若发现 `.env.local` 有旧值 → 迁移进 store 并把该行从文件里清掉。
- `src/app/api/settings/ai/route.ts`：写入策略改为「掩码回显 + 只在新值不是掩码时落库」。掩码语义沿用已有做法（`maskKey()` 在 `secrets.ts:131`；`modelGatewayActionSchema` 的注释「Masked values (`****1234`) are echoed back by the UI and must be ignored」在 `src/lib/validation.ts:518`）。
- `src/locales/en.json` / `zh-hk.json` / `zh-cn.json`：各 +3 条文案（「凭据已加密存储（Windows DPAPI / macOS Keychain）」/「当前为本地文件加密，未受 OS 级保护」/「已迁移 N 条旧凭据」）。**三份 key 必须完全一致**，否则 `satisfies Record<Locale, typeof en>`（`src/lib/locale-resources.ts:10`）会让 tsc 直接报错 —— 实测当前三份均为 1572 key、零差异，这是可以直接复用的约束。

**验收**

1. 三个门禁全绿，且测试总数不少于现状（52 文件 / 280 用例）。
2. `store.test.ts`：写入后读取数据目录下**所有**文件，断言不含明文；清空 `process.env` 后仍能读回。
3. dev 手工：保存 key → 重启 dev server → chat 仍可用。
4. **packaged 手工**：`pnpm electron:pack` → 在打包应用里保存 key → 重启 → 仍可用；对数据目录做 `findstr /s /i "sk-"` 无命中。
5. 回归：`scripts/model-management-smoke.ts` 仍通过。

**回滚**：读取顺序里保留 env 通道，`COOLPILOT_CREDENTIAL_MODE=env` 作为逃生开关，无需回滚代码。

**风险**：Windows 上 `safeStorage` 依赖 DPAPI，在无用户配置文件的服务账户下会抛错 → 桥必须把异常降级为「文件加密模式」并把状态回报给 UI，而不是让保存直接失败。

### P1 · Registry 对象化（2–3 人日）— 对应 G2 / G7

**数据（4 张新表，同时写进 `src/db/client.ts` 的 statements 与 `src/db/schema.ts`）**

```ts
// ai_endpoints：一个「可调用的地址」＝ 协议 + baseUrl
ai_endpoints(id PK, protocol, base_url, label, enabled INT DEFAULT 1,
             priority INT DEFAULT 0, created_at, updated_at)

// ai_credentials：凭据正文在 OS 存储里，这里只放引用
ai_credentials(id PK, endpoint_id, ref UNIQUE, label, masked, tags_json,
               status, last_check_at, created_at, updated_at)

// ai_models：模型目录（内置快照 + provider API + 手工录入）
ai_models(id PK, endpoint_id NULL, model_id, display_name, source,
          context_window, capabilities_json, meta_json,
          enabled INT DEFAULT 1, created_at, updated_at)
  UNIQUE(endpoint_id, model_id)

// ai_defaults：能力 → 默认模型
ai_defaults(capability PK, model_ref, endpoint_id, updated_at)
```

- `capabilities_json` 用 JSON 数组而不是关系表：420 行量级、读多写少，内存过滤足够；将来真需要 SQL 过滤再补 `ai_model_capabilities`，不破坏已有数据。
- `source` 取值 `snapshot` / `provider-api` / `manual` / `imported`，直接对应设计篇 §5 的能力来源优先级（G1 / G8）。
- 索引：`idx_ai_models_endpoint(endpoint_id)`、`idx_ai_credentials_endpoint(endpoint_id)`；**索引语句必须写在建表之后**（同 §2.2 的坑）。
- **闭环追加的两项**（§9.1）：`ai_defaults` 增加 `purpose` 列（`audience-analysis` / `user-content-analysis` / `topic` / `article` / `image` / `insight`），让「便宜模型做抽取、强模型做创作」可配置；`usage_records` 补 `capability` + `purpose` 两列（`ALTER TABLE usage_records ADD COLUMN … NOT NULL DEFAULT ''`，走既有迁移风格），让闭环第 12–13 步能按「步骤 × provider × model」归因。

**新增（3）**

- `src/db/repositories/model-registry.ts` — 纯数据访问（drizzle），无副作用。
- `src/db/repositories/model-registry.test.ts` — 照 `src/features/ai-settings/model-gateway-sync.test.ts` 的路子（`mkdtempSync` 临时目录 + 临时 DB + `vi.mock` 隔离凭据，该测试注释明确写了「never writes credentials into the working tree」）；断言 `ensureDatabase()` 连跑两次幂等。
- `src/features/ai-settings/registry-migrate.ts` — 幂等一次性导入：4 个 provider（gemini / groq / openai / openrouter）+ baseUrl/model → `ai_endpoints` + `ai_credentials`；内置快照与 gateway 同步结果 → `ai_models`。

**修改（4）**

- `src/db/client.ts`、`src/db/schema.ts` — 建表 + 索引。
- `src/features/ai-settings/provider-registry.ts` — **保持全部导出不变**（`src/components/system/model-config-panel.tsx:10` 在 import `aiProviderOrder` / `aiProviderRegistry`），内部改成「先读 registry，读不到退回静态定义」。
- `src/lib/types.ts` — 只**新增** registry 类型，不动 `LocalAgentSettings`（`AgentRuntimeMode` / `LocalAIProvider` / `LocalImageProvider` 已被多个组件引用）。

**验收**

1. 迁移前后 `listProviderModels({ provider, capability })` 的结果集合一致（4 provider × text/image 做集合断言）。
2. `SELECT count(*) FROM ai_models WHERE source='snapshot'` 与内置快照一致（实测 420 条 / 22 个厂商组）。
3. 连跑两次迁移无副作用；删库重建后仍可用。
4. 三个门禁全绿；现有测试数量不减。

**回滚**：P1 只做「写入 + 影子读取」，新表不参与现有读写主路径；真出问题把 provider-registry 的读取改回静态定义即可。

### P2 · 能力层可查询（2–3 人日）— 对应 G1 / G6 / G8

**目标**：任何能力（含现在不可调的 video / audio / embedding）都能回答「有没有可用的模型、为什么没有」。

**唯一的破坏性改动点（必须谨慎处理）**

`src/features/ai-settings/model-catalog.ts:6` 现在是 `export type ModelCapability = "text" | "image"`，而它同时被两处消费：

1. `listProviderModels()` 的归一化逻辑靠 `capability === "image" ? … : …` 二分（`model-catalog.ts:46-109`）——传 `"video"` 会掉进 text 分支，行为错误；
2. `src/app/api/settings/ai/models/route.ts:10-12` 的 `isCapability()` 白名单 + provider 集合校验。

**建议做法（零破坏）**：拆成两个类型 —— 新类型 `AiCapability`（7 个值，给 Registry / 选择器 / 新 API 用），旧 `ModelCapability`（`text | image`）原样保留给 `listProviderModels` 与旧 API。旧页面行为一字不变，新能力走新 API。

**新增（4）**

- `src/features/ai-settings/capability-registry.ts` — `resolveCapability(capability)` 返回 `{ models: [...], reason?: "no_endpoint" | "no_credential" | "no_match" | "disabled" }`；候选来源 = `ai_models`（P1）∪ 内置快照（`model-gateway-catalog.ts` 已有 `countGatewayModelsByCapability()`，实测 `chat=221 · image=55 · video=53 · audio=37 · reasoning=31 · code=13 · embedding=10`）。
- `src/features/ai-settings/capability-registry.test.ts` — 重点断言「video 在没有任何凭据时返回 `reason: "no_credential"` 而不是空数组」。
- `src/app/api/models/registry/route.ts` — `GET ?capability=&endpointId=`，返回模型 + 可用性 + 原因。
- `src/components/system/capability-matrix-panel.tsx` — 能力矩阵：列＝能力，行＝endpoint，单元格＝可用 / 缺凭据 / 不可调 + 原因浮层。

**修改（4）**

- `src/features/ai-settings/model-catalog.ts` — 新增 `AiCapability` 类型；`listProviderModels` 签名不动。
- `src/features/ai-settings/provider-registry.ts` — 给每个 provider 标注 `protocol`（`gemini → gemini-native`，其余 → `openai-compatible`）与 `defaultCapabilities`。
- `src/components/system/model-management-client.tsx`（474 行）— 挂载新面板；建议顺手把「同步面板 / 目录面板 / 能力矩阵」拆成子组件，避免继续变胖。
- 3 份 locale —— 约 +10 条文案（能力名、原因文案、矩阵表头）。

**验收**

1. 7 个 capability 逐个请求 `GET /api/models/registry`：有凭据的非空、无凭据的必须带 `reason`。
2. 旧 `/api/settings/ai/models` 行为与今日完全一致（`text`/`image` 的返回集合与排序不变）。
3. 三个门禁全绿。

### P3 · Adapter + 统一 API（3–5 人日）— 对应 G4 / G5

**新增（6）**

- `src/lib/ai/adapters/types.ts` — 设计篇 §6.2 的 `ModelRequest` / `ModelResult` / `ModelAdapter` 原样落地。
- `src/lib/ai/adapters/openai-compatible.ts` — text（`/chat/completions`，从 `providers.ts:94 callOpenAICompatible` 迁移）、image（`/images/generations`，从 `src/lib/agent/image-generation.ts` 迁移）、embedding（`/embeddings`）、audio（TTS）。
- `src/lib/ai/adapters/gemini-native.ts` — text（`generateContent`，从 `providers.ts:67 callGemini` 迁移）、image（`generateContent` + 图像模态）。
- `src/lib/ai/adapters/index.ts` — `protocol → adapter` 注册表。
- `src/lib/ai/run.ts` — 统一出口：`select` → 取凭据（仅本次调用持有）→ adapter → 归一化 → 落 `usage_records`（表已存在，`src/db/schema.ts:254`）→ 失败降级（同 endpoint 换下一把 key → 换下一个候选模型）。
- `src/lib/ai/adapters/*.test.ts` — **mock fetch**，覆盖 4 类错误：无 key、HTTP 401、空响应、超时/abort。

**修改（3）**

- `src/lib/ai/providers.ts` — `callProvider()` 改为查 adapter 注册表；`ProviderCallOptions` / `ProviderResult` / `TokenUsage` **类型与导出保持不变**。
- `src/lib/ai/generate.ts` — `runWithProviders()` 改由 `run()` 驱动；`generateText` / `generateStructured` **签名不变**（这是 19 个引用方零改动的唯一保证）。
- `src/lib/agent/image-generation.ts` — 直连 `fetch` 收编为 `image` capability 的 adapter 分支，产物落盘路径与今日一致。

**分两批落地的建议**：P3a 只做 text + image（等价重构，行为不变，最容易验证）；P3b 再加 audio / embedding / video。video 目前只有目录数据、没有任何实现，建议**明确留到 P4 之后**，不要在这期硬塞。

**验收**

1. 现有 280 个测试全绿（尤其 `generate` / image 相关路径）。
2. 新增 adapter 单测 4 类错误全覆盖，且**不依赖网络**。
3. `generateText` 在「首选 provider 无 key」时的降级顺序与今日一致（跑一个对比测试）。
4. image 生成走 `run()` 后，`src/lib/agent/image-generation.ts` 的调用方（agent 工具层）零改动。

### P4 · Agent 消费能力 + 向导 + 清理（3–5 人日）— 对应 G6

**目标**：让「能力选择」成为上层唯一入口，并把设计篇 §7 的首启向导真正做出来。

- **Agent 工具层加 `capability` 参数**（默认 `"text"`，完全向后兼容），让「生成图片」「转录音频」这类工具按能力选模型，而不是硬编码 provider。
- **首启向导**：`src/components/system/provider-onboarding-wizard.tsx` + `POST /api/models/registry/test-connection`（复用 `model-catalog.ts:127 listProviderModels` 的抓取与归一化能力，包成一个返回 `{ ok, modelCount, httpStatus }` 的探活接口）。
- **UI 拆分**：`model-management-client.tsx` 拆成 `registry-panel` / `capability-matrix-panel` / `defaults-panel` / `provider-onboarding-wizard` 四个组件 + 一个 thin client。
- **清理**：删除死表 `ai_providers`（先确认 `SELECT count(*)` 为 0）；`resolveFirstAvailableModel()` 的逻辑并入 selector，`model-catalog.ts` 只留目录归一化。
- **`ai_defaults` 落地**：文本 / 图片 / 视频 / 音频各一个默认，UI 可「自动（按优先级）」。

**验收**

1. 向导全流程可走通：勾选 provider → 填 key → 探活 → 拉取目录 → 设默认 → 完成；中途退出不产生半成品数据（用一个事务或「草稿态」列）。
2. 未配置任何 provider 时，Agent 的工具调用返回 `reason` 可读错误，而不是抛 `MissingAIKeyError` 的原始栈。
3. 删除 `ai_providers` 后所有门禁仍绿。

---

## 4. 里程碑排期与依赖

| 里程碑 | 内容 | 依赖 | 可演示结果 | 工时 |
| --- | --- | --- | --- | --- |
| M1 | P0 凭据加固 | 无 | 打包应用里存 key → 重启仍可用；磁盘无明文 | 1–2 人日 |
| M2 | P1 Registry 对象化 | M1（要先有 `credentialRef`） | 数据库里能看到 endpoint / credential / 420 条 model | 2–3 人日 |
| M3 | P2 能力层可查询 | M2 | 能力矩阵页：7 个能力各自的可用性与原因 | 2–3 人日 |
| M4 | P3a Adapter（text+image 等价重构） | M2 | 图片生成走统一 `run()`，对外零改动 | 2–3 人日 |
| M5 | P3b Adapter（audio/embedding） | M4 | 语音合成 / 向量化可调 | 1–2 人日 |
| M6 | P4 向导 + 清理 | M3、M4 | 新用户 3 分钟从零到可用 | 3–5 人日 |

**顺序上的硬约束**（不能调换）

1. **M1 必须先做**：否则后面所有表里的 `credentialRef` 都是空指向。
2. **M2 只增不改**：P1 不改 `generateText`，所以它能独立发布；P3 才动调用层。
3. **M4 是等价重构**：先把现有行为原样搬进 adapter，再加新能力；不要「边重构边加功能」，那样回归测试无法定位。

---

## 5. 关键骨架（可直接照抄的接口，签名即契约）

### 5.1 `src/lib/credentials/store.ts`

```ts
export type SecretStatus = "os-encrypted" | "file-encrypted" | "env-only";

export async function getSecret(ref: string): Promise<string | null>;
export async function setSecret(ref: string, value: string): Promise<{ status: SecretStatus }>;
export async function deleteSecret(ref: string): Promise<void>;
export async function listSecretRefs(): Promise<string[]>;
export function credentialStatus(): SecretStatus | "unavailable";
```

约束：对外返回的诊断信息**只含状态，不含明文**；日志里只允许出现 `maskKey()` 之后的形式（`maskKey` 已存在于 `src/lib/secrets.ts:131`，输出形如 `****1234`）。

### 5.2 `src/db/repositories/model-registry.ts`

```ts
export async function listEndpoints(): Promise<EndpointRecord[]>;
export async function upsertEndpoint(input: EndpointInput): Promise<EndpointRecord>;
export async function listModels(filter?: { endpointId?: string; capability?: AiCapability }): Promise<ModelRecord[]>;
export async function upsertModels(input: { endpointId: string | null; source: ModelSource; models: ModelRecordInput[] }): Promise<number>;
export async function getDefault(capability: AiCapability): Promise<ModelRef | null>;
export async function setDefault(capability: AiCapability, ref: ModelRef | null): Promise<void>;
```

### 5.3 `src/features/ai-settings/capability-registry.ts`

```ts
export type CapabilityReason = "no_endpoint" | "no_credential" | "no_match" | "disabled";

export async function resolveCapability(input: {
  capability: AiCapability;
  prefer?: { endpointId?: string; modelId?: string };
}): Promise<{ models: ModelRecord[]; reason?: CapabilityReason }>;
```

判定顺序（与设计篇 §6.1 一致）：enabled endpoint → 能力匹配 → `requires` 满足 → 费用/上下文约束 → `prefer` 加权 → 排除 → 按 `priority` 排序。

### 5.4 `src/lib/ai/adapters/index.ts`

```ts
export type ModelProtocol = "openai-compatible" | "gemini-native";

export function adapterFor(protocol: ModelProtocol): ModelAdapter;
```

新增一个协议＝新增一个实现 + 注册一行；上层（`run()` / 选择器 / UI / Agent）**不需要改代码** —— 这就是整个改造要达到的效果。

---

## 6. 测试与验收策略

| 层级 | 手段 | 现有可复用的东西 |
| --- | --- | --- |
| 纯函数（selector / 归一化 / adapter 转译） | vitest，**mock fetch**，不碰网络 | `src/features/ai-settings/*.test.ts` 现有 5 个测试文件的风格 |
| 数据层（registry / migration） | `mkdtempSync` 临时目录 + 临时 DB，跑真实 `ensureDatabase()` | `src/features/ai-settings/model-gateway-sync.test.ts`（并已验证「不会把凭据写进工作区」的 `vi.mock("@/lib/secrets")` 手法） |
| API 层 | 直接 import route handler 调用（仓库已有此风格） | `src/app/api/**` 现有测试 |
| 凭据层 | 断言磁盘上**不出现明文**；`process.env` 清空后仍可读回 | 新增 |
| 端到端 | 扩 `scripts/model-management-smoke.ts`：登录 → 存假 key → 断言磁盘无明文 → `GET /api/models/registry` → 能力矩阵 → 生成一张图 | `scripts/model-management-smoke.ts`、`scripts/whiteboard-smoke.ts` |
| 打包验证 | `pnpm electron:pack` 后在打包产物里走一遍 P0/P3 的关键路径 | `scripts/electron-dry-run.ts`；AGENTS.md 要求验证打包产物 |

**「不回归」的判定标准**（每个里程碑都要过）

1. 测试文件数 ≥ 52、用例数 ≥ 280（现状实测值）。
2. `tsc --noEmit` / `eslint .` 干净（当前 eslint 有 1 条既有无关 warning，允许保留，不允许新增）。
3. `generateText` / `generateStructured` / `listProviderModels` 这类对外函数的**类型签名 diff 为空**（用 `git diff` 人工确认，或加一条 `tsc` 编译现有调用方的隐式断言）。
4. 3 份 locale 的 key 集合仍完全一致（可用一行 node 脚本断言，见附录）。

---

## 7. 风险登记表

| # | 风险 | 概率 / 影响 | 缓解 |
| --- | --- | --- | --- |
| R-A | `safeStorage` 在无用户配置文件/受限权限下抛错，导致保存 key 直接失败 | 中 / 高 | 桥必须**降级**为文件加密模式并把状态回报 UI；`COOLPILOT_CREDENTIAL_MODE` 逃生开关 |
| R-B | 打包环境 `Program Files` 只读，写数据目录失败 | 中 / 高 | 数据目录一律走 `APP_DATA_DIR`（`main.cjs:113`）→ `SOCIAL_AUTO_POST_DATA_DIR`（`:114`）→ cwd 兜底；先测安装版再测便携版 |
| R-C | 能力推断误判（把 text 模型标成 vision，或反之） | 高 / 中 | `source` 区分 `snapshot` / `provider-api` / `manual`；UI 默认只提示「N 个模型能力是推断的」，可人工覆盖 |
| R-D | 改动 `LocalAgentSettings` 契约导致设置页/agent 连锁失败 | 中 / 高 | P1–P3 全部「只增不改」；旧字段保留，双读一段时间 |
| R-E | 3 份 locale 不同步导致 tsc 失败 | 中 / 低 | 已被类型系统强制（`src/lib/locale-resources.ts:10`），只需按顺序补三份 |
| R-F | 引入 `keytar` 等原生模块破坏打包 | 低 / 高 | **不引入**；用 `safeStorage` + AES-GCM 回退 |
| R-G | 一次性迁移在已有用户库上跑出半成品数据 | 中 / 中 | 迁移幂等 + 单次事务 + 失败回滚；先备份（`src/db/repositories/backup.ts` 已存在，可复用） |
| R-H | video 能力无从实现，UI 却已展示 | 高 / 低 | 矩阵里明确标注「仅目录可见，未实现调用」，不要假装可用 |

---

## 8. 需要你拍板的三件事（决定后续实现细节）

1. **凭据桥的形态**
   - (A) 主进程 loopback HTTP 桥（推荐：复用 `COOLPILOT_SCHEDULER_TOKEN` 的既有模式，改动局部）
   - (B) 主进程提供一次性 CLI，由 Next 进程按需 spawn（无端口，但每次调用有进程开销）
   - (C) 把 Next server 跑进 Electron 主进程（能直接用 `safeStorage`，但 `ELECTRON_RUN_AS_NODE`/standalone 启动方式要大改，风险最高）
2. **是否允许把新能力暴露在旧 API 上**：保守做法是两个类型并存（本文推荐）；激进做法是直接扩 `ModelCapability` 并同步改旧 API 与设置页（省一层，但会牵动 `src/app/api/settings/ai/models/route.ts` 与设置页 datalist）。
3. **向导的入口**：独立页 `/settings/models`（可重复进入）vs 首启强制 modal（强调 BYOK 体验但打断感强）。

---

## 9. 业务闭环 → 能力需求映射（这一节决定优先级）

你的闭环（13 步）逐项对照本仓库代码的实测结果：

| # | 闭环步骤 | 需要的模型能力 | 现有实现（已核对） | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 输入一个产品 | 无（结构化输入） | `products` 表 + `/api/products` + `products/image` | ✅ 已有 |
| 2 | AI 分析目标用户 | text / reasoning | `positions`（`targetAudience` 200 字、`personaRole` 2000 字，`src/lib/positions.ts`）+ `/api/positions/generate`（`generateStructured` + `audiencePrompt`）+ `src/components/smart-config/*` | ⚠️ 半成品：**提示词驱动的画像生成**，不是数据驱动分析（没有把竞品/评论数据喂进去） |
| 3 | 搜索潜在用户 | text + **embedding**（相似/去重） | **没有用户发现模块**。`src/lib/hot-topics.ts` 覆盖 **32 个**平台/来源的**热点榜**（`hot-topic-platforms.ts`，其中 **18 个** `available: true`），是选题来源不是用户来源；采集侧只有 `src/lib/scraper.ts`（文章抓取）与浏览器自动化 | ❌ 缺 |
| 4 | 分析用户内容 | **vision（图片/视频输入）** + text | **完全没有**：全仓库 `inlineData` 只出现在 `src/lib/agent/image-generation.ts:86`（读**生成结果**），没有任何请求侧图像输入 | ❌ 缺 |
| 5 | 判断用户需求 | **vision** + text / reasoning | 无独立模块；最接近的 `/api/metrics/insights` 是分析**自己**的发布效果 | ❌ 缺 |
| 6 | 生成选题 | text / reasoning | `/api/positions/generate`（`contentDirection` / `topicAngle`）+ `hot-topics` + `src/lib/article-themes.ts` + `src/lib/writing-agents.ts` | ✅ 已有（text） |
| 7 | 生成文章 | text / reasoning | `/api/content/generate`、`src/lib/ai-writing.ts`、`src/lib/agent/langgraph-engine.ts` + `local-tools.ts`、`content/[id]/rewrite`、`translate` | ✅ 已有（text） |
| 8 | 生成图片 | image | `src/lib/agent/image-generation.ts`、`src/lib/article-images.ts`、`/api/images`、`images/search` | ⚠️ 可用但**绕过统一调用层**（直连 fetch，见 §3-P3） |
| 9 | 生成视频 | **video** | `src/lib/video-library.ts` 与 `/api/videos` 只是**上传与本地库**（mp4/mov/webm/m4v、5GB 上限、流式回放），**没有任何生成实现** | ❌ 缺 |
| 10 | 自动发布 | 无（浏览器自动化） | `src/lib/publish.ts`、`publish-profiles.ts`、`src/worker/runner.ts`、`schedules` + Playwright | ✅ 已有 |
| 11 | 统计数据 | 无 | `src/lib/metric-collector.ts`、`metric-sync.ts`、`metric_snapshots` 表、`/api/metrics/*` | ✅ 已有 |
| 12 | 分析效果 | text / reasoning | `/api/metrics/insights`（`generateStructured` + `metricInsightSchema`：verdict / summary / factors / suggestions，配合 `computeBaseline` 对比账号与平台均值） | ✅ 已有（text） |
| 13 | 下一轮优化 | 编排 + 归因 | **没有闭环回路**：insight 只回显在 UI（`src/components/console-metrics-board.tsx:610-670`，`useState` + 按需 `POST`，不持久化、不写回定位/选题/提示词）；`toolPlanSchema` 提供了工具编排的雏形但没接效果数据 | ❌ 缺 |

**闭环需要的模型能力清单（按出现次数）**

| 能力 | 服务哪些步骤 | 现状 |
| --- | --- | --- |
| text / reasoning | 2、5（一半）、6、7、12 | ✅ 已可调，但无能力选择器 |
| image generation | 8 | ⚠️ 可调但绕过调用层 |
| **vision（图像/视频输入）** | 4、5 | ❌ 完全没有 —— **闭环里最被低估的能力** |
| **embedding** | 3（相似/去重）、12–13（历史内容检索、效果聚类） | ❌ 完全没有（只在目录分类器里出现过字面量） |
| **video generation** | 9 | ❌ 完全没有 |

### 9.1 闭环暴露的三个业务级要求（它们比技术洁癖更能定优先级）

1. **量级决定模型分层**：步骤 3–5 是「对**大量外部用户内容**做分析」，单条调用成本必须压得住。→ 模型层要支持**按用途（purpose）分模型**：便宜模型做分类/抽取，强模型做创作。这就是为什么 `ai_defaults` 不能只按 capability，必须有 `purpose` 维度（如 `audience-analysis` / `user-content-analysis` / `topic` / `article` / `image` / `insight`）。
2. **闭环要能回答「这一轮为什么好/差」**：第 12–13 步要求按 **步骤 × provider × model** 归因。现有 `usage_records`（`src/db/schema.ts:254`：provider / model / kind / input_tokens / output_tokens / total_tokens / word_count）缺 `capability` 与 `purpose` 两列 → P1 顺手补上（走既有 `ALTER TABLE … ADD COLUMN … DEFAULT` 风格）。
3. **闭环是定时跑的**（`schedules` + `worker`），模型不可用时不能整条流水线挂掉。→ 候选队列 + 降级 + **可读的 reason** 是硬需求，不是锦上添花；这也让「本地模型（Ollama / LM Studio）」从"玩具"变成生产兜底。

### 9.2 据此调整的路线图（只改动优先级，不新增阶段）

- **P0 / P1 不变**，但 P1 增加两件事：`ai_defaults.purpose` 列、`usage_records` 补 `capability` + `purpose` 列。
- **P2（能力矩阵）变得更关键**：矩阵里必须把 vision / embedding / video 明确显示为**缺口**，而不是像今天这样把它们列在目录里让人误以为可调 —— 否则第 3–5 步的排期会被错误估算。
- **P3 重排**：`P3a text+image 等价重构` → **`P3c 多模态输入（vision）`** 紧接其后（闭环第 4–5 步直接卡在这），audio / embedding 次之（embedding 服务于第 3 与 12–13 步，性价比也高）。
- **video 生成放到最后**（P4 之后）：它需要供应商侧的新协议与异步任务模型（提交 → 轮询 → 取产物），不是「加一个 adapter」能解决的；P4 阶段矩阵里如实标注「仅目录可见，未实现调用」。
- **闭环编排（13 步串联）不进模型层**，但模型层要先把 `purpose` 维度与批量/并发调用准备好；否则编排层写出来会到处硬编码 provider。

### 9.3 一个务实的判断

第 3–5 步（找人 → 看内容 → 判断需求）是**增长功能**，不依赖模型层也能做（浏览器采集 + 规则），但**有了模型层之后才做得便宜、做得准**。所以模型层不是闭环的硬前置，而是它的**成本与质量杠杆**：

- 建议先做完 **P0 + P1**（约 3–5 人日，见 §4 的 M1/M2），让「key 不外泄 + 用量可归因」先成立；
- 再开始闭环第 3–5 步的采集与分析设计，避免「边做闭环边改模型层」的双向返工；
- 第 12–13 步（效果 → 优化回路）是最容易看到商业价值的一环，且**只需要 text 能力**，可以早做：`usage_records` 补完 `purpose` 后，把 `/api/metrics/insights` 的输出按 `purpose='insight'` 归因，再写回定位/选题提示词即可形成第一版闭环。

---

## 附录 A · 本次核对过的证据（文件:行）

| 结论 | 证据位置 |
| --- | --- |
| key 明文写入 `.env.local` | `src/lib/secrets.ts:47-49`（`envFilePath()`）、`:105-108`（`writeEnvVar`） |
| `keytar` 缺失 → OS 存储路径为空 | `src/lib/secrets.ts:21-30`（`loadKeytar()` 永远 `null`）；`package.json` 依赖清单里无 keytar |
| Electron 无 `safeStorage` 调用 | `electron/main.cjs` / `electron/server-bootstrap.cjs` 全文无 `safeStorage` |
| Next server 是独立 Node 进程 | `electron/main.cjs:110-125`（`spawn` + `ELECTRON_RUN_AS_NODE=1`） |
| 跨进程鉴权先例（可复用） | `electron/main.cjs:17,121`；`src/app/api/internal/scheduler/tick/route.ts:10-11` |
| 数据目录解析已有分支 | `electron/main.cjs:48-58`（`resolveDataDir()`）、`:113-115`（env 注入） |
| 迁移机制是手写 SQL，无 migrations 目录 | `src/db/client.ts:43`，语句数组 `:50-308`，ALTER `:313-322`、`:328-354`，索引顺序坑 `:356-357` |
| `ai_providers` 是死表 | `src/db/schema.ts:17`、`src/db/client.ts:63`（全仓库仅此两处命中） |
| 能力枚举目前只有 text/image | `src/features/ai-settings/model-catalog.ts:6`；白名单在 `src/app/api/settings/ai/models/route.ts:10-12` |
| 协议分派已存在但未抽象 | `src/lib/ai/providers.ts:67,94,127` |
| 没有能力选择器 | `src/lib/ai/generate.ts:45-56`（按 provider 顺序重试）、`:69`（`resolveFirstAvailableModel`） |
| 统一出口只有 text | `src/lib/ai/generate.ts:85,115` |
| 图片生成绕过调用层 | `src/lib/agent/image-generation.ts`（直连 fetch） |
| 上层调用面（硬约束） | 19 个文件 import `@/lib/ai`；`generateText` 2 处 / `generateStructured` 11 处调用（8 个 API route + 6 个组件 + `src/lib/agent/**` 4 个 + `src/lib/article-images.ts`） |
| 3 份 locale key 完全对齐（1572 个） | `node -e` 实测：`zh-hk` 缺 0 / 多 0，`zh-cn` 缺 0 / 多 0；类型约束在 `src/lib/locale-resources.ts:10-13` |
| 测试现状 | 52 文件 / 280 用例通过（`node_modules\.bin\vitest.cmd run`） |

## 附录 B · 复现命令

```powershell
# 门禁
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\vitest.cmd run
node_modules\.bin\eslint.cmd .

# 目录数字（420 条 / 22 个厂商组 / 能力分布）
npx tsx -e "import { buildGatewayVendorGroups, countGatewayModelsByCapability } from './src/features/ai-settings/model-gateway-catalog'; console.log(buildGatewayVendorGroups().length, countGatewayModelsByCapability());"

# locale key 对齐断言（应在 CI 里加一条）
node -e "const fs=require('fs');const l=p=>JSON.parse(fs.readFileSync(p,'utf8'));const en=l('src/locales/en.json');for(const f of ['zh-hk','zh-cn']){const d=l('src/locales/'+f+'.json');const miss=Object.keys(en).filter(k=>!(k in d));const extra=Object.keys(d).filter(k=>!(k in en));console.log(f,'missing',miss.length,'extra',extra.length);}"

# 打包验证（P0 的验收标准要求必须在产物上跑）
pnpm electron:pack
```

## 附录 C · 与设计篇的对应关系

| 设计篇 | 本文 |
| --- | --- |
| §3 差距分析 G1–G8 | §1 的判定表逐层对应，§3 每阶段标注对应 G 编号 |
| §5 目标数据结构 | §3-P1 的 4 张表（落地版，含索引与迁移方式） |
| §6 选择器 / Adapter API | §5.3 / §5.4 的签名草案 |
| §7 首启向导 | §3-P4 |
| §8 路线图 P0→P4 | §3 + §4 里程碑（拆成 M1–M6，带依赖与工时） |
| §9 风险 | §7（补充了打包权限与迁移两个本仓库特有的风险） |
| （设计篇未覆盖）商业闭环 | **§9** 的 13 步闭环 → 能力需求映射，以及据此做的优先级调整（§9.2） |

