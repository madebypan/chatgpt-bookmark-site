# ChatGPT setup prompt

把 GitHub repo 網址和以下內容一起貼給 ChatGPT：

```text
請從我提供的 GitHub repo 建立一個全新的 OpenAI Site，並完整做到可以使用為止。

要求：
1. 先讀 README、.openai/hosting.json、package.json 與 Sites 相關原始碼。
2. 這是公開模板。必須建立新的 Site；不要沿用、猜測或要求任何舊 project_id、正式網址、資料庫、bucket、憑證或 Git 歷史。
3. 保留 D1 binding `DB` 與 R2 binding `ARCHIVE`，讓 Sites 建立屬於我的獨立資源。
4. 請用安全的 runtime environment 設定流程取得必要的 `OWNER_EMAIL`，並設為 server-side Secret。不要把它寫進原始碼、Git、前端、D1、R2、log 或回覆摘要。
5. 詢問我是否要啟用語意搜尋。只有我選擇啟用時，才用安全的 Secret 設定流程取得 `GEMINI_API_KEY`；不要要求我把 key 放進程式碼或公開對話內容。未設定時也必須完成部署。
6. 安裝依賴，執行 test、lint 與正式 build；修正問題後再繼續。
7. 建立 Site、推送精確的來源版本、儲存 version 並部署。將 Site access 設為 public，因為 iPhone 收件與 MCP/OAuth 必須從公開網路到達；私人資料仍由應用程式的 OWNER_EMAIL 與 OAuth 權限保護。
8. 部署後驗證首頁未登入時會要求 ChatGPT 登入，OAuth discovery 正常，且 `/mcp` 未授權時不會回傳私人內容。
9. 回覆 production Site URL、驗證結果與 Bookmark Site plugin 的下一步。不要在回覆中顯示任何 Secret、token、authorization code、cookie 或帳號 Email。
10. 完成前不要停在本機 preview、未部署版本或只提供操作說明。
```

## English

```text
Create a brand-new OpenAI Site from the GitHub repository I provided and finish with a working deployment.

Requirements:
1. Read README.md, .openai/hosting.json, package.json, and the Sites-specific source first.
2. Treat this as a public template. Create a new Site; never reuse, guess, or request an old project ID, production URL, database, bucket, credential, or Git history.
3. Preserve the D1 `DB` and R2 `ARCHIVE` bindings so Sites provisions independent resources for me.
4. Obtain the required `OWNER_EMAIL` through the secure runtime-environment flow and store it as a server-side secret. Never put it in source, Git, frontend code, D1, R2, logs, or the final summary.
5. Ask whether I want semantic search. Only if I opt in, obtain `GEMINI_API_KEY` through the secure secret flow. Complete the deployment without it when I decline.
6. Install dependencies and run tests, lint, and the production build. Fix failures before continuing.
7. Create the Site, push the exact source version, save a version, and deploy it. Set Site access to public because iPhone capture and MCP/OAuth must be reachable from the internet; private data remains protected by OWNER_EMAIL and OAuth authorization in the application.
8. Verify that unauthenticated homepage access requires ChatGPT sign-in, OAuth discovery works, and unauthorized `/mcp` requests never return private content.
9. Return the production Site URL, verification summary, and the next step for the Bookmark Site plugin. Never reveal a secret, token, authorization code, cookie, or owner email.
10. Do not stop at a local preview, an undeployed version, or instructions-only handoff.
```
