# ChatGPT Bookmark Site

一個建在 OpenAI Sites 上的私人書籤收件匣：貼上網址，自動保存乾淨內容，之後可搜尋、閱讀，或讓 ChatGPT／Codex 透過唯讀 MCP 查詢。

這個 repo 是可重建的公開模板，不包含任何既有 Site ID、正式網址、帳號、Email、金鑰、token、資料庫內容或舊 Git 歷史。

## 最快開始：把 repo 丟給 ChatGPT

將這個 GitHub repo 的網址貼給 ChatGPT，並說：

> 請依照 `docs/CHATGPT_SETUP_PROMPT.md`，從這個 repo 建立一個全新的私人 Bookmark Site。不要沿用任何既有部署或憑證。完成建置、測試、部署與權限設定後，把 Site 網址交給我，並帶我連接 Bookmark Site plugin。

ChatGPT 會為你建立新的 Site 與獨立 D1／R2 資源。部署過程只需要：

- `OWNER_EMAIL`：必要，請設為 Site 的 server-side Secret；只有這個 ChatGPT 帳號能開啟私人介面。
- `GEMINI_API_KEY`：可選，請設為 server-side Secret；啟用語意搜尋與附引用問答。未設定時，收藏、全文搜尋、匯出與其他 MCP 工具仍可使用。

完整、可直接複製的中英文建站指令在 [docs/CHATGPT_SETUP_PROMPT.md](docs/CHATGPT_SETUP_PROMPT.md)。

## 功能

- 貼上網址後擷取標題、來源、作者、描述、正文與預覽圖。
- D1 FTS5 全文搜尋；可選 Gemini Embedding 2＋D1 語意檢索。
- R2 保存 Markdown、原始內容與預覽圖。
- iPhone 分享捷徑可用獨立、可撤銷、只具新增權限的收件金鑰。
- 唯讀 Streamable HTTP MCP：
  - `search_library`
  - `ask_library`
  - `read_bookmark`
  - `list_recent_bookmarks`
- MCP 支援 OAuth；每次授權都由 Site owner 使用 ChatGPT 登入並核准。

## 隱私與安全模型

Site 必須能從公開網路到達，iPhone 分享與 MCP/OAuth 才能運作；私人內容仍由應用程式預設上鎖：

- 首頁、收藏、預覽、匯出、索引與連線管理只允許 `OWNER_EMAIL`。
- `/mcp` 每次讀取都需要短效 OAuth token 或獨立唯讀金鑰。
- `/api/capture` 只接受收件金鑰，而且只能新增 URL，不能讀取、修改或刪除資料。
- D1 只保存金鑰與 OAuth token 的 SHA-256 雜湊，不保存可用明文。
- 擷取到的網頁一律視為不可信參考內容，不能覆寫系統指令。
- `.env*`、`.dev.vars*` 與本機設定不會進入 Git。

發現安全問題時請依 [SECURITY.md](SECURITY.md) 私下回報，不要建立公開 issue。

## Codex plugin

Repo 內含可安裝的 `Bookmark Site` plugin：

- `plugins/bookmark-site/`：plugin manifest、圖示與連線 skill。
- `.agents/plugins/marketplace.json`：repo marketplace。
- 三個 starter prompts：連線、查看近期收藏、搜尋收藏。

每位使用者的 Site URL 都不同，因此公開 plugin 不會寫死 MCP 網址。`Connect Bookmark Site` skill 會驗證你的 Site，使用 Codex 官方 OAuth 流程建立個人 MCP 連線，且不要求你把 token 或 code 貼進對話。安裝方式見 [docs/PLUGIN.md](docs/PLUGIN.md)。

## 本機開發

需求：Node.js 22.13 或更新版本。

```bash
npm install
npm run dev
```

預設開發網址為 `http://localhost:3000`。交付前執行：

```bash
npm test
npm run lint
npm run build
```

`.openai/hosting.json` 在模板中只宣告 D1 `DB` 與 R2 `ARCHIVE` bindings，刻意不含 `project_id`。首次建立 Site 時，OpenAI Sites 會寫入屬於該使用者的新 ID。

## English quick start

Give the repository URL to ChatGPT and ask it to follow `docs/CHATGPT_SETUP_PROMPT.md`. It should create a brand-new OpenAI Site, provision independent D1 and R2 resources, configure `OWNER_EMAIL` as a server-side secret, optionally configure `GEMINI_API_KEY`, validate the project, and deploy it. No existing deployment ID or credential is included in this repository.

## License

[MIT](LICENSE)
