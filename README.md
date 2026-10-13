# CoolPilot

**CoolPilot** is a local-first AI workspace for content creation and publishing: an Electron desktop shell around a Next.js console, with every record, file and model call staying on your own machine.

It covers the whole loop rather than one step of it — ideas and research → articles, images, mind maps and video → a reusable brand / knowledge / research library → scheduled publishing through your own logged-in browser profiles → publish records, metrics and leads → usage, budget, quality and cost readings.

The console ships in Simplified Chinese, Traditional Chinese (Hong Kong) and English; the default locale is `zh-cn`.

[繁體中文說明](README.zh-TW.md)

## Why it is built this way

- **Local-first by construction.** One SQLite database plus plain folders for browser profiles, uploads, artifacts, media and rendered videos. The data directory is yours; there is no account system, no cloud runtime and no managed credits.
- **Bring your own models.** Providers, endpoints, models, credentials and prices are managed inside the app (**系统设置 → 模型管理**). Several keys can be configured per provider and are rotated with a cooldown when a provider answers `429`. The usage ledger never stores prompts, and credentials never appear in the logs.
- **Content, not just posts.** Topics, brands, products, account positioning and a knowledge base feed AI writing, article creation, image generation, a whiteboard and a mind map; results land in the content library and can be edited again later.
- **Publishing through real browsers.** Playwright drives one persistent Chromium profile per account, so you log in manually once per account and reuse that session afterwards. There is no platform API dependency; what actually went out is recorded as a fact in `publish_records`.
- **Cost is a reading, not a guess.** Every real model request writes exactly one ledger row carrying an explicit `cost_source` — `provider-reported`, `computed`, `unpriced` or `unknown` — and a request-time budget gate may refuse or pause spending. Unknown cost is never reported as `0`.

## Download and run

Packaged builds are produced by the `.github/workflows/desktop-build.yml` workflow and attached to the workflow run as downloadable artifacts:

- **Windows — installer** `CoolPilot Setup <version>.exe` (NSIS): run it, then open CoolPilot from the Start menu.
- **Windows — portable** `CoolPilot-Windows-x64.zip`: extract the whole ZIP to a permanent folder and run `CoolPilot.exe` inside `win-unpacked`. Keep the executable next to its `resources` files.
- **macOS** `CoolPilot-GitHub-macOS-arm64.dmg` (Apple Silicon): open the DMG, drag **CoolPilot** to **Applications**.
- **Microsoft Store** AppX package, when the store identity variables are configured for the repository.

Windows downloads are deliberately **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY: false`), so Microsoft SmartScreen may show a warning — choose **More info** → **Run anyway** only for a file you got from this repository. The macOS build is signed with a Developer ID and notarized by Apple once the five Apple secrets are configured; without them the workflow builds an unsigned development DMG.

To build the desktop app yourself:

```powershell
pnpm electron:build:win     # or electron:build:mac / electron:build:store
```

Your local database, browser profiles, uploads, media and artifacts are not touched by an app update.

## The console

Eight business groups ordered along the production chain, plus the nested canvas group — 31 pages in total:

| Group | Pages | What you come here to do |
| --- | --- | --- |
| 工作台 Workbench | `/dashboard`, `/chatroom` | Enter the day's work; talk to the agent |
| 内容创作 Creation | `/creation/ai-writing`, `/creation/topics`, `/creation/articles`, `/creation/images`, `/creation/posts`, plus 智能画布 `/whiteboard` and `/mindmap` | Turn an idea into an article, image, 图文动态 or a canvas product |
| 品牌与资产 Assets | `/content/library`, `/creation/research`, `/creation/brands`, `/creation/products`, `/smart-config/positioning`, `/smart-config/knowledge-base` | Reusable material: content library, research, brands, products, positioning, knowledge base |
| 发布与渠道 Publishing | `/publishing/accounts`, `/creation/videos`, `/publishing/records`, `/publishing/leads`, `/schedules/list`, `/schedules/calendar` | Accounts and profiles, video publishing, publish records, leads, schedules and the content calendar |
| 自动化 Automation | `/runs/queue`, `/automation/logs`, `/automation/nodes` | Run and observe repeatable executions |
| 数据与成本 Data & Costs | `/data-center`, `/automation/generations`, `/system/cost-center` | Business metrics, generation records and AI spend |
| 扩展市场 Extensions | `/app-store` | The extension surface that exists today |
| 系统设置 System | `/system/models`, `/settings`, `/system/workspace` | Local machine configuration: models, preferences, workspace |

The menu is a product contract, not a mirror of the source tree: it is defined once in `src/lib/console-nav.ts` and `console-nav.test.ts` pins the group count, the order, the exact route set and the labels in all three locales without a DOM.

## AI models and cost accounting

- **One entry point for every model call.** All AI work goes through `src/features/ai-runtime`: a registry of providers / endpoints / models / preferences, adapters for three protocols (`openai-compatible`, `gemini`, `anthropic`), a key pool with failure cooldown, capability detection and a request trail. The runtime is a frozen seam — it holds no database dependency, and the callers own ledger writes.
- **Capabilities, not vendor names.** Thirteen declared capabilities (`chat`, `reasoning`, `vision`, `audio_input`, `audio_output`, `tool_calling`, `structured_output`, `image_generation`, `video_generation`, `text_to_speech`, `speech_to_text`, `embedding`, `rerank`) decide which model a call may use. A capability that is not declared is probed (`POST /api/ai/models/probe`) rather than assumed.
- **Usage ledger.** `ai_usage_ledger` holds one row per real request — including failures and retries — carrying provider-reported usage when the provider sends it and an explicit `unpriced` / `unknown` when it does not. `ai_model_prices` is an append-only price catalog with one price per metering dimension; a price whose dimension or unit does not match stays `NULL` + `unpriced` instead of being converted silently.
- **Budget gate.** `src/lib/ai-budget*.ts` reserves budget as a row (`ai_budget_reservations`) before the request leaves, settles it idempotently, and records a decision trail (`ai_budget_decisions`). Because the reservation is a row, the guarantee holds across processes: the console, the worker and a second instance share one database file (writes wait on the lock, `sqliteBusyTimeoutMs = 5000`, instead of failing).
- **Readings in the cost center.** `/system/cost-center` reports spend totals and per-call detail (`/api/ai-cost-center/calls`), budget settings, an estimate before spending, metering coverage per dimension, and quality readings — accepted / edited / regenerated and cost per qualified output — with spend kept apart by extension id, so rows that belong to no extension stay unassigned instead of being folded into one bucket.
- **Prices you can see.** `/api/models/prices` exposes the price catalog next to `/api/models/catalog` for the model list, so what a call costs is inspectable from the console.

## Content, research and knowledge

- **Creation.** AI writing and article creation run ordinary long tasks with real progress, a real log and a cancel button. `/creation/images` is an AI image workbench with a gallery; `/creation/posts` drafts a 图文动态 (caption plus gallery image); the whiteboard and mind map are a vendored Plait / Drawnix / Slate canvas whose result can be handed to the content library and continue in the article editor.
- **Research materials.** Import a file (`/api/research/upload`) or a URL (`/api/research/[id]/fetch`), then transcribe audio or video into the material (`/api/transcription`). The transcript keeps the engine's own segments — the model gateway's speech-to-text, or the recognizer already on the machine when no speech model is configured — and the fallback is never the cloud. Editing the text a generation reads never rewrites what the engine recognised.
- **Research distillation.** A long task reads a material's own text and stores a **versioned** result on it (`/api/research/[id]/extraction`): summary, key points, facts that each carry the excerpt they came from, quotes and topic suggestions. Every fact is checked against the material's own text — an excerpt the material does not contain is marked 原文中未找到 and withheld from the writer. Re-distilling writes a new version, editing the result by hand does not, and "the material has changed since this was distilled" is decided by fingerprint comparison rather than by a timestamp.
- **Knowledge base and embeddings.** `/smart-config/knowledge-base` keeps reusable entries; `src/lib/knowledge-embedding/**` generates and recalls embeddings over them (`/api/knowledge-base/embeddings`), so retrieval reads vectors a real embedding model produced and says so when it has none.
- **Positioning, brands and products.** `/smart-config/positioning`, `/creation/brands` and `/creation/products` are generation inputs: an account's positioning profile, a brand kit and a product catalog are referenced while articles and posts are written.
- **Topic pipeline.** `/creation/topics` collects ideas (manual, hot topics, or a suggestion distilled from research) and hands a topic to the article writer, recording which material it came from.

## Publishing and operations

1. Create an account (`/publishing/accounts`) — CoolPilot gives it its own persistent Chromium profile.
2. Open that profile from the app and log in to the platform manually.
3. Repeat per account: cookies, local storage and sessions stay separated by profile.
4. Run the account health check before a run: a profile that can no longer reach its publishing page is reported instead of being launched blindly, and a run is not started for an account the check found signed out.

- **Schedules** (`/schedules/list`) support five recurrence rules — `once`, `daily`, `weekly`, `monthly`, `interval` — and the next run is the earliest occurrence across all of them. Video publishing (`/creation/videos`) is scheduled the same way.
- **Content calendar** (`/schedules/calendar`, `GET /api/calendar`) merges three layers for any date range and lets you hide each one: scheduled occurrences (paused ones struck through), run history, and what actually went out from `publish_records`. It also ranks your best weekday/hour slots from real engagement and can turn the selected slots into weekly rules in one click.
- **Run queue** (`/runs/queue`) is the queue itself: queued, running, success, warning, failed and paused runs with their event log (`/api/runs/[id]/events`). A run that paused on a budget gate or an approval requirement can be resumed or cancelled from there, and the checkpoint of a pause is the truth about that run.
- **Automation logs and nodes** (`/automation/logs`, `/automation/nodes`) keep execution history and execution nodes as separate business objects.
- **Publish records** (`/publishing/records`) are the publish facts. On success the runner writes `publish_records` first and the content status second; `POST /api/publish/verify` then consumes the receipt and feeds the metric snapshots instead of assuming the post landed.
- **Metrics** (`/data-center`, backed by `/api/metrics/overview`, `/api/metrics/series`, `/api/metrics/insights`, `/api/metrics/content`, `/api/metrics/export`) collect per-content and per-account snapshots, series and insights, with settings under `/api/metrics/settings`.
- **Marketing leads** (`/publishing/leads`) close the chain from content to a lead to a deal. A deal without a recorded amount is reported as "no amount recorded" — never as `0`.

## The agent

`/chatroom` runs the agent on a purpose-built state machine (`src/lib/agent/langgraph-engine.ts`) with an explicit tool registry (`src/lib/agent/local-tools.ts`) — planning, tool calls, then a reply, with every step recorded in `agent_runtime_runs` / `agent_runtime_events` and the conversation in `chat_threads` / `chat_messages` / `chat_tool_calls`.

- Browser and content tools include `browser_open_page`, `browser_click`, `browser_type`, `browser_screenshot`, `generate_social_post_draft`, `generate_image_prompt`, `generate_image_file`, and the platform composers (for example `threads_create_post`, `xiaohongshu_create_post`).
- Tools that need approval are decided by the local permission settings: an action left in confirm mode parks the run in `pending_approval_json` and waits for `POST /api/agent/runs/[id]/resume` instead of publishing on its own.
- Scheduled agent runs are available separately under `/api/agent/schedules`.

## Local data, backup and restore

Runtime files live under `web-data/` in a development checkout, and under the packaged data directory when CoolPilot runs as a desktop app:

- `social-auto-post.db` — the SQLite database (36 tables, no foreign keys: relationships are conventions plus JSON blobs)
- `browser-profiles/` — one persistent profile per account
- `uploads/` — assets you added
- `artifacts/` — generated images, screenshots and agent artifacts
- `media/` and `videos/` — audio/video you imported, and rendered video output

Override the location with `SOCIAL_AUTO_POST_DATA_DIR` or `APP_DATA_DIR`; `SOCIAL_AUTO_POST_DB_URL` points the database at a different file.

- **Backup and restore** (**系统设置 → 备份**): `GET /api/backup/export` writes every table into one `coolpilot-backup-<date>-<time>.json`; `POST /api/backup/restore` reads it back in `replace` mode (the workspace becomes an exact copy) or `merge` mode (existing rows are kept and duplicate primary keys skipped). Files are validated first, and an unknown table or column is skipped with a warning rather than failing the whole restore. Browser profiles, uploads, media, videos and artifacts are **not** in the JSON — copy those folders too, then sign in again if a profile path changed.
- **Workspace overview** (`/system/workspace`, `GET /api/workspace/manifest`) is a read-only reading of what this process actually has open: the database and its table count, content assets and how many of them content references, linked and unlinked browser profiles, videos, imported media, and an **attention** section naming what nothing points at yet. Asking for the overview of an empty install creates nothing, and everything missing is a smaller number rather than an error.

Never commit `.env.local`, `web-data/`, browser profiles, database files, uploads, artifacts or logs.

## What it runs on

| Layer | What it is here |
| --- | --- |
| Desktop shell | Electron 42: a window (1280×860, `contextIsolation: true`, no preload, no IPC), a tray, the Next standalone server it spawns, and a 10-second tick to the scheduler over loopback HTTP with a bearer token |
| Console | Next.js 16.2.4 (App Router, `output: "standalone"`) + React 19.2.4; `src/proxy.ts` sends unprefixed paths to a locale |
| UI | HeroUI, Tailwind CSS v4 and lucide-react; SWR for data loading; Zod for request, tool and settings validation |
| Data | SQLite through libsql + Drizzle ORM; `src/db/schema.ts` (36 tables) is the single table definition and `src/db/repositories/**` the only write path from the app |
| AI | `src/features/ai-runtime` (frozen seam): provider / endpoint / model registry, three protocol adapters, key pool, capability probe; ledger, price catalog and budget gate live in the database |
| Agent | `src/lib/agent/**`: a purpose-built state machine plus a tool registry with approval rules |
| Browser | Playwright with one persistent Chromium profile per account; the same session backs the browser preview panels |
| Canvas | Vendored Plait / Drawnix / Slate editors under `src/whiteboard/**`, reused by `src/mindmap` |
| Worker | `src/worker/**`: scheduler tick, queue claim and playbook runner — started by `pnpm worker` or by the desktop tray tick |
| Tests and tooling | Vitest 4 (`environment: "node"`, `src/**/*.test.ts`), ESLint 9 with eslint-config-next, `tsx` for scripts, pnpm 10.26.1 |

## Requirements

- Node.js 20.9 or newer
- pnpm 10.26.1 (`packageManager` in `package.json`)
- Playwright Chromium: `pnpm exec playwright install chromium`
- ffmpeg on `PATH` (or `FFMPEG_PATH` / `FFPROBE_PATH`) for the offline speech engine
- Windows, macOS or Linux

## Quick start

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm exec playwright install chromium
pnpm dev
```

Start the worker in a second terminal so schedules and queued runs make progress:

```powershell
pnpm worker
```

Then open:

```text
http://127.0.0.1:3000
```

The console redirects to a locale (`zh-cn` by default; `zh-hk` and `en` are also shipped). Under the packaged Electron shell the same console is served from `.next/standalone` on a loopback port (3130 by default, a random free port if that one is taken) and the tray timer ticks the scheduler, so a separate worker is not needed there.

## Environment setup

`.env.example` is the reference file. At minimum:

```env
SOCIAL_AUTO_POST_DB_URL=file:./web-data/social-auto-post.db
SOCIAL_AUTO_POST_LOCAL_TOKEN=change-this-local-token
```

Add the providers you use:

```env
GEMINI_API_KEYS=
GEMINI_MODEL=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
GEMINI_IMAGE_MODEL=

GROQ_API_KEYS=
GROQ_MODEL=
GROQ_BASE_URL=https://api.groq.com/openai/v1

OPENAI_API_KEYS=
OPENAI_MODEL=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODEL=
OPENAI_IMAGE_SIZE=

OPENROUTER_API_KEYS=
OPENROUTER_MODEL=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Every `*_API_KEYS` variable accepts several keys separated by commas or newlines. The AI runtime rotates through them and cools a key down when a provider answers `429`, so one rate-limited key does not take the provider offline. The same keys can be managed per provider under **系统设置 → 模型管理 → 供应商与密钥**, where they are stored in the local vault instead of the environment file.

Other variables you may need:

| Variable | Purpose |
| --- | --- |
| `SOCIAL_AUTO_POST_DATA_DIR`, `APP_DATA_DIR` | Where the database, profiles, uploads, media and artifacts live |
| `SOCIAL_AUTO_POST_DB_URL` | Point the database at a different file |
| `SOCIAL_AUTO_POST_WORKER_POLL_MS` | Worker poll interval (default 10000 ms) |
| `COOLPILOT_SERVER_PORT`, `COOLPILOT_SERVER_HOST` | Port and host the packaged server binds to |
| `COOLPILOT_SCHEDULER_TOKEN` | Bearer token the shell uses when it ticks the scheduler |
| `FFMPEG_PATH`, `FFPROBE_PATH` | ffmpeg/ffprobe used to decode audio for the local speech engine |

## Common commands

```powershell
pnpm dev
pnpm worker
pnpm build
pnpm start
pnpm test
pnpm typecheck
pnpm lint
pnpm electron:pack
pnpm electron:build
pnpm electron:dry-run
pnpm db:generate
pnpm db:studio
```

If `pnpm` is blocked by ignored build-script policy in a local environment, the direct binaries still verify the repo:

```powershell
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\vitest.cmd run
node_modules\.bin\eslint.cmd .
```

CI (`.github/workflows/ci.yml`) runs exactly those three checks through pnpm on every push to `main` and every pull request.

## Project structure

```text
src/app/[locale]/(console)/   Console pages (35)
src/app/api/                  JSON route handlers (122)
src/components/               Console UI and feature panels (90)
src/features/ai-runtime/      Model gateway (frozen seam)
src/features/ai-settings/     Model catalogs, provider settings and catalog sync
src/lib/                      Domain logic: agent, publishing, ledger, budget, schedules, i18n
src/db/                       Table definitions, client and DDL, repositories
src/worker/                   Queue, scheduler and playbook runner
src/whiteboard/ · src/mindmap/   Vendored canvas and the mind map built on it
electron/                     Desktop shell (main.cjs, server-bootstrap.cjs)
scripts/                      Build, packaging and smoke scripts
public/                       Static assets
docs/                         Architecture, data model, menu IA and delivery records
```

The counts above are file counts measured in this repository at HEAD.

## Safety and platform disclaimer

This software controls browsers and can interact with third-party social media platforms. Using automation, multi-account workflows, scraping, posting tools, or stealth browser technology may violate a platform's terms of service or automation policies.

Your accounts may be challenged, rate-limited, restricted, suspended, or banned by social media providers. Browser automation cannot guarantee that it will avoid bot detection, CAPTCHA, device checks, review systems, or enforcement actions.

Use CoolPilot only on accounts you own or are authorized to manage. Do not use it for spam, impersonation, deceptive engagement, credential abuse, platform manipulation, or any illegal activity. You are responsible for reviewing platform rules and local laws before running automated workflows.

## License

MIT. See [LICENSE](LICENSE).

## Author

CoolPilot is designed, built and maintained by [Edgarmongo](https://github.com/Edgarmongo).
