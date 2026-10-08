# CoolPilot

**CoolPilot** 是一個開源 AI 社群媒體代理。

你的開源社群媒體代理 — 在自己的電腦上規劃、核准、排程與發布社群活動。

CoolPilot — 陪你一起管理社群媒體的 AI 副駕駛。

CoolPilot 是本機優先的開源社群媒體代理；帳號、內容、排程、發布紀錄與瀏覽器 profiles 全部保存在你自己的電腦上。

它整合 Electron 桌面 app、Next.js 控制台、持久化瀏覽器 profile、排程發文，以及可以協助建立與執行社群任務的 AI social media agent。

你可以把它當成行銷工作用的本機 Agent OS：連接多個已登入帳號、讓每個帳號使用獨立瀏覽器 profile、用自己的模型 API key 生成貼文與圖片、建立 queue、安排 scheduled social posting，並讓 AI agent 在人工核准機制下協調瀏覽器操作。

[English README](README.md)

## 下載及執行 CoolPilot

請從 [GitHub Releases](https://github.com/Edgarmongo/CoolPilot/releases) 下載最新版本。正式發佈使用版本標籤，例如 `v0.1.0`。

### Windows

- **安裝程式（`CoolPilot Setup <版本>.exe`）**：下載並執行安裝程式，然後從開始功能表開啟 CoolPilot。
- **可攜式 ZIP（`CoolPilot-Windows-x64.zip`）**：將整個 ZIP 解壓縮到固定資料夾，再開啟 `win-unpacked` 內的 `CoolPilot.exe`。請勿單獨移動該 EXE，因為它需要旁邊的 `resources` 檔案。
- GitHub Windows 下載檔是刻意維持**未簽署**。Microsoft SmartScreen 可能顯示警告；只有在確認檔案來自此 repository 的官方 GitHub Release 時，才選擇「更多資訊」→「仍要執行」。

### macOS

1. 下載適合你 Mac 的 `.dmg`。
2. 開啟 DMG，將 **CoolPilot** 拖到 **Applications**。
3. 從 Applications 開啟 CoolPilot。

正式 macOS 發佈會以 Apple Developer ID 簽署並完成 Apple 公證。更新 app 不會刪除保留在你電腦上的本機資料庫、瀏覽器 profile、上傳檔案或生成的 artifacts。

## 原始碼倉庫

```bash
git clone https://github.com/Edgarmongo/CoolPilot.git
cd CoolPilot
```

## 這套軟體可以做什麼

- 在桌面 app 或本機網頁控制台中執行 local-first social media workflow。
- 管理多個社群帳號，並為每個帳號保存獨立的持久化 Chromium browser profile。
- 讓使用者先手動登入各平台帳號，之後重複使用同一個 session 進行瀏覽器自動化。
- 從主題、prompt、URL 或文章內容生成社群貼文草稿。
- 透過設定的圖片 provider 生成或附加圖片。
- 建立 scheduled social posting runs，並在本機 SQLite 中追蹤執行紀錄。
- 使用 AI agent workflow 建立貼文、生成圖片、開啟頁面、點擊、輸入、截圖，以及在 Threads 草擬或發布貼文。
- 使用自己的 LLM/image API key；provider key 只保存在本機設定，agent 的每一步都在你的電腦上執行。
- 在「系統 → 模型管理」瀏覽主流廠商的模型版本清單，並集中管理所有 model provider。
- 在「Publishing → Accounts」執行靜默帳號風控巡檢，確認每個已儲存的 profile 仍能開啟發佈頁而不是卡在登入牆；巡檢判定未登入的帳號不會再浪費時間啟動瀏覽器。
- 在「系統設定 → 備份」把整個工作區匯出成單一 JSON 檔案並隨時還原，本機資料可攜、也保有自己的副本。
- 在「自動化 → 內容日曆」用同一個月曆檢視規劃、執行紀錄與發佈紀錄，還能把成效最好的時段一鍵變成每週排程。
- 在「系統 → 工作區」查看工作區實際內容：資料庫大小與資料表數量、內容素材、瀏覽器 profiles、影片，以及目前沒有任何東西指向的項目（`GET /api/workspace/manifest`）。這一頁只讀取，不會移動或刪除任何檔案。

目前瀏覽器自動化的核心是每個帳號各自獨立的持久化 Chromium profile。專案包含 CloakBrowser 作為 stealth Chromium dependency，但目前 app 的啟動路徑仍直接使用 Playwright persistent contexts。請把 stealth tooling 視為有用的依賴，而不是能保證避開平台偵測的承諾。

## 介面預覽

下方截圖來自真實 CoolPilot app UI，發布前已替換成 demo 帳號名稱，避免顯示真實站點資料。

![CoolPilot chat workspace with browser panel](public/screenshots/chat-workspace-browser.png)

## 套件與功能標籤

| 範圍 | 套件或系統 | 提供能力 |
| --- | --- | --- |
| App framework | Next.js 16 + React 19 | 本機控制台、App Router 頁面、API routes、standalone production output |
| Desktop runtime | Electron | 封裝桌面 app，執行本機控制台與瀏覽器 workflow |
| UI system | HeroUI, Tailwind CSS, lucide-react | Console layout、控制項、icon、設定、chat、內容頁面 |
| Local database | SQLite/libSQL + Drizzle ORM | 站點、內容、排程、runs、events、chat threads、tool calls、app settings |
| AI agent workflow | LangGraph/LangChain | 本機社群媒體 agent 的規劃與工具執行 |
| Browser automation | Playwright | 持久化 Chromium profiles、頁面導覽、截圖、表單輸入、發文動作 |
| Stealth browser dependency | CloakBrowser | 已納入的 stealth Chromium 套件，可供未來或客製 launcher alignment 使用 |
| Data fetching | SWR | Client-side refresh 與狀態載入 |
| Validation | Zod | API、tool、settings validation |
| AI providers | Gemini, Groq, OpenAI-compatible, OpenRouter | 使用者自備文字模型 key、model discovery、provider fallback |
| Image providers | Gemini image, OpenAI-compatible image endpoints | 為 AI agent 社群內容生成圖片 |

## 如何使用多個已登入帳號

1. 為每個帳號建立一個 site record，例如品牌 Threads 帳號、創作者帳號或客戶帳號。
2. 從 app 開啟該帳號的 browser profile。
3. 在該 profile 中手動登入平台。
4. 對每個要管理的帳號重複以上流程。
5. 在 chatroom 使用 `@` selector，或在 schedule/run 頁面選擇正確帳號。
6. 讓 worker 或 AI agent 對該帳號保存的 profile 執行任務。

每個 site 都會在本機資料目錄下保存自己的 profile path。Cookies、local storage 與帳號 session 會依 profile 分開，這是 multi-account browser automation 的基礎。

## AI Agent Workflow

Agent 可以像社群行銷營運助理一樣工作：

- 依主題或 campaign idea 草擬貼文
- 將 URL 轉成社群貼文
- 生成 image prompt 與圖片檔
- 在同一個 chat 中沿用最新貼文與圖片 context
- 開啟指定帳號 profile
- 草擬或發布 Threads 貼文
- 建立排程發文任務

Permission controls 可讓你選擇動作自動執行，或先要求人工確認。除非你非常信任 workflow，最終發布動作建議維持 confirm mode。

### 生成貼文範例

```text
Turn one focused study session into a small win today.

Clip a useful lesson, write down one takeaway, and share the insight
while it is still fresh. CoolPilot helps your agent prepare
the draft, pair it with an image concept, and schedule the post for
the right account without mixing browser profiles.

#AISocialMediaAgent #ScheduledPosting #LocalFirstAutomation
```

### Agent Tools

| Tool | 功能 |
| --- | --- |
| `generate_social_post_draft` | 依主題、prompt、選定站點、語言與品牌 context 生成社群貼文草稿，並存成本機內容。 |
| `generate_image_prompt` | 將貼文 context 轉成可用於圖片生成的 prompt，包含主體、構圖、風格、光線與比例。 |
| `generate_image_file` | 呼叫設定好的本機圖片 provider，並將生成圖片存成本機 artifact。 |
| `browser_open_page` | 在選定的本機 browser profile 或 site browser panel 中開啟 URL。 |
| `browser_click` | 在目前 browser session 中點擊 selector；若是最終發布動作，會套用更嚴格的 approval。 |
| `browser_type` | 在選定的 browser page 中輸入或填入文字。 |
| `browser_screenshot` | 擷取目前 browser page，並將截圖存成 artifact。 |
| `threads_create_post` | 透過選定的本機 browser profile 草擬或發布 Threads 貼文。 |

Chat layer 也能在已有站點、貼文 context 與發布授權時，將自然語言時間要求轉成 scheduled Threads post。

## 本機執行模式

CoolPilot 完全在你的電腦上執行，並使用你自己的 API key。模型 provider、本機資料與瀏覽器 session 都由你掌控。

沒有雲端執行模式、不需要註冊帳號，也沒有 managed credits：在 **系統 → 模型管理** 設定你要用的模型 key，agent 的每一步都會在本機對這些 provider 執行。

## 支援的 Providers

文字生成：

- Gemini
- Groq
- OpenAI-compatible APIs
- OpenRouter

圖片生成：

- Gemini image models
- OpenAI-compatible image generation endpoints

設定 key 後，app 可從 provider API 載入 model list。你也可以透過環境變數或 settings UI 指定 model ID。

**系統 → 模型管理**是集中處理模型的地方。「可用模型」分頁列出模型網關提供的所有 model id（由 `quanzil.com/api/user/models` 匯入，匯入時為 420 個），按廠商與能力分類，並附上各廠商的 OpenAI-compatible endpoint；「模型配置」分頁則集中設定本機 provider 的 key、endpoint 與模型。

### 同步自己的網關帳號

「可用模型」分頁提供 **模型網關同步** 開關。開關保持關閉時，頁面使用 app 內建的快照；要改用自己的帳號清單：

1. 開啟開關。
2. 把已登入網關工作階段的 `Cookie` 標頭內容貼到 **帳號 Session Cookie**，按 **儲存設定**。
3. 按 **同步模型**。

同步會呼叫卡片中的端點（預設 `https://quanzil.com/api/user/models`），把回傳的 model id 存進本機資料庫，目錄立即改用該清單——不需要重新建置，也不會寫回原始碼（打包後的 Electron 版本為唯讀）。按 **清除憑證並還原內建清單** 會同時刪除同步清單與 cookie。端點需回傳 `{"data":["model-a","model-b"]}` 或單純的 model id 陣列。

Cookie 只會送到該端點，並保存在本機 `.env.local`（與 provider key 同層，也可改用 `MODEL_GATEWAY_COOKIE` 環境變數），不會進入資料庫、日誌或版本庫。同步失敗時卡片會顯示原因，目錄仍使用上一次成功的清單。

重新匯入內建快照（開關關閉時使用）：

```bash
# 先把網關模型請求的原始 JSON body（{"data":["model-a", ...]}）存成檔案
tsx scripts/import-gateway-models.ts ./gateway-models.json --source=quanzil.com/api/user/models
```

匯入工具只讀取公開的 model id，請勿傳入含 cookie、token 或帳號資料的 payload（需要帶憑證的請求請改用上面提到的 app 內同步）。

用真實瀏覽器驗證頁面渲染（需要已啟動的 dev server）：

```bash
tsx scripts/model-management-smoke.ts http://127.0.0.1:3000 zh-cn
```

## 系統需求

- Node.js 20.9 或更新版本
- pnpm
- Playwright Chromium，用於 browser automation
- Windows、macOS 或 Linux

## 快速開始

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm exec playwright install chromium
pnpm dev
```

在第二個 terminal 啟動 worker：

```powershell
pnpm worker
```

開啟：

```text
http://127.0.0.1:3000
```

## 環境設定

最低設定：

```env
SOCIAL_AUTO_POST_DB_URL=file:./web-data/social-auto-post.db
SOCIAL_AUTO_POST_LOCAL_TOKEN=change-this-local-token
```

再加入你想使用的 provider：

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

每個 `*_API_KEYS` 變數都接受多把 key（用逗號或換行分隔）。AI runtime 會自動輪換，遇到
`429` 時先把該把 key 冷卻，因此單一 key 被限流不會讓整個 provider 離線。同樣的 key 也可以
在 **系統 / 模型管理 → 供应商与密钥** 逐個 provider 管理，存在本機加密保險庫而不是 `.env`
檔（詳見 `docs/model-runtime.md` §5）。

## 常用指令

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

如果本機環境因 ignored build-script policy 導致 `pnpm` 被阻擋，可用 direct binaries 驗證：

```powershell
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\vitest.cmd run
node_modules\.bin\eslint.cmd .
```

## Runtime Data

本機 runtime 檔案預設存放在 `web-data/`：

- `web-data/social-auto-post.db`：SQLite data
- `web-data/browser-profiles/`：已登入帳號 profiles
- `web-data/uploads/`：上傳素材
- `web-data/artifacts/`：生成圖片、截圖、agent artifacts

可透過 `SOCIAL_AUTO_POST_DATA_DIR` 或 `APP_DATA_DIR` 覆寫資料目錄。

### 工作區概況

「系統 → 工作區」（`/system/workspace`，資料來自 `GET /api/workspace/manifest`）顯示目前這個 process 開啟的工作區裡實際有什麼：資料庫與資料表數量、內容素材以及其中有多少被內容引用、瀏覽器 profile 的已關聯／未關聯數量、影片，以及 **需要留意** 區塊——列出工作區裡「沒有任何東西指向」的項目（未關聯的 profiles、目前版本讀不了的資料表、不屬於任何分區的根目錄檔案）。

這個 endpoint 唯讀而且 `force-dynamic`：

- 只讀取工作區，不會建立它：對全新安裝讀取概況，不會留下 `artifacts/`、`videos/` 或資料庫檔案。
- 缺少任何東西都只是一個更小的數字，不是錯誤：沒有資料庫、資料庫檔案其實不是資料庫、`uploads/` 不存在，都會回 `200`；只有 manifest 本身壞掉（程式 bug）才回標準錯誤格式。
- 路徑是正在執行的 app 解析出來的那一個（`SOCIAL_AUTO_POST_DATA_DIR`，packaged build 為 `APP_DATA_DIR`），所以數字不會是 build 機器的工作區。
- 頁面只讀取：沒有清理、匯出或刪除。備份與還原仍在「系統設定 → 備份」。

### 備份與還原

「系統設定 → 備份」會把 `web-data/social-auto-post.db` 內所有資料表匯出成單一 `coolpilot-backup-<日期>-<時間>.json`（`GET /api/backup/export`），之後可再寫回本機（`POST /api/backup/restore`）：

- `replace`：先清空備份檔涉及的資料表再匯入，還原後與備份完全一致。
- `merge`：保留現有資料，略過主鍵已存在的記錄。

寫入前會先驗證檔案；遇到目前版本不存在的資料表或欄位會略過並回報，而不是讓整次還原失敗。瀏覽器 profiles、uploads、videos 與 artifacts **不會**包含在 JSON 內，搬遷到其他電腦時請一併複製這些目錄；若 profile 路徑改變，重新登入一次即可。

請不要 commit `.env.local`、`web-data/`、browser profiles、database files、uploaded assets、generated artifacts 或 logs。

## 內容日曆

「自動化 → 內容日曆」（`/schedules/calendar`，資料來自 `GET /api/calendar`）是月度規劃檢視，會把三層資料疊在同一個月曆上，並可逐層開關：

- **計劃**：排程規則展開後的每一次執行時間（已暫停的排程也會顯示，並以刪除線標示）。
- **執行紀錄**：`runs` 的排隊／執行中／成功／警告／失敗結果。
- **發佈紀錄**：`publish_records` 中真正發佈出去的內容。

排程支援五種重複規則，下一次執行時間會取所有規則中最早的一次（`src/lib/schedule.ts`）：

| 類型 | 內容 | 行為 |
| --- | --- | --- |
| `once` | `{ type: "once", at }` | 單次絕對時間（ISO） |
| `daily` | `{ type: "daily", time }` | 每天的本機時間 `HH:MM` |
| `weekly` | `{ type: "weekly", time, weekdays }` | 指定的每個星期（0 = 週日 … 6 = 週六） |
| `monthly` | `{ type: "monthly", time, days }` | 指定的每月日期（1–31）；當月沒有該日時改用當月最後一天 |
| `interval` | `{ type: "interval", everyMinutes, anchor? }` | 每 N 分鐘一次；有 `anchor` 時對齊該時間點 |

右側欄會依真實互動成效排出**最佳發佈時段**（`bestTimeSlots`）。勾選一到多個「星期 × 時段」後按「用所選時段建立排程」，就會把它們合併成單一排程中的多條每週規則，讓日曆與成效資料互相對應。

月曆以週一為一週起始，當日面板會列出每個項目的時間、來源層、狀態、帳號與 playbook。

## Project Structure

```text
src/app/          Next.js pages and API routes
src/components/   Console UI and feature components
src/db/           SQLite schema, client, and repositories
src/lib/          AI, browser, agent, schedule, and utility logic
src/worker/       Queue and schedule worker
electron/         Electron entrypoints
scripts/          Build and packaging helpers
public/           Public assets
docs/             Model layer docs (model-gateway.md · model-gateway-plan.md · model-layer-spec.md · model-runtime.md · generate-migration.md) + tech stack (tech-stack.md)
```

## 安全與平台風險聲明

這套軟體會控制瀏覽器，並可能與第三方社群平台互動。使用自動化、多帳號 workflows、scraping、posting tools 或 stealth browser technology，可能違反平台服務條款或自動化政策。

你的帳號可能被要求驗證、被 rate-limit、限制功能、停權或封鎖。CloakBrowser 或任何 stealth Chromium tooling 都不能保證自動化能避開 bot detection、CAPTCHA、device checks、人工審查或平台執法。

請只在你擁有或被授權管理的帳號上使用 CoolPilot。不要將它用於 spam、冒充、欺騙性互動、憑證濫用、平台操縱或任何非法行為。你有責任在執行自動化 workflow 前確認平台規則與當地法律。

## License

MIT. See [LICENSE](LICENSE).
