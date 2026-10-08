# 技术栈清单（Tech Stack Inventory）

> 全部为**实测**：版本取自 `package.json`，用法取自代码里的真实 import / 调用点，**不使用**「通常某技术栈会用到」这类推断。
> 特别标注了两类容易踩坑的情况：**① 声明了依赖但代码 0 引用**；**② 配置里存在但实际没走那条路**。
> 复现命令见文末附录。

## 0. 一句话总览

**Electron 42 外壳 + Next.js 16（App Router / Standalone）+ React 19 + SQLite(libsql) + Drizzle + Tailwind v4 + SWR + Zod + Vitest**，AI 侧是**直连 REST（Gemini native / OpenAI-compatible）+ LangGraph 自研 agent 层**，浏览器自动化用 **Playwright**，白板/思维导图内嵌了 **Plait / Drawnix / Slate** 的 vendored fork。

---

## 1. 语言与运行时

| 技术 | 版本 / 配置 | 用途与证据 |
| --- | --- | --- |
| **TypeScript** | `^5`；`strict: true`、`noEmit`、`target: ES2017`、`moduleResolution: "bundler"`、`jsx: "react-jsx"`、`isolatedModules`、`incremental` | 整个代码库的主体；路径别名 `@/* → ./src/*`（`tsconfig.json`） |
| **TSX / JSX** | `react-jsx` | React 组件（175 个 `.tsx`） |
| **JavaScript (CommonJS)** | `.cjs` | 仅 Electron 主进程：`electron/main.cjs`、`electron/server-bootstrap.cjs`（eslint 对 `electron/**/*.cjs` 专门关掉 `no-require-imports`，见 `eslint.config.mjs:18-23`） |
| **Node.js** | `engines: >=20.9.0`；CI 用 Node 20 | 服务端运行时；Next standalone 由 Node 直接跑 |
| **SCSS / Sass** | `sass ^1.101.0`；**24 个 `.scss`，全部在 `src/whiteboard/**`** | 白板 vendored 代码的样式；主应用只用 1 个 CSS 文件 |
| **CSS** | `src/app/globals.css`（唯一） | Tailwind v4 入口 + 主题变量 |
| **JSON** | 3 份 locale | `src/locales/{en,zh-hk,zh-cn}.json` |
| **PowerShell / Bash** | — | 本地验证命令（`AGENTS.md`）与 GitHub Actions |

**实测规模**：528 个文件（`src/` + `scripts/` + `electron/`），其中 `.ts` 321 / `.tsx` 175 / `.scss` 24 / `.json` 3 / `.cjs` 2，合计约 **59,442 行**。

---

## 2. 应用框架

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **Next.js** | `16.2.4` | App Router；`next.config.ts` 设 `output: "standalone"`、`transpilePackages`（8 个 `@plait/*` 包）、`outputFileTracingExcludes`（排除 `web-data` / `dist-electron` / playwright 产物） |
| **React** | `19.2.4` + `react-dom 19.2.4` | Server Components 与 Client Components（`"use client"`）混用 |
| **Next 16 的 `proxy.ts`** | — | ⚠️ **注意**：路由前缀重定向用的是 `src/proxy.ts`（**不是** 旧版 `middleware.ts`），做 locale 重定向到 `/{defaultLocale}/…`。这与 `AGENTS.md` 里「This is NOT the Next.js you know」一致 |
| 路由结构 | — | `src/app/[locale]/(console)/{dashboard, content, creation, chatroom, data-center, mindmap, publishing, runs, schedule(s), settings, smart-config, system, whiteboard, app-store, automation, account}`；API 在 `src/app/api/**`（实测 **87 个 `route.ts`**） |
| 自研 API 约定 | — | `src/lib/api.ts`（`ok/fail/parseJson`）+ `src/lib/app-errors.ts`（`AppErrorCode` 联合类型 + `AppError` 类）+ `src/lib/api-client.ts`（`apiGet/apiPost/apiPatch/apiDelete` + `ApiClientError`） |

---

## 3. 数据与持久化

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **SQLite（libsql）** | `@libsql/client ^0.17.2` | `src/db/client.ts:38`（`createClient({ url: dbUrl })`）；DB URL 来自 `SOCIAL_AUTO_POST_DB_URL`，默认 `file:./web-data/social-auto-post.db`；打包后走 Electron 注入的 `APP_DATA_DIR` / `SOCIAL_AUTO_POST_DATA_DIR` |
| **Drizzle ORM** | `drizzle-orm ^0.45.2`（11 处 import） | `src/db/schema.ts` 定义 20 张表（`accounts` / `content_items` / `schedules` / `runs` / `metric_snapshots` / `usage_records` / `knowledge_base` / `publish_records` / `app_settings` …） |
| **drizzle-kit** | `^0.31.10` | ⚠️ `drizzle.config.ts` 里 `out: ./src/db/migrations`，但**该目录不存在**；实际迁移逻辑是 `src/db/client.ts:43 ensureDatabase()` 手写 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … .catch()`。`pnpm db:generate` 目前没被使用（改这一层时要注意，见 `docs/model-layer-spec.md` §2.2） |
| 仓储层 | 自研 | `src/db/repositories/*`（17 个模块：accounts / content / settings / metrics / publish-records / backup / knowledge-base …）+ `src/db/repository.ts` 汇总导出 |
| 设置存储 | `app_settings` KV 表 | key/value + `value_json` 列；`src/db/repositories/settings.ts` 定义了 `local-agent` / `brand` / `local-agent-prompt` / `metrics` / `model-gateway` 五个 key |
| 文件存储 | 本地数据目录 | `src/lib/paths.ts` 统一约定；图片、视频、备份都落在数据目录（`videosRoot()` 等） |
| 浏览器本地存储 | `localforage ^1.10.0`（14 处）、`browser-fs-access ^0.38.0`（2 处） | 白板的本地持久化与文件读写 |

---

## 4. 前端状态、请求、国际化、校验

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **SWR** | `^2.4.1` | **项目主数据层**（164 处引用）：`useSWR(url, swrFetcher)` + `useSWRConfig().mutate` 做跨组件刷新（如 `model-gateway-sync-panel.tsx:63,89`） |
| 自研 fetch 封装 | — | `src/lib/api-client.ts`：`apiGet/apiPost/apiPatch/apiDelete/swrFetcher` + `apiErrorTranslationKey()`（把错误码映射成 `error_<CODE>` 文案键，`:20-25`） |
| **国际化（自研）** | 无第三方 i18n 库 | `src/lib/i18n.tsx`（Provider + `useI18n`）、`src/lib/locale-resources.ts`（`satisfies Record<Locale, typeof en>` 强制三份 key 一致）、`src/lib/i18n-config.ts`（`locales` / `defaultLocale` / `isLocale`）、3 份 JSON（**各 1572 个 key，实测零差异**）、`[locale]` 路由 + `src/proxy.ts` 重定向 |
| i18n 覆盖率测试 | — | `src/lib/i18n-coverage.test.ts`：断言三份 locale key 集合完全一致、且不含 mojibake（乱码） |
| **Zod** | `^4.3.6`（26 处） | 服务端请求校验（`src/lib/validation.ts`，含 `localAgentSettingsSchema` / `modelGatewayActionSchema`）+ **AI 结构化输出 schema**（`src/lib/ai/schemas.ts`：`postDraftSchema` / `chatTitleSchema` / `toolPlanSchema` / `metricInsightSchema` / `imagePromptSchema`） |
| 表单与状态 | React 内建 | `useState` + `useEffect` + 项目惯例 `window.queueMicrotask(() => setForm(...))` 播种表单（见 `model-config-panel.tsx:103-107`） |
| 微工具库 | `ahooks ^3.9.7`（2 处） | 少量 useRequest/useBoolean 类助手 |

---

## 5. UI 与样式

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **Tailwind CSS** | `tailwindcss ^4` + `@tailwindcss/postcss ^4` | `postcss.config.mjs` 单一插件；`src/app/globals.css` 开头 `@import "tailwindcss";` 后接 HSL 主题变量（`--background` / `--primary` / `--border` …，shadcn 风格 token） |
| **自研 UI kit** | — | `src/components/ui/*`：`button` / `dialog` / `drawer` / `bottom-sheet` / `form-controls`（`SegmentedControl` / `SelectField`）/ `console-surface`（`ConsoleNotice` + `consoleInputClass`）/ `nav-button` / `resizable` / `console-pagination` / `console-header-actions` / `logo-button` |
| 图标 | `lucide-react ^1.8.0`（65 处） | 全站图标 |
| 浮层定位 | `@floating-ui/react ^0.26.24`（6 处） | 下拉/提示的定位 |
| 分栏 | `react-resizable-panels ^4.11.1`（1 处） | 可拖拽分栏布局 |
| 类名工具 | `classnames ^2.5.1`（**76 处，主力**）+ `clsx ^2.1.1`（5 处） | `cn()` 组合类名（`src/lib/utils.ts`）；**没有使用 `tailwind-merge`** |
| 设备判断 | `mobile-detect ^1.4.5`（1 处） | 移动端适配分支 |
| 动画 | **`framer-motion` 已声明但 0 引用** | 见 §14 |

---

## 6. 编辑器与画布（白板 / 思维导图）

这一块是**内嵌的第三方 fork**，与主应用的技术栈相对独立（tsconfig 用路径别名自引用、eslint 直接忽略整个目录）。

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **Plait**（白板内核） | `@plait/core`、`@plait/common`、`@plait/draw`、`@plait/layouts`、`@plait/mind`、`@plait/text-plugins` 均 `^0.94.0`（合计 167 处引用） | `src/whiteboard/**`；`next.config.ts` 的 `transpilePackages` 把 8 个 `@plait*` 包全部纳入编译 |
| **Drawnix vendor fork** | 目录 `src/whiteboard/{drawnix,react-board,react-text}` + 24 个 `.scss` | tsconfig 别名指向本地目录：`@drawnix/drawnix`、`@plait-board/react-board`、`@plait-board/react-text`（即**本地覆盖了同名 npm 包**） |
| 转换桥 | `@plait-board/markdown-to-drawnix ^0.0.8`、`@plait-board/mermaid-to-drawnix ^0.0.8` | Markdown / Mermaid → 画布 |
| **Slate**（富文本） | `slate` / `slate-dom` / `slate-react` `^0.116.0`、`slate-history ^0.115.0`（合计 131 处） | 白板内的文本编辑 |
| 手绘风渲染 | `roughjs ^4.6.6`（2 处） | 图形描边风格 |
| 演示笔 | `laser-pen ^1.0.1`（1 处） | 白板演示激光笔 |
| 快捷键 | `is-hotkey ^0.2.0`（2 处，含 `@types/is-hotkey`） | 编辑器快捷键判定 |
| 思维导图 | **自研** | `src/mindmap/*`：`mindmap-canvas.tsx`、`mindmap-document`、`mindmap-history`、`mindmap-layout`、`mindmap-markdown`（**每个模块都带 `.test.ts`**） |
| 其它 | `tslib ^2.3.0` | 编译辅助，供 transpile 的包使用 |

---

## 7. AI 与 Agent

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **直连 REST（自研调用层）** | 无 SDK | `src/features/ai-runtime/adapters.ts`：按 endpoint 协议分派 —— Gemini native `generateContent` 与 OpenAI 兼容 `/chat/completions`；唯一出口是 `src/features/ai-runtime/runtime.ts` 的 `aiRuntime.chat()` / `chatStructured()` / `generateImage()`（P4 已删除 `src/lib/ai/providers.ts`、`generate.ts` 与 `compat.ts`） |
| **LangGraph** | `@langchain/langgraph ^1.3.2`（8 处） | `src/lib/agent/langgraph-engine.ts` + `/api/agent/chat` + `/api/agent/runs/[id]/resume`：agent 的图形化编排引擎 |
| 自研 Agent 层 | — | `src/lib/agent/*`（19 个文件）：`tool-registry.ts`、`local-tools.ts`、`system-prompt.ts`、`chat-context.ts`、`schedule-intent.ts`、`playwright-session.ts`、`image-generation.ts`、`contracts.ts` |
| **结构化输出** | Zod + 提示词约束 | `aiRuntime.chatStructured({ messages, systemPrompt, schema })`（10 处调用），schema 在 `src/lib/ai/schemas.ts`；JSON 指令、解析与单次纠错重试在 `src/features/ai-runtime/runtime.ts`（`parseStructured()` / `chatStructured()`） |
| 图片生成 | 直连 fetch（自研） | `src/lib/agent/image-generation.ts` 现在只做 artifacts 落盘 / 文件命名 / 空图守卫；Gemini `inlineData` 解析与 OpenAI `images/generations` 两条分支在 `src/features/ai-runtime/adapters.ts`（`aiRuntime.generateImage()`） |
| 模型目录 | 快照 + 可选同步 | `src/features/ai-settings/model-gateway-snapshot.ts`（420 条模型 / 22 个厂商组）+ `model-gateway-sync.ts`（用户 cookie 手动同步）+ `model-gateway-catalog.ts`（分类器：7 个能力） |
| 供应商元数据 | 自研注册表 | `provider-registry.ts`（4 个可调用 provider）+ `mainstream-model-catalog.ts`（14 家厂商：docsUrl / apiKeyUrl / OpenAI 兼容入口 / 本地可达 provider） |

**AI 侧的关键结论**（详见 `docs/model-gateway.md`、`docs/model-layer-spec.md`）：当前只有 `text` 与 `image` 两条真实调用路径；**没有 vision（图像输入）、没有 embedding、没有 video 生成**；`keytar` 不在依赖里 → 无 OS 凭据存储，API key 目前明文落 `.env.local`。

---

## 8. 浏览器自动化与内容抓取

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **Playwright** | `playwright ^1.60.0` + `playwright-core ^1.59.1`（27 处） | 账号登录/发布自动化：`src/lib/agent/playwright-session.ts`、`src/lib/agent/local-tools.ts`；脚本 `scripts/model-management-smoke.ts`、`scripts/whiteboard-smoke.ts`、`scripts/prepare-electron-bundle.ts`；CI 里 `pnpm exec playwright install chromium` |
| 自研浏览器会话管理 | — | `src/lib/browser.ts` + `browser-preview{,-session,-store,-shared}.ts`（内嵌浏览器预览）；`src/worker/open-profile.ts`（唤醒用户浏览器 profile） |
| **cheerio** | `^1.2.0`（6 处） | 热点榜/文章 HTML 解析（`src/lib/hot-topics.ts`、`src/lib/scraper.ts`） |
| **fast-xml-parser** | `^5.7.1`（3 处） | RSS / XML 源解析（同上） |
| 平台适配 | 自研 | `hot-topic-platforms.ts`（**32 个来源，18 个已实现**）、`publish-profiles.ts`、`metric-profiles.ts`（各平台发布/取数配置）、`account-health.ts`、`account-risk.ts` |
| `cloakbrowser` | `^0.3.30` | ⚠️ 已声明但**代码 0 引用**（见 §14） |

---

## 9. 桌面外壳、打包与分发

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **Electron** | `^42.3.3`（devDep） | `electron/main.cjs`：托盘、窗口、`before-quit`；`electron/server-bootstrap.cjs`：拼 `NODE_PATH` 后 `require` Next standalone |
| 进程模型 | 自研 | 主进程 `spawn(process.execPath, [bootstrap, server], { env: { ELECTRON_RUN_AS_NODE: "1", … } })`（`main.cjs:110-125`）→ **Next 是独立 Node 子进程**（这条决定 `safeStorage` 的跨进程方案）；窗口 `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`（**无 preload/IPC**） |
| 运行期辅助 | 自研 + 测试 | `src/electron/server-runtime.ts`（`resolveElectronAppDataDir` / `createElectronServerRuntime`）+ `server-runtime.test.ts` + `branding.test.ts` |
| **electron-builder** | `^26.8.1` | `electron-builder.yml`：`appId: io.coolpilot.app`；Windows `dir` + `nsis`；macOS `dmg` + `hardenedRuntime` + entitlements + notarization；`asarUnpack: .next/standalone/**` |
| 微软商店打包 | 自研脚本 | `scripts/build-store-package.ts`（`pnpm electron:build:store` → `.appx`） |
| 图标生成 | `sharp ^0.34.5` | **仅** `scripts/generate-icons.ts` 使用（`pnpm icons:generate`，被 `pnpm build` 依赖） |
| 便携数据目录 | 自研 | `web-data/` 与用户目录双路径判定（`main.cjs:48-58`、`server-runtime.ts:12-27`） |

---

## 10. 后台任务与调度

| 技术 | 用途与证据 |
| --- | --- |
| 内部调度端点 + Bearer 鉴权 | `src/app/api/internal/scheduler/tick/route.ts:10-11`（比对 `COOLPILOT_SCHEDULER_TOKEN`） |
| Electron 主进程轮询 | `electron/main.cjs:17`（`crypto.randomBytes(32)` 生成 token）、`:162-177`（每 10 秒 POST 一次 tick） |
| 独立 worker 进程 | `src/worker/{worker,scheduler-service,runner,open-profile}.ts`；`pnpm worker` → `tsx src/worker/worker.ts` |
| 任务持久化 | `schedules` / `runs` / `run_events` 表；`idx_runs_schedule_occurrence(schedule_id, scheduled_for)` 唯一索引做**时间点幂等**（`client.ts:342`） |
| 用量记录 | `usage_records` 表（provider / model / kind / tokens / word_count / account_id） |
| 队列中间件 | **无**（没有 Redis / BullMQ / Kafka；调度 = SQLite + 轮询） |

---

## 11. 测试、质量与 CI

| 技术 | 版本 / 配置 | 用途与证据 |
| --- | --- | --- |
| **Vitest** | `^4.1.5` | `vitest.config.ts`：`environment: "node"`（**无 jsdom**）、`include: ["src/**/*.test.ts"]`、alias `@ → ./src`；实测 **57 文件 / 325 用例全绿** |
| 测试风格 | — | 只测逻辑/仓储/路由 handler（**没有组件渲染测试**，因为没有 jsdom 与 @testing-library）；临时 SQLite 用 `mkdtempSync` + `vi.mock("@/lib/secrets")` 隔离（`model-gateway-sync.test.ts`） |
| 自研 smoke 脚本 | `tsx` | `scripts/model-management-smoke.ts`、`scripts/whiteboard-smoke.ts`（起 dev server 后用 Playwright 跑）、`scripts/electron-dry-run.ts` |
| **ESLint** | `^9` flat config + `eslint-config-next 16.2.4` | `eslint.config.mjs`：`core-web-vitals` + `typescript` 两套预设；`globalIgnores` 排除 `.next` / `dist-electron` / `out` / `build` / **`src/whiteboard/**`**；对 `electron/**/*.cjs` 关闭 `no-require-imports`。当前仅 1 条既存 warning（`src/components/agent-chat/chat-conversation.tsx:146`） |
| **tsc** | `^5`，`--noEmit` | `pnpm typecheck` |
| Prettier | **未使用**（无配置文件） | 格式由约定维持 |
| **GitHub Actions** | `.github/workflows/ci.yml` | pnpm 10.26.1 + Node 20 → `typecheck` → `lint` → `test` |
| | `.github/workflows/desktop-build.yml` | Windows 未签名产物（`--dir` + `nsis`，`CSC_IDENTITY_AUTO_DISCOVERY=false`）；macOS Developer ID 签名 + 公证（5 个 secret 必须同时存在或同时缺席）；Microsoft Store AppX（需 `MS_STORE_IDENTITY_NAME` / `MS_STORE_PUBLISHER`）；`v*` tag 触发 release 并校验 tag 与 `package.json.version` 一致 |

---

## 12. 构建工具与协作约定

| 技术 | 版本 | 用途与证据 |
| --- | --- | --- |
| **pnpm** | `10.26.1`（`packageManager` 字段） | 唯一包管理器；`pnpm-lock.yaml`；**注意**：本机 `pnpm` 会被 ignored build scripts 挡住，`AGENTS.md` 要求改用 `node_modules\.bin\*.cmd` 直连二进制验证 |
| **tsx** | `^4.21.0` | 所有 `scripts/*` 与 worker 的运行器（无需编译直接跑 `.ts`） |
| Next 构建产物 | `next build` → `.next/standalone` | `scripts/prepare-electron-bundle.ts` 把 standalone + static 摆到打包需要的位置（并处理 playwright 相关外置） |
| **opencc-js** | `^1.4.2` | **仅** `scripts/convert-zh-cn.mjs`：zh-hk → zh-cn 文案转换（与三份 locale 的维护方式相关） |
| 文档 | Markdown | `README.md` + `README.zh-TW.md`（**必须同步**）+ `docs/`（模型层：设计篇 / 实施篇 / 规格书 + 本清单） |
| 协作约定 | `AGENTS.md` / `CLAUDE.md` | 「这不是你熟悉的 Next.js」、直连二进制验证、打包产物必须实测、README 双语同步 |
| monorepo | **无**（`pnpm-workspace.yaml` 已删除） | 单包仓库 |

---

## 13. 外部服务与集成

| 集成 | 配置 / 证据 |
| --- | --- |
| **Dify** | `/api/dify/{connections, connections/[id], datasets}` + `dify_connections` 表 + `src/db/repositories/dify-connections.ts` |
| **AI 供应商** | 4 个可调用（gemini / groq / openai / openrouter）+ 14 家厂商元数据 + 420 条模型目录（快照 + 可选网关同步） |
| **本地模型** | 通过 OpenAI 兼容 `baseUrl` 接入（设置项 `openAIBaseUrl` / `openRouterBaseUrl`，`provider-registry.ts:65-74`） |
| **社交媒体平台** | 走 Playwright 浏览器自动化（复用用户已登录的浏览器 profile），无官方 API 依赖 |
| **Electron 凭据能力** | `safeStorage` 可用但**当前未使用**（见 §14） |

---

## 14. 声明但未使用 / 需要注意的技术债（全部实测）

### 14.1 依赖声明了但代码零引用

| 依赖 | 声明版本 | 代码引用实测 | 备注 |
| --- | --- | --- | --- |
| `@heroui/react` | `^3.0.3` | **0** | UI 全部是自研 kit + Tailwind |
| `framer-motion` | `^12.38.0` | **0** | 动画走 CSS transition |
| `@langchain/core` | `^1.1.48` | **0** | 只用了 `langgraph` |
| `@langchain/google-genai` | `^2.1.31` | **0** | AI 调用是直连 REST |
| `@langchain/openai` | `^1.4.7` | **0** | 同上 |
| `cloakbrowser` | `^0.3.30` | **0** | 浏览器自动化实际用 Playwright |

> 影响：安装体积与依赖攻击面偏大；如果要精简，这 6 条是最安全的候选（删除前需确认 `pnpm-lock.yaml` 与打包产物无隐式依赖）。

### 14.2 只在构建/脚本里使用的依赖（运行时不加载）

`sharp`（仅图标生成）、`opencc-js`（仅 zh-cn 转换）、`drizzle-kit`（仅 CLI；且 `src/db/migrations/` 不存在，实际迁移走 `ensureDatabase()`）。

### 14.3 需要注意的结构性事实

1. **无 OS 凭据存储**：`keytar` 不在依赖里，`electron/*.cjs` 无 `safeStorage` 调用 → API key 明文落 `.env.local`（P0 要修）。
2. **Electron 无 preload / IPC**：窗口 `sandbox: true` 且没有 preload 脚本 → 主进程与 Next 进程之间**只能**靠 loopback HTTP + token 通信（这正是凭据桥方案的技术前提）。
3. **Drizzle 双轨风险**：`drizzle.config.ts` 存在但迁移目录不存在；改表只能追加 `ensureDatabase()` 的手写 SQL。
4. **`src/whiteboard/**` 是 vendored fork**：被 eslint 忽略、用 tsconfig 别名覆盖同名 npm 包，改它要格外小心（也会影响 `next.config.ts` 的 `transpilePackages`）。
5. **i18n 是自研的**：没有 ICU / 复数 / 日期格式化，只有 `{name}` 插值与 `error_<CODE>` 约定；三份 locale 的 key 必须完全一致（有测试强制）。
6. **历史命名迁移内建**：`sites → accounts`、`site_id → account_id` 等 best-effort 重命名仍在 `ensureDatabase()` 里执行（`client.ts:311-322`）。
7. **既存 lint warning**：`src/components/agent-chat/chat-conversation.tsx:146`（`react-hooks/exhaustive-deps`），改动该文件时不要新增。

---

## 附录 · 复现命令

```powershell
# 全部依赖与版本
node -e "const p=require('./package.json');for(const [k,v] of Object.entries({...p.dependencies,...p.devDependencies})) console.log(k.padEnd(32), v)"

# 判断某依赖是否真的被使用（把 <name> 换掉）
Get-ChildItem src -Recurse -Include *.ts,*.tsx | Select-String -Pattern '<name>' | Measure-Object

# 文件与行数统计
$all = Get-ChildItem src,scripts,electron -Recurse -File
$all | Group-Object Extension | Sort-Object Count -Descending | Select-Object -First 10
($all | Where-Object { $_.Extension -in '.ts','.tsx','.cjs','.mjs','.scss','.css','.json' } | Get-Content | Measure-Object -Line).Lines

# 质量门禁
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\vitest.cmd run
node_modules\.bin\eslint.cmd .
```



